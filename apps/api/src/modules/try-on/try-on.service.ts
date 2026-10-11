import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { ClothingCategory, TryOnStatus } from '@wearme/shared';
import type { TryOnJob } from '@wearme/database';
import { DatabaseService } from '../database/database.service';
import { StorageProvider } from '../storage/storage.provider';
import { VirtualTryOnProvider } from '../ai/virtual-tryon.provider';
import type { StorageConfig } from '../../config/configuration';
import {
  JobStatusResponseDto,
  CreateJobResponseDto,
  ProcessJobResponseDto,
} from './dto/job-status.dto';

// Allowed MIME types — checked server-side (in addition to Multer filter)
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const MIN_IMAGE_DIMENSION_PX = 64;
const MAX_IMAGE_DIMENSION_PX = 4096;

// Magic byte signatures for image validation
const MAGIC_BYTES: Array<{ mime: string; bytes: number[]; offset: number }> = [
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff], offset: 0 },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], offset: 0 },
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 }, // RIFF header
];

@Injectable()
export class TryOnService {
  private readonly logger = new Logger(TryOnService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageProvider,
    private readonly ai: VirtualTryOnProvider,
    private readonly configService: ConfigService,
  ) {}

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private validateMagicBytes(buffer: Buffer, mimeType: string, fieldName: string): void {
    const sig = MAGIC_BYTES.find((s) => s.mime === mimeType);
    if (!sig) return;

    if (buffer.length < sig.offset + sig.bytes.length) {
      throw new BadRequestException(
        `Uploaded file for ${fieldName} is truncated or too small.`,
      );
    }

    const actual = [...buffer.subarray(sig.offset, sig.offset + sig.bytes.length)];
    const match = sig.bytes.every((b, i) => actual[i] === b);
    if (!match) {
      throw new BadRequestException(
        `File signature for ${fieldName} does not match declared MIME type ${mimeType}.`,
      );
    }

    if (mimeType === 'image/webp') {
      if (buffer.length < 12 || buffer.subarray(8, 12).toString('ascii') !== 'WEBP') {
        throw new BadRequestException(
          `File signature for ${fieldName} is not a valid WebP container.`,
        );
      }
    }
  }

  private async validateFile(
    file: Express.Multer.File,
    fieldName: string,
  ): Promise<{ width: number; height: number }> {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException(`Missing or empty required file: ${fieldName}`);
    }
    const storageCfg = this.configService.get<StorageConfig>('storage')!;
    const maxBytes = (storageCfg?.maxFileSizeMb ?? 10) * 1024 * 1024;
    if (file.buffer.length > maxBytes) {
      throw new BadRequestException(
        `File ${fieldName} exceeds maximum upload size of ${storageCfg?.maxFileSizeMb ?? 10} MB.`,
      );
    }
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(
        `Invalid file type for ${fieldName}: ${file.mimetype}. Allowed: image/jpeg, image/png, image/webp.`,
      );
    }
    this.validateMagicBytes(file.buffer, file.mimetype, fieldName);

    let width: number | undefined;
    let height: number | undefined;
    try {
      const metadata = await sharp(file.buffer).metadata();
      width = metadata.width;
      height = metadata.height;
    } catch {
      throw new BadRequestException(
        `Uploaded image for ${fieldName} is corrupt or cannot be decoded.`,
      );
    }

    if (!width || !height) {
      throw new BadRequestException(
        `Could not determine image dimensions for ${fieldName}.`,
      );
    }

    if (width < MIN_IMAGE_DIMENSION_PX || height < MIN_IMAGE_DIMENSION_PX) {
      throw new BadRequestException(
        `Image dimensions for ${fieldName} (${width}x${height}px) are too small. Minimum size is ${MIN_IMAGE_DIMENSION_PX}x${MIN_IMAGE_DIMENSION_PX}px.`,
      );
    }

    if (width > MAX_IMAGE_DIMENSION_PX || height > MAX_IMAGE_DIMENSION_PX) {
      throw new BadRequestException(
        `Image dimensions for ${fieldName} (${width}x${height}px) exceed maximum allowed size of ${MAX_IMAGE_DIMENSION_PX}x${MAX_IMAGE_DIMENSION_PX}px.`,
      );
    }

    return { width, height };
  }

  private storageKey(jobId: string, type: 'person' | 'garment' | 'result', mime: string): string {
    const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    return `jobs/${jobId}/${type}.${ext}`;
  }

  private retentionDate(): Date {
    const config = this.configService.get<StorageConfig>('storage')!;
    const d = new Date();
    d.setDate(d.getDate() + config.imageRetentionDays);
    return d;
  }

  private async jobToStatusDto(job: TryOnJob): Promise<JobStatusResponseDto> {
    const dto = new JobStatusResponseDto();
    dto.jobId = job.id;
    dto.status = job.status as TryOnStatus;
    dto.category = job.category;
    dto.createdAt = job.createdAt.toISOString();
    dto.completedAt = job.completedAt?.toISOString();
    dto.aiProvider = job.aiProvider ?? undefined;
    dto.errorMessage = job.errorMessage ?? undefined;

    if (job.personImageKey) {
      dto.personImageUrl = await this.storage.getUrl(job.personImageKey);
    }
    if (job.garmentImageKey) {
      dto.garmentImageUrl = await this.storage.getUrl(job.garmentImageKey);
    }
    if (job.resultImageKey) {
      dto.resultUrl = await this.storage.getUrl(job.resultImageKey);
    }

    return dto;
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Upload person + garment images and create a PENDING job.
   */
  async createJob(
    personFile: Express.Multer.File,
    garmentFile: Express.Multer.File,
    category: ClothingCategory,
  ): Promise<CreateJobResponseDto> {
    const [personDims, garmentDims] = await Promise.all([
      this.validateFile(personFile, 'personImage'),
      this.validateFile(garmentFile, 'garmentImage'),
    ]);

    const jobId = uuidv4();
    const personKey = this.storageKey(jobId, 'person', personFile.mimetype);
    const garmentKey = this.storageKey(jobId, 'garment', garmentFile.mimetype);

    // Upload both images
    await Promise.all([
      this.storage.upload(personKey, personFile.buffer, personFile.mimetype),
      this.storage.upload(garmentKey, garmentFile.buffer, garmentFile.mimetype),
    ]);

    // Create job record
    const job = await this.db.tryOnJob.create({
      data: {
        id: jobId,
        status: 'PENDING',
        category,
        personImageKey: personKey,
        garmentImageKey: garmentKey,
        personImageMeta: {
          size: personFile.size,
          mimeType: personFile.mimetype,
          width: personDims.width,
          height: personDims.height,
        },
        garmentImageMeta: {
          size: garmentFile.size,
          mimeType: garmentFile.mimetype,
          width: garmentDims.width,
          height: garmentDims.height,
        },
        expiresAt: this.retentionDate(),
      },
    });

    this.logger.log(`Job created: ${job.id} (${category})`);

    return {
      jobId: job.id,
      status: job.status as TryOnStatus,
      createdAt: job.createdAt.toISOString(),
    };
  }

  /**
   * Synchronously process a job — call AI provider, store result, update status.
   */
  async processJob(jobId: string): Promise<ProcessJobResponseDto> {
    const job = await this.db.tryOnJob.findUnique({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException(`Job not found: ${jobId}`);
    }
    if (job.status === 'PROCESSING' || job.status === 'COMPLETED') {
      const statusDto = await this.jobToStatusDto(job);
      return {
        jobId: job.id,
        status: statusDto.status,
        resultUrl: statusDto.resultUrl,
      };
    }

    // Mark as PROCESSING
    await this.db.tryOnJob.update({
      where: { id: jobId },
      data: { status: 'PROCESSING' },
    });

    try {
      const [personBuffer, garmentBuffer] = await Promise.all([
        this.storage.download(job.personImageKey),
        this.storage.download(job.garmentImageKey),
      ]);

      const result = await this.ai.processJob({
        jobId,
        personImageBuffer: personBuffer,
        garmentImageBuffer: garmentBuffer,
        personMimeType:
          (job.personImageMeta as Record<string, string>)?.['mimeType'] ?? 'image/jpeg',
        garmentMimeType:
          (job.garmentImageMeta as Record<string, string>)?.['mimeType'] ?? 'image/jpeg',
        category: job.category as ClothingCategory,
      });

      const resultKey = this.storageKey(jobId, 'result', result.resultMimeType);
      await this.storage.upload(resultKey, result.resultImageBuffer, result.resultMimeType);

      const updatedJob = await this.db.tryOnJob.update({
        where: { id: jobId },
        data: {
          status: 'COMPLETED',
          resultImageKey: resultKey,
          aiProvider: result.provider,
          aiProviderMeta: { inferenceMs: result.inferenceMs, ...(result.metadata ?? {}) },
          completedAt: new Date(),
        },
      });

      this.logger.log(
        `Job ${jobId} COMPLETED via ${result.provider} in ${result.inferenceMs}ms`,
      );

      return {
        jobId,
        status: updatedJob.status as TryOnStatus,
        resultUrl: await this.storage.getUrl(resultKey),
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Job ${jobId} FAILED: ${message}`);

      await this.db.tryOnJob.update({
        where: { id: jobId },
        data: { status: 'FAILED', errorMessage: message },
      });

      throw new InternalServerErrorException(message);
    }
  }

  /**
   * Get current status of a job.
   */
  async getJobStatus(jobId: string): Promise<JobStatusResponseDto> {
    const job = await this.db.tryOnJob.findUnique({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException(`Job not found: ${jobId}`);
    }
    return this.jobToStatusDto(job);
  }

  /**
   * Delete all images and the job record.
   */
  async deleteJob(jobId: string): Promise<void> {
    const job = await this.db.tryOnJob.findUnique({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException(`Job not found: ${jobId}`);
    }

    // Delete all associated files from storage
    const deletePromises: Promise<void>[] = [
      this.storage.delete(job.personImageKey),
      this.storage.delete(job.garmentImageKey),
    ];
    if (job.resultImageKey) {
      deletePromises.push(this.storage.delete(job.resultImageKey));
    }

    await Promise.all(deletePromises);
    await this.db.tryOnJob.delete({ where: { id: jobId } });

    this.logger.log(`Job ${jobId} deleted (all files and record removed)`);
  }
}
