import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import type {
  ConsumerEntitlementSummary,
  EntitlementStatusResponse,
  PartnerStoreAuthResponse,
  PartnerStoreQrTokenResponse,
  PartnerStoreSubscriptionResponse,
  PartnerStoreUsageResponse,
  SponsoredSessionExpiredReason,
  SponsoredSessionStateResponse,
  UsageBillingModeType,
} from '@wearme/shared';
import { DatabaseService } from '../database/database.service';
import { resolveSigningSecret } from '../storage/file-token.util';

export interface SeededPartnerStoreConfig {
  storeId: string;
  storeName: string;
  city: string;
  verifiedPartner: boolean;
  supportedSubcategories: string[];
  planId: 'STARTER' | 'GROWTH' | 'PREMIUM';
  planName: string;
  monthlyPriceInr: number;
  includedCredits: number;
  devPartnerKey: string;
}

export const SEEDED_PARTNER_STORES: Record<string, SeededPartnerStoreConfig> = {
  store_indiranagar_01: {
    storeId: 'store_indiranagar_01',
    storeName: 'Studio Namma Indiranagar',
    city: 'Bengaluru',
    verifiedPartner: true,
    supportedSubcategories: ['TSHIRT', 'SHIRT', 'KURTA', 'SAREE', 'DRESS', 'JACKET'],
    planId: 'PREMIUM',
    planName: 'WearMe Premium',
    monthlyPriceInr: 4999,
    includedCredits: 1500,
    devPartnerKey: 'wm_partner_indiranagar_01_dev_key',
  },
  store_koramangala_02: {
    storeId: 'store_koramangala_02',
    storeName: 'Studio Koramangala Flagship',
    city: 'Bengaluru',
    verifiedPartner: true,
    supportedSubcategories: ['TSHIRT', 'SHIRT', 'DRESS', 'JACKET', 'TROUSERS'],
    planId: 'GROWTH',
    planName: 'WearMe Growth',
    monthlyPriceInr: 2499,
    includedCredits: 700,
    devPartnerKey: 'wm_partner_koramangala_02_dev_key',
  },
  store_jayanagar_03: {
    storeId: 'store_jayanagar_03',
    storeName: 'Studio Jayanagar Boutique',
    city: 'Bengaluru',
    verifiedPartner: true,
    supportedSubcategories: ['SAREE', 'KURTA', 'LEHENGA', 'SHERWANI', 'SHIRT'],
    planId: 'GROWTH',
    planName: 'WearMe Growth',
    monthlyPriceInr: 2499,
    includedCredits: 700,
    devPartnerKey: 'wm_partner_jayanagar_03_dev_key',
  },
  store_bandra_04: {
    storeId: 'store_bandra_04',
    storeName: 'Atelier Bandra West',
    city: 'Mumbai',
    verifiedPartner: true,
    supportedSubcategories: ['DRESS', 'BLAZER', 'SHIRT', 'TSHIRT', 'JACKET'],
    planId: 'STARTER',
    planName: 'WearMe Starter',
    monthlyPriceInr: 999,
    includedCredits: 200,
    devPartnerKey: 'wm_partner_bandra_04_dev_key',
  },
};

export interface ResolvedJobBillingContext {
  billingMode: 'STORE_SPONSORED' | 'PERSONAL';
  sponsoredStoreId: string | null;
  sponsoredStoreName: string | null;
  subscriptionId: string | null;
  consumerEntitlementId: string | null;
  sessionRecordId: string | null;
}

interface SignedStoreQrCheckInPayload {
  storeId: string;
  nonce: string;
  iat: number;
  exp: number;
}

@Injectable()
export class UsageEntitlementService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UsageEntitlementService.name);
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly db: DatabaseService) {}

  onModuleInit(): void {
    const rawInterval = process.env['RESERVATION_RECONCILE_INTERVAL_MS'];
    if (rawInterval === '0') {
      return;
    }
    const intervalMs = Number(rawInterval ?? 60_000);
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      return;
    }
    this.reconcileTimer = setInterval(() => {
      void this.reconcileStaleReservations().catch((err: unknown) => {
        this.logger.warn(
          `Scheduled reservation reconciliation failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    }, intervalMs);
    if (typeof this.reconcileTimer.unref === 'function') {
      this.reconcileTimer.unref();
    }
  }

  onModuleDestroy(): void {
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private get rawDb(): Record<string, any> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.db as unknown as Record<string, any>;
  }

  private get maxSessionLifetimeMinutes(): number {
    const val = Number(process.env['STORE_SESSION_MAX_LIFETIME_MINUTES'] ?? 60);
    return Number.isFinite(val) && val > 0 ? val : 60;
  }

  private get inactivityTimeoutMinutes(): number {
    const val = Number(process.env['STORE_SESSION_INACTIVITY_MINUTES'] ?? 15);
    return Number.isFinite(val) && val > 0 ? val : 15;
  }

  private get personalAuthenticatedCredits(): number {
    const val = Number(process.env['PERSONAL_AUTHENTICATED_CREDITS'] ?? 10);
    return Number.isFinite(val) && val >= 0 ? val : 10;
  }

  private get personalAnonymousCredits(): number {
    const val = Number(process.env['PERSONAL_ANONYMOUS_CREDITS'] ?? 5);
    return Number.isFinite(val) && val >= 0 ? val : 5;
  }

  private get reservationTtlMinutes(): number {
    const val = Number(process.env['USAGE_RESERVATION_TTL_MINUTES'] ?? 15);
    return Number.isFinite(val) && val > 0 ? val : 15;
  }

  hashPartnerKey(rawKey: string): string {
    return crypto.createHash('sha256').update(rawKey.trim()).digest('hex');
  }

  private verifyPartnerKeyConstantTime(rawKey: string, expectedHash: string): boolean {
    const candidateHash = this.hashPartnerKey(rawKey);
    const a = Buffer.from(candidateHash, 'utf8');
    const b = Buffer.from(expectedHash, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private resolveStoreQrSecret(store: Record<string, any>): string {
    if (store['qrTokenSecret'] && String(store['qrTokenSecret']).trim().length >= 16) {
      return String(store['qrTokenSecret']).trim();
    }
    return crypto
      .createHmac('sha256', resolveSigningSecret())
      .update(`qr_secret:${String(store['storeId'])}`)
      .digest('hex');
  }

  /**
   * Issues a short-lived, single-use signed QR check-in token for a physical store display.
   * Token issuance is strictly restricted to an authorized partner workflow (`requireKey: true`).
   */
  async issueStoreQrCheckInToken(
    storeId: string,
    auth?: { partnerStoreHeader?: string; partnerKeyHeader?: string; requireKey?: boolean },
    options?: { ttlSeconds?: number; now?: Date },
  ): Promise<PartnerStoreQrTokenResponse> {
    const { store } = await this.verifyPartnerStoreAccess(storeId, {
      ...auth,
      requireKey: auth?.requireKey ?? true,
    });
    const normalizedStoreId = String(store['storeId']);
    const now = options?.now ?? new Date();
    const rawTtl = Number(options?.ttlSeconds ?? 300);
    const ttlSeconds = Number.isFinite(rawTtl)
      ? Math.min(Math.max(30, Math.floor(rawTtl)), 900)
      : 300;
    const issuedAtMs = now.getTime();
    const expiresAtMs = issuedAtMs + ttlSeconds * 1000;

    const payload: SignedStoreQrCheckInPayload = {
      storeId: normalizedStoreId,
      nonce: crypto.randomBytes(12).toString('hex'),
      iat: issuedAtMs,
      exp: expiresAtMs,
    };

    const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const secret = this.resolveStoreQrSecret(store);
    const signature = crypto
      .createHmac('sha256', secret)
      .update(encodedPayload)
      .digest('hex');
    const qrToken = `${encodedPayload}.${signature}`;

    return {
      storeId: normalizedStoreId,
      qrToken,
      issuedAt: new Date(issuedAtMs).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      ttlSeconds,
      singleUse: true,
      checkInPath: `/try-on?storeId=${encodeURIComponent(normalizedStoreId)}&qrToken=${encodeURIComponent(qrToken)}`,
    };
  }

  /**
   * Verifies a signed store QR check-in token and atomically consumes its nonce in the ledger
   * so that a captured token or URL can never be replayed to renew an expired session from home.
   * Also returns the `idempotencyKey` so the caller can roll back nonce consumption if subsequent
   * session persistence fails.
   */
  private async verifyAndConsumeStoreQrCheckInToken(params: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store: Record<string, any>;
    qrToken: string;
    sessionToken: string;
    minIssuedAtMs?: number;
    now: Date;
  }): Promise<{ payload: SignedStoreQrCheckInPayload; idempotencyKey: string }> {
    const { store, qrToken, sessionToken, minIssuedAtMs, now } = params;
    const trimmed = qrToken.trim();
    const dotIndex = trimmed.indexOf('.');
    if (dotIndex <= 0 || dotIndex === trimmed.length - 1) {
      throw new ForbiddenException(
        'Invalid store QR check-in token format. Please scan the physical QR code in store.',
      );
    }

    const encodedPayload = trimmed.slice(0, dotIndex);
    const signature = trimmed.slice(dotIndex + 1);
    const secret = this.resolveStoreQrSecret(store);
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(encodedPayload)
      .digest('hex');

    const sigBuf = Buffer.from(signature, 'utf8');
    const expectedBuf = Buffer.from(expectedSig, 'utf8');
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      throw new ForbiddenException(
        'Invalid store QR check-in signature. Please scan the physical QR code in store.',
      );
    }

    let payload: SignedStoreQrCheckInPayload;
    try {
      payload = JSON.parse(
        Buffer.from(encodedPayload, 'base64url').toString('utf8'),
      ) as SignedStoreQrCheckInPayload;
    } catch {
      throw new ForbiddenException('Malformed store QR check-in token payload.');
    }

    if (
      !payload ||
      payload.storeId !== String(store['storeId']) ||
      typeof payload.nonce !== 'string' ||
      payload.nonce.length < 8 ||
      typeof payload.iat !== 'number' ||
      typeof payload.exp !== 'number'
    ) {
      throw new ForbiddenException(
        'Store QR check-in token does not match this boutique.',
      );
    }

    if (now.getTime() >= payload.exp) {
      throw new ForbiddenException(
        'This store QR check-in token has expired. Please scan a fresh QR code in the boutique or continue with Personal WearMe.',
      );
    }

    if (typeof minIssuedAtMs === 'number' && payload.iat < minIssuedAtMs) {
      throw new ForbiddenException(
        'This QR check-in token was issued before your previous session started and cannot be reused to renew an expired session.',
      );
    }

    const tokenHash = crypto.createHash('sha256').update(trimmed).digest('hex');
    const idempotencyKey = `qr_checkin:${tokenHash}`;
    const ledgerDelegate = this.rawDb['usageLedgerEntry'];
    if (ledgerDelegate?.create) {
      try {
        await ledgerDelegate.create({
          data: {
            idempotencyKey,
            eventType: 'ADJUSTMENT',
            billingMode: 'STORE_SPONSORED',
            creditsDelta: 0,
            storeId: String(store['storeId']),
            reason: `QR_CHECKIN_TOKEN_CONSUMED:${sessionToken}`,
          },
        });
      } catch {
        throw new ForbiddenException(
          'This store QR check-in token has already been used. Please scan a fresh QR code in the boutique or continue with Personal WearMe.',
        );
      }
    }

    return { payload, idempotencyKey };
  }

  /**
   * Ensures a known partner store and its active subscription exist in PostgreSQL.
   */
  async ensureStoreAndSubscriptionSeeded(storeId: string): Promise<{
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store: Record<string, any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    subscription: Record<string, any> | null;
  }> {
    const normalizedId = storeId.trim();
    const seed = SEEDED_PARTNER_STORES[normalizedId];
    const partnerStoreDelegate = this.rawDb['partnerStore'];
    const subscriptionDelegate = this.rawDb['partnerStoreSubscription'];

    if (!partnerStoreDelegate) {
      if (!seed) {
        throw new NotFoundException(`Partner store "${normalizedId}" is not registered.`);
      }
      const now = new Date();
      const periodEnd = new Date(now.getTime() + 30 * 86400_000);
      return {
        store: {
          storeId: seed.storeId,
          storeName: seed.storeName,
          city: seed.city,
          verifiedPartner: seed.verifiedPartner,
          status: 'ACTIVE',
          supportedSubcategories: seed.supportedSubcategories,
          creditBalance: seed.includedCredits,
          totalCreditsUsed: 0,
        },
        subscription: {
          id: `sub_${seed.storeId}`,
          storeId: seed.storeId,
          planId: seed.planId,
          planName: seed.planName,
          monthlyPriceInr: seed.monthlyPriceInr,
          status: 'ACTIVE',
          periodStart: now,
          periodEnd,
          includedCredits: seed.includedCredits,
          consumedCredits: 0,
          reservedCredits: 0,
          failedGenerationsCount: 0,
          overagePolicy: 'BLOCK',
        },
      };
    }

    let store = await partnerStoreDelegate.findUnique({
      where: { storeId: normalizedId },
    });

    if (!store) {
      if (!seed) {
        throw new NotFoundException(`Partner store "${normalizedId}" is not registered.`);
      }
      store = await partnerStoreDelegate.upsert({
        where: { storeId: seed.storeId },
        create: {
          storeId: seed.storeId,
          storeName: seed.storeName,
          city: seed.city,
          verifiedPartner: seed.verifiedPartner,
          status: 'ACTIVE',
          apiKeyHash: this.hashPartnerKey(seed.devPartnerKey),
          qrTokenSecret: crypto.randomBytes(16).toString('hex'),
          supportedSubcategories: seed.supportedSubcategories,
          creditBalance: seed.includedCredits,
          totalCreditsUsed: 0,
        },
        update: {},
      });
    } else if (seed && !store.apiKeyHash && typeof partnerStoreDelegate.update === 'function') {
      store = await partnerStoreDelegate.update({
        where: { storeId: seed.storeId },
        data: {
          apiKeyHash: this.hashPartnerKey(seed.devPartnerKey),
          supportedSubcategories:
            Array.isArray(store.supportedSubcategories) && store.supportedSubcategories.length > 0
              ? store.supportedSubcategories
              : seed.supportedSubcategories,
        },
      });
    }

    let subscription = null;
    if (subscriptionDelegate) {
      subscription = await subscriptionDelegate.findFirst({
        where: { storeId: normalizedId },
        orderBy: [{ createdAt: 'desc' }, { periodEnd: 'desc' }],
      }).catch(() =>
        subscriptionDelegate.findFirst({
          where: { storeId: normalizedId },
          orderBy: { createdAt: 'desc' },
        }),
      );

      if (!subscription) {
        const now = new Date();
        const periodEnd = new Date(now.getTime() + 30 * 86400_000);
        const includedCredits = seed?.includedCredits ?? Number(store.creditBalance ?? 100);
        subscription = await subscriptionDelegate.create({
          data: {
            storeId: normalizedId,
            planId: seed?.planId ?? 'GROWTH',
            planName: seed?.planName ?? 'WearMe Growth',
            monthlyPriceInr: seed?.monthlyPriceInr ?? 2499,
            status: 'ACTIVE',
            periodStart: now,
            periodEnd,
            includedCredits,
            consumedCredits: Number(store.totalCreditsUsed ?? 0),
            reservedCredits: 0,
            failedGenerationsCount: 0,
            overagePolicy: 'BLOCK',
          },
        });
      } else {
        const now = new Date();
        const periodEnd = subscription['periodEnd']
          ? new Date(subscription['periodEnd'])
          : null;
        const currentStatus = String(subscription['status'] ?? 'ACTIVE');
        if (
          periodEnd &&
          periodEnd.getTime() <= now.getTime() &&
          (currentStatus === 'ACTIVE' || currentStatus === 'TRIAL') &&
          typeof subscriptionDelegate.update === 'function'
        ) {
          subscription = await subscriptionDelegate.update({
            where: { id: subscription['id'] },
            data: { status: 'PAST_DUE' },
          });
        }
      }
    }

    return { store, subscription };
  }

  /**
   * Seeds all 4 default partner stores into PostgreSQL when available.
   */
  async ensureAllDefaultStoresSeeded(): Promise<void> {
    for (const storeId of Object.keys(SEEDED_PARTNER_STORES)) {
      await this.ensureStoreAndSubscriptionSeeded(storeId);
    }
  }

  /**
   * Evaluates whether a store and its subscription can sponsor try-on jobs right now.
   */
  private evaluateStoreSponsorshipEligibility(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store: Record<string, any>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    subscription: Record<string, any> | null,
    now: Date,
  ): {
    eligible: boolean;
    reason: SponsoredSessionExpiredReason | null;
    remainingCredits: number;
  } {
    if (store['status'] === 'SUSPENDED' || store['verifiedPartner'] === false) {
      return {
        eligible: false,
        reason: 'STORE_SUSPENDED',
        remainingCredits: 0,
      };
    }

    if (!subscription) {
      const fallbackRemaining = Math.max(0, Number(store['creditBalance'] ?? 0));
      if (fallbackRemaining <= 0) {
        return {
          eligible: false,
          reason: 'STORE_QUOTA_EXHAUSTED',
          remainingCredits: 0,
        };
      }
      return {
        eligible: true,
        reason: null,
        remainingCredits: fallbackRemaining,
      };
    }

    const subStatus = String(subscription['status'] ?? 'ACTIVE');
    const periodEnd = subscription['periodEnd'] ? new Date(subscription['periodEnd']) : null;
    if (
      (subStatus !== 'ACTIVE' && subStatus !== 'TRIAL') ||
      (periodEnd && periodEnd.getTime() <= now.getTime())
    ) {
      return {
        eligible: false,
        reason: 'SUBSCRIPTION_INACTIVE',
        remainingCredits: 0,
      };
    }

    const included = Number(subscription['includedCredits'] ?? 0);
    const consumed = Number(subscription['consumedCredits'] ?? 0);
    const reserved = Number(subscription['reservedCredits'] ?? 0);
    const remaining = Math.max(0, included - consumed - reserved);
    const overagePolicy = String(subscription['overagePolicy'] ?? 'BLOCK');

    if (remaining <= 0 && overagePolicy !== 'ALLOW_CONFIGURED') {
      return {
        eligible: false,
        reason: 'STORE_QUOTA_EXHAUSTED',
        remainingCredits: 0,
      };
    }

    return {
      eligible: true,
      reason: null,
      remainingCredits: remaining,
    };
  }

  /**
   * Starts or inspects a bounded Store-Sponsored QR Session.
   *
   * CRITICAL SECURITY & BILLING INVARIANTS:
   * 1. Page refresh or client-supplied `forceRefreshScan: true` NEVER resets or extends
   *    `sponsoredExpiresAt` for an existing session.
   * 2. Renewing an expired/timed-out/revoked session requires a verifiable, short-lived,
   *    single-use signed `qrToken` (`verifyAndConsumeStoreQrCheckInToken`) issued after
   *    the previous session started.
   * 3. An authenticated user cannot bypass an expired session at the same store by minting
   *    a new `sessionToken` from home without a valid `qrToken`.
   * 4. Changing `?storeId=` query parameters on an existing session cannot overwrite or reset
   *    the session's store binding without a valid signed `qrToken`.
   */
  async createOrInspectSponsoredSession(
    storeId: string,
    sessionToken?: string,
    options?: {
      userId?: string | null;
      forceRefreshScan?: boolean;
      qrToken?: string | null;
    },
  ): Promise<SponsoredSessionStateResponse> {
    const normalizedStoreId = storeId.trim();
    const { store, subscription } = await this.ensureStoreAndSubscriptionSeeded(normalizedStoreId);
    const now = new Date();
    const maxLifetimeMinutes = this.maxSessionLifetimeMinutes;
    const inactivityTimeoutMinutes = this.inactivityTimeoutMinutes;

    const effectiveSessionToken =
      sessionToken && sessionToken.trim().length >= 8
        ? sessionToken.trim()
        : `wm_${crypto.randomBytes(16).toString('hex')}`;

    const storeEligibility = this.evaluateStoreSponsorshipEligibility(store, subscription, now);
    const sessionDelegate = this.rawDb['tryOnSession'];

    if (!sessionDelegate) {
      const expiresAt = new Date(now.getTime() + maxLifetimeMinutes * 60_000);
      return {
        sessionToken: effectiveSessionToken,
        usageMode: storeEligibility.eligible ? 'STORE_SPONSORED' : 'PERSONAL',
        active: storeEligibility.eligible,
        storeId: String(store['storeId']),
        storeName: String(store['storeName']),
        city: store['city'] ? String(store['city']) : null,
        startedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        lastActivityAt: now.toISOString(),
        remainingSeconds: storeEligibility.eligible ? maxLifetimeMinutes * 60 : 0,
        inactivityTimeoutMinutes,
        maxLifetimeMinutes,
        expiredReason: storeEligibility.reason,
        storeQuotaRemaining: storeEligibility.remainingCredits,
        message: storeEligibility.eligible
          ? `Trying on at ${String(store['storeName'])}. Sponsored in-store session active.`
          : this.formatExpiredMessage(String(store['storeName']), storeEligibility.reason),
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let existingSession: Record<string, any> | null = await sessionDelegate.findUnique({
      where: { sessionToken: effectiveSessionToken },
    });

    // Prevent authenticated user from rotating sessionToken or store-hopping to escape an expired store window
    if (
      (!existingSession || existingSession['sponsoredStoreId'] !== normalizedStoreId) &&
      options?.userId &&
      typeof sessionDelegate.findMany === 'function'
    ) {
      const priorUserSessions = await sessionDelegate.findMany({
        where: {
          userId: options.userId,
          sponsoredStoreId: normalizedStoreId,
        },
      });
      if (Array.isArray(priorUserSessions) && priorUserSessions.length > 0) {
        const sorted = [...priorUserSessions].sort((a, b) => {
          const ta = new Date(a['sponsoredStartedAt'] ?? a['createdAt'] ?? 0).getTime();
          const tb = new Date(b['sponsoredStartedAt'] ?? b['createdAt'] ?? 0).getTime();
          return tb - ta;
        });
        if (sorted[0]?.['sponsoredExpiresAt']) {
          existingSession = sorted[0];
        }
      }
    }

    let hasVerifiedQrRenewal = false;
    let consumedQrIdempotencyKey: string | null = null;
    if (options?.qrToken && options.qrToken.trim().length > 0) {
      const minIssuedAtMs =
        existingSession &&
        existingSession['sponsoredStoreId'] === normalizedStoreId &&
        existingSession['sponsoredStartedAt']
          ? new Date(existingSession['sponsoredStartedAt']).getTime()
          : undefined;
      const verifiedQr = await this.verifyAndConsumeStoreQrCheckInToken({
        store,
        qrToken: options.qrToken,
        sessionToken: effectiveSessionToken,
        minIssuedAtMs,
        now,
      });
      hasVerifiedQrRenewal = true;
      consumedQrIdempotencyKey = verifiedQr.idempotencyKey;
    }

    // Prevent query-parameter store-hopping (`?storeId=storeB` then back to `?storeId=storeA`) from overwriting an existing store session without a signed qrToken
    if (
      existingSession &&
      existingSession['sponsoredStoreId'] &&
      existingSession['sponsoredStoreId'] !== normalizedStoreId &&
      !hasVerifiedQrRenewal
    ) {
      return {
        sessionToken: effectiveSessionToken,
        usageMode: 'PERSONAL',
        active: false,
        storeId: String(store['storeId']),
        storeName: String(store['storeName']),
        city: store['city'] ? String(store['city']) : null,
        startedAt: now.toISOString(),
        expiresAt: now.toISOString(),
        lastActivityAt: now.toISOString(),
        remainingSeconds: 0,
        inactivityTimeoutMinutes,
        maxLifetimeMinutes,
        expiredReason: 'REVOKED',
        storeQuotaRemaining: storeEligibility.remainingCredits,
        message: this.formatExpiredMessage(String(store['storeName']), 'REVOKED'),
      };
    }

    // Case 1: Session already exists for this exact store and has bounded timestamps.
    // Note: `forceRefreshScan: true` is NEVER sufficient on its own to bypass Case 1!
    // Only a cryptographically verified single-use `qrToken` (`hasVerifiedQrRenewal`) can renew.
    if (
      existingSession &&
      existingSession['sponsoredStoreId'] === normalizedStoreId &&
      existingSession['sponsoredExpiresAt'] &&
      !hasVerifiedQrRenewal
    ) {
      const startedAt = existingSession['sponsoredStartedAt']
        ? new Date(existingSession['sponsoredStartedAt'])
        : new Date(existingSession['createdAt'] ?? now);
      const expiresAt = new Date(existingSession['sponsoredExpiresAt']);
      const lastActivityAt = existingSession['lastActivityAt']
        ? new Date(existingSession['lastActivityAt'])
        : startedAt;
      const sessInactivityMin = Number(
        existingSession['inactivityTimeoutMinutes'] ?? inactivityTimeoutMinutes,
      );
      const sessMaxLifetimeMin = Number(
        existingSession['maxLifetimeMinutes'] ?? maxLifetimeMinutes,
      );

      let expiredReason: SponsoredSessionExpiredReason | null = null;
      if (!storeEligibility.eligible) {
        expiredReason = storeEligibility.reason;
      } else if (
        existingSession['revokedAt'] ||
        existingSession['usageMode'] !== 'STORE_SPONSORED'
      ) {
        expiredReason = 'REVOKED';
      } else if (now.getTime() >= expiresAt.getTime()) {
        expiredReason = 'SESSION_EXPIRED';
      } else if (now.getTime() - lastActivityAt.getTime() >= sessInactivityMin * 60_000) {
        expiredReason = 'INACTIVITY_TIMEOUT';
      }

      if (expiredReason !== null) {
        return {
          sessionToken: effectiveSessionToken,
          usageMode: 'PERSONAL',
          active: false,
          storeId: String(store['storeId']),
          storeName: String(store['storeName']),
          city: store['city'] ? String(store['city']) : null,
          startedAt: startedAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
          lastActivityAt: lastActivityAt.toISOString(),
          remainingSeconds: 0,
          inactivityTimeoutMinutes: sessInactivityMin,
          maxLifetimeMinutes: sessMaxLifetimeMin,
          expiredReason,
          storeQuotaRemaining: storeEligibility.remainingCredits,
          message: this.formatExpiredMessage(String(store['storeName']), expiredReason),
        };
      }

      // Active session: touch lastActivityAt ONLY, NEVER extend sponsoredExpiresAt!
      await sessionDelegate.update({
        where: { id: existingSession['id'] },
        data: {
          lastActivityAt: now,
          ...(options?.userId && !existingSession['userId'] ? { userId: options.userId } : {}),
        },
      });

      const remainingSeconds = Math.max(
        0,
        Math.floor((expiresAt.getTime() - now.getTime()) / 1000),
      );

      return {
        sessionToken: effectiveSessionToken,
        usageMode: 'STORE_SPONSORED',
        active: true,
        storeId: String(store['storeId']),
        storeName: String(store['storeName']),
        city: store['city'] ? String(store['city']) : null,
        startedAt: startedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        lastActivityAt: now.toISOString(),
        remainingSeconds,
        inactivityTimeoutMinutes: sessInactivityMin,
        maxLifetimeMinutes: sessMaxLifetimeMin,
        expiredReason: null,
        storeQuotaRemaining: storeEligibility.remainingCredits,
        message: `Trying on at ${String(store['storeName'])}. Sponsored in-store session active.`,
      };
    }

    // Strict check-in enforcement: when REQUIRE_SIGNED_QR_CHECKIN=true, initial session creation also requires a valid signed qrToken
    const requireSignedQrForInitial =
      process.env['REQUIRE_SIGNED_QR_CHECKIN'] === 'true' ||
      process.env['REQUIRE_SIGNED_QR_CHECKIN'] === '1';
    if (requireSignedQrForInitial && !hasVerifiedQrRenewal) {
      return {
        sessionToken: effectiveSessionToken,
        usageMode: 'PERSONAL',
        active: false,
        storeId: String(store['storeId']),
        storeName: String(store['storeName']),
        city: store['city'] ? String(store['city']) : null,
        startedAt: now.toISOString(),
        expiresAt: now.toISOString(),
        lastActivityAt: now.toISOString(),
        remainingSeconds: 0,
        inactivityTimeoutMinutes,
        maxLifetimeMinutes,
        expiredReason: 'REVOKED',
        storeQuotaRemaining: storeEligibility.remainingCredits,
        message: this.formatExpiredMessage(String(store['storeName']), 'REVOKED'),
      };
    }

    // Case 2: First-time QR scan for this session/store OR verified single-use qrToken renewal
    const startedAt = now;
    const expiresAt = new Date(now.getTime() + maxLifetimeMinutes * 60_000);
    const active = storeEligibility.eligible;
    const usageMode: UsageBillingModeType = active ? 'STORE_SPONSORED' : 'PERSONAL';

    try {
      await sessionDelegate.upsert({
        where: { sessionToken: effectiveSessionToken },
        create: {
          sessionToken: effectiveSessionToken,
          storeId: String(store['storeId']),
          storeName: String(store['storeName']),
          usageMode,
          sponsoredStoreId: String(store['storeId']),
          sponsoredStartedAt: startedAt,
          sponsoredExpiresAt: expiresAt,
          lastActivityAt: now,
          inactivityTimeoutMinutes,
          maxLifetimeMinutes,
          revokedAt: active ? null : now,
          revokeReason: active ? null : storeEligibility.reason,
          ...(options?.userId ? { userId: options.userId } : {}),
        },
        update: {
          storeId: String(store['storeId']),
          storeName: String(store['storeName']),
          usageMode,
          sponsoredStoreId: String(store['storeId']),
          sponsoredStartedAt: startedAt,
          sponsoredExpiresAt: expiresAt,
          lastActivityAt: now,
          inactivityTimeoutMinutes,
          maxLifetimeMinutes,
          revokedAt: active ? null : now,
          revokeReason: active ? null : storeEligibility.reason,
          ...(options?.userId ? { userId: options.userId } : {}),
        },
      });
    } catch (err) {
      if (consumedQrIdempotencyKey && this.rawDb['usageLedgerEntry']?.delete) {
        await this.rawDb['usageLedgerEntry']
          .delete({ where: { idempotencyKey: consumedQrIdempotencyKey } })
          .catch(() => undefined);
      }
      throw err;
    }

    return {
      sessionToken: effectiveSessionToken,
      usageMode,
      active,
      storeId: String(store['storeId']),
      storeName: String(store['storeName']),
      city: store['city'] ? String(store['city']) : null,
      startedAt: startedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      lastActivityAt: now.toISOString(),
      remainingSeconds: active ? maxLifetimeMinutes * 60 : 0,
      inactivityTimeoutMinutes,
      maxLifetimeMinutes,
      expiredReason: storeEligibility.reason,
      storeQuotaRemaining: storeEligibility.remainingCredits,
      message: active
        ? `Trying on at ${String(store['storeName'])}. Sponsored in-store session active.`
        : this.formatExpiredMessage(String(store['storeName']), storeEligibility.reason),
    };
  }

  private formatExpiredMessage(
    storeName: string,
    reason: SponsoredSessionExpiredReason | null,
  ): string {
    switch (reason) {
      case 'SESSION_EXPIRED':
        return `Your in-store try-on session at ${storeName} has ended. Continue with Personal WearMe or scan the shop QR code again in store.`;
      case 'INACTIVITY_TIMEOUT':
        return `Your in-store try-on session at ${storeName} timed out due to inactivity. Continue with Personal WearMe or scan the shop QR code again in store.`;
      case 'REVOKED':
        return `You are currently using Personal WearMe. Scan the QR code at ${storeName} if you are in the store.`;
      case 'STORE_SUSPENDED':
        return `${storeName}'s in-store virtual try-on sponsorship is currently paused. You can continue with Personal WearMe.`;
      case 'SUBSCRIPTION_INACTIVE':
        return `${storeName}'s subscription period has ended. You can continue with Personal WearMe.`;
      case 'STORE_QUOTA_EXHAUSTED':
        return `${storeName}'s monthly sponsored try-on quota is currently full. You can continue immediately with Personal WearMe.`;
      default:
        return `Your in-store try-on session at ${storeName} is no longer active. Continue with Personal WearMe.`;
    }
  }

  /**
   * Explicitly switches a session from Store-Sponsored mode to Personal WearMe mode.
   */
  async switchSessionToPersonalMode(
    sessionToken?: string,
    userId?: string | null,
  ): Promise<EntitlementStatusResponse> {
    const effectiveToken =
      sessionToken && sessionToken.trim().length >= 8
        ? sessionToken.trim()
        : `wm_${crypto.randomBytes(16).toString('hex')}`;
    const now = new Date();
    const sessionDelegate = this.rawDb['tryOnSession'];

    if (sessionDelegate) {
      await sessionDelegate.upsert({
        where: { sessionToken: effectiveToken },
        create: {
          sessionToken: effectiveToken,
          usageMode: 'PERSONAL',
          lastActivityAt: now,
          revokedAt: now,
          revokeReason: 'USER_SWITCHED_TO_PERSONAL',
          ...(userId ? { userId } : {}),
        },
        update: {
          usageMode: 'PERSONAL',
          lastActivityAt: now,
          revokedAt: now,
          revokeReason: 'USER_SWITCHED_TO_PERSONAL',
          ...(userId ? { userId } : {}),
        },
      });
    }

    return this.getEntitlementStatus(effectiveToken, userId);
  }

  /**
   * Gets or creates the caller's personal ConsumerEntitlement (never tied to any PartnerStore).
   * Enforces period lifecycle:
   * - Free authenticated monthly tier (`PERSONAL_FREE`) rolls into a fresh 30-day cycle when `now >= periodEnd`.
   * - Anonymous trial (`ANONYMOUS_TRIAL`) or paid plans transition to `EXPIRED` / `PAST_DUE` when `now >= periodEnd`.
   */
  async getOrCreateConsumerEntitlement(
    userId?: string | null,
    sessionToken?: string | null,
  ): Promise<{
    id: string;
    summary: ConsumerEntitlementSummary;
  }> {
    const now = new Date();
    const defaultPeriodEnd = new Date(now.getTime() + 30 * 86400_000);
    const isAuthenticated = Boolean(userId && userId.trim().length > 0);
    const defaultIncluded = isAuthenticated
      ? this.personalAuthenticatedCredits
      : this.personalAnonymousCredits;
    const defaultPlanId = isAuthenticated ? 'PERSONAL_FREE' : 'ANONYMOUS_TRIAL';

    const entitlementDelegate = this.rawDb['consumerEntitlement'];
    if (!entitlementDelegate) {
      return {
        id: isAuthenticated ? `ent_user_${userId}` : `ent_sess_${sessionToken ?? 'anon'}`,
        summary: {
          planId: defaultPlanId,
          status: 'ACTIVE',
          includedCredits: defaultIncluded,
          consumedCredits: 0,
          reservedCredits: 0,
          remainingCredits: defaultIncluded,
          failedGenerationsCount: 0,
          periodStart: now.toISOString(),
          periodEnd: defaultPeriodEnd.toISOString(),
        },
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let record: Record<string, any> | null = null;
    if (isAuthenticated && userId) {
      record = await entitlementDelegate.findUnique({
        where: { userId: userId.trim() },
      });
      if (!record) {
        record = await entitlementDelegate.create({
          data: {
            userId: userId.trim(),
            planId: defaultPlanId,
            status: 'ACTIVE',
            periodStart: now,
            periodEnd: defaultPeriodEnd,
            includedCredits: defaultIncluded,
            consumedCredits: 0,
            reservedCredits: 0,
            failedGenerationsCount: 0,
          },
        });
      }
    } else {
      const normalizedToken =
        sessionToken && sessionToken.trim().length >= 8
          ? sessionToken.trim()
          : `wm_anon_default`;
      record = await entitlementDelegate.findUnique({
        where: { sessionToken: normalizedToken },
      });
      if (!record) {
        record = await entitlementDelegate.create({
          data: {
            sessionToken: normalizedToken,
            planId: defaultPlanId,
            status: 'ACTIVE',
            periodStart: now,
            periodEnd: defaultPeriodEnd,
            includedCredits: defaultIncluded,
            consumedCredits: 0,
            reservedCredits: 0,
            failedGenerationsCount: 0,
          },
        });
      }
    }

    if (record && typeof entitlementDelegate.update === 'function') {
      const periodEnd = record['periodEnd'] ? new Date(record['periodEnd']) : null;
      const currentStatus = String(record['status'] ?? 'ACTIVE');
      const planId = String(record['planId'] ?? defaultPlanId);
      if (periodEnd && periodEnd.getTime() <= now.getTime()) {
        if (planId === 'PERSONAL_FREE' && currentStatus === 'ACTIVE') {
          record = await entitlementDelegate.update({
            where: { id: record['id'] },
            data: {
              periodStart: now,
              periodEnd: defaultPeriodEnd,
              consumedCredits: 0,
            },
          });
        } else if (currentStatus === 'ACTIVE' || currentStatus === 'TRIAL') {
          const expiredStatus = planId === 'ANONYMOUS_TRIAL' ? 'EXPIRED' : 'PAST_DUE';
          record = await entitlementDelegate.update({
            where: { id: record['id'] },
            data: { status: expiredStatus },
          });
        }
      }
    }

    const status = String(record?.['status'] ?? 'ACTIVE');
    const included = Number(record?.['includedCredits'] ?? defaultIncluded);
    const consumed = Number(record?.['consumedCredits'] ?? 0);
    const reserved = Number(record?.['reservedCredits'] ?? 0);
    const isActiveStatus = status === 'ACTIVE' || status === 'TRIAL';
    const remaining = isActiveStatus ? Math.max(0, included - consumed - reserved) : 0;

    return {
      id: String(record?.['id']),
      summary: {
        planId: String(record?.['planId'] ?? defaultPlanId),
        status,
        includedCredits: included,
        consumedCredits: consumed,
        reservedCredits: reserved,
        remainingCredits: remaining,
        failedGenerationsCount: Number(record?.['failedGenerationsCount'] ?? 0),
        periodStart: new Date(record?.['periodStart'] ?? now).toISOString(),
        periodEnd: new Date(record?.['periodEnd'] ?? defaultPeriodEnd).toISOString(),
      },
    };
  }

  /**
   * Deterministically reconciles an anonymous session's ConsumerEntitlement into the
   * authenticated user's ConsumerEntitlement when a session upgrades via OTP login.
   * Atomically claims the anonymous entitlement row first and re-links all reservations
   * and ledger entries BEFORE deleting the anonymous row so ON DELETE SET NULL never detaches records.
   */
  async migrateAnonymousEntitlementOnUpgrade(
    sessionToken: string,
    userId: string,
  ): Promise<void> {
    const normalizedToken = sessionToken?.trim();
    const normalizedUserId = userId?.trim();
    if (!normalizedToken || normalizedToken.length < 8 || !normalizedUserId) {
      return;
    }

    const entitlementDelegate = this.rawDb['consumerEntitlement'];
    if (!entitlementDelegate?.findUnique) {
      return;
    }

    const anonRecord = await entitlementDelegate.findUnique({
      where: { sessionToken: normalizedToken },
    });

    const userEnt = await this.getOrCreateConsumerEntitlement(
      normalizedUserId,
      normalizedToken,
    );

    if (!anonRecord || String(anonRecord['id']) === userEnt.id) {
      return;
    }

    const anonId = String(anonRecord['id']);
    const anonConsumed = Number(anonRecord['consumedCredits'] ?? 0);
    const anonReserved = Number(anonRecord['reservedCredits'] ?? 0);
    const anonFailed = Number(anonRecord['failedGenerationsCount'] ?? 0);

    // Atomically claim the anonymous entitlement so concurrent upgrade calls cannot double-migrate credits
    if (typeof entitlementDelegate.updateMany === 'function') {
      const claimed = await entitlementDelegate.updateMany({
        where: { id: anonId, sessionToken: normalizedToken },
        data: { sessionToken: null, status: 'EXPIRED' },
      });
      if (!claimed || claimed.count === 0) {
        return;
      }
    }

    // Re-link reservations, ledger entries, and jobs BEFORE deleting anonId so ON DELETE SET NULL cannot detach them
    if (this.rawDb['usageReservation']?.updateMany) {
      await this.rawDb['usageReservation']
        .updateMany({
          where: { consumerEntitlementId: anonId },
          data: { consumerEntitlementId: userEnt.id, userId: normalizedUserId },
        })
        .catch(() => undefined);
    }

    if (this.rawDb['usageLedgerEntry']?.updateMany) {
      await this.rawDb['usageLedgerEntry']
        .updateMany({
          where: { consumerEntitlementId: anonId },
          data: { consumerEntitlementId: userEnt.id, userId: normalizedUserId },
        })
        .catch(() => undefined);
    }

    if (this.rawDb['tryOnJob']?.updateMany) {
      await this.rawDb['tryOnJob']
        .updateMany({
          where: { consumerEntitlementId: anonId },
          data: { consumerEntitlementId: userEnt.id },
        })
        .catch(() => undefined);
    }

    if (typeof this.rawDb['$executeRaw'] === 'function') {
      await this.rawDb['$executeRaw']`
        UPDATE "ConsumerEntitlement"
        SET "consumedCredits" = "consumedCredits" + ${anonConsumed},
            "reservedCredits" = "reservedCredits" + ${anonReserved},
            "failedGenerationsCount" = "failedGenerationsCount" + ${anonFailed},
            "updatedAt" = NOW()
        WHERE "id" = ${userEnt.id}
      `;
    } else {
      const currentUserRecord = await entitlementDelegate.findUnique({
        where: { id: userEnt.id },
      });
      if (currentUserRecord && typeof entitlementDelegate.update === 'function') {
        await entitlementDelegate.update({
          where: { id: userEnt.id },
          data: {
            consumedCredits: Number(currentUserRecord['consumedCredits'] ?? 0) + anonConsumed,
            reservedCredits: Number(currentUserRecord['reservedCredits'] ?? 0) + anonReserved,
            failedGenerationsCount:
              Number(currentUserRecord['failedGenerationsCount'] ?? 0) + anonFailed,
          },
        });
      }
    }

    if (this.rawDb['usageLedgerEntry']?.create) {
      await this.rawDb['usageLedgerEntry']
        .create({
          data: {
            idempotencyKey: `migrate_anon_ent:${anonId}`,
            eventType: 'ADJUSTMENT',
            billingMode: 'PERSONAL',
            creditsDelta: 0,
            consumerEntitlementId: userEnt.id,
            userId: normalizedUserId,
            reason: `MIGRATED_ANONYMOUS_ENTITLEMENT:${anonId}`,
          },
        })
        .catch(() => undefined);
    }

    if (typeof entitlementDelegate.delete === 'function') {
      await entitlementDelegate.delete({ where: { id: anonId } }).catch(() => undefined);
    }
  }

  /**
   * Returns the complete entitlement status for the current user/session.
   * Explicitly separates `effectiveBillingMode`, `sponsoredSession`, `personalEntitlement`,
   * and historical `originStoreAttribution` (which NEVER grants store sponsorship).
   */
  async getEntitlementStatus(
    sessionToken?: string,
    userId?: string | null,
  ): Promise<EntitlementStatusResponse> {
    const personal = await this.getOrCreateConsumerEntitlement(userId, sessionToken);
    let sponsoredSession: SponsoredSessionStateResponse | null = null;
    let originStoreAttribution: { storeId: string | null; storeName: string | null } | null = null;

    if (userId && this.rawDb['user']) {
      const user = await this.rawDb['user'].findUnique({
        where: { id: userId },
      });
      if (user && (user['originStoreId'] || user['originStoreName'])) {
        originStoreAttribution = {
          storeId: user['originStoreId'] ? String(user['originStoreId']) : null,
          storeName: user['originStoreName'] ? String(user['originStoreName']) : null,
        };
      }
    }

    if (sessionToken && sessionToken.trim().length >= 8 && this.rawDb['tryOnSession']) {
      const sess = await this.rawDb['tryOnSession'].findUnique({
        where: { sessionToken: sessionToken.trim() },
      });
      if (sess && sess['sponsoredStoreId']) {
        try {
          sponsoredSession = await this.createOrInspectSponsoredSession(
            String(sess['sponsoredStoreId']),
            sessionToken.trim(),
            { userId, forceRefreshScan: false },
          );
        } catch {
          sponsoredSession = null;
        }
      }
    }

    const effectiveBillingMode: UsageBillingModeType =
      sponsoredSession && sponsoredSession.active ? 'STORE_SPONSORED' : 'PERSONAL';

    return {
      effectiveBillingMode,
      sponsoredSession,
      personalEntitlement: personal.summary,
      authenticatedUserId: userId ?? null,
      originStoreAttribution,
    };
  }

  /**
   * Authoritatively selects and validates the billing context for a new TryOnJob.
   *
   * CRITICAL SECURITY & BILLING INVARIANTS:
   * 1. NEVER uses `User.originStoreId` as billing authority.
   * 2. NEVER trusts a raw `?storeId=` parameter unless backed by an active, non-expired,
   *    non-inactive, unrevoked server-side `TryOnSession` with `usageMode === 'STORE_SPONSORED'`.
   * 3. Rejects expired/inactive/revoked store sessions BEFORE job creation or AI inference.
   */
  async resolveBillingContextForNewJob(params: {
    sessionToken?: string;
    userId?: string | null;
    requestedStoreId?: string | null;
  }): Promise<ResolvedJobBillingContext> {
    const sessionDelegate = this.rawDb['tryOnSession'];
    const requestedStoreId = params.requestedStoreId?.trim() || null;
    const sessionToken = params.sessionToken?.trim() || null;

    // Inspect server-side TryOnSession if available
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sessionRecord: Record<string, any> | null = null;
    if (sessionDelegate && sessionToken && sessionToken.length >= 8) {
      sessionRecord = await sessionDelegate.findUnique({
        where: { sessionToken },
      });
    }

    const sessionIsSponsored =
      sessionRecord &&
      sessionRecord['usageMode'] === 'STORE_SPONSORED' &&
      Boolean(sessionRecord['sponsoredStoreId']);

    // If the session is currently in STORE_SPONSORED mode OR the caller explicitly asked for store billing
    if (sessionIsSponsored || requestedStoreId) {
      const targetStoreId = requestedStoreId ?? String(sessionRecord?.['sponsoredStoreId'] ?? '');

      if (!sessionRecord || !sessionRecord['sponsoredStoreId']) {
        throw new ForbiddenException(
          `A verified active in-store QR session is required for store-sponsored try-on at "${targetStoreId}". Continue with Personal WearMe or scan the shop QR code in store.`,
        );
      }

      if (
        requestedStoreId &&
        String(sessionRecord['sponsoredStoreId']) !== requestedStoreId
      ) {
        throw new ForbiddenException(
          `Your current session is not authorized for store-sponsored billing at "${requestedStoreId}". Scan the store's QR code in store or continue with Personal WearMe.`,
        );
      }

      const inspected = await this.createOrInspectSponsoredSession(
        String(sessionRecord['sponsoredStoreId']),
        sessionToken ?? undefined,
        { userId: params.userId, forceRefreshScan: false },
      );

      if (!inspected.active) {
        throw new ForbiddenException(inspected.message);
      }

      const { store, subscription } = await this.ensureStoreAndSubscriptionSeeded(
        String(sessionRecord['sponsoredStoreId']),
      );

      return {
        billingMode: 'STORE_SPONSORED',
        sponsoredStoreId: String(store['storeId']),
        sponsoredStoreName: String(store['storeName']),
        subscriptionId: subscription ? String(subscription['id']) : null,
        consumerEntitlementId: null,
        sessionRecordId: sessionRecord['id'] ? String(sessionRecord['id']) : null,
      };
    }

    // Otherwise, this is a PERSONAL WearMe job (even if the user has an originStoreId!)
    const personal = await this.getOrCreateConsumerEntitlement(params.userId, sessionToken);
    if (personal.summary.status !== 'ACTIVE' && personal.summary.status !== 'TRIAL') {
      throw new ForbiddenException(
        'Your Personal WearMe entitlement is currently inactive.',
      );
    }
    if (personal.summary.remainingCredits < 1) {
      throw new ForbiddenException(
        `Personal WearMe try-on allowance exhausted (${personal.summary.consumedCredits}/${personal.summary.includedCredits} credits used). Upgrade your Personal WearMe plan to continue.`,
      );
    }

    return {
      billingMode: 'PERSONAL',
      sponsoredStoreId: null,
      sponsoredStoreName: null,
      subscriptionId: null,
      consumerEntitlementId: personal.id,
      sessionRecordId: sessionRecord?.['id'] ? String(sessionRecord['id']) : null,
    };
  }

  /**
   * Authenticates a partner store request and strictly enforces Store A vs. Store B isolation.
   */
  async verifyPartnerStoreAccess(
    targetStoreId: string,
    options?: {
      partnerStoreHeader?: string;
      partnerKeyHeader?: string;
      requireKey?: boolean;
    },
  ): Promise<{
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store: Record<string, any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    subscription: Record<string, any> | null;
  }> {
    const normalizedTarget = targetStoreId.trim();
    const headerStoreId = options?.partnerStoreHeader?.trim();

    if (headerStoreId && headerStoreId !== normalizedTarget) {
      throw new ForbiddenException(
        `Cross-store access denied: partner credentials for "${headerStoreId}" cannot access "${normalizedTarget}".`,
      );
    }

    const { store, subscription } = await this.ensureStoreAndSubscriptionSeeded(normalizedTarget);
    const providedKey = options?.partnerKeyHeader?.trim();
    const isProd = process.env['NODE_ENV'] === 'production';
    const requireKey = options?.requireKey === true || isProd;

    if (providedKey) {
      const expectedHash = store['apiKeyHash']
        ? String(store['apiKeyHash'])
        : SEEDED_PARTNER_STORES[normalizedTarget]
          ? this.hashPartnerKey(SEEDED_PARTNER_STORES[normalizedTarget].devPartnerKey)
          : null;

      if (!expectedHash || !this.verifyPartnerKeyConstantTime(providedKey, expectedHash)) {
        throw new UnauthorizedException(
          `Invalid partner API key for store "${normalizedTarget}".`,
        );
      }
    } else if (requireKey) {
      throw new UnauthorizedException(
        `Partner API key header (x-wearme-partner-key) is required to access store "${normalizedTarget}".`,
      );
    }

    return { store, subscription };
  }

  /**
   * Explicitly authenticates a boutique partner API key for production dashboard access.
   */
  async authenticatePartnerStore(
    storeId: string,
    partnerKey?: string,
  ): Promise<PartnerStoreAuthResponse> {
    if (!partnerKey || !partnerKey.trim()) {
      throw new UnauthorizedException(
        `Partner API key is required to sign in to store "${storeId}".`,
      );
    }
    const sub = await this.getPartnerStoreSubscription(storeId, {
      partnerStoreHeader: storeId,
      partnerKeyHeader: partnerKey.trim(),
      requireKey: true,
    });
    return {
      authenticated: true,
      storeId: sub.storeId,
      storeName: sub.storeName,
      city: sub.city,
      storeStatus: sub.storeStatus,
      subscriptionStatus: sub.subscriptionStatus,
      periodEnd: sub.periodEnd,
      remainingCredits: sub.remainingCredits,
    };
  }

  /**
   * Authorizes and renews a PartnerStoreSubscription for a new 30-day billing period.
   * Paid store subscriptions never silently roll forward without an explicit authorized renewal.
   *
   * Period Isolation & Concurrent Renewal Guarantees:
   * - Creates a distinct `PartnerStoreSubscription` row for the new billing period and marks
   *   the prior period row `EXPIRED`, so in-flight reservations from Period 1 settle/release
   *   against Period 1's row without corrupting Period 2's counters.
   * - Enforces an atomic ledger lock (`renew_from_sub:<priorSubId>`) so concurrent renewal
   *   requests cannot create duplicate active periods or reset counters twice.
   */
  async renewPartnerStoreSubscription(
    storeId: string,
    auth?: { partnerStoreHeader?: string; partnerKeyHeader?: string },
    options?: {
      planId?: string;
      includedCredits?: number;
      now?: Date;
    },
  ): Promise<PartnerStoreSubscriptionResponse> {
    const { store, subscription } = await this.verifyPartnerStoreAccess(storeId, {
      ...auth,
      requireKey: true,
    });
    const normalizedStoreId = String(store['storeId']);
    const seed = SEEDED_PARTNER_STORES[normalizedStoreId];
    const now = options?.now ?? new Date();
    const periodEnd = new Date(now.getTime() + 30 * 86400_000);

    const planCatalog: Record<
      string,
      { planId: string; planName: string; monthlyPriceInr: number; includedCredits: number }
    > = {
      STARTER: {
        planId: 'STARTER',
        planName: 'WearMe Starter',
        monthlyPriceInr: 999,
        includedCredits: 200,
      },
      GROWTH: {
        planId: 'GROWTH',
        planName: 'WearMe Growth',
        monthlyPriceInr: 2499,
        includedCredits: 700,
      },
      PREMIUM: {
        planId: 'PREMIUM',
        planName: 'WearMe Premium',
        monthlyPriceInr: 4999,
        includedCredits: 1500,
      },
    };

    const requestedPlanKey = options?.planId?.trim().toUpperCase();
    const selectedPlan =
      (requestedPlanKey && planCatalog[requestedPlanKey]) ||
      (subscription?.['planId'] && planCatalog[String(subscription['planId']).toUpperCase()]) ||
      (seed && planCatalog[seed.planId]) ||
      planCatalog['GROWTH']!;

    const nextIncludedCredits =
      typeof options?.includedCredits === 'number' &&
      Number.isFinite(options.includedCredits) &&
      options.includedCredits > 0
        ? Math.floor(options.includedCredits)
        : selectedPlan.includedCredits;

    const subscriptionDelegate = this.rawDb['partnerStoreSubscription'];
    const priorSubId = subscription?.['id'] ? String(subscription['id']) : null;
    const renewLockKey = priorSubId
      ? `renew_from_sub:${priorSubId}`
      : `renew_sub:${normalizedStoreId}:${now.getTime()}`;

    if (
      typeof this.rawDb['$transaction'] === 'function' &&
      priorSubId &&
      typeof subscriptionDelegate?.updateMany === 'function' &&
      typeof subscriptionDelegate?.create === 'function'
    ) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await this.rawDb['$transaction'](async (tx: Record<string, any>) => {
          // Row-level UPDATE lock in PostgreSQL blocks concurrent renewal transactions until this transaction commits
          const archived = await tx['partnerStoreSubscription'].updateMany({
            where: { id: priorSubId, status: { not: 'EXPIRED' } },
            data: { status: 'EXPIRED' },
          });
          if (!archived || archived.count === 0) {
            return;
          }

          const createdSub = await tx['partnerStoreSubscription'].create({
            data: {
              storeId: normalizedStoreId,
              planId: selectedPlan.planId,
              planName: selectedPlan.planName,
              monthlyPriceInr: selectedPlan.monthlyPriceInr,
              status: 'ACTIVE',
              periodStart: now,
              periodEnd,
              includedCredits: nextIncludedCredits,
              consumedCredits: 0,
              reservedCredits: 0,
              failedGenerationsCount: 0,
              overagePolicy: 'BLOCK',
            },
          });

          if (tx['usageLedgerEntry']?.create) {
            await tx['usageLedgerEntry'].create({
              data: {
                idempotencyKey: renewLockKey,
                eventType: 'ADJUSTMENT',
                billingMode: 'STORE_SPONSORED',
                creditsDelta: nextIncludedCredits,
                storeId: normalizedStoreId,
                subscriptionId: createdSub?.['id'] ? String(createdSub['id']) : priorSubId,
                reason: `SUBSCRIPTION_RENEWED:${selectedPlan.planId}`,
              },
            });
          }

          if (tx['partnerStore']?.update) {
            await tx['partnerStore']
              .update({
                where: { storeId: normalizedStoreId },
                data: {
                  creditBalance: nextIncludedCredits,
                  totalCreditsUsed: 0,
                },
              })
              .catch(() => undefined);
          }
        });
      } catch {
        // Concurrent renewal lock contention resolved by reading committed active subscription below
      }

      return this.getPartnerStoreSubscription(normalizedStoreId, {
        ...auth,
        requireKey: true,
      });
    }

    if (this.rawDb['usageLedgerEntry']?.create) {
      try {
        await this.rawDb['usageLedgerEntry'].create({
          data: {
            idempotencyKey: renewLockKey,
            eventType: 'ADJUSTMENT',
            billingMode: 'STORE_SPONSORED',
            creditsDelta: nextIncludedCredits,
            storeId: normalizedStoreId,
            subscriptionId: priorSubId,
            reason: `SUBSCRIPTION_RENEWED:${selectedPlan.planId}`,
          },
        });
      } catch {
        // Concurrent renewal request already renewed this subscription period
        return this.getPartnerStoreSubscription(normalizedStoreId, {
          ...auth,
          requireKey: true,
        });
      }
    }

    if (subscriptionDelegate) {
      if (priorSubId && typeof subscriptionDelegate.updateMany === 'function') {
        const archived = await subscriptionDelegate.updateMany({
          where: { id: priorSubId, status: { not: 'EXPIRED' } },
          data: { status: 'EXPIRED' },
        });
        if (archived && typeof archived.count === 'number' && archived.count === 0) {
          return this.getPartnerStoreSubscription(normalizedStoreId, {
            ...auth,
            requireKey: true,
          });
        }
      } else if (priorSubId && typeof subscriptionDelegate.update === 'function') {
        await subscriptionDelegate
          .update({
            where: { id: priorSubId },
            data: { status: 'EXPIRED' },
          })
          .catch(() => undefined);
      }

      if (typeof subscriptionDelegate.create === 'function') {
        const createdSub = await subscriptionDelegate.create({
          data: {
            storeId: normalizedStoreId,
            planId: selectedPlan.planId,
            planName: selectedPlan.planName,
            monthlyPriceInr: selectedPlan.monthlyPriceInr,
            status: 'ACTIVE',
            periodStart: now,
            periodEnd,
            includedCredits: nextIncludedCredits,
            consumedCredits: 0,
            reservedCredits: 0,
            failedGenerationsCount: 0,
            overagePolicy: 'BLOCK',
          },
        });
        if (createdSub?.['id'] && this.rawDb['usageLedgerEntry']?.update) {
          await this.rawDb['usageLedgerEntry']
            .update({
              where: { idempotencyKey: renewLockKey },
              data: { subscriptionId: String(createdSub['id']) },
            })
            .catch(() => undefined);
        }
      } else if (priorSubId && typeof subscriptionDelegate.update === 'function') {
        await subscriptionDelegate.update({
          where: { id: priorSubId },
          data: {
            planId: selectedPlan.planId,
            planName: selectedPlan.planName,
            monthlyPriceInr: selectedPlan.monthlyPriceInr,
            status: 'ACTIVE',
            periodStart: now,
            periodEnd,
            includedCredits: nextIncludedCredits,
            consumedCredits: 0,
            reservedCredits: 0,
          },
        });
      }
    }

    if (this.rawDb['partnerStore']?.update) {
      await this.rawDb['partnerStore']
        .update({
          where: { storeId: normalizedStoreId },
          data: {
            creditBalance: nextIncludedCredits,
            totalCreditsUsed: 0,
          },
        })
        .catch(() => undefined);
    }

    return this.getPartnerStoreSubscription(normalizedStoreId, {
      ...auth,
      requireKey: true,
    });
  }

  /**
   * Returns the PartnerStoreSubscription details for a store.
   */
  async getPartnerStoreSubscription(
    storeId: string,
    auth?: { partnerStoreHeader?: string; partnerKeyHeader?: string; requireKey?: boolean },
  ): Promise<PartnerStoreSubscriptionResponse> {
    const { store, subscription } = await this.verifyPartnerStoreAccess(storeId, auth);
    const now = new Date();
    const defaultEnd = new Date(now.getTime() + 30 * 86400_000);

    const periodEndDate = subscription?.['periodEnd']
      ? new Date(subscription['periodEnd'])
      : defaultEnd;
    let subscriptionStatus = String(subscription?.['status'] ?? 'ACTIVE');
    if (
      periodEndDate.getTime() <= now.getTime() &&
      (subscriptionStatus === 'ACTIVE' || subscriptionStatus === 'TRIAL')
    ) {
      subscriptionStatus = 'PAST_DUE';
      if (subscription?.['id'] && this.rawDb['partnerStoreSubscription']?.update) {
        await this.rawDb['partnerStoreSubscription']
          .update({
            where: { id: subscription['id'] },
            data: { status: 'PAST_DUE' },
          })
          .catch(() => undefined);
      }
    }

    const included = Number(
      subscription?.['includedCredits'] ?? store['creditBalance'] ?? 100,
    );
    const consumed = Number(
      subscription?.['consumedCredits'] ?? store['totalCreditsUsed'] ?? 0,
    );
    const reserved = Number(subscription?.['reservedCredits'] ?? 0);
    const isSubActive = subscriptionStatus === 'ACTIVE' || subscriptionStatus === 'TRIAL';
    const remaining = isSubActive ? Math.max(0, included - consumed - reserved) : 0;
    const failed = Number(subscription?.['failedGenerationsCount'] ?? 0);
    const storeStatus =
      store['status'] === 'SUSPENDED' ? ('SUSPENDED' as const) : ('ACTIVE' as const);
    const overagePolicy =
      subscription?.['overagePolicy'] === 'ALLOW_CONFIGURED'
        ? ('ALLOW_CONFIGURED' as const)
        : ('BLOCK' as const);

    return {
      storeId: String(store['storeId']),
      storeName: String(store['storeName']),
      city: store['city'] ? String(store['city']) : null,
      storeStatus,
      subscriptionId: String(subscription?.['id'] ?? `sub_${String(store['storeId'])}`),
      planId: String(subscription?.['planId'] ?? 'GROWTH'),
      planName: String(subscription?.['planName'] ?? 'WearMe Growth'),
      monthlyPriceInr: Number(subscription?.['monthlyPriceInr'] ?? 2499),
      subscriptionStatus,
      periodStart: new Date(subscription?.['periodStart'] ?? now).toISOString(),
      periodEnd: periodEndDate.toISOString(),
      includedCredits: included,
      consumedCredits: consumed,
      reservedCredits: reserved,
      remainingCredits: remaining,
      failedGenerationsCount: failed,
      overagePolicy,
      quotaExhausted: !isSubActive || (remaining <= 0 && overagePolicy === 'BLOCK'),
      lowQuotaWarning: isSubActive && remaining > 0 && remaining <= Math.ceil(included * 0.1),
    };
  }

  /**
   * Returns aggregated, privacy-safe usage metrics and ledger summary for a partner store.
   * Strictly excludes all customer portraits, result URLs, phone numbers, emails, and wardrobe items.
   */
  async getPartnerStoreUsage(
    storeId: string,
    auth?: { partnerStoreHeader?: string; partnerKeyHeader?: string; requireKey?: boolean },
  ): Promise<PartnerStoreUsageResponse> {
    const subResponse = await this.getPartnerStoreSubscription(storeId, auth);
    const normalizedId = subResponse.storeId;
    const now = new Date();

    let activeSponsoredSessionsCount = 0;
    let expiredSponsoredSessionsCount = 0;
    if (this.rawDb['tryOnSession']?.findMany) {
      const sessions = await this.rawDb['tryOnSession'].findMany({
        where: {
          OR: [{ sponsoredStoreId: normalizedId }, { storeId: normalizedId }],
        },
      });
      for (const s of sessions) {
        const exp = s['sponsoredExpiresAt'] ? new Date(s['sponsoredExpiresAt']) : null;
        const lastAct = s['lastActivityAt'] ? new Date(s['lastActivityAt']) : null;
        const inactMin = Number(s['inactivityTimeoutMinutes'] ?? 15);
        const isRevoked = Boolean(s['revokedAt']) || s['usageMode'] !== 'STORE_SPONSORED';
        const isExpired = exp ? now.getTime() >= exp.getTime() : true;
        const isInactive = lastAct
          ? now.getTime() - lastAct.getTime() >= inactMin * 60_000
          : false;
        if (!isRevoked && !isExpired && !isInactive) {
          activeSponsoredSessionsCount++;
        } else {
          expiredSponsoredSessionsCount++;
        }
      }
    }

    let totalSponsoredTryOnJobs = 0;
    let completedSponsoredTryOnJobs = 0;
    let failedSponsoredTryOnJobs = 0;
    let savedToWardrobeFromStoreCount = 0;
    if (this.rawDb['tryOnJob']?.findMany) {
      const jobs = await this.rawDb['tryOnJob'].findMany({
        where: {
          OR: [{ sponsoredStoreId: normalizedId }, { storeId: normalizedId }],
        },
      });
      for (const j of jobs) {
        const mode = String(j['billingMode'] ?? 'STORE_SPONSORED');
        if (
          mode === 'STORE_SPONSORED' ||
          j['sponsoredStoreId'] === normalizedId ||
          j['storeId'] === normalizedId
        ) {
          totalSponsoredTryOnJobs++;
          if (j['status'] === 'COMPLETED') completedSponsoredTryOnJobs++;
          if (j['status'] === 'FAILED') failedSponsoredTryOnJobs++;
          if (j['savedToWardrobe'] === true) savedToWardrobeFromStoreCount++;
        }
      }
    }

    let firstTouchAttributedUsersCount = 0;
    if (this.rawDb['user']?.findMany) {
      const users = await this.rawDb['user'].findMany({
        where: { originStoreId: normalizedId },
      });
      firstTouchAttributedUsersCount = users.length;
    }

    const recentLedgerSummary: Array<{
      id: string;
      eventType: string;
      creditsDelta: number;
      reason: string | null;
      createdAt: string;
    }> = [];
    if (this.rawDb['usageLedgerEntry']?.findMany) {
      const entries = await this.rawDb['usageLedgerEntry'].findMany({
        where: { storeId: normalizedId },
        orderBy: { createdAt: 'desc' },
        take: 15,
      });
      for (const e of entries) {
        recentLedgerSummary.push({
          id: String(e['id']),
          eventType: String(e['eventType']),
          creditsDelta: Number(e['creditsDelta'] ?? 0),
          reason: e['reason'] ? String(e['reason']) : null,
          createdAt: new Date(e['createdAt'] ?? now).toISOString(),
        });
      }
    }

    return {
      storeId: subResponse.storeId,
      storeName: subResponse.storeName,
      subscription: subResponse,
      activeSponsoredSessionsCount,
      expiredSponsoredSessionsCount,
      totalSponsoredTryOnJobs,
      completedSponsoredTryOnJobs,
      failedSponsoredTryOnJobs,
      savedToWardrobeFromStoreCount,
      firstTouchAttributedUsersCount,
      recentLedgerSummary,
      privacyNotice:
        'Aggregated store-sponsored usage & billing metrics only. Customer portraits, generated try-on images, phone numbers, emails, and personal wardrobe activity are strictly isolated and inaccessible to shop partners.',
    };
  }

  /**
   * Reconciles stale PENDING UsageReservations whose TTL has expired without completion,
   * AND recovers any post-settlement crashes where a reservation was marked CONSUMED before
   * the API process died while TryOnJob remained PROCESSING or FAILED.
   */
  async reconcileStaleReservations(options?: {
    dryRun?: boolean;
    now?: Date;
  }): Promise<{
    dryRun: boolean;
    staleFound: number;
    releasedCount: number;
    releasedReservationIds: string[];
    reconciledJobIds: string[];
  }> {
    const dryRun = options?.dryRun === true;
    const now = options?.now ?? new Date();
    const reservationDelegate = this.rawDb['usageReservation'];
    if (!reservationDelegate?.findMany) {
      return {
        dryRun,
        staleFound: 0,
        releasedCount: 0,
        releasedReservationIds: [],
        reconciledJobIds: [],
      };
    }

    const staleReservations = await reservationDelegate.findMany({
      where: {
        status: 'PENDING',
        expiresAt: { lt: now },
      },
    });

    if (dryRun) {
      return {
        dryRun,
        staleFound: staleReservations.length,
        releasedCount: 0,
        releasedReservationIds: staleReservations.map((r: Record<string, unknown>) =>
          String(r['id']),
        ),
        reconciledJobIds: staleReservations.map((r: Record<string, unknown>) =>
          String(r['jobId']),
        ),
      };
    }

    const releasedIds: string[] = [];
    const reconciledJobIds: string[] = [];

    for (const r of staleReservations) {
      const resId = String(r['id']);
      const jobId = String(r['jobId']);
      const credits = Number(r['credits'] ?? 1);
      const transitioned = await reservationDelegate.updateMany({
        where: { id: resId, status: 'PENDING' },
        data: {
          status: 'EXPIRED',
          releasedAt: now,
          failureReason: 'STALE_RESERVATION_TTL_EXPIRED',
        },
      });

      if (transitioned.count === 1) {
        releasedIds.push(resId);
        if (r['subscriptionId'] && this.rawDb['partnerStoreSubscription']) {
          const subId = String(r['subscriptionId']);
          if (typeof this.rawDb['$executeRaw'] === 'function') {
            await this.rawDb['$executeRaw']`
              UPDATE "PartnerStoreSubscription"
              SET "reservedCredits" = GREATEST(0, "reservedCredits" - ${credits}),
                  "failedGenerationsCount" = "failedGenerationsCount" + 1,
                  "updatedAt" = NOW()
              WHERE "id" = ${subId}
            `;
          } else {
            const sub = await this.rawDb['partnerStoreSubscription'].findUnique({
              where: { id: subId },
            });
            if (sub) {
              await this.rawDb['partnerStoreSubscription'].update({
                where: { id: subId },
                data: {
                  reservedCredits: Math.max(0, Number(sub['reservedCredits'] ?? 0) - credits),
                  failedGenerationsCount: Number(sub['failedGenerationsCount'] ?? 0) + 1,
                },
              });
            }
          }
        }
        if (r['storeId'] && this.rawDb['partnerStore']) {
          await this.rawDb['partnerStore'].updateMany({
            where: { storeId: String(r['storeId']) },
            data: {
              creditBalance: { increment: credits },
              totalCreditsUsed: { decrement: credits },
            },
          });
        }
        if (r['consumerEntitlementId'] && this.rawDb['consumerEntitlement']) {
          const entId = String(r['consumerEntitlementId']);
          if (typeof this.rawDb['$executeRaw'] === 'function') {
            await this.rawDb['$executeRaw']`
              UPDATE "ConsumerEntitlement"
              SET "reservedCredits" = GREATEST(0, "reservedCredits" - ${credits}),
                  "failedGenerationsCount" = "failedGenerationsCount" + 1,
                  "updatedAt" = NOW()
              WHERE "id" = ${entId}
            `;
          } else {
            const ent = await this.rawDb['consumerEntitlement'].findUnique({
              where: { id: entId },
            });
            if (ent) {
              await this.rawDb['consumerEntitlement'].update({
                where: { id: entId },
                data: {
                  reservedCredits: Math.max(0, Number(ent['reservedCredits'] ?? 0) - credits),
                  failedGenerationsCount: Number(ent['failedGenerationsCount'] ?? 0) + 1,
                },
              });
            }
          }
        }
        if (this.rawDb['usageLedgerEntry']?.create) {
          await this.rawDb['usageLedgerEntry']
            .create({
              data: {
                idempotencyKey: `expire:${String(r['idempotencyKey'])}`,
                eventType: 'RELEASE',
                billingMode: r['billingMode'] ?? 'PERSONAL',
                creditsDelta: credits,
                jobId,
                reservationId: resId,
                storeId: r['storeId'] ?? null,
                subscriptionId: r['subscriptionId'] ?? null,
                consumerEntitlementId: r['consumerEntitlementId'] ?? null,
                reason: 'STALE_RESERVATION_TTL_EXPIRED',
              },
            })
            .catch((err: unknown) => {
              this.logger.warn(`Ledger entry skipped for expired reservation ${resId}: ${String(err)}`);
            });
        }
      }

      // Ensure the associated TryOnJob never stays stuck in PROCESSING/PENDING after its reservation expired
      if (this.rawDb['tryOnJob']?.updateMany) {
        const jobUpdate = await this.rawDb['tryOnJob'].updateMany({
          where: {
            id: jobId,
            status: { in: ['PENDING', 'PROCESSING'] },
          },
          data: {
            status: 'FAILED',
            creditReserved: false,
            savedToWardrobe: false,
          },
        });
        if (jobUpdate && jobUpdate.count > 0) {
          reconciledJobIds.push(jobId);
        }
      }
    }

    // Also sweep any orphaned TryOnJob stuck in PROCESSING longer than reservationTtlMinutes
    // AND reverse any CONSUMED reservation whose job crashed before reaching COMPLETED!
    const staleJobCutoff = new Date(
      now.getTime() - this.reservationTtlMinutes * 60_000,
    );
    if (this.rawDb['tryOnJob']?.findMany && this.rawDb['tryOnJob']?.updateMany) {
      const stuckProcessingJobs = await this.rawDb['tryOnJob'].findMany({
        where: {
          status: 'PROCESSING',
          updatedAt: { lt: staleJobCutoff },
        },
      });
      for (const sj of stuckProcessingJobs) {
        if (
          sj['status'] === 'PROCESSING' &&
          sj['updatedAt'] &&
          new Date(sj['updatedAt']).getTime() < staleJobCutoff.getTime()
        ) {
          const sjId = String(sj['id']);
          const updated = await this.rawDb['tryOnJob'].updateMany({
            where: { id: sjId, status: 'PROCESSING' },
            data: { status: 'FAILED', creditReserved: false, savedToWardrobe: false },
          });
          if (updated && updated.count > 0 && !reconciledJobIds.includes(sjId)) {
            reconciledJobIds.push(sjId);
          }

          // Check if this crashed PROCESSING job had already transitioned its reservation to CONSUMED before crashing
          if (reservationDelegate.findUnique && reservationDelegate.updateMany) {
            const orphanConsumed = await reservationDelegate
              .findUnique({ where: { jobId: sjId } })
              .catch(() => null);
            if (orphanConsumed && orphanConsumed['status'] === 'CONSUMED') {
              const resId = String(orphanConsumed['id']);
              const credits = Number(orphanConsumed['credits'] ?? 1);
              const reversed = await reservationDelegate.updateMany({
                where: { id: resId, status: 'CONSUMED' },
                data: {
                  status: 'RELEASED',
                  releasedAt: now,
                  failureReason: 'POST_SETTLEMENT_CRASH_RECOVERED',
                },
              });
              if (reversed && reversed.count === 1) {
                releasedIds.push(resId);
                if (orphanConsumed['subscriptionId'] && typeof this.rawDb['$executeRaw'] === 'function') {
                  const subId = String(orphanConsumed['subscriptionId']);
                  await this.rawDb['$executeRaw']`
                    UPDATE "PartnerStoreSubscription"
                    SET "consumedCredits" = GREATEST(0, "consumedCredits" - ${credits}),
                        "failedGenerationsCount" = "failedGenerationsCount" + 1,
                        "updatedAt" = NOW()
                    WHERE "id" = ${subId}
                  `;
                }
                if (orphanConsumed['storeId'] && this.rawDb['partnerStore']?.updateMany) {
                  await this.rawDb['partnerStore'].updateMany({
                    where: { storeId: String(orphanConsumed['storeId']) },
                    data: {
                      creditBalance: { increment: credits },
                      totalCreditsUsed: { decrement: credits },
                    },
                  });
                }
                if (orphanConsumed['consumerEntitlementId'] && typeof this.rawDb['$executeRaw'] === 'function') {
                  const entId = String(orphanConsumed['consumerEntitlementId']);
                  await this.rawDb['$executeRaw']`
                    UPDATE "ConsumerEntitlement"
                    SET "consumedCredits" = GREATEST(0, "consumedCredits" - ${credits}),
                        "failedGenerationsCount" = "failedGenerationsCount" + 1,
                        "updatedAt" = NOW()
                    WHERE "id" = ${entId}
                  `;
                }
                if (this.rawDb['usageLedgerEntry']?.create) {
                  await this.rawDb['usageLedgerEntry']
                    .create({
                      data: {
                        idempotencyKey: `crash_refund:${String(orphanConsumed['idempotencyKey'])}`,
                        eventType: 'REFUND',
                        billingMode: orphanConsumed['billingMode'] ?? 'PERSONAL',
                        creditsDelta: credits,
                        jobId: sjId,
                        reservationId: resId,
                        storeId: orphanConsumed['storeId'] ?? null,
                        subscriptionId: orphanConsumed['subscriptionId'] ?? null,
                        consumerEntitlementId: orphanConsumed['consumerEntitlementId'] ?? null,
                        reason: 'POST_SETTLEMENT_CRASH_RECOVERED',
                      },
                    })
                    .catch(() => undefined);
                }
              }
            }
          }
        }
      }
    }

    return {
      dryRun,
      staleFound: staleReservations.length,
      releasedCount: releasedIds.length,
      releasedReservationIds: releasedIds,
      reconciledJobIds,
    };
  }
}

