import {
  Injectable,
  Logger,
  Optional,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import sharp from 'sharp';
import { v4 as uuidv4, validate as isUuid } from 'uuid';
import {
  ClothingCategory,
  WearableDomain,
  WearableSubcategory,
  type AuthChannelsResponse,
  type ContactInquiryResponse,
  type DeleteAccountResponse,
  type DeletePortraitResponse,
  type OtpChannel,
  type PartnerStoreAnalyticsResponse,
  type PartnerStorePublicInfo,
  type RequestOtpResponse,
  type RetailerCatalogItem,
  type UpgradeSessionResponse,
  type WardrobeResponse,
  type WardrobeUserProfile,
} from '@wearme/shared';
import type { Prisma, TryOnJob, User } from '@wearme/database';
import { DatabaseService } from '../database/database.service';
import { StorageProvider } from '../storage/storage.provider';
import {
  extractAuthTokenFromCookieHeader,
  resolveSigningSecret,
} from '../storage/file-token.util';
import { TryOnService } from '../try-on/try-on.service';
import type { JobStatusResponseDto } from '../try-on/dto/job-status.dto';
import type {
  ContactInquiryDto,
  RequestOtpDto,
  UpgradeSessionDto,
  WardrobeCatalogTryOnDto,
} from './dto/wardrobe.dto';
import {
  createDefaultOtpProviders,
  getAuthChannelCapabilities,
  resolveTrustedStoreInfo,
  type OtpDeliveryProvider,
} from './otp-providers';
import { UsageEntitlementService } from './usage-entitlement.service';

const SAFE_SESSION_ID_REGEX = /^[a-zA-Z0-9_-]{8,128}$/;
const SAFE_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const OTP_RESEND_COOLDOWN_MS = 30 * 1000; // 30 seconds
const MAX_OTP_ATTEMPTS = 5;
const AUTH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const DEV_DEFAULT_OTP = '123456';

export interface SignedAuthTokenPayload {
  sub: string;
  phoneE164?: string | null;
  email?: string | null;
  sessionToken: string;
  iat: number;
  exp: number;
}

export const CROSS_RETAILER_CATALOG: RetailerCatalogItem[] = [
  {
    id: 'zara_oxford_shirt',
    brand: 'Zara Online',
    title: 'Structured Cobalt Oxford Shirt',
    category: ClothingCategory.SHIRT,
    subcategory: WearableSubcategory.SHIRT,
    domain: WearableDomain.CLOTHING,
    priceInr: 2990,
    accentColor: '#2563eb',
    tagline: 'Sample catalog preview · Cross-retailer B2C demo',
    previewSvgDataUri:
      'data:image/svg+xml;utf8,' +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 380" fill="none">
          <rect width="300" height="380" rx="24" fill="#0f172a"/>
          <path d="M90 65 L125 48 L150 72 L175 48 L210 65 L252 130 L215 155 L198 118 L198 320 L102 320 L102 118 L85 155 L48 130 Z" fill="#2563eb" stroke="#60a5fa" stroke-width="4"/>
          <line x1="150" y1="72" x2="150" y2="320" stroke="#93c5fd" stroke-width="3" stroke-dasharray="8 8"/>
          <text x="150" y="355" text-anchor="middle" fill="#cbd5e1" font-family="sans-serif" font-size="14" font-weight="bold">ZARA · OXFORD SHIRT</text>
        </svg>`,
      ),
  },
  {
    id: 'fabindia_indigo_kurta',
    brand: 'Fabindia',
    title: 'Handblock Artisanal Indigo Top',
    category: ClothingCategory.TOP,
    subcategory: WearableSubcategory.TOP,
    domain: WearableDomain.CLOTHING,
    priceInr: 2490,
    accentColor: '#4f46e5',
    tagline: 'Natural indigo dye · Ethnic & fusion B2C collection',
    previewSvgDataUri:
      'data:image/svg+xml;utf8,' +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 380" fill="none">
          <rect width="300" height="380" rx="24" fill="#1e1b4b"/>
          <path d="M88 68 L122 52 L150 84 L178 52 L212 68 L246 142 L212 162 L195 122 L202 325 L98 325 L105 122 L88 162 L54 142 Z" fill="#4f46e5" stroke="#a5b4fc" stroke-width="4"/>
          <circle cx="150" cy="145" r="18" fill="#818cf8" opacity="0.5"/>
          <circle cx="150" cy="215" r="18" fill="#818cf8" opacity="0.5"/>
          <text x="150" y="355" text-anchor="middle" fill="#e0e7ff" font-family="sans-serif" font-size="14" font-weight="bold">FABINDIA · INDIGO TOP</text>
        </svg>`,
      ),
  },
  {
    id: 'levis_trucker_jacket',
    brand: "Levi's Store",
    title: 'Vintage Indigo Type-III Jacket',
    category: ClothingCategory.JACKET,
    subcategory: WearableSubcategory.JACKET,
    domain: WearableDomain.CLOTHING,
    priceInr: 4599,
    accentColor: '#0284c7',
    tagline: 'Heavyweight selvedge denim · Outerwear collection',
    previewSvgDataUri:
      'data:image/svg+xml;utf8,' +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 380" fill="none">
          <rect width="300" height="380" rx="24" fill="#082f49"/>
          <path d="M82 62 L122 45 L150 66 L178 45 L218 62 L258 148 L220 168 L200 120 L200 318 L100 318 L100 120 L80 168 L42 148 Z" fill="#0284c7" stroke="#7dd3fc" stroke-width="4"/>
          <rect x="112" y="128" width="28" height="28" rx="4" stroke="#bae6fd" stroke-width="3"/>
          <rect x="160" y="128" width="28" height="28" rx="4" stroke="#bae6fd" stroke-width="3"/>
          <text x="150" y="355" text-anchor="middle" fill="#e0f2fe" font-family="sans-serif" font-size="14" font-weight="bold">LEVI'S · DENIM JACKET</text>
        </svg>`,
      ),
  },
  {
    id: 'uniqlo_supima_tee',
    brand: 'Uniqlo',
    title: 'Supima Cotton Crew Neck T-Shirt',
    category: ClothingCategory.TSHIRT,
    subcategory: WearableSubcategory.TSHIRT,
    domain: WearableDomain.CLOTHING,
    priceInr: 1490,
    accentColor: '#059669',
    tagline: 'Ultra-soft combed cotton · Everyday essentials',
    previewSvgDataUri:
      'data:image/svg+xml;utf8,' +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 380" fill="none">
          <rect width="300" height="380" rx="24" fill="#064e3b"/>
          <path d="M92 68 L124 52 C136 68 164 68 176 52 L208 68 L248 122 L216 150 L196 122 L196 318 L104 318 L104 122 L84 150 L52 122 Z" fill="#059669" stroke="#6ee7b7" stroke-width="4"/>
          <text x="150" y="355" text-anchor="middle" fill="#d1fae5" font-family="sans-serif" font-size="14" font-weight="bold">UNIQLO · SUPIMA TEE</text>
        </svg>`,
      ),
  },
];

@Injectable()
export class WardrobeService {
  private readonly logger = new Logger(WardrobeService.name);
  private otpProviders: Record<OtpChannel, OtpDeliveryProvider>;

  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageProvider,
    private readonly tryOnService: TryOnService,
    private readonly configService: ConfigService,
    @Optional() private readonly usageEntitlementService?: UsageEntitlementService,
  ) {
    this.otpProviders = createDefaultOtpProviders();
  }

  setOtpProvidersForTest(providers: Partial<Record<OtpChannel, OtpDeliveryProvider>>): void {
    this.otpProviders = {
      ...this.otpProviders,
      ...providers,
    };
  }

  // ─── Helpers & Step-by-Step Execution Trace Logger ───────────────────────

  private getNodeEnv(): string {
    return (
      this.configService.get<string>('app.nodeEnv') ??
      process.env['NODE_ENV'] ??
      'development'
    );
  }

  private getSigningSecret(): string {
    const configured =
      this.configService.get<string>('AUTH_TOKEN_SECRET') ??
      process.env['AUTH_TOKEN_SECRET'];
    if (this.getNodeEnv() === 'production' && !configured) {
      throw new ServiceUnavailableException(
        'AUTH_TOKEN_SECRET must be configured in production.',
      );
    }
    return resolveSigningSecret(configured);
  }

  private isDevOtpPreviewEnabled(): boolean {
    if (this.getNodeEnv() === 'production') {
      return false;
    }
    return process.env['ENABLE_DEV_OTP_PREVIEW'] !== 'false';
  }

  getTraceLogFilePath(): string {
    return (
      process.env['SESSION_UPGRADE_TRACE_LOG_PATH'] ??
      path.resolve(process.cwd(), 'uploads', 'session-upgrade-trace.log')
    );
  }

  private maskDestination(destination: string): string {
    if (destination.includes('@')) {
      const [local, domain] = destination.split('@');
      if (!local || !domain) return '***@***';
      const prefix = local.slice(0, Math.min(2, local.length));
      return `${prefix}***@${domain}`;
    }
    if (destination.length <= 6) return '***';
    return `${destination.slice(0, 3)}******${destination.slice(-4)}`;
  }

  private async appendUpgradeTrace(
    step: string,
    sessionToken: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    const traceFile = this.getTraceLogFilePath();
    const entry = {
      timestamp: new Date().toISOString(),
      step,
      sessionToken,
      ...details,
    };
    const line = `${JSON.stringify(entry)}\n`;
    this.logger.log(`[SessionUpgradeTrace] ${step} (${sessionToken}) ${JSON.stringify(details)}`);
    try {
      await fs.mkdir(path.dirname(traceFile), { recursive: true });
      await fs.appendFile(traceFile, line, 'utf8');
    } catch {
      // Non-fatal in read-only test environments
    }
  }

  validateSessionToken(sessionId?: string): string {
    if (!sessionId || typeof sessionId !== 'string') {
      throw new BadRequestException(
        'Missing required x-wearme-session-id header for session handoff.',
      );
    }
    const trimmed = sessionId.trim();
    if (!SAFE_SESSION_ID_REGEX.test(trimmed)) {
      throw new BadRequestException(
        'Invalid x-wearme-session-id format. Expected 8-128 alphanumeric, underscore, or hyphen characters.',
      );
    }
    return trimmed;
  }

  normalizePhoneE164(rawPhone: string): string {
    if (!rawPhone || typeof rawPhone !== 'string') {
      throw new BadRequestException('Phone number is required.');
    }
    const digitsAndPlus = rawPhone.replace(/[\s\-()]/g, '');
    if (/^\+[1-9]\d{9,14}$/.test(digitsAndPlus)) {
      return digitsAndPlus;
    }
    const digitsOnly = digitsAndPlus.replace(/^\+/, '');
    if (/^[6-9]\d{9}$/.test(digitsOnly)) {
      return `+91${digitsOnly}`;
    }
    if (/^91[6-9]\d{9}$/.test(digitsOnly)) {
      return `+${digitsOnly}`;
    }
    if (/^[1-9]\d{9,14}$/.test(digitsOnly)) {
      return `+${digitsOnly}`;
    }
    throw new BadRequestException(
      'Invalid phone number. Enter a valid 10-digit mobile number or E.164 number (e.g. +919876543210).',
    );
  }

  normalizeEmail(rawEmail: string): string {
    if (!rawEmail || typeof rawEmail !== 'string') {
      throw new BadRequestException('Email address is required.');
    }
    const normalized = rawEmail.trim().toLowerCase();
    if (normalized.length > 160 || !SAFE_EMAIL_REGEX.test(normalized)) {
      throw new BadRequestException('Invalid email address format.');
    }
    return normalized;
  }

  resolveSafeReturnUrl(rawReturnUrl?: string | null): string {
    if (!rawReturnUrl || typeof rawReturnUrl !== 'string') {
      return '/my-wardrobe';
    }
    const trimmed = rawReturnUrl.trim();
    if (
      !trimmed.startsWith('/') ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('/\\') ||
      trimmed.includes('://') ||
      trimmed.startsWith('/login')
    ) {
      return '/my-wardrobe';
    }
    return trimmed;
  }

  private resolveChannelAndDestination(dto: {
    channel?: OtpChannel;
    phone?: string;
    email?: string;
  }): { channel: OtpChannel; destination: string; phoneE164?: string; email?: string } {
    const channel: OtpChannel =
      dto.channel ?? (dto.email && !dto.phone ? 'email' : 'whatsapp');

    if (channel === 'email') {
      const email = this.normalizeEmail(dto.email ?? '');
      return { channel, destination: email, email };
    }

    const phoneE164 = this.normalizePhoneE164(dto.phone ?? '');
    return { channel, destination: phoneE164, phoneE164 };
  }

  private hashOtp(
    sessionToken: string,
    channel: OtpChannel,
    destination: string,
    otpCode: string,
  ): string {
    const payload =
      channel === 'whatsapp'
        ? `${sessionToken}:${destination}:${otpCode}`
        : `${sessionToken}:${channel}:${destination}:${otpCode}`;
    return crypto
      .createHmac('sha256', this.getSigningSecret())
      .update(payload)
      .digest('hex');
  }

  signAuthToken(
    user: { id: string; phoneE164?: string | null; email?: string | null },
    sessionToken: string,
  ): string {
    const now = Date.now();
    const payload: SignedAuthTokenPayload = {
      sub: user.id,
      phoneE164: user.phoneE164 ?? null,
      email: user.email ?? null,
      sessionToken,
      iat: now,
      exp: now + AUTH_TOKEN_TTL_MS,
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signature = crypto
      .createHmac('sha256', this.getSigningSecret())
      .update(encodedPayload)
      .digest('base64url');
    return `wm_auth_${encodedPayload}.${signature}`;
  }

  verifyAuthToken(rawToken?: string): SignedAuthTokenPayload | null {
    if (!rawToken || typeof rawToken !== 'string') {
      return null;
    }
    const cleaned = rawToken.replace(/^Bearer\s+/i, '').trim();
    if (!cleaned.startsWith('wm_auth_')) {
      return null;
    }
    const withoutPrefix = cleaned.slice('wm_auth_'.length);
    const dotIndex = withoutPrefix.indexOf('.');
    if (dotIndex <= 0) {
      return null;
    }
    const encodedPayload = withoutPrefix.slice(0, dotIndex);
    const signature = withoutPrefix.slice(dotIndex + 1);

    const expectedSig = crypto
      .createHmac('sha256', this.getSigningSecret())
      .update(encodedPayload)
      .digest('base64url');

    const sigBuf = Buffer.from(signature, 'utf8');
    const expectedBuf = Buffer.from(expectedSig, 'utf8');
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }

    try {
      const parsed = JSON.parse(
        Buffer.from(encodedPayload, 'base64url').toString('utf8'),
      ) as SignedAuthTokenPayload;
      if (!parsed.sub || !parsed.exp || parsed.exp <= Date.now()) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
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
    return candidate && SAFE_SESSION_ID_REGEX.test(candidate) ? candidate : undefined;
  }

  private async toUserProfileDto(user: User): Promise<WardrobeUserProfile> {
    let basePersonImageUrl: string | null = null;
    if (user.basePersonImageKey) {
      const exists = await this.storage.exists(user.basePersonImageKey);
      if (exists) {
        basePersonImageUrl = await this.storage.getUrl(user.basePersonImageKey);
      }
    }
    return {
      id: user.id,
      phoneE164: user.phoneE164 ?? null,
      email: (user as { email?: string | null }).email ?? null,
      name: user.name ?? null,
      basePersonImageUrl,
      originStoreId: user.originStoreId ?? null,
      originStoreName: user.originStoreName ?? null,
      createdAt: user.createdAt.toISOString(),
    };
  }

  getAuthChannels(): AuthChannelsResponse {
    return {
      channels: getAuthChannelCapabilities(this.otpProviders, this.getNodeEnv()),
      resendCooldownSeconds: OTP_RESEND_COOLDOWN_MS / 1000,
      otpValiditySeconds: OTP_TTL_MS / 1000,
    };
  }

  // ─── 1. Request Multi-Channel OTP Challenge (WhatsApp, SMS, Email) ───────

  async requestOtp(
    sessionIdHeader: string | undefined,
    dto: RequestOtpDto,
  ): Promise<RequestOtpResponse> {
    const sessionToken = this.validateSessionToken(sessionIdHeader);
    const { channel, destination, phoneE164 } = this.resolveChannelAndDestination(dto);

    const provider = this.otpProviders[channel];
    if (!provider || !provider.isEnabled(this.getNodeEnv())) {
      throw new ServiceUnavailableException(
        `OTP verification channel '${channel}' is not currently enabled.`,
      );
    }

    // Enforce resend cooldown on rapid consecutive requests for the same session & destination
    const existingSession = await this.db.tryOnSession.findUnique({
      where: { sessionToken },
    });
    const existingRequestedAt = (
      existingSession as { otpRequestedAt?: Date | null } | null
    )?.otpRequestedAt;
    const existingTarget =
      (existingSession as { otpTarget?: string | null } | null)?.otpTarget ??
      existingSession?.otpPhoneE164;

    if (
      existingSession?.otpCodeHash &&
      existingRequestedAt &&
      existingTarget === destination &&
      Date.now() - existingRequestedAt.getTime() < OTP_RESEND_COOLDOWN_MS
    ) {
      const remainingSec = Math.ceil(
        (OTP_RESEND_COOLDOWN_MS - (Date.now() - existingRequestedAt.getTime())) / 1000,
      );
      throw new BadRequestException(
        `Please wait ${remainingSec} seconds before requesting another verification code.`,
      );
    }

    const trustedStore = resolveTrustedStoreInfo(dto.storeId);
    const resolvedStoreId = trustedStore?.storeId ?? null;
    const resolvedStoreName = trustedStore?.storeName ?? null;

    const otpCode = this.isDevOtpPreviewEnabled()
      ? DEV_DEFAULT_OTP
      : String(crypto.randomInt(100000, 1000000));
    const otpCodeHash = this.hashOtp(sessionToken, channel, destination, otpCode);
    const now = new Date();
    const otpExpiresAt = new Date(now.getTime() + OTP_TTL_MS);

    await provider.sendOtp(destination, otpCode);

    await this.db.tryOnSession.upsert({
      where: { sessionToken },
      create: {
        sessionToken,
        status: 'OTP_PENDING',
        storeId: resolvedStoreId,
        storeName: resolvedStoreName,
        otpChannel: channel,
        otpTarget: destination,
        otpPhoneE164: phoneE164 ?? destination,
        otpCodeHash,
        otpExpiresAt,
        otpRequestedAt: now,
        otpAttempts: 0,
      },
      update: {
        status: 'OTP_PENDING',
        ...(resolvedStoreId ? { storeId: resolvedStoreId } : {}),
        ...(resolvedStoreName ? { storeName: resolvedStoreName } : {}),
        otpChannel: channel,
        otpTarget: destination,
        otpPhoneE164: phoneE164 ?? destination,
        otpCodeHash,
        otpExpiresAt,
        otpRequestedAt: now,
        otpAttempts: 0,
      },
    });

    await this.appendUpgradeTrace('STEP_0_REQUEST_OTP', sessionToken, {
      channel,
      maskedPhone: this.maskDestination(destination),
      storeId: resolvedStoreId,
      storeName: resolvedStoreName,
      expiresAt: otpExpiresAt.toISOString(),
    });

    return {
      sessionToken,
      channel,
      destination,
      phoneE164: phoneE164 ?? destination,
      expiresAt: otpExpiresAt.toISOString(),
      resendAvailableInSeconds: OTP_RESEND_COOLDOWN_MS / 1000,
      ...(this.isDevOtpPreviewEnabled() ? { devOtpPreview: otpCode } : {}),
    };
  }

  // ─── 2. Atomic Session Upgrade (Anonymous QR -> Persistent B2C User) ─────

  async upgradeSession(
    sessionIdHeader: string | undefined,
    dto: UpgradeSessionDto,
  ): Promise<UpgradeSessionResponse> {
    const sessionToken = this.validateSessionToken(sessionIdHeader);
    const { channel, destination, phoneE164, email } =
      this.resolveChannelAndDestination(dto);

    await this.appendUpgradeTrace('STEP_1_VALIDATE_HEADERS_AND_INPUT', sessionToken, {
      channel,
      maskedPhone: this.maskDestination(destination),
      requestedJobId: dto.jobId ?? null,
      storeId: dto.storeId ?? null,
    });

    const session = await this.db.tryOnSession.findUnique({
      where: { sessionToken },
    });

    const sessionChannel =
      ((session as { otpChannel?: string | null } | null)?.otpChannel as
        | OtpChannel
        | undefined) ?? 'whatsapp';
    const sessionTarget =
      (session as { otpTarget?: string | null } | null)?.otpTarget ??
      session?.otpPhoneE164;

    if (!session || !session.otpCodeHash || !session.otpExpiresAt || !sessionTarget) {
      await this.appendUpgradeTrace('STEP_2_OTP_CHALLENGE_MISSING', sessionToken, {
        reason: 'No active OTP challenge found for sessionToken',
      });
      throw new UnauthorizedException(
        'No active OTP verification request found for this session. Please request a new OTP.',
      );
    }

    if (session.otpAttempts >= MAX_OTP_ATTEMPTS) {
      await this.appendUpgradeTrace('STEP_2_OTP_LOCKED_OUT', sessionToken, {
        attempts: session.otpAttempts,
      });
      throw new UnauthorizedException(
        'Maximum OTP verification attempts exceeded. Please request a new OTP.',
      );
    }

    if (session.otpExpiresAt.getTime() <= Date.now()) {
      await this.appendUpgradeTrace('STEP_2_OTP_EXPIRED', sessionToken, {
        expiredAt: session.otpExpiresAt.toISOString(),
      });
      throw new UnauthorizedException('OTP has expired. Please request a new OTP.');
    }

    if (sessionTarget !== destination || sessionChannel !== channel) {
      await this.db.tryOnSession.update({
        where: { id: session.id },
        data: { otpAttempts: { increment: 1 } },
      });
      throw new UnauthorizedException(
        'Verification destination or channel does not match the active OTP challenge.',
      );
    }

    const expectedHash = this.hashOtp(sessionToken, channel, destination, dto.otpCode);
    const actualBuf = Buffer.from(session.otpCodeHash, 'utf8');
    const expectedBuf = Buffer.from(expectedHash, 'utf8');
    const isOtpValid =
      actualBuf.length === expectedBuf.length &&
      crypto.timingSafeEqual(actualBuf, expectedBuf);

    if (!isOtpValid) {
      await this.db.tryOnSession.update({
        where: { id: session.id },
        data: { otpAttempts: { increment: 1 } },
      });
      await this.appendUpgradeTrace('STEP_2_OTP_MISMATCH', sessionToken, {
        attemptsAfterIncrement: session.otpAttempts + 1,
      });
      throw new UnauthorizedException('Invalid OTP code. Please check the 6-digit code.');
    }

    const priorOtpCodeHash = session.otpCodeHash;
    const priorOtpExpiresAt = session.otpExpiresAt;
    const priorOtpAttempts = session.otpAttempts;

    // Atomically claim the OTP hash in PostgreSQL before entering the transaction to block concurrent replay across API instances
    if (typeof this.db.tryOnSession.updateMany === 'function') {
      const claimed = await this.db.tryOnSession.updateMany({
        where: {
          id: session.id,
          otpCodeHash: session.otpCodeHash,
        },
        data: {
          otpCodeHash: null,
          otpExpiresAt: null,
          otpAttempts: 0,
        },
      });
      if (!claimed || claimed.count === 0) {
        throw new UnauthorizedException(
          'This verification code has already been used. Please request a new OTP.',
        );
      }
    }

    try {
      await this.appendUpgradeTrace('STEP_2_OTP_VERIFIED', sessionToken, {
        channel,
        maskedPhone: this.maskDestination(destination),
      });

      // Discover all non-expired jobs created in this browser session (scoped in PostgreSQL before take: 50)
      const recentCandidates = await this.db.tryOnJob.findMany({
        where: {
          OR: [
            { sessionId: session.id },
            {
              personImageMeta: {
                path: ['sessionId'],
                equals: sessionToken,
              },
            },
            {
              garmentImageMeta: {
                path: ['sessionId'],
                equals: sessionToken,
              },
            },
            ...(dto.jobId && isUuid(dto.jobId) ? [{ id: dto.jobId }] : []),
          ],
        } as Prisma.TryOnJobWhereInput,
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      const sessionJobs = recentCandidates.filter(
        (job) =>
          (job.sessionId === session.id || this.extractJobSessionId(job) === sessionToken) &&
          (!job.userId || (session.userId && job.userId === session.userId)),
      );

      await this.appendUpgradeTrace('STEP_3_DISCOVER_SESSION_JOBS', sessionToken, {
        discoveredJobsCount: sessionJobs.length,
        jobIds: sessionJobs.map((j) => j.id),
      });

      // Pick the best person photo from the target jobId or most recent session job
      const primaryJob =
        (dto.jobId ? sessionJobs.find((j) => j.id === dto.jobId) : undefined) ??
        sessionJobs.find((j) => j.status === 'COMPLETED') ??
        sessionJobs[0];

      let sourcePersonKey: string | undefined;
      let sourcePersonMeta: Prisma.InputJsonValue | undefined;
      if (primaryJob?.personImageKey) {
        const exists = await this.storage.exists(primaryJob.personImageKey);
        if (exists) {
          sourcePersonKey = primaryJob.personImageKey;
          sourcePersonMeta = (primaryJob.personImageMeta ?? undefined) as
            | Prisma.InputJsonValue
            | undefined;
        }
      }

      // Resolve store context against trusted server-side partner store registry
      const trustedStore = resolveTrustedStoreInfo(dto.storeId ?? session.storeId);
      const resolvedStoreId = trustedStore?.storeId ?? undefined;
      const resolvedStoreName =
        trustedStore?.storeName ?? 'Walk-In Partner Boutique (QR)';

      // Execute atomic DB upgrade transaction with storage decoupling & returning-user protection
      const {
        upgradedUser,
        upgradedJobsCount,
        isReturningUser,
        originStoreDecision,
        basePortraitDecision,
        copiedFromKey,
      } = await this.db.$transaction(async (tx) => {
        // Look up existing user by verified phone or verified email, or existing session.userId (account linking)
        let existingUser: User | null = null;
        if (phoneE164) {
          existingUser = await tx.user.findUnique({ where: { phoneE164 } });
        }
        if (!existingUser && email) {
          existingUser = await tx.user.findUnique({
            where: { email } as Prisma.UserWhereUniqueInput,
          });
        }
        if (!existingUser && session.userId) {
          existingUser = await tx.user.findUnique({ where: { id: session.userId } });
        }

        const returning = Boolean(existingUser);

        // Rule 1: Never overwrite originStoreId or originStoreName if already set on a returning user
        const preserveExistingStore = Boolean(existingUser?.originStoreId);
        const nextOriginStoreId = existingUser?.originStoreId ?? resolvedStoreId ?? null;
        const nextOriginStoreName = existingUser?.originStoreName ?? resolvedStoreName;
        const storeDecision = preserveExistingStore
          ? 'PRESERVED_EXISTING_ORIGIN_STORE'
          : 'SET_FIRST_TOUCH_ORIGIN_STORE';

        let user: User;
        if (phoneE164 && (!existingUser || existingUser.phoneE164 === phoneE164)) {
          user = await tx.user.upsert({
            where: { phoneE164 },
            create: {
              phoneE164,
              phoneVerifiedAt: new Date(),
              basePersonImageKey: null,
              basePersonImageMeta: undefined,
              originStoreId: nextOriginStoreId,
              originStoreName: nextOriginStoreName,
            },
            update: {
              phoneVerifiedAt: new Date(),
              ...(!existingUser?.originStoreId && nextOriginStoreId
                ? { originStoreId: nextOriginStoreId }
                : {}),
              ...(!existingUser?.originStoreName && nextOriginStoreName
                ? { originStoreName: nextOriginStoreName }
                : {}),
            },
          });
        } else if (existingUser) {
          user = await tx.user.update({
            where: { id: existingUser.id },
            data: {
              ...(phoneE164 ? { phoneE164, phoneVerifiedAt: new Date() } : {}),
              ...(email ? { email, emailVerifiedAt: new Date() } : {}),
              ...(!existingUser.originStoreId && nextOriginStoreId
                ? { originStoreId: nextOriginStoreId }
                : {}),
              ...(!existingUser.originStoreName && nextOriginStoreName
                ? { originStoreName: nextOriginStoreName }
                : {}),
            } as Prisma.UserUpdateInput,
          });
        } else {
          user = await tx.user.upsert({
            where: { email: email! } as Prisma.UserWhereUniqueInput,
            create: {
              email: email!,
              emailVerifiedAt: new Date(),
              phoneE164: null,
              basePersonImageKey: null,
              basePersonImageMeta: undefined,
              originStoreId: nextOriginStoreId,
              originStoreName: nextOriginStoreName,
            } as Prisma.UserCreateInput,
            update: {
              emailVerifiedAt: new Date(),
            } as Prisma.UserUpdateInput,
          });
        }

        // Rule 2: Decouple storage into `users/<userId>/base_portrait.<ext>` and protect returning users' base portrait
        const existingKey = existingUser?.basePersonImageKey ?? null;
        const hasValidUserScopedPortrait = Boolean(
          existingKey &&
            existingKey.startsWith('users/') &&
            (await this.storage.exists(existingKey)),
        );
        const explicitReplace = Boolean(dto.replaceBasePortrait);

        let portraitDecision = 'NO_SOURCE_PORTRAIT_AVAILABLE';
        let copiedSource: string | null = null;

        if (hasValidUserScopedPortrait && !explicitReplace) {
          portraitDecision = 'RETAINED_EXISTING_USER_PORTRAIT';
        } else if (sourcePersonKey) {
          const decoupledKey = await this.copyPortraitToUserStorage(
            user.id,
            sourcePersonKey,
            sourcePersonMeta,
          );
          user = await tx.user.update({
            where: { id: user.id },
            data: {
              basePersonImageKey: decoupledKey,
              ...(sourcePersonMeta ? { basePersonImageMeta: sourcePersonMeta } : {}),
            },
          });
          copiedSource = sourcePersonKey;
          portraitDecision = explicitReplace
            ? 'EXPLICITLY_REPLACED_AND_COPIED_TO_USER_STORAGE'
            : 'COPIED_JOB_PORTRAIT_TO_USER_STORAGE';
        } else if (
          existingKey &&
          existingKey.startsWith('jobs/') &&
          (await this.storage.exists(existingKey))
        ) {
          // Self-heal legacy job-bound pointer into user-scoped storage
          const migratedKey = await this.copyPortraitToUserStorage(
            user.id,
            existingKey,
            existingUser?.basePersonImageMeta,
          );
          user = await tx.user.update({
            where: { id: user.id },
            data: { basePersonImageKey: migratedKey },
          });
          copiedSource = existingKey;
          portraitDecision = 'MIGRATED_LEGACY_JOB_KEY_TO_USER_STORAGE';
        }

        await tx.tryOnSession.update({
          where: { id: session.id },
          data: {
            status: 'UPGRADED',
            userId: user.id,
            upgradedAt: new Date(),
            storeId: resolvedStoreId ?? session.storeId,
            storeName: resolvedStoreName,
            otpCodeHash: null,
            otpExpiresAt: null,
            otpAttempts: 0,
          },
        });

        const completedJobIds = sessionJobs
          .filter((j) => j.status === 'COMPLETED')
          .map((j) => j.id);
        const nonCompletedJobIds = sessionJobs
          .filter((j) => j.status !== 'COMPLETED')
          .map((j) => j.id);
        let updatedCount = 0;
        if (completedJobIds.length > 0) {
          const res = await tx.tryOnJob.updateMany({
            where: { id: { in: completedJobIds } },
            data: {
              userId: user.id,
              sessionId: session.id,
              savedToWardrobe: true,
              retailerSource: resolvedStoreName,
              // Clear 7-day anonymous TTL so saved wardrobe looks never expire
              expiresAt: null,
            },
          });
          updatedCount += res.count;
        }
        if (nonCompletedJobIds.length > 0) {
          await tx.tryOnJob.updateMany({
            where: { id: { in: nonCompletedJobIds } },
            data: {
              userId: user.id,
              sessionId: session.id,
              savedToWardrobe: false,
              retailerSource: resolvedStoreName,
              // Preserve expiresAt so failed/uncompleted temporary assets are cleaned up
            },
          });
        }

        return {
          upgradedUser: user,
          upgradedJobsCount: updatedCount,
          isReturningUser: returning,
          originStoreDecision: storeDecision,
          basePortraitDecision: portraitDecision,
          copiedFromKey: copiedSource,
        };
      });

      if (this.usageEntitlementService) {
        await this.usageEntitlementService
          .migrateAnonymousEntitlementOnUpgrade(sessionToken, upgradedUser.id)
          .catch((err) => {
            this.logger.warn(
              `Non-fatal anonymous entitlement migration warning for user ${upgradedUser.id}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          });
      }

      await this.appendUpgradeTrace('STEP_4_USER_UPSERTED_AND_BASE_PHOTO_PROMOTED', sessionToken, {
        userId: upgradedUser.id,
        isReturningUser,
        originStoreDecision,
        originStoreId: upgradedUser.originStoreId,
        originStoreName: upgradedUser.originStoreName,
        currentVisitStoreId: resolvedStoreId ?? null,
        currentVisitStoreName: resolvedStoreName,
        basePortraitDecision,
        copiedFromKey,
        basePersonImageKey: upgradedUser.basePersonImageKey,
      });

      await this.appendUpgradeTrace('STEP_5_SESSION_AND_JOBS_UPGRADED', sessionToken, {
        userId: upgradedUser.id,
        upgradedJobsCount,
        ttlCleared: true,
      });

      const authToken = this.signAuthToken(upgradedUser, sessionToken);
      const safeRedirect = this.resolveSafeReturnUrl(dto.returnUrl);

      await this.appendUpgradeTrace('STEP_6_AUTH_TOKEN_MINTED', sessionToken, {
        userId: upgradedUser.id,
        redirectTo: safeRedirect,
      });

      return {
        authToken,
        user: await this.toUserProfileDto(upgradedUser),
        upgradedJobsCount,
        redirectTo: safeRedirect,
      };
    } catch (err) {
      // Restore claimed OTP hash if a transient storage or DB error prevented upgrade completion
      if (typeof this.db.tryOnSession.updateMany === 'function') {
        await this.db.tryOnSession
          .updateMany({
            where: {
              id: session.id,
              status: { not: 'UPGRADED' },
              otpCodeHash: null,
            },
            data: {
              otpCodeHash: priorOtpCodeHash,
              otpExpiresAt: priorOtpExpiresAt,
              otpAttempts: priorOtpAttempts,
            },
          })
          .catch(() => undefined);
      }
      throw err;
    }
  }

  private resolvePortraitExtension(
    sourceKey: string,
    meta?: unknown,
  ): 'jpg' | 'png' | 'webp' {
    const mimeType =
      typeof (meta as Record<string, unknown>)?.['mimeType'] === 'string'
        ? String((meta as Record<string, unknown>)['mimeType']).toLowerCase()
        : '';
    if (mimeType === 'image/png' || sourceKey.toLowerCase().endsWith('.png')) {
      return 'png';
    }
    if (mimeType === 'image/webp' || sourceKey.toLowerCase().endsWith('.webp')) {
      return 'webp';
    }
    return 'jpg';
  }

  buildUserBasePortraitKey(userId: string, sourceKey: string, meta?: unknown): string {
    const ext = this.resolvePortraitExtension(sourceKey, meta);
    return `users/${userId}/base_portrait.${ext}`;
  }

  private async copyPortraitToUserStorage(
    userId: string,
    sourceKey: string,
    meta?: unknown,
  ): Promise<string> {
    const destKey = this.buildUserBasePortraitKey(userId, sourceKey, meta);
    if (sourceKey === destKey) {
      return destKey;
    }
    const ext = this.resolvePortraitExtension(sourceKey, meta);
    const mimeType =
      ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    await this.storage.copy(sourceKey, destKey, mimeType);
    return destKey;
  }

  // ─── 3. Resolve Authenticated User (Bearer Token, Cookie, or Upgraded Session) ──

  assertNotShopkeeperHeader(partnerStoreId?: string, partnerKey?: string): void {
    if (partnerStoreId || partnerKey) {
      throw new ForbiddenException(
        'Shopkeeper credentials are not permitted to access customer wardrobe, portraits, or private account data.',
      );
    }
  }

  async resolveAuthenticatedUser(
    authorizationHeader?: string,
    authTokenHeader?: string,
    sessionIdHeader?: string,
    cookieHeader?: string,
    partnerStoreId?: string,
    partnerKey?: string,
  ): Promise<{ user: User; sessionToken?: string }> {
    this.assertNotShopkeeperHeader(partnerStoreId, partnerKey);

    const cookieToken = extractAuthTokenFromCookieHeader(cookieHeader);
    const tokenCandidate = authTokenHeader ?? authorizationHeader ?? cookieToken;
    const verifiedPayload = this.verifyAuthToken(tokenCandidate);

    if (verifiedPayload) {
      const user = await this.db.user.findUnique({
        where: { id: verifiedPayload.sub },
      });
      if (user) {
        return { user, sessionToken: verifiedPayload.sessionToken };
      }
    }

    if (sessionIdHeader && SAFE_SESSION_ID_REGEX.test(sessionIdHeader.trim())) {
      const sessionToken = sessionIdHeader.trim();
      const session = await this.db.tryOnSession.findUnique({
        where: { sessionToken },
        include: { user: true },
      });
      if (session?.status === 'UPGRADED' && session.user) {
        return { user: session.user, sessionToken };
      }
    }

    throw new UnauthorizedException(
      'Wardrobe access requires a verified account session. Upgrade your try-on session or sign in with OTP.',
    );
  }

  // ─── 4. Fetch Digital Wardrobe (/my-wardrobe) ────────────────────────────

  async getWardrobe(
    authorizationHeader?: string,
    authTokenHeader?: string,
    sessionIdHeader?: string,
    cookieHeader?: string,
    partnerStoreId?: string,
    partnerKey?: string,
  ): Promise<WardrobeResponse> {
    const { user } = await this.resolveAuthenticatedUser(
      authorizationHeader,
      authTokenHeader,
      sessionIdHeader,
      cookieHeader,
      partnerStoreId,
      partnerKey,
    );

    const queriedJobs = await this.db.tryOnJob.findMany({
      where: {
        userId: user.id,
        savedToWardrobe: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 24,
    });

    const savedJobs = queriedJobs.filter(
      (job) => job.userId === user.id && Boolean(job.savedToWardrobe),
    );

    const dtos = await Promise.all(
      savedJobs.map((job) => this.tryOnService.jobToStatusDto(job)),
    );

    // Self-heal if user has no basePersonImageKey or still has a legacy job-scoped key
    if (!user.basePersonImageKey || user.basePersonImageKey.startsWith('jobs/')) {
      const candidateKey =
        user.basePersonImageKey ??
        savedJobs.find((j) => Boolean(j.personImageKey))?.personImageKey;
      if (candidateKey && (await this.storage.exists(candidateKey))) {
        const decoupledKey = await this.copyPortraitToUserStorage(
          user.id,
          candidateKey,
          user.basePersonImageMeta,
        );
        user.basePersonImageKey = decoupledKey;
        await this.db.user.update({
          where: { id: user.id },
          data: { basePersonImageKey: decoupledKey },
        });
      }
    }

    return {
      user: await this.toUserProfileDto(user),
      savedLooks: dtos,
      retailerCatalog: CROSS_RETAILER_CATALOG,
    };
  }

  // ─── 5. Save an Existing Job to an Already-Upgraded Wardrobe ─────────────

  async saveJobToWardrobe(
    jobId: string,
    authorizationHeader?: string,
    authTokenHeader?: string,
    sessionIdHeader?: string,
    cookieHeader?: string,
  ): Promise<JobStatusResponseDto> {
    const { user, sessionToken } = await this.resolveAuthenticatedUser(
      authorizationHeader,
      authTokenHeader,
      sessionIdHeader,
      cookieHeader,
    );

    const job = await this.db.tryOnJob.findUnique({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException(`Try-on job not found: ${jobId}`);
    }

    const jobOwnerSession = this.extractJobSessionId(job);
    const callerSession = sessionIdHeader?.trim() ?? sessionToken;
    if (
      (job.userId && job.userId !== user.id) ||
      (!job.userId && jobOwnerSession && jobOwnerSession !== callerSession)
    ) {
      throw new UnauthorizedException('You do not own this try-on job.');
    }

    const jobWithBilling = job as typeof job & {
      billingMode?: string | null;
      sponsoredStoreId?: string | null;
      storeId?: string | null;
    };
    const isStoreSponsored =
      jobWithBilling.billingMode === 'STORE_SPONSORED' ||
      Boolean(jobWithBilling.sponsoredStoreId || jobWithBilling.storeId);
    const storeFallbackName = isStoreSponsored
      ? (resolveTrustedStoreInfo(
          jobWithBilling.sponsoredStoreId ?? jobWithBilling.storeId ?? undefined,
        )?.storeName ?? 'Partner Boutique')
      : 'Personal WearMe';

    const updated = await this.db.tryOnJob.update({
      where: { id: job.id },
      data: {
        userId: user.id,
        savedToWardrobe: true,
        expiresAt: null,
        retailerSource: job.retailerSource ?? storeFallbackName,
      },
    });

    const hasValidExistingPortrait = Boolean(
      user.basePersonImageKey &&
        user.basePersonImageKey.startsWith('users/') &&
        (await this.storage.exists(user.basePersonImageKey)),
    );

    if (
      !hasValidExistingPortrait &&
      job.personImageKey &&
      (await this.storage.exists(job.personImageKey))
    ) {
      const decoupledKey = await this.copyPortraitToUserStorage(
        user.id,
        job.personImageKey,
        job.personImageMeta,
      );
      await this.db.user.update({
        where: { id: user.id },
        data: {
          basePersonImageKey: decoupledKey,
          basePersonImageMeta: (job.personImageMeta ?? undefined) as
            | Prisma.InputJsonValue
            | undefined,
        },
      });
    }

    return this.tryOnService.jobToStatusDto(updated);
  }

  // ─── 6. 1-Click Cross-Retailer Try-On Using Saved Base Portrait ──────────

  private async renderCatalogGarmentPng(item: RetailerCatalogItem): Promise<Buffer> {
    const hex = item.accentColor.replace('#', '');
    const r = parseInt(hex.slice(0, 2), 16) || 59;
    const g = parseInt(hex.slice(2, 4), 16) || 130;
    const b = parseInt(hex.slice(4, 6), 16) || 246;

    const svgOverlay = Buffer.from(
      `<svg width="768" height="1024" viewBox="0 0 768 1024" xmlns="http://www.w3.org/2000/svg">
        <rect width="768" height="1024" fill="#f8fafc"/>
        <path d="M210 180 L310 130 L384 190 L458 130 L558 180 L650 350 L555 410 L510 310 L510 840 L258 840 L258 310 L213 410 L118 350 Z"
              fill="rgb(${r},${g},${b})" stroke="#1e293b" stroke-width="6"/>
      </svg>`,
    );

    return sharp(svgOverlay).png().toBuffer();
  }

  async tryOnFromCatalog(
    dto: WardrobeCatalogTryOnDto,
    authorizationHeader?: string,
    authTokenHeader?: string,
    sessionIdHeader?: string,
    cookieHeader?: string,
  ): Promise<JobStatusResponseDto> {
    const { user, sessionToken } = await this.resolveAuthenticatedUser(
      authorizationHeader,
      authTokenHeader,
      sessionIdHeader,
      cookieHeader,
    );

    const catalogItem = CROSS_RETAILER_CATALOG.find(
      (item) => item.id === dto.catalogItemId,
    );
    if (!catalogItem) {
      throw new BadRequestException(
        `Unknown retailer catalog item '${dto.catalogItemId}'.`,
      );
    }

    if (!user.basePersonImageKey) {
      throw new BadRequestException(
        'No saved base portrait found in your wardrobe. Complete a studio try-on first to save your base photo.',
      );
    }

    const personExists = await this.storage.exists(user.basePersonImageKey);
    if (!personExists) {
      throw new BadRequestException(
        'Your saved base portrait file is no longer in storage. Please run a new try-on in the Studio to refresh your base portrait.',
      );
    }

    const [personBuffer, garmentBuffer] = await Promise.all([
      this.storage.download(user.basePersonImageKey),
      this.renderCatalogGarmentPng(catalogItem),
    ]);

    const effectiveSessionId =
      sessionIdHeader && SAFE_SESSION_ID_REGEX.test(sessionIdHeader.trim())
        ? sessionIdHeader.trim()
        : sessionToken;

    const jobId = uuidv4();
    const personKey = `jobs/${jobId}/person.jpg`;
    const garmentKey = `jobs/${jobId}/garment.png`;

    await Promise.all([
      this.storage.upload(personKey, personBuffer, 'image/jpeg'),
      this.storage.upload(garmentKey, garmentBuffer, 'image/png'),
    ]);

    const hasExtendedSchema = Boolean(
      (this.db as unknown as Record<string, unknown>)['usageReservation'],
    );

    await this.db.tryOnJob.create({
      data: {
        id: jobId,
        status: 'PENDING',
        category: catalogItem.category as ClothingCategory,
        personImageKey: personKey,
        garmentImageKey: garmentKey,
        userId: user.id,
        savedToWardrobe: true,
        retailerSource: catalogItem.brand,
        productTitle: catalogItem.title,
        expiresAt: null,
        ...(hasExtendedSchema
          ? {
              billingMode: 'PERSONAL',
              sponsoredStoreId: null,
              storeId: null,
            }
          : {}),
        personImageMeta: {
          mimeType: 'image/jpeg',
          reusedFromWardrobeBasePhoto: true,
          ...(effectiveSessionId ? { sessionId: effectiveSessionId } : {}),
        },
        garmentImageMeta: {
          mimeType: 'image/png',
          subcategory: catalogItem.subcategory,
          domain: catalogItem.domain,
          catalogItemId: catalogItem.id,
          brand: catalogItem.brand,
          title: catalogItem.title,
          billingMode: 'PERSONAL',
          ...(effectiveSessionId ? { sessionId: effectiveSessionId } : {}),
        },
      } as unknown as Prisma.TryOnJobUncheckedCreateInput,
    });

    await this.tryOnService.processJob(jobId, effectiveSessionId, user.id);
    const completedJob = await this.db.tryOnJob.findUnique({ where: { id: jobId } });
    if (!completedJob) {
      throw new NotFoundException(`Generated wardrobe job not found: ${jobId}`);
    }
    return this.tryOnService.jobToStatusDto(completedJob);
  }

  // ─── 7. Privacy Operations (Portrait Deletion, Account Deletion, Logout) ──

  async deleteUserPortrait(
    authorizationHeader?: string,
    authTokenHeader?: string,
    sessionIdHeader?: string,
    cookieHeader?: string,
    partnerStoreId?: string,
    partnerKey?: string,
  ): Promise<DeletePortraitResponse> {
    const { user } = await this.resolveAuthenticatedUser(
      authorizationHeader,
      authTokenHeader,
      sessionIdHeader,
      cookieHeader,
      partnerStoreId,
      partnerKey,
    );

    if (user.basePersonImageKey) {
      await this.storage.delete(user.basePersonImageKey).catch(() => undefined);
    }

    await this.db.user.update({
      where: { id: user.id },
      data: {
        basePersonImageKey: null,
      },
    });

    return {
      deleted: true,
      userId: user.id,
    };
  }

  async deleteUserAccount(
    authorizationHeader?: string,
    authTokenHeader?: string,
    sessionIdHeader?: string,
    cookieHeader?: string,
    partnerStoreId?: string,
    partnerKey?: string,
  ): Promise<DeleteAccountResponse> {
    const { user, sessionToken } = await this.resolveAuthenticatedUser(
      authorizationHeader,
      authTokenHeader,
      sessionIdHeader,
      cookieHeader,
      partnerStoreId,
      partnerKey,
    );

    if (user.basePersonImageKey) {
      await this.storage.delete(user.basePersonImageKey).catch(() => undefined);
    }

    const queriedJobs = await this.db.tryOnJob.findMany({
      where: { userId: user.id },
    });
    const userJobs = queriedJobs.filter((j) => j.userId === user.id);

    for (const job of userJobs) {
      await Promise.allSettled([
        this.storage.delete(job.personImageKey),
        this.storage.delete(job.garmentImageKey),
        ...(job.resultImageKey ? [this.storage.delete(job.resultImageKey)] : []),
        this.storage.deleteJobDirectory(job.id),
      ]);
      if (this.db.tryOnJob.delete) {
        await this.db.tryOnJob.delete({ where: { id: job.id } }).catch(() => undefined);
      }
    }

    // Purge TryOnSession records containing user linkage or OTP PII before deleting user
    const sessionConditions: Record<string, unknown>[] = [{ userId: user.id }];
    if (sessionIdHeader && SAFE_SESSION_ID_REGEX.test(sessionIdHeader.trim())) {
      sessionConditions.push({ sessionToken: sessionIdHeader.trim() });
    }
    if (sessionToken) {
      sessionConditions.push({ sessionToken });
    }
    if (user.phoneE164) {
      sessionConditions.push({ otpPhoneE164: user.phoneE164 });
      sessionConditions.push({ otpTarget: user.phoneE164 });
    }
    if (user.email) {
      sessionConditions.push({ otpTarget: user.email });
    }
    const tryOnSessionDelegate = this.db.tryOnSession as unknown as {
      deleteMany?: (args: unknown) => Promise<unknown>;
    };
    if (typeof tryOnSessionDelegate?.deleteMany === 'function') {
      await tryOnSessionDelegate
        .deleteMany({ where: { OR: sessionConditions } })
        .catch(() => undefined);
    }

    if (this.db.user.delete) {
      await this.db.user.delete({ where: { id: user.id } }).catch(() => undefined);
    }

    return {
      deleted: true,
      userId: user.id,
      deletedJobsCount: userJobs.length,
    };
  }

  async logoutSession(sessionIdHeader?: string): Promise<{ loggedOut: boolean }> {
    if (sessionIdHeader && SAFE_SESSION_ID_REGEX.test(sessionIdHeader.trim())) {
      const sessionToken = sessionIdHeader.trim();
      const existing = await this.db.tryOnSession.findUnique({
        where: { sessionToken },
      });
      if (existing) {
        await this.db.tryOnSession.update({
          where: { id: existing.id },
          data: {
            status: 'ANONYMOUS',
            userId: null,
            otpCodeHash: null,
            otpExpiresAt: null,
          },
        });
      }
    }
    return { loggedOut: true };
  }

  // ─── 8. Partner Store Registry & Aggregated Analytics (No Customer Data) ──

  getPublicStoreInfo(rawStoreId: string): PartnerStorePublicInfo {
    const info = resolveTrustedStoreInfo(rawStoreId);
    if (!info) {
      throw new BadRequestException(
        'Invalid storeId format. Expected 2-64 alphanumeric, underscore, or hyphen characters.',
      );
    }
    return info;
  }

  async getPartnerStoreAnalytics(
    rawStoreId: string,
    partnerStoreIdHeader?: string,
  ): Promise<PartnerStoreAnalyticsResponse> {
    const info = this.getPublicStoreInfo(rawStoreId);
    if (
      partnerStoreIdHeader &&
      partnerStoreIdHeader.trim() &&
      partnerStoreIdHeader.trim() !== info.storeId
    ) {
      throw new ForbiddenException(
        `Cross-store access denied: partner credentials for '${partnerStoreIdHeader.trim()}' cannot access '${info.storeId}'.`,
      );
    }

    const allJobs = await this.db.tryOnJob.findMany({
      where: {
        OR: [
          { sponsoredStoreId: info.storeId },
          { storeId: info.storeId },
          { retailerSource: info.storeName },
        ],
      } as Prisma.TryOnJobWhereInput,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const matchingJobs = allJobs.filter((j) => {
      const jb = j as typeof j & { sponsoredStoreId?: string | null; storeId?: string | null };
      return (
        jb.sponsoredStoreId === info.storeId ||
        jb.storeId === info.storeId ||
        j.retailerSource === info.storeName
      );
    });

    return {
      storeId: info.storeId,
      storeName: info.storeName,
      totalTryOnSessions: matchingJobs.length,
      totalTryOnJobs: matchingJobs.length,
      completedTryOnJobs: matchingJobs.filter((j) => j.status === 'COMPLETED').length,
      savedToWardrobeCount: matchingJobs.filter((j) => Boolean(j.savedToWardrobe)).length,
      firstTouchAttributedUsersCount: new Set(
        matchingJobs.map((j) => j.userId).filter(Boolean),
      ).size,
      privacyNotice:
        'Aggregated operational metrics only. Customer portraits, generated try-on images, private wardrobes, and personal contact details are strictly isolated and inaccessible to shop partners.',
    };
  }

  // ─── 9. Server-Validated Contact / Privacy / Security Inquiry Handler ─────

  async submitContactInquiry(dto: ContactInquiryDto): Promise<ContactInquiryResponse> {
    const inquiryId = uuidv4();
    const receivedAt = new Date().toISOString();
    const normalizedEmail = this.normalizeEmail(dto.email);

    let deliveryMode: 'logged_local_queue' | 'webhook_forwarded' = 'logged_local_queue';
    if (process.env['CONTACT_INQUIRY_WEBHOOK_URL']) {
      try {
        await axios.post(
          process.env['CONTACT_INQUIRY_WEBHOOK_URL'],
          {
            inquiryId,
            category: dto.category,
            name: dto.name.trim(),
            email: normalizedEmail,
            organization: dto.organization?.trim() ?? null,
            message: dto.message.trim(),
            receivedAt,
          },
          { timeout: 5000 },
        );
        deliveryMode = 'webhook_forwarded';
      } catch {
        deliveryMode = 'logged_local_queue';
      }
    }

    const logPath = path.resolve(process.cwd(), 'uploads', 'contact-inquiries.jsonl');
    try {
      await fs.mkdir(path.dirname(logPath), { recursive: true });
      await fs.appendFile(
        logPath,
        `${JSON.stringify({
          inquiryId,
          category: dto.category,
          name: dto.name.trim(),
          email: normalizedEmail,
          organization: dto.organization?.trim() ?? null,
          messageLength: dto.message.trim().length,
          receivedAt,
          deliveryMode,
        })}\n`,
        'utf8',
      );
    } catch {
      // Non-fatal in read-only environments
    }

    return {
      inquiryId,
      category: dto.category,
      receivedAt,
      deliveryMode,
      notice:
        deliveryMode === 'webhook_forwarded'
          ? 'Your inquiry has been recorded and forwarded to the configured team webhook.'
          : 'Your inquiry has been validated and recorded in the server inquiry queue (SMTP/webhook delivery is not configured in this environment).',
    };
  }
}
