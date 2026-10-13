import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  Query,
  Headers,
  Res,
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
import type { Response } from 'express';
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
import {
  extractAuthTokenFromCookieHeader,
  extractSessionIdFromCookieHeader,
  verifyCustomerAuthToken,
} from '../storage/file-token.util';

const SAFE_SESSION_ID_REGEX = /^[a-zA-Z0-9_-]{8,128}$/;

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

  private resolveAndBindSessionCookie(
    headerSessionId?: string,
    cookieHeader?: string,
    res?: Response,
  ): string | undefined {
    const candidate =
      headerSessionId && SAFE_SESSION_ID_REGEX.test(headerSessionId.trim())
        ? headerSessionId.trim()
        : extractSessionIdFromCookieHeader(cookieHeader);
    if (candidate && SAFE_SESSION_ID_REGEX.test(candidate) && res?.cookie) {
      res.cookie('wearme_session_id_v1', candidate, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env['NODE_ENV'] === 'production',
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
    }
    return candidate;
  }

  private resolveAuthenticatedUserId(
    authorizationHeader?: string,
    authTokenHeader?: string,
    cookieHeader?: string,
  ): string | null {
    const rawToken =
      authorizationHeader ??
      authTokenHeader ??
      extractAuthTokenFromCookieHeader(cookieHeader);
    const verified = verifyCustomerAuthToken(rawToken);
    return verified?.sub ?? null;
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
      'List recent non-expired try-on jobs for the authenticated user or active browser session',
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
    @Headers('authorization') authorizationHeader?: string,
    @Headers('x-wearme-auth-token') authTokenHeader?: string,
    @Headers('cookie') cookieHeader?: string,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<JobHistoryResponse> {
    const effectiveSession = this.resolveAndBindSessionCookie(sessionId, cookieHeader, res);
    const userId = this.resolveAuthenticatedUserId(
      authorizationHeader,
      authTokenHeader,
      cookieHeader,
    );
    return this.tryOnService.listRecentJobs(ids, effectiveSession, userId);
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
        storeId: {
          type: 'string',
          description:
            'Optional storeId hint; only honored when backed by an active server-side STORE_SPONSORED TryOnSession',
        },
        idempotencyKey: {
          type: 'string',
          description: 'Optional idempotency key',
        },
      },
    },
  })
  @ApiResponse({ status: 201, type: CreateJobResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid file type, missing file, or invalid category' })
  @ApiResponse({ status: 403, description: 'Expired store-sponsored session or exhausted quota' })
  @ApiResponse({ status: 413, description: 'File too large (max 10 MB)' })
  async upload(
    @UploadedFiles()
    files: {
      personImage?: Express.Multer.File[];
      garmentImage?: Express.Multer.File[];
    },
    @Body() dto: CreateTryOnJobDto,
    @Headers('x-wearme-session-id') sessionId?: string,
    @Headers('authorization') authorizationHeader?: string,
    @Headers('x-wearme-auth-token') authTokenHeader?: string,
    @Headers('x-idempotency-key') idempotencyKeyHeader?: string,
    @Headers('cookie') cookieHeader?: string,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<CreateJobResponseDto> {
    const personFile = files?.personImage?.[0];
    const garmentFile = files?.garmentImage?.[0];
    const effectiveSession = this.resolveAndBindSessionCookie(sessionId, cookieHeader, res);
    const userId = this.resolveAuthenticatedUserId(
      authorizationHeader,
      authTokenHeader,
      cookieHeader,
    );

    return this.tryOnService.createJob(
      personFile as Express.Multer.File,
      garmentFile as Express.Multer.File,
      dto.category,
      dto.subcategory,
      effectiveSession,
      dto.storeId,
      {
        userId,
        idempotencyKey: idempotencyKeyHeader ?? dto.idempotencyKey,
      },
    );
  }

  @Post(':jobId/process')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Trigger AI inference for a job (synchronous in V1)' })
  @ApiParam({ name: 'jobId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: ProcessJobResponseDto })
  @ApiResponse({ status: 403, description: 'Job belongs to another user or session' })
  @ApiResponse({ status: 404, description: 'Job not found or expired' })
  @ApiResponse({ status: 500, description: 'AI processing failed' })
  async process(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Headers('x-wearme-session-id') sessionId?: string,
    @Headers('authorization') authorizationHeader?: string,
    @Headers('x-wearme-auth-token') authTokenHeader?: string,
    @Headers('cookie') cookieHeader?: string,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<ProcessJobResponseDto> {
    const effectiveSession = this.resolveAndBindSessionCookie(sessionId, cookieHeader, res);
    const userId = this.resolveAuthenticatedUserId(
      authorizationHeader,
      authTokenHeader,
      cookieHeader,
    );
    return this.tryOnService.processJob(jobId, effectiveSession, userId);
  }

  @Get(':jobId/status')
  @ApiOperation({ summary: 'Get current job status and image URLs' })
  @ApiParam({ name: 'jobId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: JobStatusResponseDto })
  @ApiResponse({ status: 403, description: 'Job belongs to another user or session' })
  @ApiResponse({ status: 404, description: 'Job not found or expired' })
  async getStatus(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Headers('x-wearme-session-id') sessionId?: string,
    @Headers('authorization') authorizationHeader?: string,
    @Headers('x-wearme-auth-token') authTokenHeader?: string,
    @Headers('cookie') cookieHeader?: string,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<JobStatusResponseDto> {
    const effectiveSession = this.resolveAndBindSessionCookie(sessionId, cookieHeader, res);
    const userId = this.resolveAuthenticatedUserId(
      authorizationHeader,
      authTokenHeader,
      cookieHeader,
    );
    return this.tryOnService.getJobStatus(jobId, effectiveSession, userId);
  }

  @Delete(':jobId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a job and all associated images' })
  @ApiParam({ name: 'jobId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Job and images deleted' })
  @ApiResponse({ status: 403, description: 'Job belongs to another user or session' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async deleteJob(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Headers('x-wearme-session-id') sessionId?: string,
    @Headers('authorization') authorizationHeader?: string,
    @Headers('x-wearme-auth-token') authTokenHeader?: string,
    @Headers('cookie') cookieHeader?: string,
  ): Promise<void> {
    const effectiveSession = this.resolveAndBindSessionCookie(sessionId, cookieHeader);
    const userId = this.resolveAuthenticatedUserId(
      authorizationHeader,
      authTokenHeader,
      cookieHeader,
    );
    return this.tryOnService.deleteJob(jobId, effectiveSession, userId);
  }
}
