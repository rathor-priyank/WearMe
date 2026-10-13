import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Optional,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type {
  AuthChannelsResponse,
  ContactInquiryResponse,
  DeleteAccountResponse,
  DeletePortraitResponse,
  EntitlementStatusResponse,
  PartnerStoreAnalyticsResponse,
  PartnerStoreAuthResponse,
  PartnerStorePublicInfo,
  PartnerStoreQrTokenResponse,
  PartnerStoreSubscriptionResponse,
  PartnerStoreUsageResponse,
  RequestOtpResponse,
  SponsoredSessionStateResponse,
  UpgradeSessionResponse,
  WardrobeResponse,
} from '@wearme/shared';
import { JobStatusResponseDto } from '../try-on/dto/job-status.dto';
import {
  extractAuthTokenFromCookieHeader,
  extractSessionIdFromCookieHeader,
  verifyCustomerAuthToken,
} from '../storage/file-token.util';
import {
  ContactInquiryDto,
  RequestOtpDto,
  UpgradeSessionDto,
  WardrobeCatalogTryOnDto,
} from './dto/wardrobe.dto';
import { UsageEntitlementService } from './usage-entitlement.service';
import { WardrobeService } from './wardrobe.service';

const AUTH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

@ApiTags('auth & wardrobe')
@Controller()
export class WardrobeController {
  constructor(
    private readonly wardrobeService: WardrobeService,
    @Optional() private readonly usageEntitlementService?: UsageEntitlementService,
  ) {}

  private resolveOptionalUserId(
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

  private setAuthCookies(
    res: Response | undefined,
    authToken: string,
    sessionId?: string,
  ): void {
    if (!res?.cookie) return;
    const isProd = process.env['NODE_ENV'] === 'production';

    res.cookie('wearme_auth_token_v1', authToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      path: '/',
      maxAge: AUTH_COOKIE_MAX_AGE_MS,
    });

    res.cookie('wearme_logged_in_v1', '1', {
      httpOnly: false,
      sameSite: 'lax',
      secure: isProd,
      path: '/',
      maxAge: AUTH_COOKIE_MAX_AGE_MS,
    });

    if (sessionId) {
      res.cookie('wearme_session_id_v1', sessionId, {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProd,
        path: '/',
        maxAge: AUTH_COOKIE_MAX_AGE_MS,
      });
    }
  }

  private clearAuthCookies(res: Response | undefined): void {
    if (!res?.clearCookie) return;
    const isProd = process.env['NODE_ENV'] === 'production';
    const opts = {
      sameSite: 'lax' as const,
      secure: isProd,
      path: '/',
    };
    res.clearCookie('wearme_auth_token_v1', { ...opts, httpOnly: true });
    res.clearCookie('wearme_session_id_v1', { ...opts, httpOnly: true });
    res.clearCookie('wearme_logged_in_v1', { ...opts, httpOnly: false });
  }

  @Get('auth/channels')
  @ApiOperation({
    summary: 'List supported OTP verification channels (WhatsApp, SMS, Email) and live availability',
  })
  @ApiResponse({ status: 200, description: 'Available OTP authentication channels' })
  getAuthChannels(): AuthChannelsResponse {
    return this.wardrobeService.getAuthChannels();
  }

  @Post('auth/request-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 15 } })
  @ApiOperation({
    summary:
      'Request a WhatsApp, SMS, or Email OTP verification code to upgrade the anonymous x-wearme-session-id session or sign in',
  })
  @ApiResponse({ status: 200, description: 'OTP challenge generated for session' })
  async requestOtp(
    @Headers('x-wearme-session-id') sessionId: string | undefined,
    @Headers('cookie') cookieHeader: string | undefined,
    @Body() dto: RequestOtpDto,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<RequestOtpResponse> {
    const effectiveSession = sessionId ?? extractSessionIdFromCookieHeader(cookieHeader);
    const result = await this.wardrobeService.requestOtp(effectiveSession, dto);
    if (res?.cookie && result.sessionToken) {
      res.cookie('wearme_session_id_v1', result.sessionToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env['NODE_ENV'] === 'production',
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
    }
    return result;
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
    description: 'Session upgraded and persistent wardrobe HttpOnly cookie issued',
  })
  @ApiResponse({ status: 401, description: 'Invalid, expired, or locked OTP challenge' })
  async upgradeSession(
    @Headers('x-wearme-session-id') sessionId: string | undefined,
    @Headers('cookie') cookieHeader: string | undefined,
    @Body() dto: UpgradeSessionDto,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<UpgradeSessionResponse> {
    const effectiveSession = sessionId ?? extractSessionIdFromCookieHeader(cookieHeader);
    const response = await this.wardrobeService.upgradeSession(effectiveSession, dto);
    this.setAuthCookies(res, response.authToken, effectiveSession);
    return response;
  }

  @Post('auth/logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign out the current customer session and clear authentication cookies',
  })
  @ApiResponse({ status: 200, description: 'Session signed out' })
  async logout(
    @Headers('x-wearme-session-id') sessionId?: string,
    @Headers('cookie') cookieHeader?: string,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<{ loggedOut: boolean }> {
    const effectiveSession = sessionId ?? extractSessionIdFromCookieHeader(cookieHeader);
    const result = await this.wardrobeService.logoutSession(effectiveSession);
    this.clearAuthCookies(res);
    return result;
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
    @Headers('cookie') cookieHeader?: string,
    @Headers('x-wearme-partner-store-id') partnerStoreId?: string,
    @Headers('x-wearme-partner-key') partnerKey?: string,
  ): Promise<WardrobeResponse> {
    return this.wardrobeService.getWardrobe(
      authorization,
      authToken,
      sessionId,
      cookieHeader,
      partnerStoreId,
      partnerKey,
    );
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
    @Headers('cookie') cookieHeader?: string,
  ): Promise<JobStatusResponseDto> {
    return this.wardrobeService.saveJobToWardrobe(
      jobId,
      authorization,
      authToken,
      sessionId,
      cookieHeader,
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
    @Headers('cookie') cookieHeader?: string,
  ): Promise<JobStatusResponseDto> {
    return this.wardrobeService.tryOnFromCatalog(
      dto,
      authorization,
      authToken,
      sessionId,
      cookieHeader,
    );
  }

  @Delete('wardrobe/portrait')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete the authenticated customer’s saved base portrait from storage and database',
  })
  @ApiResponse({ status: 200, description: 'Saved base portrait deleted' })
  async deletePortrait(
    @Headers('authorization') authorization?: string,
    @Headers('x-wearme-auth-token') authToken?: string,
    @Headers('x-wearme-session-id') sessionId?: string,
    @Headers('cookie') cookieHeader?: string,
    @Headers('x-wearme-partner-store-id') partnerStoreId?: string,
    @Headers('x-wearme-partner-key') partnerKey?: string,
  ): Promise<DeletePortraitResponse> {
    return this.wardrobeService.deleteUserPortrait(
      authorization,
      authToken,
      sessionId,
      cookieHeader,
      partnerStoreId,
      partnerKey,
    );
  }

  @Delete('wardrobe/account')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Permanently delete the authenticated customer’s account, saved base portrait, and all saved try-on jobs',
  })
  @ApiResponse({ status: 200, description: 'Account and associated assets permanently deleted' })
  async deleteAccount(
    @Headers('authorization') authorization?: string,
    @Headers('x-wearme-auth-token') authToken?: string,
    @Headers('x-wearme-session-id') sessionId?: string,
    @Headers('cookie') cookieHeader?: string,
    @Headers('x-wearme-partner-store-id') partnerStoreId?: string,
    @Headers('x-wearme-partner-key') partnerKey?: string,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<DeleteAccountResponse> {
    const result = await this.wardrobeService.deleteUserAccount(
      authorization,
      authToken,
      sessionId,
      cookieHeader,
      partnerStoreId,
      partnerKey,
    );
    this.clearAuthCookies(res);
    return result;
  }

  @Get('wardrobe/stores/:storeId/public')
  @ApiOperation({
    summary:
      'Resolve verified public boutique metadata by storeId so client UI never trusts URL-injected store names',
  })
  @ApiResponse({ status: 200, description: 'Verified boutique public info' })
  getPublicStoreInfo(@Param('storeId') storeId: string): PartnerStorePublicInfo {
    return this.wardrobeService.getPublicStoreInfo(storeId);
  }

  @Get('wardrobe/stores/:storeId/info')
  @ApiOperation({
    summary:
      'Resolve verified public boutique metadata by storeId (alias for /wardrobe/stores/:storeId/public)',
  })
  @ApiResponse({ status: 200, description: 'Verified boutique public info' })
  getPublicStoreInfoAlias(@Param('storeId') storeId: string): PartnerStorePublicInfo {
    return this.wardrobeService.getPublicStoreInfo(storeId);
  }

  @Post('wardrobe/stores/:storeId/sessions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Start or inspect a bounded Store-Sponsored QR Session (does NOT extend lifetime on page refresh or remote forceRefreshScan; renewal requires a valid single-use qrToken)',
  })
  @ApiResponse({ status: 200, description: 'Bounded store-sponsored session state' })
  async createOrInspectStoreSponsoredSession(
    @Param('storeId') storeId: string,
    @Body() body?: { forceRefreshScan?: boolean; qrToken?: string },
    @Headers('x-wearme-session-id') sessionId?: string,
    @Headers('authorization') authorization?: string,
    @Headers('x-wearme-auth-token') authToken?: string,
    @Headers('cookie') cookieHeader?: string,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<SponsoredSessionStateResponse> {
    const effectiveSession = sessionId ?? extractSessionIdFromCookieHeader(cookieHeader);
    const userId = this.resolveOptionalUserId(authorization, authToken, cookieHeader);
    const result = await this.usageEntitlementService!.createOrInspectSponsoredSession(
      storeId,
      effectiveSession,
      {
        userId,
        forceRefreshScan: body?.forceRefreshScan === true,
        qrToken: body?.qrToken,
      },
    );
    if (res?.cookie && result.sessionToken) {
      res.cookie('wearme_session_id_v1', result.sessionToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env['NODE_ENV'] === 'production',
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
    }
    return result;
  }

  @Get('wardrobe/stores/:storeId/sessions')
  @ApiOperation({
    summary:
      'Inspect the current bounded Store-Sponsored QR Session state without resetting session lifetime',
  })
  @ApiResponse({ status: 200, description: 'Bounded store-sponsored session state' })
  async inspectStoreSponsoredSession(
    @Param('storeId') storeId: string,
    @Headers('x-wearme-session-id') sessionId?: string,
    @Headers('authorization') authorization?: string,
    @Headers('x-wearme-auth-token') authToken?: string,
    @Headers('cookie') cookieHeader?: string,
  ): Promise<SponsoredSessionStateResponse> {
    const effectiveSession = sessionId ?? extractSessionIdFromCookieHeader(cookieHeader);
    const userId = this.resolveOptionalUserId(authorization, authToken, cookieHeader);
    return this.usageEntitlementService!.createOrInspectSponsoredSession(
      storeId,
      effectiveSession,
      {
        userId,
        forceRefreshScan: false,
      },
    );
  }

  @Get('entitlements/me')
  @ApiOperation({
    summary:
      'Get current effective billing mode, store-sponsored session state, and personal try-on entitlement',
  })
  @ApiResponse({ status: 200, description: 'Current entitlement status' })
  async getEntitlementsMe(
    @Headers('x-wearme-session-id') sessionId?: string,
    @Headers('authorization') authorization?: string,
    @Headers('x-wearme-auth-token') authToken?: string,
    @Headers('cookie') cookieHeader?: string,
  ): Promise<EntitlementStatusResponse> {
    const effectiveSession = sessionId ?? extractSessionIdFromCookieHeader(cookieHeader);
    const userId = this.resolveOptionalUserId(authorization, authToken, cookieHeader);
    return this.usageEntitlementService!.getEntitlementStatus(effectiveSession, userId);
  }

  @Get('entitlements/session')
  @ApiOperation({
    summary:
      'Get current session entitlement status (alias for /entitlements/me for anonymous or authenticated sessions)',
  })
  @ApiResponse({ status: 200, description: 'Current entitlement status' })
  async getEntitlementsSession(
    @Headers('x-wearme-session-id') sessionId?: string,
    @Headers('authorization') authorization?: string,
    @Headers('x-wearme-auth-token') authToken?: string,
    @Headers('cookie') cookieHeader?: string,
  ): Promise<EntitlementStatusResponse> {
    const effectiveSession = sessionId ?? extractSessionIdFromCookieHeader(cookieHeader);
    const userId = this.resolveOptionalUserId(authorization, authToken, cookieHeader);
    return this.usageEntitlementService!.getEntitlementStatus(effectiveSession, userId);
  }

  @Post('entitlements/session/switch-personal')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Explicitly switch the current session from an expired or active store-sponsored session to Personal WearMe mode',
  })
  @ApiResponse({ status: 200, description: 'Switched to Personal WearMe mode' })
  async switchSessionToPersonal(
    @Headers('x-wearme-session-id') sessionId?: string,
    @Headers('authorization') authorization?: string,
    @Headers('x-wearme-auth-token') authToken?: string,
    @Headers('cookie') cookieHeader?: string,
  ): Promise<EntitlementStatusResponse> {
    const effectiveSession = sessionId ?? extractSessionIdFromCookieHeader(cookieHeader);
    const userId = this.resolveOptionalUserId(authorization, authToken, cookieHeader);
    return this.usageEntitlementService!.switchSessionToPersonalMode(effectiveSession, userId);
  }

  @Post('partner/stores/:storeId/auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Authenticate a boutique partner API key for production partner dashboard access',
  })
  @ApiResponse({ status: 200, description: 'Partner API key verified' })
  async authenticatePartnerStore(
    @Param('storeId') storeId: string,
    @Body() body?: { apiKey?: string },
    @Headers('x-wearme-partner-key') partnerKeyHeader?: string,
  ): Promise<PartnerStoreAuthResponse> {
    const effectiveKey = body?.apiKey?.trim() || partnerKeyHeader?.trim();
    return this.usageEntitlementService!.authenticatePartnerStore(storeId, effectiveKey);
  }

  @Post('partner/stores/:storeId/subscription/renew')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Explicitly authorize and renew a partner store subscription for a new 30-day billing period',
  })
  @ApiResponse({ status: 200, description: 'Partner store subscription renewed' })
  async renewPartnerStoreSubscription(
    @Param('storeId') storeId: string,
    @Body() body?: { planId?: string; includedCredits?: number },
    @Headers('x-wearme-partner-store-id') partnerStoreHeader?: string,
    @Headers('x-wearme-partner-key') partnerKeyHeader?: string,
  ): Promise<PartnerStoreSubscriptionResponse> {
    return this.usageEntitlementService!.renewPartnerStoreSubscription(
      storeId,
      {
        partnerStoreHeader,
        partnerKeyHeader,
      },
      {
        planId: body?.planId,
        includedCredits: body?.includedCredits,
      },
    );
  }

  @Post('partner/stores/:storeId/qr-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Issue a short-lived, single-use signed QR check-in token for in-store session renewal',
  })
  @ApiResponse({ status: 200, description: 'Signed store QR check-in token issued' })
  async issuePartnerStoreQrToken(
    @Param('storeId') storeId: string,
    @Body() body?: { ttlSeconds?: number },
    @Headers('x-wearme-partner-store-id') partnerStoreHeader?: string,
    @Headers('x-wearme-partner-key') partnerKeyHeader?: string,
  ): Promise<PartnerStoreQrTokenResponse> {
    return this.usageEntitlementService!.issueStoreQrCheckInToken(
      storeId,
      {
        partnerStoreHeader,
        partnerKeyHeader,
      },
      {
        ttlSeconds: body?.ttlSeconds,
      },
    );
  }

  @Get('partner/stores/:storeId/subscription')
  @ApiOperation({
    summary:
      'Get PartnerStoreSubscription details (plan, billing period, included/consumed/reserved/remaining credits, failed generation count)',
  })
  @ApiResponse({ status: 200, description: 'Partner store subscription details' })
  async getPartnerStoreSubscription(
    @Param('storeId') storeId: string,
    @Headers('x-wearme-partner-store-id') partnerStoreHeader?: string,
    @Headers('x-wearme-partner-key') partnerKeyHeader?: string,
  ): Promise<PartnerStoreSubscriptionResponse> {
    return this.usageEntitlementService!.getPartnerStoreSubscription(storeId, {
      partnerStoreHeader,
      partnerKeyHeader,
    });
  }

  @Get('partner/stores/:storeId/usage')
  @ApiOperation({
    summary:
      'Get aggregated, privacy-safe PartnerStoreUsageResponse including subscription quota, session counts, and recent ledger events',
  })
  @ApiResponse({ status: 200, description: 'Partner store usage and ledger summary' })
  async getPartnerStoreUsage(
    @Param('storeId') storeId: string,
    @Headers('x-wearme-partner-store-id') partnerStoreHeader?: string,
    @Headers('x-wearme-partner-key') partnerKeyHeader?: string,
  ): Promise<PartnerStoreUsageResponse> {
    return this.usageEntitlementService!.getPartnerStoreUsage(storeId, {
      partnerStoreHeader,
      partnerKeyHeader,
    });
  }

  @Get('wardrobe/stores/:storeId/analytics')
  @ApiOperation({
    summary:
      'Get privacy-preserving aggregated operational metrics for a partner boutique (no customer portraits, generated images, or PII)',
  })
  @ApiResponse({ status: 200, description: 'Aggregated store metrics' })
  async getPartnerStoreAnalytics(
    @Param('storeId') storeId: string,
    @Headers('x-wearme-partner-store-id') partnerStoreHeader?: string,
    @Headers('x-wearme-partner-key') partnerKeyHeader?: string,
  ): Promise<PartnerStoreAnalyticsResponse> {
    if (this.usageEntitlementService) {
      await this.usageEntitlementService.verifyPartnerStoreAccess(storeId, {
        partnerStoreHeader,
        partnerKeyHeader,
      });
    }
    return this.wardrobeService.getPartnerStoreAnalytics(storeId, partnerStoreHeader);
  }

  @Post('wardrobe/contact')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({
    summary: 'Submit a validated business, shop partnership, privacy, or customer support inquiry',
  })
  @ApiResponse({ status: 200, description: 'Inquiry received and ticket ID issued' })
  async submitContactInquiry(@Body() dto: ContactInquiryDto): Promise<ContactInquiryResponse> {
    return this.wardrobeService.submitContactInquiry(dto);
  }
}

