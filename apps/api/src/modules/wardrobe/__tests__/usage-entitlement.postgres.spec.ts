import {
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { ClothingCategory, TryOnStatus } from '@wearme/shared';
import { DatabaseService } from '../../database/database.service';
import type { StorageProvider } from '../../storage/storage.provider';
import type { VirtualTryOnProvider } from '../../ai/virtual-tryon.provider';
import { TryOnService } from '../../try-on/try-on.service';
import { UsageEntitlementService } from '../usage-entitlement.service';
import { WardrobeService } from '../wardrobe.service';

const DEFAULT_PG_URL = 'postgresql://wearme:wearme@localhost:5434/wearme_dev';

describe('Real PostgreSQL Integration — Store-Sponsored Sessions, Atomic Quotas & Consumer Billing', () => {
  let db: DatabaseService;
  let usageService: UsageEntitlementService;
  let tryOnServiceInstanceA: TryOnService;
  let tryOnServiceInstanceB: TryOnService;
  let wardrobeService: WardrobeService;
  let mockStorage: jest.Mocked<StorageProvider>;
  let mockAi: jest.Mocked<VirtualTryOnProvider>;
  let validJpegBuffer: Buffer;
  let validPngBuffer: Buffer;

  beforeAll(async () => {
    process.env['DATABASE_URL'] = process.env['DATABASE_URL'] ?? DEFAULT_PG_URL;
    db = new DatabaseService();
    await db.$connect();

    validJpegBuffer = await sharp({
      create: {
        width: 256,
        height: 384,
        channels: 3,
        background: { r: 180, g: 160, b: 140 },
      },
    })
      .jpeg()
      .toBuffer();

    validPngBuffer = await sharp({
      create: {
        width: 256,
        height: 384,
        channels: 4,
        background: { r: 40, g: 90, b: 180, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
  });

  afterAll(async () => {
    if (db) {
      await db.$disconnect();
    }
  });

  const makeMulterFile = (
    buffer: Buffer,
    mimetype = 'image/jpeg',
  ): Express.Multer.File =>
    ({
      buffer,
      mimetype,
      size: buffer.length,
      originalname: mimetype === 'image/png' ? 'test.png' : 'test.jpg',
    }) as Express.Multer.File;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Clean test artifacts in PostgreSQL in FK-safe order
    await db.usageLedgerEntry.deleteMany({});
    await db.usageReservation.deleteMany({});
    await db.tryOnJob.deleteMany({});
    await db.tryOnSession.deleteMany({});
    await db.consumerEntitlement.deleteMany({});
    await db.partnerStoreSubscription.deleteMany({});
    await db.partnerStore.deleteMany({});
    await db.user.deleteMany({});

    mockStorage = {
      upload: jest.fn().mockResolvedValue(undefined),
      copy: jest.fn().mockResolvedValue(undefined),
      download: jest.fn().mockResolvedValue(validJpegBuffer),
      getUrl: jest
        .fn()
        .mockImplementation(
          async (key: string) => `http://localhost:3001/api/v1/files/${key}`,
        ),
      delete: jest.fn().mockResolvedValue(undefined),
      deleteJobDirectory: jest.fn().mockResolvedValue(undefined),
      listJobDirectories: jest.fn().mockResolvedValue([]),
      exists: jest.fn().mockResolvedValue(true),
      healthCheck: jest.fn().mockResolvedValue(true),
    };

    mockAi = {
      name: 'mock',
      processJob: jest.fn().mockResolvedValue({
        resultImageBuffer: validJpegBuffer,
        resultMimeType: 'image/jpeg',
        provider: 'mock',
        inferenceMs: 20,
      }),
      healthCheck: jest.fn().mockResolvedValue(true),
    };

    const mockConfig = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'ai') {
          return {
            provider: 'mock',
            serviceUrl: 'http://localhost:8001',
            timeoutMs: 30000,
            enableNecklacePoc: false,
          };
        }
        if (key === 'app.nodeEnv') {
          return 'development';
        }
        if (key === 'storage') {
          return {
            provider: 'local',
            localPath: './uploads',
            localBaseUrl: 'http://localhost:3001',
            maxFileSizeMb: 10,
            imageRetentionDays: 7,
          };
        }
        return undefined;
      }),
    } as unknown as ConfigService;

    usageService = new UsageEntitlementService(db);
    await usageService.ensureAllDefaultStoresSeeded();

    // Two distinct TryOnService instances sharing only PostgreSQL (simulating 2 separate API pods)
    tryOnServiceInstanceA = new TryOnService(db, mockStorage, mockAi, mockConfig);
    tryOnServiceInstanceB = new TryOnService(db, mockStorage, mockAi, mockConfig);

    wardrobeService = new WardrobeService(
      db,
      mockStorage,
      tryOnServiceInstanceA,
      mockConfig,
      usageService,
    );
  });

  it('1. creates a bounded Store-Sponsored QR session, does NOT reset lifetime on page refresh, and bills active in-store try-ons to the store subscription', async () => {
    const storeId = 'store_indiranagar_01';
    const sessionToken = 'wm_pg_qr_indiranagar_active_01';

    // Initial QR scan
    const initialScan = await usageService.createOrInspectSponsoredSession(
      storeId,
      sessionToken,
    );
    expect(initialScan.active).toBe(true);
    expect(initialScan.usageMode).toBe('STORE_SPONSORED');
    expect(initialScan.storeId).toBe(storeId);
    expect(initialScan.storeQuotaRemaining).toBe(1500);

    // Backdate sponsoredExpiresAt to 20 minutes from now to verify page refresh does NOT reset it to 60 minutes
    const twentyMinsFromNow = new Date(Date.now() + 20 * 60_000);
    await db.tryOnSession.update({
      where: { sessionToken },
      data: { sponsoredExpiresAt: twentyMinsFromNow },
    });

    const afterRefresh = await usageService.createOrInspectSponsoredSession(
      storeId,
      sessionToken,
      { forceRefreshScan: false },
    );
    expect(afterRefresh.active).toBe(true);
    expect(new Date(afterRefresh.expiresAt!).getTime()).toBe(twentyMinsFromNow.getTime());
    expect(afterRefresh.remainingSeconds).toBeLessThanOrEqual(20 * 60);

    // Create and process a store-sponsored try-on job
    const createdJob = await tryOnServiceInstanceA.createJob(
      makeMulterFile(validJpegBuffer),
      makeMulterFile(validPngBuffer, 'image/png'),
      ClothingCategory.TSHIRT,
      'TSHIRT',
      sessionToken,
      storeId,
      { idempotencyKey: 'idem_store_job_01' },
    );
    expect(createdJob.billingMode).toBe('STORE_SPONSORED');
    expect(createdJob.sponsoredStoreId).toBe(storeId);

    // Idempotent retry with same idempotencyKey returns the exact same jobId without re-creating
    const duplicateRetry = await tryOnServiceInstanceA.createJob(
      makeMulterFile(validJpegBuffer),
      makeMulterFile(validPngBuffer, 'image/png'),
      ClothingCategory.TSHIRT,
      'TSHIRT',
      sessionToken,
      storeId,
      { idempotencyKey: 'idem_store_job_01' },
    );
    expect(duplicateRetry.jobId).toBe(createdJob.jobId);

    const processed = await tryOnServiceInstanceA.processJob(createdJob.jobId, sessionToken);
    expect(processed.status).toBe(TryOnStatus.COMPLETED);

    // Verify PostgreSQL subscription, reservation, and ledger records
    const subAfter = await usageService.getPartnerStoreSubscription(storeId);
    expect(subAfter.includedCredits).toBe(1500);
    expect(subAfter.consumedCredits).toBe(1);
    expect(subAfter.reservedCredits).toBe(0);
    expect(subAfter.remainingCredits).toBe(1499);

    const reservation = await db.usageReservation.findUnique({
      where: { jobId: createdJob.jobId },
    });
    expect(reservation?.status).toBe('CONSUMED');
    expect(reservation?.billingMode).toBe('STORE_SPONSORED');

    const ledgerEntries = await db.usageLedgerEntry.findMany({
      where: { jobId: createdJob.jobId },
      orderBy: { createdAt: 'asc' },
    });
    expect(ledgerEntries.map((e) => e.eventType)).toEqual(['RESERVATION', 'CONSUMPTION']);
  });

  it('2. blocks saved/expired or inactive QR sessions BEFORE AI inference and allows switching to Personal WearMe without charging the store', async () => {
    const storeId = 'store_indiranagar_01';
    const sessionToken = 'wm_pg_qr_expired_session_02';

    await usageService.createOrInspectSponsoredSession(storeId, sessionToken);

    // Simulate customer leaving the shop: session expired 5 minutes ago
    const expiredAt = new Date(Date.now() - 5 * 60_000);
    await db.tryOnSession.update({
      where: { sessionToken },
      data: { sponsoredExpiresAt: expiredAt },
    });

    // Page refresh must report expired and NEVER renew the session
    const refreshed = await usageService.createOrInspectSponsoredSession(
      storeId,
      sessionToken,
      { forceRefreshScan: false },
    );
    expect(refreshed.active).toBe(false);
    expect(refreshed.expiredReason).toBe('SESSION_EXPIRED');

    // Attempting to create a try-on while session is expired is rejected with ForbiddenException before AI inference
    await expect(
      tryOnServiceInstanceA.createJob(
        makeMulterFile(validJpegBuffer),
        makeMulterFile(validPngBuffer, 'image/png'),
        ClothingCategory.TSHIRT,
        'TSHIRT',
        sessionToken,
        storeId,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(mockAi.processJob).not.toHaveBeenCalled();

    // Store credits must remain untouched at 1500
    const storeSub = await usageService.getPartnerStoreSubscription(storeId);
    expect(storeSub.consumedCredits).toBe(0);
    expect(storeSub.remainingCredits).toBe(1500);

    // Customer clicks "Continue with Personal WearMe"
    const switched = await usageService.switchSessionToPersonalMode(sessionToken);
    expect(switched.effectiveBillingMode).toBe('PERSONAL');

    // Subsequent try-on succeeds in PERSONAL mode and charges ConsumerEntitlement, NOT the store
    const personalJob = await tryOnServiceInstanceA.createJob(
      makeMulterFile(validJpegBuffer),
      makeMulterFile(validPngBuffer, 'image/png'),
      ClothingCategory.TSHIRT,
      'TSHIRT',
      sessionToken,
    );
    expect(personalJob.billingMode).toBe('PERSONAL');
    expect(personalJob.sponsoredStoreId).toBeNull();

    await tryOnServiceInstanceA.processJob(personalJob.jobId, sessionToken);

    const storeSubAfterPersonal = await usageService.getPartnerStoreSubscription(storeId);
    expect(storeSubAfterPersonal.consumedCredits).toBe(0);
    expect(storeSubAfterPersonal.remainingCredits).toBe(1500);

    const entAfter = await usageService.getEntitlementStatus(sessionToken);
    expect(entAfter.personalEntitlement.consumedCredits).toBe(1);
  });

  it('3. never bills User.originStoreId when a registered user runs try-ons at home or via /my-wardrobe', async () => {
    const storeId = 'store_indiranagar_01';
    const homeSessionToken = 'wm_pg_home_personal_session_03';

    // Create a user whose first-touch originStoreId is store_indiranagar_01
    const user = await db.user.create({
      data: {
        phoneE164: '+919876543210',
        phoneVerifiedAt: new Date(),
        originStoreId: storeId,
        originStoreName: 'Studio Namma Indiranagar',
        basePersonImageKey: 'users/test-user/base_portrait.jpg',
      },
    });

    // User opens WearMe at home (no active store-sponsored session)
    const entStatus = await usageService.getEntitlementStatus(homeSessionToken, user.id);
    expect(entStatus.effectiveBillingMode).toBe('PERSONAL');
    expect(entStatus.originStoreAttribution?.storeId).toBe(storeId);

    // Attempting to spoof ?storeId=store_indiranagar_01 without an active sponsored session is rejected
    await expect(
      tryOnServiceInstanceA.createJob(
        makeMulterFile(validJpegBuffer),
        makeMulterFile(validPngBuffer, 'image/png'),
        ClothingCategory.SHIRT,
        'SHIRT',
        homeSessionToken,
        storeId,
        { userId: user.id },
      ),
    ).rejects.toThrow(ForbiddenException);

    // Normal personal try-on at home bills PERSONAL ConsumerEntitlement and NEVER touches store_indiranagar_01
    const homeJob = await tryOnServiceInstanceA.createJob(
      makeMulterFile(validJpegBuffer),
      makeMulterFile(validPngBuffer, 'image/png'),
      ClothingCategory.SHIRT,
      'SHIRT',
      homeSessionToken,
      undefined,
      { userId: user.id },
    );
    expect(homeJob.billingMode).toBe('PERSONAL');
    expect(homeJob.sponsoredStoreId).toBeNull();

    await tryOnServiceInstanceA.processJob(homeJob.jobId, homeSessionToken);

    const storeSub = await usageService.getPartnerStoreSubscription(storeId);
    expect(storeSub.consumedCredits).toBe(0);
    expect(storeSub.reservedCredits).toBe(0);
    expect(storeSub.remainingCredits).toBe(1500);

    const updatedEnt = await usageService.getEntitlementStatus(homeSessionToken, user.id);
    expect(updatedEnt.personalEntitlement.consumedCredits).toBe(1);
    expect(updatedEnt.personalEntitlement.remainingCredits).toBe(
      updatedEnt.personalEntitlement.includedCredits - 1,
    );
  });

  it('4. enforces cross-instance PostgreSQL atomic last-credit reservation so two separate TryOnService instances cannot consume the last credit twice', async () => {
    const storeId = 'store_bandra_04';
    // Set store_bandra_04 to have ONLY 1 credit remaining in PostgreSQL
    await tryOnServiceInstanceA.setQuotaBalance(storeId, 1);

    const session1 = 'wm_pg_concurrent_sess_01';
    const session2 = 'wm_pg_concurrent_sess_02';
    await usageService.createOrInspectSponsoredSession(storeId, session1);
    await usageService.createOrInspectSponsoredSession(storeId, session2);

    const job1 = await tryOnServiceInstanceA.createJob(
      makeMulterFile(validJpegBuffer),
      makeMulterFile(validPngBuffer, 'image/png'),
      ClothingCategory.TSHIRT,
      'TSHIRT',
      session1,
      storeId,
    );
    const job2 = await tryOnServiceInstanceB.createJob(
      makeMulterFile(validJpegBuffer),
      makeMulterFile(validPngBuffer, 'image/png'),
      ClothingCategory.TSHIRT,
      'TSHIRT',
      session2,
      storeId,
    );

    // Slow AI provider (60ms) so both requests overlap in time across two separate service instances
    mockAi.processJob.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return {
        resultImageBuffer: validJpegBuffer,
        resultMimeType: 'image/jpeg',
        provider: 'mock',
        inferenceMs: 60,
      };
    });

    // Fire both requests concurrently on separate TryOnService instances (no shared memory!)
    const results = await Promise.allSettled([
      tryOnServiceInstanceA.processJob(job1.jobId, session1),
      tryOnServiceInstanceB.processJob(job2.jobId, session2),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(HttpException);
    expect(rejected[0]?.reason?.message).toMatch(/credit quota exhausted/i);

    // AI inference was invoked ONLY ONCE
    expect(mockAi.processJob).toHaveBeenCalledTimes(1);

    // Verify PostgreSQL subscription state: 1 consumed, 0 reserved, 0 remaining (never negative)
    const subAfter = await usageService.getPartnerStoreSubscription(storeId);
    expect(subAfter.includedCredits).toBe(1);
    expect(subAfter.consumedCredits).toBe(1);
    expect(subAfter.reservedCredits).toBe(0);
    expect(subAfter.remainingCredits).toBe(0);
  });

  it('5. prevents duplicate AI inference and double reservation when two separate TryOnService instances call processJob on the same PENDING jobId', async () => {
    const storeId = 'store_jayanagar_03';
    await tryOnServiceInstanceA.setQuotaBalance(storeId, 5);

    const sessionToken = 'wm_pg_dup_claim_sess_01';
    await usageService.createOrInspectSponsoredSession(storeId, sessionToken);

    const created = await tryOnServiceInstanceA.createJob(
      makeMulterFile(validJpegBuffer),
      makeMulterFile(validPngBuffer, 'image/png'),
      ClothingCategory.TSHIRT,
      'TSHIRT',
      sessionToken,
      storeId,
    );

    mockAi.processJob.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return {
        resultImageBuffer: validJpegBuffer,
        resultMimeType: 'image/jpeg',
        provider: 'mock',
        inferenceMs: 50,
      };
    });

    // Call processJob on the SAME jobId concurrently across two separate instances
    const [resA, resB] = await Promise.all([
      tryOnServiceInstanceA.processJob(created.jobId, sessionToken),
      tryOnServiceInstanceB.processJob(created.jobId, sessionToken),
    ]);

    expect([resA.status, resB.status]).toContain(TryOnStatus.COMPLETED);
    expect(mockAi.processJob).toHaveBeenCalledTimes(1);

    const subAfter = await usageService.getPartnerStoreSubscription(storeId);
    expect(subAfter.consumedCredits).toBe(1);
    expect(subAfter.reservedCredits).toBe(0);
    expect(subAfter.remainingCredits).toBe(4);
  });

  it('6. releases reserved credits on AI failure, increments failedGenerationsCount, and guarantees state-transition idempotency on repeated refund calls', async () => {
    const storeId = 'store_koramangala_02';
    await tryOnServiceInstanceA.setQuotaBalance(storeId, 2);

    const sessionToken = 'wm_pg_failure_refund_sess_01';
    await usageService.createOrInspectSponsoredSession(storeId, sessionToken);

    const created = await tryOnServiceInstanceA.createJob(
      makeMulterFile(validJpegBuffer),
      makeMulterFile(validPngBuffer, 'image/png'),
      ClothingCategory.SHIRT,
      'SHIRT',
      sessionToken,
      storeId,
    );

    mockAi.processJob.mockRejectedValueOnce(new Error('Upstream GPU worker OOM'));

    await expect(
      tryOnServiceInstanceA.processJob(created.jobId, sessionToken),
    ).rejects.toThrow(InternalServerErrorException);

    // Verify reservation was transitioned to RELEASED, credit refunded to remaining=2, and failedGenerationsCount=1
    const subAfterFail = await usageService.getPartnerStoreSubscription(storeId);
    expect(subAfterFail.includedCredits).toBe(2);
    expect(subAfterFail.consumedCredits).toBe(0);
    expect(subAfterFail.reservedCredits).toBe(0);
    expect(subAfterFail.remainingCredits).toBe(2);
    expect(subAfterFail.failedGenerationsCount).toBe(1);

    // Calling releaseReservedQuotaOnFailure again on the same jobId MUST be a no-op (never double-refunds!)
    const secondRelease = await tryOnServiceInstanceA.releaseReservedQuotaOnFailure(
      storeId,
      created.jobId,
      'Duplicate failure callback',
      true,
    );
    expect(secondRelease).toBe(false);

    const subAfterDuplicateRelease = await usageService.getPartnerStoreSubscription(storeId);
    expect(subAfterDuplicateRelease.remainingCredits).toBe(2);
    expect(subAfterDuplicateRelease.failedGenerationsCount).toBe(1);
  });

  it('7. reconciles stale PENDING reservations idempotently and supports dryRun', async () => {
    const storeId = 'store_indiranagar_01';
    await tryOnServiceInstanceA.setQuotaBalance(storeId, 10);

    const sessionToken = 'wm_pg_stale_res_sess_01';
    await usageService.createOrInspectSponsoredSession(storeId, sessionToken);
    const created = await tryOnServiceInstanceA.createJob(
      makeMulterFile(validJpegBuffer),
      makeMulterFile(validPngBuffer, 'image/png'),
      ClothingCategory.TSHIRT,
      'TSHIRT',
      sessionToken,
      storeId,
    );

    const sub = await db.partnerStoreSubscription.findFirst({ where: { storeId } });
    await db.partnerStoreSubscription.update({
      where: { id: sub!.id },
      data: { reservedCredits: 1 },
    });
    await db.usageReservation.create({
      data: {
        jobId: created.jobId,
        idempotencyKey: `stale_job_${created.jobId}`,
        billingMode: 'STORE_SPONSORED',
        status: 'PENDING',
        credits: 1,
        storeId,
        subscriptionId: sub!.id,
        expiresAt: new Date(Date.now() - 60_000), // Expired 1 minute ago
      },
    });

    // Dry run reports 1 stale reservation without mutating DB
    const dryRes = await usageService.reconcileStaleReservations({ dryRun: true });
    expect(dryRes.dryRun).toBe(true);
    expect(dryRes.staleFound).toBe(1);
    expect(dryRes.releasedCount).toBe(0);

    // Live reconciliation releases the stuck reservation
    const liveRes = await usageService.reconcileStaleReservations({ dryRun: false });
    expect(liveRes.staleFound).toBe(1);
    expect(liveRes.releasedCount).toBe(1);

    const subAfter = await usageService.getPartnerStoreSubscription(storeId);
    expect(subAfter.reservedCredits).toBe(0);
    expect(subAfter.remainingCredits).toBe(10);

    // Running reconciliation a second time is a safe no-op
    const secondRun = await usageService.reconcileStaleReservations({ dryRun: false });
    expect(secondRun.staleFound).toBe(0);
    expect(secondRun.releasedCount).toBe(0);
  });

  it('8. enforces store suspension, Store A vs. Store B isolation, partner API key verification, and customer privacy', async () => {
    const storeA = 'store_indiranagar_01';
    const storeB = 'store_koramangala_02';

    // 1. Store A cannot access Store B's subscription, usage, or analytics
    await expect(
      usageService.getPartnerStoreSubscription(storeB, {
        partnerStoreHeader: storeA,
      }),
    ).rejects.toThrow(ForbiddenException);

    await expect(
      usageService.getPartnerStoreUsage(storeB, {
        partnerStoreHeader: storeA,
      }),
    ).rejects.toThrow(ForbiddenException);

    await expect(
      wardrobeService.getPartnerStoreAnalytics(storeB, storeA),
    ).rejects.toThrow(ForbiddenException);

    // 2. Invalid partner API key is rejected with 401 Unauthorized
    await expect(
      usageService.getPartnerStoreSubscription(storeA, {
        partnerStoreHeader: storeA,
        partnerKeyHeader: 'wm_partner_wrong_secret_key',
      }),
    ).rejects.toThrow(UnauthorizedException);

    // 3. Valid partner API key succeeds and returns zero customer PII/images
    const usageA = await usageService.getPartnerStoreUsage(storeA, {
      partnerStoreHeader: storeA,
      partnerKeyHeader: 'wm_partner_indiranagar_01_dev_key',
    });
    expect(usageA.storeId).toBe(storeA);
    expect(JSON.stringify(usageA)).not.toContain('personImageUrl');
    expect(JSON.stringify(usageA)).not.toContain('base_portrait.jpg');

    // 4. Suspending Store A immediately blocks new sponsored sessions and jobs before AI inference
    await db.partnerStore.update({
      where: { storeId: storeA },
      data: { status: 'SUSPENDED' },
    });

    const suspendedSession = await usageService.createOrInspectSponsoredSession(
      storeA,
      'wm_pg_suspended_store_sess_01',
    );
    expect(suspendedSession.active).toBe(false);
    expect(suspendedSession.expiredReason).toBe('STORE_SUSPENDED');
  });

  it('9. [Fix 1] makes authenticated userId ownership authoritative across devices, blocks cross-user access on shared browsers, and scopes PostgreSQL queries BEFORE pagination so unrelated traffic cannot push jobs out', async () => {
    const userA = await db.user.create({
      data: {
        phoneE164: '+919811111111',
        phoneVerifiedAt: new Date(),
      },
    });
    const userB = await db.user.create({
      data: {
        phoneE164: '+919822222222',
        phoneVerifiedAt: new Date(),
      },
    });

    const deviceASession = 'wm_pg_device_a_session_01';
    const deviceBSession = 'wm_pg_device_b_session_02';

    const userAJob = await tryOnServiceInstanceA.createJob(
      makeMulterFile(validJpegBuffer),
      makeMulterFile(validPngBuffer, 'image/png'),
      ClothingCategory.TSHIRT,
      'TSHIRT',
      deviceASession,
      undefined,
      { userId: userA.id },
    );
    await tryOnServiceInstanceA.processJob(userAJob.jobId, deviceASession, userA.id);

    // Flood the database with 60 newer unrelated jobs from other sessions/users (exceeding take: 24 and take: 50)
    for (let i = 0; i < 60; i++) {
      await db.tryOnJob.create({
        data: {
          status: 'COMPLETED',
          category: ClothingCategory.SHIRT,
          personImageKey: `jobs/unrelated-${i}/person.jpg`,
          garmentImageKey: `jobs/unrelated-${i}/garment.png`,
          resultImageKey: `jobs/unrelated-${i}/result.jpg`,
          userId: userB.id,
          personImageMeta: { sessionId: `wm_pg_other_session_${i}` },
        },
      });
    }

    // 1. User A logs in on Device B (different sessionToken) and still sees their own job despite 60 newer unrelated jobs
    const historyOnDeviceB = await tryOnServiceInstanceB.listRecentJobs(
      undefined,
      deviceBSession,
      userA.id,
    );
    expect(historyOnDeviceB.jobs.some((j) => j.jobId === userAJob.jobId)).toBe(true);
    expect(historyOnDeviceB.jobs.every((j) => j.jobId === userAJob.jobId)).toBe(true);

    const statusOnDeviceB = await tryOnServiceInstanceB.getJobStatus(
      userAJob.jobId,
      deviceBSession,
      userA.id,
    );
    expect(statusOnDeviceB.jobId).toBe(userAJob.jobId);

    // 2. User B cannot access or delete User A's job even if sharing deviceASession!
    await expect(
      tryOnServiceInstanceB.getJobStatus(userAJob.jobId, deviceASession, userB.id),
    ).rejects.toThrow(ForbiddenException);

    await expect(
      tryOnServiceInstanceB.deleteJob(userAJob.jobId, deviceASession, userB.id),
    ).rejects.toThrow(ForbiddenException);
  });

  it('10. [Fix 2] closes the sponsored QR renewal loophole: rejects remote forceRefreshScan: true and replayed tokens, requiring a freshly issued single-use signed qrToken', async () => {
    const storeId = 'store_indiranagar_01';
    const partnerKey = 'wm_partner_indiranagar_01_dev_key';
    const sessionToken = 'wm_pg_qr_renewal_loophole_sess_01';
    const user = await db.user.create({
      data: {
        phoneE164: '+919833333333',
        phoneVerifiedAt: new Date(),
      },
    });

    const initial = await usageService.createOrInspectSponsoredSession(
      storeId,
      sessionToken,
      { userId: user.id },
    );
    expect(initial.active).toBe(true);

    // Expire the session
    await db.tryOnSession.update({
      where: { sessionToken },
      data: {
        sponsoredStartedAt: new Date(Date.now() - 65 * 60_000),
        sponsoredExpiresAt: new Date(Date.now() - 5 * 60_000),
      },
    });

    // 1. Attempting remote renewal by passing forceRefreshScan: true WITHOUT a valid qrToken MUST fail to renew!
    const spoofedRefresh = await usageService.createOrInspectSponsoredSession(
      storeId,
      sessionToken,
      { userId: user.id, forceRefreshScan: true },
    );
    expect(spoofedRefresh.active).toBe(false);
    expect(spoofedRefresh.expiredReason).toBe('SESSION_EXPIRED');

    // 2. Authenticated user rotating to a brand-new sessionToken from home without a qrToken ALSO remains expired!
    const rotatedSessionAttempt = await usageService.createOrInspectSponsoredSession(
      storeId,
      'wm_pg_rotated_cookie_from_home_02',
      { userId: user.id, forceRefreshScan: true },
    );
    expect(rotatedSessionAttempt.active).toBe(false);
    expect(rotatedSessionAttempt.expiredReason).toBe('SESSION_EXPIRED');

    // 3. Boutique issues a short-lived, single-use signed QR check-in token
    const issued = await usageService.issueStoreQrCheckInToken(storeId, {
      partnerStoreHeader: storeId,
      partnerKeyHeader: partnerKey,
    });
    expect(issued.qrToken).toBeTruthy();
    expect(issued.singleUse).toBe(true);

    // 4. Presenting the freshly issued signed qrToken renews the sponsored window
    const renewed = await usageService.createOrInspectSponsoredSession(
      storeId,
      sessionToken,
      { userId: user.id, qrToken: issued.qrToken },
    );
    expect(renewed.active).toBe(true);
    expect(renewed.usageMode).toBe('STORE_SPONSORED');

    // 5. Replaying the exact same qrToken a second time is rejected (single-use anti-replay)
    await expect(
      usageService.createOrInspectSponsoredSession(
        storeId,
        'wm_pg_replay_attacker_sess_03',
        { qrToken: issued.qrToken },
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('11. [Fix 3] guarantees job completion and credit settlement consistency: if saving COMPLETED fails after finalizeQuotaOnSuccess, the CONSUMED credit is reversed to RELEASED so no FAILED job is ever charged', async () => {
    const storeId = 'store_koramangala_02';
    await tryOnServiceInstanceA.setQuotaBalance(storeId, 3);

    const sessionToken = 'wm_pg_settlement_consistency_sess_01';
    await usageService.createOrInspectSponsoredSession(storeId, sessionToken);

    const created = await tryOnServiceInstanceA.createJob(
      makeMulterFile(validJpegBuffer),
      makeMulterFile(validPngBuffer, 'image/png'),
      ClothingCategory.TSHIRT,
      'TSHIRT',
      sessionToken,
      storeId,
    );

    // Simulate a failure specifically AFTER finalizeQuotaOnSuccess (when signing/saving COMPLETED result URL)
    mockStorage.getUrl.mockRejectedValueOnce(
      new Error('Simulated failure after finalizeQuotaOnSuccess while completing job'),
    );

    await expect(
      tryOnServiceInstanceA.processJob(created.jobId, sessionToken),
    ).rejects.toThrow(InternalServerErrorException);

    // Job is marked FAILED
    const jobAfter = await db.tryOnJob.findUnique({ where: { id: created.jobId } });
    expect(jobAfter?.status).toBe('FAILED');
    expect(jobAfter?.creditReserved).toBe(false);

    // Reservation was reversed from CONSUMED -> RELEASED, so 0 credits are consumed and all 3 remain!
    const reservationAfter = await db.usageReservation.findUnique({
      where: { jobId: created.jobId },
    });
    expect(reservationAfter?.status).toBe('RELEASED');

    const subAfter = await usageService.getPartnerStoreSubscription(storeId);
    expect(subAfter.consumedCredits).toBe(0);
    expect(subAfter.reservedCredits).toBe(0);
    expect(subAfter.remainingCredits).toBe(3);
    expect(subAfter.failedGenerationsCount).toBe(1);

    // Retrying releaseReservedQuotaOnFailure cannot double-release
    const retryRelease = await tryOnServiceInstanceA.releaseReservedQuotaOnFailure(
      storeId,
      created.jobId,
      'Retry release check',
      true,
    );
    expect(retryRelease).toBe(false);
    const subAfterRetry = await usageService.getPartnerStoreSubscription(storeId);
    expect(subAfterRetry.remainingCredits).toBe(3);
  });

  it('12. [Fix 4] automates crash recovery: reconciles stuck PROCESSING jobs to FAILED and aborts late AI workers that finish after reservation expiry', async () => {
    const storeId = 'store_indiranagar_01';
    await tryOnServiceInstanceA.setQuotaBalance(storeId, 5);

    const sessionToken = 'wm_pg_crash_recovery_sess_01';
    await usageService.createOrInspectSponsoredSession(storeId, sessionToken);

    const created = await tryOnServiceInstanceA.createJob(
      makeMulterFile(validJpegBuffer),
      makeMulterFile(validPngBuffer, 'image/png'),
      ClothingCategory.TSHIRT,
      'TSHIRT',
      sessionToken,
      storeId,
    );

    // Simulate a late AI worker: while AI inference is in-flight, the reservation expires and reconciler runs!
    mockAi.processJob.mockImplementationOnce(async () => {
      // Expire the reservation and run the crash-recovery reconciler while the worker is still running
      await db.usageReservation.update({
        where: { jobId: created.jobId },
        data: { expiresAt: new Date(Date.now() - 10_000) },
      });
      const rec = await usageService.reconcileStaleReservations({ dryRun: false });
      expect(rec.releasedCount).toBe(1);
      expect(rec.reconciledJobIds).toContain(created.jobId);

      return {
        resultImageBuffer: validJpegBuffer,
        resultMimeType: 'image/jpeg',
        provider: 'mock',
        inferenceMs: 30,
      };
    });

    // Late worker finishes after reconciler already expired the reservation and marked the job FAILED:
    // processJob must abort with 408 Request Timeout, delete the late result file, and NOT mark the job COMPLETED or charge credits
    await expect(
      tryOnServiceInstanceA.processJob(created.jobId, sessionToken),
    ).rejects.toThrow(/credit reservation already expired/i);

    const jobAfter = await db.tryOnJob.findUnique({ where: { id: created.jobId } });
    expect(jobAfter?.status).toBe('FAILED');

    const resAfter = await db.usageReservation.findUnique({
      where: { jobId: created.jobId },
    });
    expect(resAfter?.status).toBe('EXPIRED');

    const subAfter = await usageService.getPartnerStoreSubscription(storeId);
    expect(subAfter.consumedCredits).toBe(0);
    expect(subAfter.reservedCredits).toBe(0);
    expect(subAfter.remainingCredits).toBe(5);
  });

  it('13. [Fix 5] enforces production partner authentication and subscription period lifecycle (ACTIVE -> PAST_DUE at periodEnd, restored only by authorized renewal)', async () => {
    const storeId = 'store_jayanagar_03';
    const validKey = 'wm_partner_jayanagar_03_dev_key';

    // 1. Partner authentication endpoint requires a valid key
    await expect(usageService.authenticatePartnerStore(storeId, '')).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(
      usageService.authenticatePartnerStore(storeId, 'wrong_key'),
    ).rejects.toThrow(UnauthorizedException);

    const authOk = await usageService.authenticatePartnerStore(storeId, validKey);
    expect(authOk.authenticated).toBe(true);
    expect(authOk.storeId).toBe(storeId);

    // 2. When subscription period ends, status transitions to PAST_DUE (never silently rolled forward)
    const subRecord = await db.partnerStoreSubscription.findFirst({ where: { storeId } });
    await db.partnerStoreSubscription.update({
      where: { id: subRecord!.id },
      data: {
        periodEnd: new Date(Date.now() - 60_000),
        consumedCredits: 120,
      },
    });

    const pastDueSub = await usageService.getPartnerStoreSubscription(storeId, {
      partnerStoreHeader: storeId,
      partnerKeyHeader: validKey,
    });
    expect(pastDueSub.subscriptionStatus).toBe('PAST_DUE');
    expect(pastDueSub.remainingCredits).toBe(0);
    expect(pastDueSub.quotaExhausted).toBe(true);

    // Store cannot sponsor sessions while PAST_DUE
    const blockedSession = await usageService.createOrInspectSponsoredSession(
      storeId,
      'wm_pg_past_due_sess_01',
    );
    expect(blockedSession.active).toBe(false);
    expect(blockedSession.expiredReason).toBe('SUBSCRIPTION_INACTIVE');

    // 3. Explicit authorized renewal starts a new 30-day ACTIVE cycle and resets consumedCredits to 0
    const renewedSub = await usageService.renewPartnerStoreSubscription(
      storeId,
      {
        partnerStoreHeader: storeId,
        partnerKeyHeader: validKey,
      },
      { planId: 'GROWTH' },
    );
    expect(renewedSub.subscriptionStatus).toBe('ACTIVE');
    expect(renewedSub.consumedCredits).toBe(0);
    expect(renewedSub.remainingCredits).toBe(700);
  });

  it('14. [Fix 6] enforces multi-instance DB atomic OTP claim, migrates anonymous entitlement balances on login, and cleans up expired FAILED jobs while preserving saved wardrobe looks', async () => {
    const anonSession = 'wm_pg_anon_upgrade_sess_01';

    // 1. Run 1 personal job as anonymous user (consuming 1 credit from ANONYMOUS_TRIAL)
    const anonJob = await tryOnServiceInstanceA.createJob(
      makeMulterFile(validJpegBuffer),
      makeMulterFile(validPngBuffer, 'image/png'),
      ClothingCategory.TSHIRT,
      'TSHIRT',
      anonSession,
    );
    await tryOnServiceInstanceA.processJob(anonJob.jobId, anonSession);

    // Also create 1 failed job in the same session with an expired TTL
    const expiredFailedJob = await db.tryOnJob.create({
      data: {
        status: 'FAILED',
        category: ClothingCategory.TSHIRT,
        personImageKey: 'jobs/expired-failed-job/person.jpg',
        garmentImageKey: 'jobs/expired-failed-job/garment.png',
        expiresAt: new Date(Date.now() - 3600_000),
        personImageMeta: { sessionId: anonSession },
      },
    });

    const anonEntBefore = await usageService.getEntitlementStatus(anonSession);
    expect(anonEntBefore.personalEntitlement.planId).toBe('ANONYMOUS_TRIAL');
    expect(anonEntBefore.personalEntitlement.consumedCredits).toBe(1);

    // 2. Request OTP and attempt concurrent upgrade across two distinct WardrobeService instances
    const mockConfig = (tryOnServiceInstanceA as unknown as { configService: ConfigService })
      .configService;
    const wardrobeInstanceB = new WardrobeService(
      db,
      mockStorage,
      tryOnServiceInstanceB,
      mockConfig,
      usageService,
    );

    const otpReq = await wardrobeService.requestOtp(anonSession, {
      channel: 'whatsapp',
      phone: '+919844444444',
    });
    const otpCode = otpReq.devOtpPreview ?? '123456';

    const upgradeResults = await Promise.allSettled([
      wardrobeService.upgradeSession(anonSession, {
        channel: 'whatsapp',
        phone: '+919844444444',
        otpCode,
      }),
      wardrobeInstanceB.upgradeSession(anonSession, {
        channel: 'whatsapp',
        phone: '+919844444444',
        otpCode,
      }),
    ]);

    const succeeded = upgradeResults.filter(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof wardrobeService.upgradeSession>>> =>
        r.status === 'fulfilled',
    );
    const failed = upgradeResults.filter((r) => r.status === 'rejected');
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);

    const upgradedUserId = succeeded[0]!.value.user.id;

    // 3. Verify anonymous consumedCredits (1) was deterministically migrated to the user's PERSONAL_FREE entitlement
    const userEntAfter = await usageService.getEntitlementStatus(anonSession, upgradedUserId);
    expect(userEntAfter.personalEntitlement.planId).toBe('PERSONAL_FREE');
    expect(userEntAfter.personalEntitlement.consumedCredits).toBe(1);

    const orphanAnonEnt = await db.consumerEntitlement.findUnique({
      where: { sessionToken: anonSession },
    });
    expect(orphanAnonEnt).toBeNull();

    // 4. Verify cleanupExpiredAndOrphanedJobs deletes the expired FAILED job while preserving the saved COMPLETED wardrobe look
    const cleanup = await tryOnServiceInstanceA.cleanupExpiredAndOrphanedJobs();
    expect(cleanup.expiredJobsDeleted).toBeGreaterThanOrEqual(1);

    const failedStillInDb = await db.tryOnJob.findUnique({
      where: { id: expiredFailedJob.id },
    });
    expect(failedStillInDb).toBeNull();

    const completedStillInDb = await db.tryOnJob.findUnique({
      where: { id: anonJob.jobId },
    });
    expect(completedStillInDb).not.toBeNull();
    expect(completedStillInDb?.savedToWardrobe).toBe(true);
  });

  it('15. [Audit A] enforces QR session security against unauthenticated token issuance, query-param store-hopping expiry bypass, concurrent token replay, and DB persistence failures', async () => {
    const storeA = 'store_indiranagar_01';
    const storeB = 'store_koramangala_02';
    const partnerKeyA = 'wm_partner_indiranagar_01_dev_key';
    const sessionToken = 'wm_pg_audit_a_sess_01';

    // 1. Token issuance WITHOUT partner API key must be rejected even in non-production
    await expect(usageService.issueStoreQrCheckInToken(storeA)).rejects.toThrow(
      UnauthorizedException,
    );

    // 2. Token issued for Store A cannot be used with Store B
    const tokenForA = await usageService.issueStoreQrCheckInToken(storeA, {
      partnerStoreHeader: storeA,
      partnerKeyHeader: partnerKeyA,
    });
    await expect(
      usageService.createOrInspectSponsoredSession(storeB, sessionToken, {
        qrToken: tokenForA.qrToken,
      }),
    ).rejects.toThrow(ForbiddenException);

    // 3. Start sponsored session at Store A using tokenForA, then expire it
    const started = await usageService.createOrInspectSponsoredSession(
      storeA,
      sessionToken,
      { qrToken: tokenForA.qrToken },
    );
    expect(started.active).toBe(true);

    await db.tryOnSession.update({
      where: { sessionToken },
      data: {
        sponsoredStartedAt: new Date(Date.now() - 65 * 60_000),
        sponsoredExpiresAt: new Date(Date.now() - 5 * 60_000),
      },
    });

    // Attempting to bypass Store A's expiry by changing query param to Store B (without qrToken) and back to Store A MUST fail!
    const hopToStoreB = await usageService.createOrInspectSponsoredSession(
      storeB,
      sessionToken,
    );
    expect(hopToStoreB.active).toBe(false);

    const hopBackToStoreA = await usageService.createOrInspectSponsoredSession(
      storeA,
      sessionToken,
    );
    expect(hopBackToStoreA.active).toBe(false);
    expect(hopBackToStoreA.expiredReason).toBe('SESSION_EXPIRED');

    // 4. Concurrent replay of the same fresh qrToken across 5 simultaneous requests succeeds at most ONCE
    const freshToken = await usageService.issueStoreQrCheckInToken(storeA, {
      partnerStoreHeader: storeA,
      partnerKeyHeader: partnerKeyA,
    });
    const concurrentReplays = await Promise.allSettled(
      Array.from({ length: 5 }, (_, idx) =>
        usageService.createOrInspectSponsoredSession(
          storeA,
          `wm_pg_concurrent_qr_${idx}`,
          { qrToken: freshToken.qrToken },
        ),
      ),
    );
    const replaySuccesses = concurrentReplays.filter(
      (r) => r.status === 'fulfilled' && r.value.active,
    );
    const replayRejections = concurrentReplays.filter((r) => r.status === 'rejected');
    expect(replaySuccesses).toHaveLength(1);
    expect(replayRejections).toHaveLength(4);

    // 5. When REQUIRE_SIGNED_QR_CHECKIN=true, initial anonymous session creation with only a guessed storeId (no qrToken) does NOT grant store sponsorship
    const prevRequireQr = process.env['REQUIRE_SIGNED_QR_CHECKIN'];
    process.env['REQUIRE_SIGNED_QR_CHECKIN'] = 'true';
    try {
      const guessedStoreAttempt = await usageService.createOrInspectSponsoredSession(
        storeA,
        'wm_pg_guessed_store_only_sess',
      );
      expect(guessedStoreAttempt.active).toBe(false);
      expect(guessedStoreAttempt.usageMode).toBe('PERSONAL');
    } finally {
      if (prevRequireQr === undefined) {
        delete process.env['REQUIRE_SIGNED_QR_CHECKIN'];
      } else {
        process.env['REQUIRE_SIGNED_QR_CHECKIN'] = prevRequireQr;
      }
    }
  });

  it('16. [Audit B] enforces SQL userId isolation on shared browser sessions, idempotency-key ownership, and signed file URL revocation after deletion/expiry', async () => {
    const sharedBrowserSession = 'wm_pg_shared_browser_sess_b1';
    const userA = await db.user.create({
      data: { phoneE164: '+919855555511', phoneVerifiedAt: new Date() },
    });
    const userB = await db.user.create({
      data: { phoneE164: '+919855555522', phoneVerifiedAt: new Date() },
    });

    // User A creates 1 job with an explicit idempotencyKey and 25 additional jobs on sharedBrowserSession
    const userAKeyedJob = await tryOnServiceInstanceA.createJob(
      makeMulterFile(validJpegBuffer),
      makeMulterFile(validPngBuffer, 'image/png'),
      ClothingCategory.TSHIRT,
      'TSHIRT',
      sharedBrowserSession,
      undefined,
      { userId: userA.id, idempotencyKey: 'user_a_idem_key_01' },
    );

    // 1. User B cannot hijack User A's job by supplying User A's idempotencyKey
    await expect(
      tryOnServiceInstanceB.createJob(
        makeMulterFile(validJpegBuffer),
        makeMulterFile(validPngBuffer, 'image/png'),
        ClothingCategory.TSHIRT,
        'TSHIRT',
        sharedBrowserSession,
        undefined,
        { userId: userB.id, idempotencyKey: 'user_a_idem_key_01' },
      ),
    ).rejects.toThrow(ForbiddenException);

    for (let i = 0; i < 25; i++) {
      await db.tryOnJob.create({
        data: {
          status: 'COMPLETED',
          category: ClothingCategory.TSHIRT,
          personImageKey: `jobs/user-a-shared-${i}/person.jpg`,
          garmentImageKey: `jobs/user-a-shared-${i}/garment.png`,
          resultImageKey: `jobs/user-a-shared-${i}/result.jpg`,
          userId: userA.id,
          personImageMeta: { sessionId: sharedBrowserSession },
          garmentImageMeta: { sessionId: sharedBrowserSession },
        },
      });
    }

    // User B logs in on the SAME sharedBrowserSession and has 1 older job on their account
    const userBJob = await db.tryOnJob.create({
      data: {
        status: 'COMPLETED',
        category: ClothingCategory.TSHIRT,
        personImageKey: 'jobs/user-b-own-job/person.jpg',
        garmentImageKey: 'jobs/user-b-own-job/garment.png',
        resultImageKey: 'jobs/user-b-own-job/result.jpg',
        userId: userB.id,
        createdAt: new Date(Date.now() - 120_000),
      },
    });

    // 2. User B listing jobs on sharedBrowserSession must still receive userBJob (not crowded out by User A's 26 newer jobs on sharedBrowserSession!)
    const userBHistory = await tryOnServiceInstanceB.listRecentJobs(
      undefined,
      sharedBrowserSession,
      userB.id,
    );
    expect(userBHistory.jobs.some((j) => j.jobId === userBJob.id)).toBe(true);
    expect(userBHistory.jobs.every((j) => j.jobId === userBJob.id)).toBe(true);

    // 3. Signed file URLs cannot bypass deletion/expiry or cross-user authentication
    const { StorageController } = await import('../../storage/storage.controller');
    const { createFileSignature } = await import('../../storage/file-token.util');
    const storageController = new StorageController(mockStorage, db);
    const exp = String(Date.now() + 3600_000);
    const key = `jobs/${userAKeyedJob.jobId}/person.jpg`;
    const sig = createFileSignature(key, Number(exp));

    const userBToken = wardrobeService.signAuthToken(userB, sharedBrowserSession);
    const mockRes = { set: jest.fn(), send: jest.fn() } as unknown as import('express').Response;

    // User B presenting their auth token alongside User A's signed URL must be rejected
    await expect(
      storageController.serveFile(
        userAKeyedJob.jobId,
        'person.jpg',
        mockRes,
        exp,
        sig,
        undefined,
        sharedBrowserSession,
        `Bearer ${userBToken}`,
      ),
    ).rejects.toThrow(ForbiddenException);

    // Once User A deletes the job, the still-unexpired signed URL must return 404 NotFoundException
    await tryOnServiceInstanceA.deleteJob(
      userAKeyedJob.jobId,
      sharedBrowserSession,
      userA.id,
    );
    await expect(
      storageController.serveFile(
        userAKeyedJob.jobId,
        'person.jpg',
        mockRes,
        exp,
        sig,
      ),
    ).rejects.toThrow();
  });

  it('17. [Audit C] recovers cleanly from post-settlement crashes (PROCESSING job with CONSUMED reservation) and cleans up uploaded result files on completion failure', async () => {
    const storeId = 'store_indiranagar_01';
    await tryOnServiceInstanceA.setQuotaBalance(storeId, 4);

    const sessionToken = 'wm_pg_audit_c_crash_sess_01';
    await usageService.createOrInspectSponsoredSession(storeId, sessionToken);

    const created = await tryOnServiceInstanceA.createJob(
      makeMulterFile(validJpegBuffer),
      makeMulterFile(validPngBuffer, 'image/png'),
      ClothingCategory.TSHIRT,
      'TSHIRT',
      sessionToken,
      storeId,
    );

    // Simulate process crash right AFTER finalizeQuotaOnSuccess:
    // Job is stuck in PROCESSING (stale updatedAt), while UsageReservation is CONSUMED and consumedCredits = 1
    await (tryOnServiceInstanceA as unknown as {
      reserveQuotaBeforeInference: (job: unknown, scope: string, sess?: string) => Promise<void>;
    }).reserveQuotaBeforeInference(
      await db.tryOnJob.findUnique({ where: { id: created.jobId } }),
      storeId,
      sessionToken,
    );
    const settled = await tryOnServiceInstanceA.finalizeQuotaOnSuccess(created.jobId);
    expect(settled).toBe('CONSUMED');

    // Mark job as stuck in PROCESSING past the stale cutoff (simulating node process crash before COMPLETED update)
    await db.tryOnJob.update({
      where: { id: created.jobId },
      data: {
        status: 'PROCESSING',
        updatedAt: new Date(Date.now() - 20 * 60_000),
      },
    });
    await db.usageReservation.update({
      where: { jobId: created.jobId },
      data: {
        expiresAt: new Date(Date.now() - 5 * 60_000),
      },
    });

    // Run crash recovery across two concurrent instances
    const [recA, recB] = await Promise.all([
      usageService.reconcileStaleReservations({ dryRun: false }),
      usageService.reconcileStaleReservations({ dryRun: false }),
    ]);
    expect(recA.reconciledJobIds.length + recB.reconciledJobIds.length).toBeGreaterThanOrEqual(1);

    // Job must be FAILED, reservation must be reversed from CONSUMED -> RELEASED, and consumedCredits refunded to 0!
    const jobAfter = await db.tryOnJob.findUnique({ where: { id: created.jobId } });
    expect(jobAfter?.status).toBe('FAILED');

    const resAfter = await db.usageReservation.findUnique({ where: { jobId: created.jobId } });
    expect(resAfter?.status).toBe('RELEASED');

    const subAfter = await usageService.getPartnerStoreSubscription(storeId);
    expect(subAfter.consumedCredits).toBe(0);
    expect(subAfter.reservedCredits).toBe(0);
    expect(subAfter.remainingCredits).toBe(4);
    expect(subAfter.failedGenerationsCount).toBe(1);
  });

  it('18. [Audit D] isolates subscription billing periods across renewals and prevents concurrent renewal requests from creating duplicate cycles', async () => {
    const storeId = 'store_koramangala_02';
    const partnerKey = 'wm_partner_koramangala_02_dev_key';
    await tryOnServiceInstanceA.setQuotaBalance(storeId, 10);

    const sessionToken = 'wm_pg_audit_d_period_sess_01';
    await usageService.createOrInspectSponsoredSession(storeId, sessionToken);

    // Create 2 jobs and reserve credits in Period 1 right before Period 1 expires
    const job1 = await tryOnServiceInstanceA.createJob(
      makeMulterFile(validJpegBuffer),
      makeMulterFile(validPngBuffer, 'image/png'),
      ClothingCategory.TSHIRT,
      'TSHIRT',
      sessionToken,
      storeId,
    );
    const job2 = await tryOnServiceInstanceA.createJob(
      makeMulterFile(validJpegBuffer),
      makeMulterFile(validPngBuffer, 'image/png'),
      ClothingCategory.TSHIRT,
      'TSHIRT',
      sessionToken,
      storeId,
    );

    const job1Row = await db.tryOnJob.findUnique({ where: { id: job1.jobId } });
    const job2Row = await db.tryOnJob.findUnique({ where: { id: job2.jobId } });
    await (tryOnServiceInstanceA as unknown as {
      reserveQuotaBeforeInference: (job: unknown, scope: string, sess?: string) => Promise<void>;
    }).reserveQuotaBeforeInference(job1Row, storeId, sessionToken);
    await (tryOnServiceInstanceA as unknown as {
      reserveQuotaBeforeInference: (job: unknown, scope: string, sess?: string) => Promise<void>;
    }).reserveQuotaBeforeInference(job2Row, storeId, sessionToken);

    const period1Sub = await usageService.getPartnerStoreSubscription(storeId, {
      partnerStoreHeader: storeId,
      partnerKeyHeader: partnerKey,
    });
    expect(period1Sub.reservedCredits).toBe(2);

    // Expire Period 1
    await db.partnerStoreSubscription.update({
      where: { id: period1Sub.subscriptionId },
      data: { periodEnd: new Date(Date.now() - 10_000), status: 'PAST_DUE' },
    });

    // Fire 3 concurrent renewal requests: only 1 new ACTIVE subscription period should be created
    const concurrentRenewals = await Promise.all([
      usageService.renewPartnerStoreSubscription(
        storeId,
        { partnerStoreHeader: storeId, partnerKeyHeader: partnerKey },
        { planId: 'GROWTH', includedCredits: 700 },
      ),
      usageService.renewPartnerStoreSubscription(
        storeId,
        { partnerStoreHeader: storeId, partnerKeyHeader: partnerKey },
        { planId: 'GROWTH', includedCredits: 700 },
      ),
      usageService.renewPartnerStoreSubscription(
        storeId,
        { partnerStoreHeader: storeId, partnerKeyHeader: partnerKey },
        { planId: 'GROWTH', includedCredits: 700 },
      ),
    ]);

    const activeSubs = await db.partnerStoreSubscription.findMany({
      where: { storeId, status: 'ACTIVE' },
    });
    expect(activeSubs).toHaveLength(1);
    const period2SubId = activeSubs[0]!.id;
    expect(period2SubId).not.toBe(period1Sub.subscriptionId);
    expect(concurrentRenewals[0]?.subscriptionId).toBe(period2SubId);

    // Now settle job1 (CONSUMED) and fail job2 (RELEASED) AFTER Period 2 started:
    // Period 1's subscription row must absorb both transitions; Period 2's counters must remain 0 consumed, 0 reserved, 700 remaining!
    await tryOnServiceInstanceA.finalizeQuotaOnSuccess(job1.jobId);
    await tryOnServiceInstanceA.releaseReservedQuotaOnFailure(
      storeId,
      job2.jobId,
      'Late failure from Period 1',
      true,
    );

    const period2After = await usageService.getPartnerStoreSubscription(storeId, {
      partnerStoreHeader: storeId,
      partnerKeyHeader: partnerKey,
    });
    expect(period2After.subscriptionId).toBe(period2SubId);
    expect(period2After.consumedCredits).toBe(0);
    expect(period2After.reservedCredits).toBe(0);
    expect(period2After.remainingCredits).toBe(700);

    const period1RowAfter = await db.partnerStoreSubscription.findUnique({
      where: { id: period1Sub.subscriptionId },
    });
    expect(period1RowAfter?.consumedCredits).toBe(1);
    expect(period1RowAfter?.reservedCredits).toBe(0);
    expect(period1RowAfter?.failedGenerationsCount).toBe(1);
  });

  it('19. [Audit E & F] rolls back OTP claim on transient storage failure so retry succeeds, and scrubs all session PII on account deletion', async () => {
    const sessionToken = 'wm_pg_audit_ef_otp_retry_sess';
    const job = await tryOnServiceInstanceA.createJob(
      makeMulterFile(validJpegBuffer),
      makeMulterFile(validPngBuffer, 'image/png'),
      ClothingCategory.TSHIRT,
      'TSHIRT',
      sessionToken,
    );
    await tryOnServiceInstanceA.processJob(job.jobId, sessionToken);

    const otpReq = await wardrobeService.requestOtp(sessionToken, {
      channel: 'whatsapp',
      phone: '+919866666666',
    });
    const otpCode = otpReq.devOtpPreview ?? '123456';

    // 1. Simulate transient object-storage error during copyPortraitToUserStorage after OTP is claimed
    mockStorage.copy.mockRejectedValueOnce(new Error('Transient S3/storage copy timeout'));

    await expect(
      wardrobeService.upgradeSession(sessionToken, {
        channel: 'whatsapp',
        phone: '+919866666666',
        otpCode,
      }),
    ).rejects.toThrow(/Transient S3\/storage copy timeout/i);

    // 2. Retrying upgradeSession with the SAME valid OTP code must succeed because the failed upgrade rolled back the OTP claim!
    const retryUpgrade = await wardrobeService.upgradeSession(sessionToken, {
      channel: 'whatsapp',
      phone: '+919866666666',
      otpCode,
    });
    expect(retryUpgrade.user.phoneE164).toBe('+919866666666');
    expect(retryUpgrade.upgradedJobsCount).toBe(1);

    // 3. Account deletion removes user, jobs, portrait, AND TryOnSession rows (leaving no phone/email PII in TryOnSession)
    const deleted = await wardrobeService.deleteUserAccount(
      `Bearer ${retryUpgrade.authToken}`,
      undefined,
      sessionToken,
    );
    expect(deleted.deleted).toBe(true);

    const remainingSessions = await db.tryOnSession.findMany({
      where: {
        OR: [{ sessionToken }, { otpPhoneE164: '+919866666666' }, { otpTarget: '+919866666666' }],
      },
    });
    expect(remainingSessions).toHaveLength(0);
  });
});


