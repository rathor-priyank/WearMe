import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type {
  RequestOtpResponse,
  UpgradeSessionResponse,
  WardrobeResponse,
} from '@wearme/shared';
import { JobStatusResponseDto } from '../try-on/dto/job-status.dto';
import {
  RequestOtpDto,
  UpgradeSessionDto,
  WardrobeCatalogTryOnDto,
} from './dto/wardrobe.dto';
import { WardrobeService } from './wardrobe.service';

@ApiTags('auth & wardrobe')
@Controller()
export class WardrobeController {
  constructor(private readonly wardrobeService: WardrobeService) {}

  @Post('auth/request-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 15 } })
  @ApiOperation({
    summary:
      'Request a WhatsApp OTP verification code to upgrade the anonymous x-wearme-session-id session',
  })
  @ApiResponse({ status: 200, description: 'OTP challenge generated for session' })
  async requestOtp(
    @Headers('x-wearme-session-id') sessionId: string | undefined,
    @Body() dto: RequestOtpDto,
  ): Promise<RequestOtpResponse> {
    return this.wardrobeService.requestOtp(sessionId, dto);
  }

  @Post('auth/upgrade-session')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 15 } })
  @ApiOperation({
    summary:
      'Verify OTP and atomically upgrade the anonymous TryOnSession and its jobs into a persistent User wardrobe',
  })
  @ApiResponse({
    status: 200,
    description: 'Session upgraded and persistent wardrobe token issued',
  })
  @ApiResponse({ status: 401, description: 'Invalid, expired, or locked OTP challenge' })
  async upgradeSession(
    @Headers('x-wearme-session-id') sessionId: string | undefined,
    @Body() dto: UpgradeSessionDto,
  ): Promise<UpgradeSessionResponse> {
    return this.wardrobeService.upgradeSession(sessionId, dto);
  }

  @Get('wardrobe')
  @ApiOperation({
    summary:
      'Get the authenticated B2C Digital Wardrobe (saved base portrait, saved looks, and cross-retailer catalog)',
  })
  @ApiResponse({ status: 200, description: 'Digital wardrobe payload' })
  @ApiResponse({ status: 401, description: 'Unauthenticated session' })
  async getWardrobe(
    @Headers('authorization') authorization?: string,
    @Headers('x-wearme-auth-token') authToken?: string,
    @Headers('x-wearme-session-id') sessionId?: string,
  ): Promise<WardrobeResponse> {
    return this.wardrobeService.getWardrobe(authorization, authToken, sessionId);
  }

  @Post('wardrobe/save-job/:jobId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Save a completed try-on job directly to an already-authenticated wardrobe',
  })
  @ApiParam({ name: 'jobId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: JobStatusResponseDto })
  async saveJob(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Headers('authorization') authorization?: string,
    @Headers('x-wearme-auth-token') authToken?: string,
    @Headers('x-wearme-session-id') sessionId?: string,
  ): Promise<JobStatusResponseDto> {
    return this.wardrobeService.saveJobToWardrobe(
      jobId,
      authorization,
      authToken,
      sessionId,
    );
  }

  @Post('wardrobe/try-on')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ upload: { ttl: 60_000, limit: 10 } })
  @ApiOperation({
    summary:
      'Run a 1-click cross-retailer virtual try-on using the user’s saved base portrait without re-uploading a selfie',
  })
  @ApiResponse({ status: 201, type: JobStatusResponseDto })
  async tryOnFromCatalog(
    @Body() dto: WardrobeCatalogTryOnDto,
    @Headers('authorization') authorization?: string,
    @Headers('x-wearme-auth-token') authToken?: string,
    @Headers('x-wearme-session-id') sessionId?: string,
  ): Promise<JobStatusResponseDto> {
    return this.wardrobeService.tryOnFromCatalog(
      dto,
      authorization,
      authToken,
      sessionId,
    );
  }
}

