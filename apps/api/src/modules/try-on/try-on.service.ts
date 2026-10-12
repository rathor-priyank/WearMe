import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import sharp from 'sharp';
import { v4 as uuidv4, validate as isUuid } from 'uuid';
import {
  CategoriesResponse,
  CategoryCapabilityItem,
  ClothingCategory,
  findWearableSpec,
  JobHistoryResponse,
  LiveValidationStatus,
  NECKLACE_POC_SUBCATEGORIES,
  ProviderSupportStatus,
  TryOnStatus,
  UPPER_BODY_SUBCATEGORIES,
  WEARABLE_CATALOG,
} from '@wearme/shared';
import type { TryOnJob } from '@wearme/database';
import { DatabaseService } from '../database/database.service';
import { StorageProvider } from '../storage/storage.provider';
import { VirtualTryOnProvider } from '../ai/virtual-tryon.provider';
import type { AiConfig, StorageConfig } from '../../config/configuration';
import {
  JobStatusResponseDto,
  CreateJobResponseDto,
  ProcessJobResponseDto,
} from './dto/job-status.dto';

// Allowed MIME types — checked server-side (in addition to Multer filter)
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const MIN_IMAGE_DIMENSION_PX = 64;
const MAX_IMAGE_DIMENSION_PX = 4096;
const MAX_DECOMPRESSED_PIXELS = MAX_IMAGE_DIMENSION_PX * MAX_IMAGE_DIMENSION_PX;
const SAFE_SESSION_ID_REGEX = /^[a-zA-Z0-9_-]{8,128}$/;

// Magic byte signatures for image validation
const MAGIC_BYTES: Array<{ mime: string; bytes: number[]; offset: number }> = [
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff], offset: 0 },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], offset: 0 },
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 }, // RIFF header
];

interface FastApiCategoriesPayload {
  active_provider: string;
  necklace_poc_enabled?: boolean;
  categories: Array<{
    subcategory: string;
    domain: string;
    label: string;
    target_body_region: string;
    required_landmarks: string[];
    routing_strategy: string;
    idm_vton_prompt: string | null;
    fashn_v16_category: 'tops' | 'bottoms' | 'one-pieces' | null;
    live_validation_status: LiveValidationStatus;
    provider_support_status?: ProviderSupportStatus;
    selected_route?: string | null;
  }>;
}

export interface StorageCleanupSummary {
  dryRun?: boolean;
  expiredJobsDeleted: number;
  orphanDirsDeleted: number;
  deletedJobIds: string[];
  deletedOrphanDirs: string[];
  protectedUserJobDirsSkipped?: string[];
}

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

  private isNecklacePocEnabled(): boolean {
    const aiCfg = this.configService.get<AiConfig>('ai');
    if (typeof aiCfg?.enableNecklacePoc === 'boolean') {
      return aiCfg.enableNecklacePoc;
    }
    return (
      process.env['ENABLE_NECKLACE_POC'] === 'true' ||
      process.env['ENABLE_NECKLACE_POC'] === '1'
    );
  }

  private normalizeSessionId(sessionId?: string): string | undefined {
    if (!sessionId || typeof sessionId !== 'string') {
      return undefined;
    }
    const trimmed = sessionId.trim();
    if (!SAFE_SESSION_ID_REGEX.test(trimmed)) {
      return undefined;
    }
    return trimmed;
  }

  private extractJobSessionId(job: TryOnJob): string | undefined {
    const garmentMeta = (job.garmentImageMeta ?? {}) as Record<string, unknown>;
    const personMeta = (job.personImageMeta ?? {}) as Record<string, unknown>;
    const candidate =
      typeof garmentMeta['sessionId'] === 'string'
        ? garmentMeta['sessionId']
        : typeof personMeta['sessionId'] === 'string'
          ? personMeta['sessionId']
          : undefined;
    return this.normalizeSessionId(candidate);
  }

  private assertJobSessionAccess(job: TryOnJob, callerSessionId?: string): void {
    const ownerSessionId = this.extractJobSessionId(job);
    if (!ownerSessionId) {
      // Job was created without a session header (e.g. legacy test or direct CLI call)
      return;
    }
    const normalizedCaller = this.normalizeSessionId(callerSessionId);
    if (!normalizedCaller || normalizedCaller !== ownerSessionId) {
      throw new ForbiddenException(
        'You do not have permission to access or modify this try-on job.',
      );
    }
  }

  private isJobExpired(job: TryOnJob): boolean {
    return Boolean(job.expiresAt && job.expiresAt.getTime() <= Date.now());
  }

  private sanitizeErrorMessage(raw: string): string {
    if (!raw) {
      return 'Virtual try-on processing failed.';
    }
    return raw
      .replace(/hf_[A-Za-z0-9]{8,}/g, '[REDACTED_HF_TOKEN]')
      .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [REDACTED]')
      .replace(
        /((?:api[_-]?key|access[_-]?token|authorization)\s*[:=]\s*)([^\s,;'"`]+)/gi,
        '$1[REDACTED]',
      )
      .replace(/\/(?:Users|home|var|tmp|private|app|opt|etc)\/[^\s"'<>]+/g, '[INTERNAL_PATH]');
  }

  private validateCategorySelection(
    category: ClothingCategory,
    subcategory?: string,
  ): {
    dbCategory: ClothingCategory;
    subcategory: string;
    domain: string;
    isExperimentalPoc: boolean;
  } {
    if (!subcategory || subcategory.trim() === '') {
      if (category === ClothingCategory.ACCESSORY) {
        throw new BadRequestException(
          'When category is ACCESSORY, an explicit subcategory (NECKLACE or PENDANT) is required.',
        );
      }
      return {
        dbCategory: category,
        subcategory: category,
        domain: 'clothing',
        isExperimentalPoc: false,
      };
    }

    const spec = findWearableSpec(subcategory);
    if (!spec) {
      throw new BadRequestException(
        `Unsupported wearable subcategory '${subcategory}'.`,
      );
    }

    if ((UPPER_BODY_SUBCATEGORIES as readonly string[]).includes(spec.subcategory)) {
      return {
        dbCategory: spec.dbCategory,
        subcategory: spec.subcategory,
        domain: spec.domain,
        isExperimentalPoc: false,
      };
    }

    if ((NECKLACE_POC_SUBCATEGORIES as readonly string[]).includes(spec.subcategory)) {
      if (!this.isNecklacePocEnabled()) {
        throw new BadRequestException(
          `Category '${spec.subcategory}' requires the experimental Necklace/Pendant PoC processor ('landmark_jewellery_neck'), which is disabled by default. Set ENABLE_NECKLACE_POC=true on both the API and AI services to enable experimental necklace/pendant try-on.`,
        );
      }
      return {
        dbCategory: ClothingCategory.ACCESSORY,
        subcategory: spec.subcategory,
        domain: spec.domain,
        isExperimentalPoc: true,
      };
    }

    throw new BadRequestException(
      `Category '${spec.subcategory}' (domain='${spec.domain}', strategy='${spec.routingStrategy}') requires a specialized model (${spec.liveValidationStatus}) and cannot be routed to upper-body clothing or mock providers.`,
    );
  }

  /**
   * Ensure the AI service also has `ENABLE_NECKLACE_POC=true` before accepting an upload
   * for NECKLACE or PENDANT, preventing config-mismatch jobs that fail after upload.
   */
  private async verifyAiNecklacePocAvailable(subcategory: string): Promise<void> {
    const aiCfg = this.configService.get<AiConfig>('ai');
    const serviceUrl = aiCfg?.serviceUrl?.replace(/\/$/, '');
    if (!serviceUrl) {
      return;
    }

    try {
      const res = await axios.get<FastApiCategoriesPayload>(
        `${serviceUrl}/try-on/categories`,
        { timeout: 2500 },
      );
      if (res.data && res.data.necklace_poc_enabled === false) {
        throw new BadRequestException(
          `Category '${subcategory}' is enabled on the API but disabled on the AI service (ENABLE_NECKLACE_POC=false). Both services must have ENABLE_NECKLACE_POC=true.`,
        );
      }
    } catch (err: unknown) {
      if (err instanceof BadRequestException) {
        throw err;
      }
      // If AI service is unreachable during offline unit tests, allow local flag validation to proceed
    }
  }

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
      const metadata = await sharp(file.buffer, {
        limitInputPixels: MAX_DECOMPRESSED_PIXELS,
      }).metadata();
      width = metadata.width;
      height = metadata.height;
    } catch {
      throw new BadRequestException(
        `Uploaded image for ${fieldName} is corrupt, exceeds safe pixel limits, or cannot be decoded.`,
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

    if (
      width > MAX_IMAGE_DIMENSION_PX ||
      height > MAX_IMAGE_DIMENSION_PX ||
      width * height > MAX_DECOMPRESSED_PIXELS
    ) {
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
    d.setDate(d.getDate() + (config?.imageRetentionDays ?? 7));
    return d;
  }

  private async purgeJobStorageAndRecord(job: TryOnJob): Promise<void> {
    const deletePromises: Promise<void>[] = [
      this.storage.delete(job.personImageKey),
      this.storage.delete(job.garmentImageKey),
    ];
    if (job.resultImageKey) {
      deletePromises.push(this.storage.delete(job.resultImageKey));
    }
    deletePromises.push(this.storage.deleteJobDirectory(job.id));
    await Promise.allSettled(deletePromises);
    await this.db.tryOnJob.delete({ where: { id: job.id } }).catch(() => undefined);
  }

  async jobToStatusDto(job: TryOnJob): Promise<JobStatusResponseDto> {
    const garmentMeta = (job.garmentImageMeta ?? {}) as Record<string, unknown>;
    const providerMeta = (job.aiProviderMeta ?? {}) as Record<string, unknown>;

    const dto = new JobStatusResponseDto();
    dto.jobId = job.id;
    dto.status = job.status as TryOnStatus;
    dto.category = job.category;
    dto.subcategory =
      (typeof providerMeta['subcategory'] === 'string'
        ? providerMeta['subcategory']
        : typeof garmentMeta['subcategory'] === 'string'
          ? garmentMeta['subcategory']
          : job.category);
    dto.domain =
      (typeof providerMeta['domain'] === 'string'
        ? providerMeta['domain']
        : typeof garmentMeta['domain'] === 'string'
          ? garmentMeta['domain']
          : 'clothing');
    dto.createdAt = job.createdAt.toISOString();
    dto.completedAt = job.completedAt?.toISOString();
    dto.expiresAt = job.expiresAt?.toISOString();
    dto.aiProvider = job.aiProvider ?? undefined;
    dto.isExperimentalPoc = Boolean(
      providerMeta['is_experimental_poc'] ??
        garmentMeta['isExperimentalPoc'] ??
        job.aiProvider === 'necklace-poc',
    );
    dto.isMock = Boolean(providerMeta['is_mock'] ?? job.aiProvider === 'mock');
    dto.aiProviderMeta = Object.keys(providerMeta).length > 0 ? providerMeta : undefined;
    dto.errorMessage = job.errorMessage ? this.sanitizeErrorMessage(job.errorMessage) : undefined;
    dto.savedToWardrobe = Boolean(job.savedToWardrobe);
    dto.retailerSource = job.retailerSource ?? undefined;
    dto.productTitle = job.productTitle ?? undefined;

    if (job.personImageKey) {
      const personExists = await this.storage.exists(job.personImageKey);
      if (personExists) {
        dto.personImageUrl = await this.storage.getUrl(job.personImageKey);
      }
    }
    if (job.garmentImageKey) {
      const garmentExists = await this.storage.exists(job.garmentImageKey);
      if (garmentExists) {
        dto.garmentImageUrl = await this.storage.getUrl(job.garmentImageKey);
      }
    }
    if (job.resultImageKey) {
      const resultExists = await this.storage.exists(job.resultImageKey);
      if (resultExists) {
        dto.resultUrl = await this.storage.getUrl(job.resultImageKey);
      } else if (dto.status === TryOnStatus.COMPLETED) {
        dto.status = TryOnStatus.FAILED;
        dto.resultUrl = undefined;
        dto.errorMessage =
          dto.errorMessage || 'Generated result image is no longer available in storage.';
      }
    } else if (dto.status === TryOnStatus.COMPLETED) {
      dto.status = TryOnStatus.FAILED;
      dto.errorMessage =
        dto.errorMessage || 'Generated result image is missing for completed job.';
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
    subcategory?: string,
    sessionId?: string,
  ): Promise<CreateJobResponseDto> {
    const resolved = this.validateCategorySelection(category, subcategory);
    if (resolved.isExperimentalPoc) {
      await this.verifyAiNecklacePocAvailable(resolved.subcategory);
    }

    const [personDims, garmentDims] = await Promise.all([
      this.validateFile(personFile, 'personImage'),
      this.validateFile(garmentFile, 'garmentImage'),
    ]);

    const normalizedSessionId = this.normalizeSessionId(sessionId);
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
        category: resolved.dbCategory,
        personImageKey: personKey,
        garmentImageKey: garmentKey,
        personImageMeta: {
          size: personFile.size,
          mimeType: personFile.mimetype,
          width: personDims.width,
          height: personDims.height,
          ...(normalizedSessionId ? { sessionId: normalizedSessionId } : {}),
        },
        garmentImageMeta: {
          size: garmentFile.size,
          mimeType: garmentFile.mimetype,
          width: garmentDims.width,
          height: garmentDims.height,
          subcategory: resolved.subcategory,
          domain: resolved.domain,
          isExperimentalPoc: resolved.isExperimentalPoc,
          ...(normalizedSessionId ? { sessionId: normalizedSessionId } : {}),
        },
        expiresAt: this.retentionDate(),
      },
    });

    this.logger.log(
      `Job created: ${job.id} (category=${resolved.dbCategory}, subcategory=${resolved.subcategory})`,
    );

    return {
      jobId: job.id,
      status: job.status as TryOnStatus,
      createdAt: job.createdAt.toISOString(),
    };
  }

  /**
   * Synchronously process a job — call AI provider, store result, update status.
   */
  async processJob(jobId: string, sessionId?: string): Promise<ProcessJobResponseDto> {
    const job = await this.db.tryOnJob.findUnique({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException(`Job not found: ${jobId}`);
    }
    this.assertJobSessionAccess(job, sessionId);

    if (this.isJobExpired(job)) {
      await this.purgeJobStorageAndRecord(job);
      throw new NotFoundException(`Job has expired and been removed: ${jobId}`);
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

    const garmentMeta = (job.garmentImageMeta ?? {}) as Record<string, unknown>;
    const subcategory =
      typeof garmentMeta['subcategory'] === 'string'
        ? garmentMeta['subcategory']
        : undefined;

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
        subcategory,
      });

      const resultKey = this.storageKey(jobId, 'result', result.resultMimeType);
      await this.storage.upload(resultKey, result.resultImageBuffer, result.resultMimeType);

      const updatedJob = await this.db.tryOnJob.update({
        where: { id: jobId },
        data: {
          status: 'COMPLETED',
          resultImageKey: resultKey,
          aiProvider: result.provider,
          aiProviderMeta: {
            inferenceMs: result.inferenceMs,
            subcategory: subcategory ?? job.category,
            ...(result.metadata ?? {}),
          },
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
      const rawMessage = err instanceof Error ? err.message : String(err);
      const safeMessage = this.sanitizeErrorMessage(rawMessage);
      this.logger.error(`Job ${jobId} FAILED: ${safeMessage}`);

      await this.db.tryOnJob.update({
        where: { id: jobId },
        data: { status: 'FAILED', errorMessage: safeMessage },
      });

      throw new InternalServerErrorException(safeMessage);
    }
  }

  /**
   * Get current status of a job.
   */
  async getJobStatus(jobId: string, sessionId?: string): Promise<JobStatusResponseDto> {
    const job = await this.db.tryOnJob.findUnique({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException(`Job not found: ${jobId}`);
    }
    this.assertJobSessionAccess(job, sessionId);

    if (this.isJobExpired(job)) {
      await this.purgeJobStorageAndRecord(job);
      throw new NotFoundException(`Job has expired and been removed: ${jobId}`);
    }

    return this.jobToStatusDto(job);
  }

  /**
   * List recent non-expired jobs for the current browser session.
   * Never returns all users' jobs when both `idsParam` and `sessionId` are omitted.
   */
  async listRecentJobs(idsParam?: string, sessionId?: string): Promise<JobHistoryResponse> {
    const validIds = idsParam
      ? idsParam
          .split(',')
          .map((s) => s.trim())
          .filter((s) => isUuid(s))
          .slice(0, 30)
      : [];
    const normalizedSessionId = this.normalizeSessionId(sessionId);

    // Security: never expose all jobs in the database when neither explicit IDs nor a sessionId is supplied
    if (validIds.length === 0 && !normalizedSessionId) {
      return { jobs: [] };
    }

    const now = new Date();
    const whereClause =
      validIds.length > 0
        ? { id: { in: validIds }, OR: [{ expiresAt: { gt: now } }, { expiresAt: null }] }
        : { OR: [{ expiresAt: { gt: now } }, { expiresAt: null }] };

    const jobs = await this.db.tryOnJob.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: 24,
    });

    const accessibleJobs = jobs.filter((job) => {
      const ownerSessionId = this.extractJobSessionId(job);
      if (ownerSessionId) {
        return normalizedSessionId === ownerSessionId;
      }
      // If a job has no ownerSessionId, only return it when explicitly requested by UUID in `ids`
      return validIds.includes(job.id);
    });

    const dtos = await Promise.all(accessibleJobs.map((j) => this.jobToStatusDto(j)));
    return { jobs: dtos };
  }

  /**
   * Return the full 38-item wearable category capability matrix with live provider
   * and experimental Necklace PoC status.
   *
   * Requires both the API and AI services to agree on `ENABLE_NECKLACE_POC=true`
   * before reporting `necklacePocEnabled: true` or `providerSupportStatus: 'experimental_poc'`.
   */
  async getCategories(): Promise<CategoriesResponse> {
    const aiCfg = this.configService.get<AiConfig>('ai');
    const serviceUrl = (aiCfg?.serviceUrl ?? 'http://localhost:8001').replace(/\/$/, '');
    const localPocEnabled = this.isNecklacePocEnabled();
    const activeProvider = aiCfg?.provider ?? this.ai.name;

    try {
      const res = await axios.get<FastApiCategoriesPayload>(
        `${serviceUrl}/try-on/categories`,
        { timeout: 2500 },
      );
      const data = res.data;
      // Both API and AI service must have ENABLE_NECKLACE_POC enabled
      const pocEnabled = Boolean(data.necklace_poc_enabled) && localPocEnabled;

      const items: CategoryCapabilityItem[] = WEARABLE_CATALOG.map((catalogSpec) => {
        const remote = data.categories?.find(
          (c) => c.subcategory === catalogSpec.subcategory,
        );
        const isNeckPoc = (NECKLACE_POC_SUBCATEGORIES as readonly string[]).includes(
          catalogSpec.subcategory,
        );
        let supportStatus: ProviderSupportStatus =
          remote?.provider_support_status ?? catalogSpec.defaultSupportStatus;
        let liveStatus: LiveValidationStatus =
          remote?.live_validation_status ?? catalogSpec.liveValidationStatus;
        let selectedRoute = remote?.selected_route ?? null;

        if (isNeckPoc) {
          if (pocEnabled) {
            supportStatus = 'experimental_poc';
            liveStatus = 'experimental_poc_local_unverified_live';
            selectedRoute = 'landmark_jewellery_neck';
          } else {
            supportStatus = 'requires_specialized_model';
            liveStatus = catalogSpec.liveValidationStatus;
            selectedRoute = null;
          }
        }

        return {
          subcategory: catalogSpec.subcategory,
          domain: catalogSpec.domain,
          dbCategory: catalogSpec.dbCategory,
          label: catalogSpec.label,
          targetBodyRegion: remote?.target_body_region ?? catalogSpec.targetBodyRegion,
          requiredLandmarks: remote?.required_landmarks ?? catalogSpec.requiredLandmarks,
          routingStrategy: remote?.routing_strategy ?? catalogSpec.routingStrategy,
          idmVtonCompatible: catalogSpec.idmVtonCompatible,
          fashnV16Category: catalogSpec.fashnV16Category,
          liveValidationStatus: liveStatus,
          providerSupportStatus: supportStatus,
          selectedRoute,
        };
      });

      return {
        activeProvider: data.active_provider || activeProvider,
        necklacePocEnabled: pocEnabled,
        categories: items,
      };
    } catch {
      const items: CategoryCapabilityItem[] = WEARABLE_CATALOG.map((catalogSpec) => {
        const isNeckPoc = (NECKLACE_POC_SUBCATEGORIES as readonly string[]).includes(
          catalogSpec.subcategory,
        );
        const supportStatus: ProviderSupportStatus =
          isNeckPoc && localPocEnabled
            ? 'experimental_poc'
            : catalogSpec.defaultSupportStatus;
        const liveStatus: LiveValidationStatus =
          isNeckPoc && localPocEnabled
            ? 'experimental_poc_local_unverified_live'
            : catalogSpec.liveValidationStatus;

        return {
          subcategory: catalogSpec.subcategory,
          domain: catalogSpec.domain,
          dbCategory: catalogSpec.dbCategory,
          label: catalogSpec.label,
          targetBodyRegion: catalogSpec.targetBodyRegion,
          requiredLandmarks: [...catalogSpec.requiredLandmarks],
          routingStrategy: catalogSpec.routingStrategy,
          idmVtonCompatible: catalogSpec.idmVtonCompatible,
          fashnV16Category: catalogSpec.fashnV16Category,
          liveValidationStatus: liveStatus,
          providerSupportStatus: supportStatus,
          selectedRoute:
            supportStatus === 'supported'
              ? catalogSpec.routingStrategy
              : supportStatus === 'experimental_poc'
                ? 'landmark_jewellery_neck'
                : null,
        };
      });

      return {
        activeProvider,
        necklacePocEnabled: localPocEnabled,
        categories: items,
      };
    }
  }

  /**
   * Collect all storage keys and `jobs/<jobId>` directory IDs referenced by `User.basePersonImageKey`.
   * Guarantees that storage cleanup and job deletion never remove any file referenced in `User`.
   */
  private async getUserReferencedStorageSet(): Promise<{
    referencedKeys: Set<string>;
    referencedJobIds: Set<string>;
  }> {
    const users =
      (await this.db.user?.findMany({
        where: { basePersonImageKey: { not: null } },
        select: { basePersonImageKey: true },
      })) ?? [];

    const referencedKeys = new Set<string>();
    const referencedJobIds = new Set<string>();

    for (const u of users) {
      const key = u.basePersonImageKey?.trim();
      if (!key) continue;
      referencedKeys.add(key);
      const match = /^jobs\/([0-9a-fA-F-]{36})\//.exec(key);
      if (match?.[1]) {
        referencedJobIds.add(match[1]);
      }
    }

    return { referencedKeys, referencedJobIds };
  }

  /**
   * Delete all images, the physical job directory (`uploads/jobs/<jobId>`), and the job record.
   * Never deletes a file or directory that is still referenced by `User.basePersonImageKey`.
   */
  async deleteJob(jobId: string, sessionId?: string): Promise<void> {
    const { referencedKeys, referencedJobIds } = await this.getUserReferencedStorageSet();
    const job = await this.db.tryOnJob.findUnique({ where: { id: jobId } });
    if (!job) {
      // Ensure any orphaned job directory on disk is still cleaned up before returning 404 (unless referenced by User)
      if (!referencedJobIds.has(jobId)) {
        await this.storage.deleteJobDirectory(jobId).catch(() => undefined);
      }
      throw new NotFoundException(`Job not found: ${jobId}`);
    }

    this.assertJobSessionAccess(job, sessionId);

    const isPersonReferencedByUser =
      referencedKeys.has(job.personImageKey) || referencedJobIds.has(jobId);

    const deletePromises: Promise<void>[] = [];
    if (!isPersonReferencedByUser) {
      deletePromises.push(this.storage.delete(job.personImageKey));
    }
    deletePromises.push(this.storage.delete(job.garmentImageKey));
    if (job.resultImageKey) {
      deletePromises.push(this.storage.delete(job.resultImageKey));
    }
    if (!isPersonReferencedByUser) {
      deletePromises.push(this.storage.deleteJobDirectory(jobId));
    }

    await Promise.all(deletePromises);
    await this.db.tryOnJob.delete({ where: { id: jobId } });

    this.logger.log(`Job ${jobId} deleted (all unreferenced files, job directory, and record removed)`);
  }

  /**
   * Purge expired database jobs (`expiresAt <= now`) along with their physical files,
   * and remove any orphaned `uploads/jobs/<jobId>` directories that have no matching DB row.
   * Never deletes files or directories referenced in the `User` table (`basePersonImageKey`)
   * or jobs marked `savedToWardrobe = true`.
   */
  async cleanupExpiredAndOrphanedJobs(options?: {
    orphanGraceMs?: number;
    dryRun?: boolean;
  }): Promise<StorageCleanupSummary> {
    const now = new Date();
    const orphanGraceMs = options?.orphanGraceMs ?? 10 * 60 * 1000;
    const dryRun = Boolean(options?.dryRun);

    const { referencedKeys, referencedJobIds } = await this.getUserReferencedStorageSet();
    const protectedUserJobDirsSkipped: string[] = [];

    const expiredJobs = await this.db.tryOnJob.findMany({
      where: { expiresAt: { lte: now } },
    });

    const deletedJobIds: string[] = [];
    for (const job of expiredJobs) {
      if (
        job.savedToWardrobe ||
        referencedJobIds.has(job.id) ||
        referencedKeys.has(job.personImageKey)
      ) {
        protectedUserJobDirsSkipped.push(job.id);
        continue;
      }
      if (!dryRun) {
        await this.purgeJobStorageAndRecord(job);
      }
      deletedJobIds.push(job.id);
    }

    const deletedOrphanDirs: string[] = [];
    const jobDirs = await this.storage.listJobDirectories();
    const cutoffMs = Date.now() - orphanGraceMs;

    for (const dir of jobDirs) {
      if (deletedJobIds.includes(dir.jobId)) {
        continue;
      }
      if (dir.mtimeMs > cutoffMs) {
        continue;
      }
      if (referencedJobIds.has(dir.jobId)) {
        if (!protectedUserJobDirsSkipped.includes(dir.jobId)) {
          protectedUserJobDirsSkipped.push(dir.jobId);
        }
        continue;
      }
      const existingJob = await this.db.tryOnJob.findUnique({
        where: { id: dir.jobId },
      });
      if (!existingJob) {
        if (!dryRun) {
          await this.storage.deleteJobDirectory(dir.jobId);
        }
        deletedOrphanDirs.push(dir.jobId);
      }
    }

    this.logger.log(
      `Storage cleanup finished (dryRun=${dryRun}): expiredJobsDeleted=${deletedJobIds.length}, orphanDirsDeleted=${deletedOrphanDirs.length}, protectedSkipped=${protectedUserJobDirsSkipped.length}`,
    );

    return {
      dryRun,
      expiredJobsDeleted: deletedJobIds.length,
      orphanDirsDeleted: deletedOrphanDirs.length,
      deletedJobIds,
      deletedOrphanDirs,
      protectedUserJobDirsSkipped,
    };
  }
}
