import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  Query,
  Headers,
  UseInterceptors,
  UploadedFiles,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  BadRequestException,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiConsumes,
  ApiBody,
  ApiParam,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import type { CategoriesResponse, JobHistoryResponse } from '@wearme/shared';
import { TryOnService } from './try-on.service';
import { CreateTryOnJobDto } from './dto/create-job.dto';
import {
  CreateJobResponseDto,
  JobStatusResponseDto,
  ProcessJobResponseDto,
} from './dto/job-status.dto';
import { ConfigService } from '@nestjs/config';
import type { StorageConfig } from '../../config/configuration';

@ApiTags('try-on')
@Controller('try-on')
export class TryOnController {
  private readonly maxFileSizeBytes: number;

  constructor(
    private readonly tryOnService: TryOnService,
    private readonly configService: ConfigService,
  ) {
    const storage = this.configService.get<StorageConfig>('storage')!;
    this.maxFileSizeBytes = storage.maxFileSizeMb * 1024 * 1024;
  }

  @Get('categories')
  @ApiOperation({
    summary:
      'Get the full 38-item wearable category capability matrix and live provider support status',
  })
  @ApiResponse({ status: 200, description: 'Wearable category capability matrix' })
  async getCategories(): Promise<CategoriesResponse> {
    return this.tryOnService.getCategories();
  }

  @Get('jobs')
  @ApiOperation({
    summary:
      'List recent non-expired try-on jobs for the active browser session (filtered by comma-separated job IDs or session header)',
  })
  @ApiQuery({
    name: 'ids',
    required: false,
    description: 'Optional comma-separated UUIDs of session jobs to inspect',
  })
  @ApiResponse({ status: 200, description: 'Recent non-expired try-on jobs' })
  async listJobs(
    @Query('ids') ids?: string,
    @Headers('x-wearme-session-id') sessionId?: string,
  ): Promise<JobHistoryResponse> {
    return this.tryOnService.listRecentJobs(ids, sessionId);
  }

  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ upload: { ttl: 60_000, limit: 10 } })
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'personImage', maxCount: 1 },
        { name: 'garmentImage', maxCount: 1 },
      ],
      {
        storage: memoryStorage(),
        limits: { fileSize: 10 * 1024 * 1024, files: 2 }, // 10 MB max per file, max 2 files
        fileFilter: (_req, file, cb) => {
          const allowed = ['image/jpeg', 'image/png', 'image/webp'];
          if (allowed.includes(file.mimetype)) {
            cb(null, true);
          } else {
            cb(
              new BadRequestException(
                `Unsupported file type: ${file.mimetype}. Allowed: image/jpeg, image/png, image/webp.`,
              ),
              false,
            );
          }
        },
      },
    ),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Upload person and garment/product images to create a try-on job',
    schema: {
      type: 'object',
      required: ['personImage', 'garmentImage', 'category'],
      properties: {
        personImage: { type: 'string', format: 'binary' },
        garmentImage: { type: 'string', format: 'binary' },
        category: {
          type: 'string',
          enum: ['TOP', 'SHIRT', 'TSHIRT', 'JACKET', 'ACCESSORY'],
        },
        subcategory: {
          type: 'string',
          description:
            'Optional specific wearable subcategory (e.g. TSHIRT, SHIRT, SWEATER, HOODIE, JACKET, TOP, NECKLACE, PENDANT)',
        },
      },
    },
  })
  @ApiResponse({ status: 201, type: CreateJobResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid file type, missing file, or invalid category' })
  @ApiResponse({ status: 413, description: 'File too large (max 10 MB)' })
  async upload(
    @UploadedFiles()
    files: {
      personImage?: Express.Multer.File[];
      garmentImage?: Express.Multer.File[];
    },
    @Body() dto: CreateTryOnJobDto,
    @Headers('x-wearme-session-id') sessionId?: string,
  ): Promise<CreateJobResponseDto> {
    const personFile = files?.personImage?.[0];
    const garmentFile = files?.garmentImage?.[0];

    return this.tryOnService.createJob(
      personFile as Express.Multer.File,
      garmentFile as Express.Multer.File,
      dto.category,
      dto.subcategory,
      sessionId,
    );
  }

  @Post(':jobId/process')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Trigger AI inference for a job (synchronous in V1)' })
  @ApiParam({ name: 'jobId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: ProcessJobResponseDto })
  @ApiResponse({ status: 403, description: 'Job belongs to another session' })
  @ApiResponse({ status: 404, description: 'Job not found or expired' })
  @ApiResponse({ status: 500, description: 'AI processing failed' })
  async process(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Headers('x-wearme-session-id') sessionId?: string,
  ): Promise<ProcessJobResponseDto> {
    return this.tryOnService.processJob(jobId, sessionId);
  }

  @Get(':jobId/status')
  @ApiOperation({ summary: 'Get current job status and image URLs' })
  @ApiParam({ name: 'jobId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: JobStatusResponseDto })
  @ApiResponse({ status: 403, description: 'Job belongs to another session' })
  @ApiResponse({ status: 404, description: 'Job not found or expired' })
  async getStatus(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Headers('x-wearme-session-id') sessionId?: string,
  ): Promise<JobStatusResponseDto> {
    return this.tryOnService.getJobStatus(jobId, sessionId);
  }

  @Delete(':jobId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a job and all associated images' })
  @ApiParam({ name: 'jobId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Job and images deleted' })
  @ApiResponse({ status: 403, description: 'Job belongs to another session' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async deleteJob(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Headers('x-wearme-session-id') sessionId?: string,
  ): Promise<void> {
    return this.tryOnService.deleteJob(jobId, sessionId);
  }
}
