import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  UseInterceptors,
  UploadedFiles,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiConsumes,
  ApiBody,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
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
        limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB; config read in service
        fileFilter: (_req, file, cb) => {
          const allowed = ['image/jpeg', 'image/png', 'image/webp'];
          if (allowed.includes(file.mimetype)) {
            cb(null, true);
          } else {
            cb(new Error(`Unsupported file type: ${file.mimetype}`), false);
          }
        },
      },
    ),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Upload person and garment images to create a try-on job',
    schema: {
      type: 'object',
      required: ['personImage', 'garmentImage', 'category'],
      properties: {
        personImage: { type: 'string', format: 'binary' },
        garmentImage: { type: 'string', format: 'binary' },
        category: { type: 'string', enum: ['TOP', 'SHIRT', 'TSHIRT', 'JACKET'] },
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
  ): Promise<CreateJobResponseDto> {
    const personFile = files.personImage?.[0];
    const garmentFile = files.garmentImage?.[0];

    return this.tryOnService.createJob(
      personFile as Express.Multer.File,
      garmentFile as Express.Multer.File,
      dto.category,
    );
  }

  @Post(':jobId/process')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Trigger AI inference for a job (synchronous in V1)' })
  @ApiParam({ name: 'jobId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: ProcessJobResponseDto })
  @ApiResponse({ status: 404, description: 'Job not found' })
  @ApiResponse({ status: 500, description: 'AI processing failed' })
  async process(@Param('jobId', ParseUUIDPipe) jobId: string): Promise<ProcessJobResponseDto> {
    return this.tryOnService.processJob(jobId);
  }

  @Get(':jobId/status')
  @ApiOperation({ summary: 'Get current job status and image URLs' })
  @ApiParam({ name: 'jobId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: JobStatusResponseDto })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async getStatus(@Param('jobId', ParseUUIDPipe) jobId: string): Promise<JobStatusResponseDto> {
    return this.tryOnService.getJobStatus(jobId);
  }

  @Delete(':jobId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a job and all associated images' })
  @ApiParam({ name: 'jobId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Job and images deleted' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async deleteJob(@Param('jobId', ParseUUIDPipe) jobId: string): Promise<void> {
    return this.tryOnService.deleteJob(jobId);
  }
}

