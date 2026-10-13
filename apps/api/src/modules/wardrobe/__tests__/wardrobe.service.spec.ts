import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ClothingCategory, TryOnStatus } from '@wearme/shared';
import { DatabaseService } from '../../database/database.service';
import { appendSignedFileQuery } from '../../storage/file-token.util';
import { StorageController } from '../../storage/storage.controller';
import { StorageProvider } from '../../storage/storage.provider';
import { TryOnService } from '../../try-on/try-on.service';
import { WardrobeService } from '../wardrobe.service';

describe('WardrobeService — Network Effect Flywheel, Multi-Channel OTP & Privacy Boundary', () => {
  let service: WardrobeService;
  let storageController: StorageController;
  let tmpTraceDir: string;
  let traceLogPath: string;
  let currentNodeEnv = 'development';

  const sessionStore = new Map<string, Record<string, unknown>>();
  const userStore = new Map<string, Record<string, unknown>>();
  const jobStore = new Map<string, Record<string, unknown>>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockDb: Record<string, any> = {
    tryOnSession: {
      findUnique: jest.fn(async ({ where }: { where: { sessionToken?: string; id?: string } }) => {
        if (where.sessionToken) {
          const found = sessionStore.get(where.sessionToken) ?? null;
          if (found && found['userId']) {
            return {
              ...found,
              user: Array.from(userStore.values()).find((u) => u['id'] === found['userId']) ?? null,
            };
          }
          return found;
        }
        return null;
      }),
      upsert: jest.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { sessionToken: string };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const existing = sessionStore.get(where.sessionToken);
          const merged = existing
            ? { ...existing, ...update, updatedAt: new Date() }
            : {
                id: `sess-uuid-${sessionStore.size + 1}`,
                createdAt: new Date(),
                updatedAt: new Date(),
                ...create,
              };
          sessionStore.set(where.sessionToken, merged);
          return merged;
        },
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          for (const [token, sess] of sessionStore.entries()) {
            if (sess['id'] === where.id) {
              const nextAttempts =
                typeof (data['otpAttempts'] as { increment?: number })?.increment === 'number'
                  ? Number(sess['otpAttempts'] ?? 0) +
                    Number((data['otpAttempts'] as { increment: number }).increment)
                  : (data['otpAttempts'] ?? sess['otpAttempts']);
              const updated = {
                ...sess,
                ...data,
                otpAttempts: nextAttempts,
                updatedAt: new Date(),
              };
              sessionStore.set(token, updated);
              return updated;
            }
          }
          return null;
        },
      ),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { userId?: string; id?: string; otpCodeHash?: string | null };
          data: Record<string, unknown>;
        }) => {
          let count = 0;
          for (const [token, sess] of sessionStore.entries()) {
            const matchUser = where.userId ? sess['userId'] === where.userId : true;
            const matchId = where.id ? sess['id'] === where.id : true;
            const matchOtp =
              where.otpCodeHash !== undefined
                ? sess['otpCodeHash'] === where.otpCodeHash
                : true;
            if (matchUser && matchId && matchOtp) {
              sessionStore.set(token, { ...sess, ...data, updatedAt: new Date() });
              count++;
            }
          }
          return { count };
        },
      ),
    },
    user: {
      findUnique: jest.fn(
        async ({ where }: { where: { phoneE164?: string; email?: string; id?: string } }) => {
          if (where.id) {
            return userStore.get(where.id) ?? null;
          }
          if (where.phoneE164) {
            return (
              Array.from(userStore.values()).find((u) => u['phoneE164'] === where.phoneE164) ?? null
            );
          }
          if (where.email) {
            return (
              Array.from(userStore.values()).find((u) => u['email'] === where.email) ?? null
            );
          }
          return null;
        },
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = `user-uuid-${userStore.size + 1}`;
        const created = {
          id,
          phoneE164: null,
          email: null,
          phoneVerifiedAt: null,
          emailVerifiedAt: null,
          basePersonImageKey: null,
          originStoreId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        userStore.set(id, created);
        return created;
      }),
      upsert: jest.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { phoneE164?: string; email?: string };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const existing = Array.from(userStore.values()).find(
            (u) =>
              (where.phoneE164 && u['phoneE164'] === where.phoneE164) ||
              (where.email && u['email'] === where.email),
          );
          const id = existing ? String(existing['id']) : `user-uuid-${userStore.size + 1}`;
          const merged = existing
            ? { ...existing, ...update, updatedAt: new Date() }
            : {
                id,
                createdAt: new Date(),
                updatedAt: new Date(),
                ...create,
              };
          userStore.set(id, merged);
          return merged;
        },
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const existing = userStore.get(where.id);
          if (!existing) return null;
          const updated = { ...existing, ...data, updatedAt: new Date() };
          userStore.set(where.id, updated);
          return updated;
        },
      ),
      delete: jest.fn(async ({ where }: { where: { id: string } }) => {
        const existing = userStore.get(where.id) ?? null;
        userStore.delete(where.id);
        return existing;
      }),
    },
    tryOnJob: {
      findMany: jest.fn(async () => Array.from(jobStore.values())),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        return jobStore.get(where.id) ?? null;
      }),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const record = {
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        jobStore.set(String(data['id']), record);
        return record;
      }),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const existing = jobStore.get(where.id);
          const updated = { ...existing, ...data, updatedAt: new Date() };
          jobStore.set(where.id, updated);
          return updated;
        },
      ),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: { in: string[] } };
          data: Record<string, unknown>;
        }) => {
          let count = 0;
          for (const id of where.id.in) {
            const existing = jobStore.get(id);
            if (existing) {
              jobStore.set(id, { ...existing, ...data, updatedAt: new Date() });
              count++;
            }
          }
          return { count };
        },
      ),
      delete: jest.fn(async ({ where }: { where: { id: string } }) => {
        const existing = jobStore.get(where.id) ?? null;
        jobStore.delete(where.id);
        return existing;
      }),
      deleteMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
        let count = 0;
        for (const id of where.id.in) {
          if (jobStore.delete(id)) {
            count++;
          }
        }
        return { count };
      }),
    },
    $transaction: jest.fn(
      async (cb: (tx: unknown) => Promise<unknown>): Promise<unknown> => cb(mockDb),
    ),
  };

  const mockStorage: jest.Mocked<StorageProvider> = {
    upload: jest.fn().mockResolvedValue('jobs/mock/file.jpg'),
    copy: jest.fn().mockResolvedValue(undefined),
    download: jest.fn().mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff, 0xd9])),
    getUrl: jest.fn(async (key: string) => `http://localhost:3001/api/v1/files/${key}`),
    delete: jest.fn().mockResolvedValue(undefined),
    deleteJobDirectory: jest.fn().mockResolvedValue(undefined),
    listJobDirectories: jest.fn().mockResolvedValue([]),
    exists: jest.fn().mockResolvedValue(true),
    healthCheck: jest.fn().mockResolvedValue(true),
  };

  const mockTryOnService = {
    jobToStatusDto: jest.fn(async (job: Record<string, unknown>) => ({
      jobId: String(job['id']),
      status: (job['status'] as TryOnStatus) ?? TryOnStatus.COMPLETED,
      category: String(job['category'] ?? 'TSHIRT'),
      subcategory: 'TSHIRT',
      domain: 'clothing',
      personImageUrl: `http://localhost:3001/api/v1/files/${String(job['personImageKey'])}`,
      garmentImageUrl: `http://localhost:3001/api/v1/files/${String(job['garmentImageKey'])}`,
      resultUrl: `http://localhost:3001/api/v1/files/${String(job['resultImageKey'] ?? 'jobs/mock/result.jpg')}`,
      savedToWardrobe: Boolean(job['savedToWardrobe']),
      retailerSource: job['retailerSource'] ? String(job['retailerSource']) : undefined,
      productTitle: job['productTitle'] ? String(job['productTitle']) : undefined,
      createdAt: new Date().toISOString(),
    })),
    processJob: jest.fn(async (jobId: string) => {
      const existing = jobStore.get(jobId);
      if (existing) {
        jobStore.set(jobId, {
          ...existing,
          status: 'COMPLETED',
          resultImageKey: `jobs/${jobId}/result.jpg`,
          completedAt: new Date(),
        });
      }
      return {
        jobId,
        status: TryOnStatus.COMPLETED,
        resultUrl: `http://localhost:3001/api/v1/files/jobs/${jobId}/result.jpg`,
      };
    }),
  };

  const mockConfig = {
    get: jest.fn((key: string) => {
      if (key === 'app.nodeEnv') return currentNodeEnv;
      return undefined;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    currentNodeEnv = 'development';
    delete process.env['NODE_ENV'];
    sessionStore.clear();
    userStore.clear();
    jobStore.clear();

    tmpTraceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wearme-flywheel-trace-'));
    traceLogPath = path.join(tmpTraceDir, 'upsert-integrity-trace.log');
    process.env['SESSION_UPGRADE_TRACE_LOG_PATH'] = traceLogPath;

    service = new WardrobeService(
      mockDb as unknown as DatabaseService,
      mockStorage,
      mockTryOnService as unknown as TryOnService,
      mockConfig as unknown as ConfigService,
    );

    storageController = new StorageController(
      mockStorage,
      mockDb as unknown as DatabaseService,
    );
  });

  afterEach(async () => {
    delete process.env['SESSION_UPGRADE_TRACE_LOG_PATH'];
    delete process.env['NODE_ENV'];
    if (tmpTraceDir) {
      await fs.rm(tmpTraceDir, { recursive: true, force: true });
    }
  });

  it('upgrades an anonymous walk-in QR session into a persistent User wardrobe, decouples base portrait storage, and writes step-by-step trace logs', async () => {
    const sessionToken = 'wm_walkin_indiranagar_99887766';
    const jobId = '11111111-2222-4333-8444-555555555555';

    // Seed an anonymous completed TryOnJob created via store QR scan
    jobStore.set(jobId, {
      id: jobId,
      status: 'COMPLETED',
      category: ClothingCategory.TSHIRT,
      personImageKey: `jobs/${jobId}/person.jpg`,
      garmentImageKey: `jobs/${jobId}/garment.jpg`,
      resultImageKey: `jobs/${jobId}/result.jpg`,
      personImageMeta: { sessionId: sessionToken, mimeType: 'image/jpeg' },
      garmentImageMeta: { sessionId: sessionToken, subcategory: 'TSHIRT' },
      savedToWardrobe: false,
      expiresAt: new Date(Date.now() + 7 * 86400_000),
      createdAt: new Date(),
    });

    // Step 1: Request OTP
    const otpChallenge = await service.requestOtp(sessionToken, {
      phone: '9876543210',
      storeId: 'store_indiranagar_01',
      storeName: 'Studio Namma Indiranagar',
    });

    expect(otpChallenge.phoneE164).toBe('+919876543210');
    expect(otpChallenge.devOtpPreview).toBe('123456');

    // Step 2: Upgrade session with OTP
    const upgraded = await service.upgradeSession(sessionToken, {
      phone: '+91 98765 43210',
      otpCode: '123456',
      jobId,
      storeId: 'store_indiranagar_01',
      storeName: 'Studio Namma Indiranagar',
    });

    expect(upgraded.authToken).toMatch(/^wm_auth_/);
    expect(upgraded.upgradedJobsCount).toBe(1);
    expect(upgraded.redirectTo).toBe('/my-wardrobe');
    expect(upgraded.user.phoneE164).toBe('+919876543210');
    expect(upgraded.user.originStoreId).toBe('store_indiranagar_01');
    // Storage decoupling: base portrait was physically copied to users/<userId>/base_portrait.jpg
    expect(mockStorage.copy).toHaveBeenCalledWith(
      `jobs/${jobId}/person.jpg`,
      'users/user-uuid-1/base_portrait.jpg',
      'image/jpeg',
    );
    expect(upgraded.user.basePersonImageUrl).toContain(
      'users/user-uuid-1/base_portrait.jpg',
    );

    // Verify job TTL was cleared and savedToWardrobe=true
    const upgradedJob = jobStore.get(jobId)!;
    expect(upgradedJob['savedToWardrobe']).toBe(true);
    expect(upgradedJob['expiresAt']).toBeNull();
    expect(upgradedJob['userId']).toBe(upgraded.user.id);

    // Verify step-by-step execution trace log file was written
    const traceRaw = await fs.readFile(traceLogPath, 'utf8');
    const traceSteps = traceRaw
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { step: string });
    expect(traceSteps.map((s) => s.step)).toEqual([
      'STEP_0_REQUEST_OTP',
      'STEP_1_VALIDATE_HEADERS_AND_INPUT',
      'STEP_2_OTP_VERIFIED',
      'STEP_3_DISCOVER_SESSION_JOBS',
      'STEP_4_USER_UPSERTED_AND_BASE_PHOTO_PROMOTED',
      'STEP_5_SESSION_AND_JOBS_UPGRADED',
      'STEP_6_AUTH_TOKEN_MINTED',
    ]);

    // Step 3: Fetch /my-wardrobe using the minted authToken
    const wardrobe = await service.getWardrobe(`Bearer ${upgraded.authToken}`, undefined, undefined);
    expect(wardrobe.user.id).toBe(upgraded.user.id);
    expect(wardrobe.savedLooks).toHaveLength(1);
    expect(wardrobe.retailerCatalog.length).toBeGreaterThanOrEqual(4);

    // Step 4: Run a 1-click cross-retailer try-on using the saved base portrait
    const crossLook = await service.tryOnFromCatalog(
      { catalogItemId: 'zara_oxford_shirt' },
      `Bearer ${upgraded.authToken}`,
      undefined,
      sessionToken,
    );
    expect(crossLook.status).toBe(TryOnStatus.COMPLETED);
    expect(crossLook.savedToWardrobe).toBe(true);
    expect(crossLook.retailerSource).toBe('Zara Online');
  });

  it('preserves originStoreId and decoupled basePersonImageKey when a returning user scans a QR code at a second store (unless replaceBasePortrait=true)', async () => {
    let sessCounter = 0;
    mockDb.tryOnSession.upsert.mockImplementation(
      async ({
        where,
        create,
        update,
      }: {
        where: { sessionToken: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const existing = sessionStore.get(where.sessionToken);
        const merged = existing
          ? { ...existing, ...update, updatedAt: new Date() }
          : {
              id: `sess-uuid-${++sessCounter}`,
              createdAt: new Date(),
              updatedAt: new Date(),
              ...create,
            };
        sessionStore.set(where.sessionToken, merged);
        return merged;
      },
    );

    // 1. First store visit (Store A: Indiranagar) -> New User Registration
    const store1Session = 'wm_walkin_indiranagar_visit01';
    const job1Id = '11111111-2222-4333-8444-555555555555';
    jobStore.set(job1Id, {
      id: job1Id,
      status: 'COMPLETED',
      category: ClothingCategory.TSHIRT,
      personImageKey: `jobs/${job1Id}/person.jpg`,
      garmentImageKey: `jobs/${job1Id}/garment.jpg`,
      resultImageKey: `jobs/${job1Id}/result.jpg`,
      personImageMeta: { sessionId: store1Session, mimeType: 'image/jpeg' },
      garmentImageMeta: { sessionId: store1Session, subcategory: 'TSHIRT' },
      savedToWardrobe: false,
      expiresAt: new Date(Date.now() + 7 * 86400_000),
      createdAt: new Date(),
    });

    await service.requestOtp(store1Session, {
      phone: '9876543210',
      storeId: 'store_indiranagar_01',
      storeName: 'Studio Namma Indiranagar',
    });
    const firstUpgrade = await service.upgradeSession(store1Session, {
      phone: '9876543210',
      otpCode: '123456',
      jobId: job1Id,
      storeId: 'store_indiranagar_01',
      storeName: 'Studio Namma Indiranagar',
    });

    expect(firstUpgrade.user.originStoreId).toBe('store_indiranagar_01');
    expect(firstUpgrade.user.basePersonImageUrl).toBe(
      'http://localhost:3001/api/v1/files/users/user-uuid-1/base_portrait.jpg',
    );
    expect(mockStorage.copy).toHaveBeenCalledTimes(1);

    // Simulate user deleting Job 1 (`jobs/<job1Id>/person.jpg` deleted from disk)
    jobStore.delete(job1Id);
    mockStorage.exists.mockImplementation(
      async (key: string) => !key.startsWith(`jobs/${job1Id}/`),
    );

    const wardrobeAfterJob1Delete = await service.getWardrobe(
      `Bearer ${firstUpgrade.authToken}`,
      undefined,
      undefined,
    );
    // Decoupled user portrait remains valid even after original job is deleted!
    expect(wardrobeAfterJob1Delete.user.basePersonImageUrl).toBe(
      'http://localhost:3001/api/v1/files/users/user-uuid-1/base_portrait.jpg',
    );

    // 2. Returning user visits a NEW store (Store B: Koramangala Flagship) and scans a QR code
    const store2Session = 'wm_walkin_koramangala_visit02';
    const job2Id = '22222222-3333-4444-8555-666666666666';
    jobStore.set(job2Id, {
      id: job2Id,
      status: 'COMPLETED',
      category: ClothingCategory.KURTI,
      personImageKey: `jobs/${job2Id}/person.jpg`,
      garmentImageKey: `jobs/${job2Id}/garment.jpg`,
      resultImageKey: `jobs/${job2Id}/result.jpg`,
      personImageMeta: { sessionId: store2Session, mimeType: 'image/jpeg' },
      garmentImageMeta: { sessionId: store2Session, subcategory: 'KURTA' },
      savedToWardrobe: false,
      expiresAt: new Date(Date.now() + 7 * 86400_000),
      createdAt: new Date(),
    });

    await service.requestOtp(store2Session, {
      phone: '9876543210',
      storeId: 'store_koramangala_02',
      storeName: 'Studio Koramangala Flagship',
    });

    const returningUpgrade = await service.upgradeSession(store2Session, {
      phone: '9876543210',
      otpCode: '123456',
      jobId: job2Id,
      storeId: 'store_koramangala_02',
      storeName: 'Studio Koramangala Flagship',
      // replaceBasePortrait omitted (defaults to false)
    });

    // First-touch originStoreId MUST be preserved as store_indiranagar_01
    expect(returningUpgrade.user.originStoreId).toBe('store_indiranagar_01');
    // Existing high-quality base portrait MUST be retained (no second copy call)
    expect(returningUpgrade.user.basePersonImageUrl).toBe(
      'http://localhost:3001/api/v1/files/users/user-uuid-1/base_portrait.jpg',
    );
    expect(mockStorage.copy).toHaveBeenCalledTimes(1);

    // Meanwhile, Job 2's retailerSource records the new store visit
    const job2Record = jobStore.get(job2Id)!;
    expect(job2Record['savedToWardrobe']).toBe(true);
    expect(job2Record['retailerSource']).toBe('Studio Koramangala Flagship');

    // 3. Returning user explicitly opts in (`replaceBasePortrait: true`) on a third store visit
    const store3Session = 'wm_walkin_jayanagar_visit03';
    const job3Id = '33333333-4444-4555-8666-777777777777';
    jobStore.set(job3Id, {
      id: job3Id,
      status: 'COMPLETED',
      category: ClothingCategory.JACKET,
      personImageKey: `jobs/${job3Id}/person.jpg`,
      garmentImageKey: `jobs/${job3Id}/garment.jpg`,
      resultImageKey: `jobs/${job3Id}/result.jpg`,
      personImageMeta: { sessionId: store3Session, mimeType: 'image/jpeg' },
      garmentImageMeta: { sessionId: store3Session, subcategory: 'JACKET' },
      savedToWardrobe: false,
      expiresAt: new Date(Date.now() + 7 * 86400_000),
      createdAt: new Date(),
    });

    await service.requestOtp(store3Session, {
      phone: '9876543210',
      storeId: 'store_jayanagar_03',
      storeName: 'Studio Jayanagar Boutique',
    });

    const explicitReplaceUpgrade = await service.upgradeSession(store3Session, {
      phone: '9876543210',
      otpCode: '123456',
      jobId: job3Id,
      storeId: 'store_jayanagar_03',
      storeName: 'Studio Jayanagar Boutique',
      replaceBasePortrait: true,
    });

    // Origin store is still immutable (`store_indiranagar_01`), but base portrait was explicitly re-copied from Job 3
    expect(explicitReplaceUpgrade.user.originStoreId).toBe('store_indiranagar_01');
    expect(mockStorage.copy).toHaveBeenCalledTimes(2);
    expect(mockStorage.copy).toHaveBeenLastCalledWith(
      `jobs/${job3Id}/person.jpg`,
      'users/user-uuid-1/base_portrait.jpg',
      'image/jpeg',
    );

    // Persist the returning-user trace log to the artifact scratch directory for inspection
    const traceContent = await fs.readFile(traceLogPath, 'utf8');
    if (process.env['UPSERT_TRACE_CAPTURE_PATH']) {
      await fs.mkdir(path.dirname(process.env['UPSERT_TRACE_CAPTURE_PATH']), {
        recursive: true,
      });
      await fs.writeFile(process.env['UPSERT_TRACE_CAPTURE_PATH'], traceContent, 'utf8');
    }
    const step4Events = traceContent
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry['step'] === 'STEP_4_USER_UPSERTED_AND_BASE_PHOTO_PROMOTED');

    expect(step4Events).toHaveLength(3);
    expect(step4Events[0]?.['isReturningUser']).toBe(false);
    expect(step4Events[0]?.['originStoreDecision']).toBe('SET_FIRST_TOUCH_ORIGIN_STORE');
    expect(step4Events[0]?.['basePortraitDecision']).toBe(
      'COPIED_JOB_PORTRAIT_TO_USER_STORAGE',
    );

    expect(step4Events[1]?.['isReturningUser']).toBe(true);
    expect(step4Events[1]?.['originStoreDecision']).toBe(
      'PRESERVED_EXISTING_ORIGIN_STORE',
    );
    expect(step4Events[1]?.['basePortraitDecision']).toBe(
      'RETAINED_EXISTING_USER_PORTRAIT',
    );

    expect(step4Events[2]?.['isReturningUser']).toBe(true);
    expect(step4Events[2]?.['originStoreDecision']).toBe(
      'PRESERVED_EXISTING_ORIGIN_STORE',
    );
    expect(step4Events[2]?.['basePortraitDecision']).toBe(
      'EXPLICITLY_REPLACED_AND_COPIED_TO_USER_STORAGE',
    );
  });

  it('rejects invalid OTP codes, increments attempt counter, and blocks unauthenticated wardrobe access', async () => {
    const sessionToken = 'wm_security_test_session_01';

    await expect(service.getWardrobe(undefined, undefined, sessionToken)).rejects.toThrow(
      UnauthorizedException,
    );

    await expect(
      service.requestOtp('bad', { phone: '9876543210' }),
    ).rejects.toThrow(BadRequestException);

    await service.requestOtp(sessionToken, { phone: '9876543210' });

    await expect(
      service.upgradeSession(sessionToken, {
        phone: '9876543210',
        otpCode: '000000',
      }),
    ).rejects.toThrow(UnauthorizedException);

    const sessAfterBadAttempt = sessionStore.get(sessionToken)!;
    expect(sessAfterBadAttempt['otpAttempts']).toBe(1);
  });

  it('supports Email and SMS OTP channels, links email + phone to the same account, and enforces cooldown, expiry, one-time use, and brute-force lockout', async () => {
    const sessionToken = 'wm_multichannel_otp_session_01';

    // 1. Email OTP challenge
    const emailChallenge = await service.requestOtp(sessionToken, {
      channel: 'email',
      email: 'Shopper.One@Example.com',
    });
    expect(emailChallenge.channel).toBe('email');
    expect(emailChallenge.destination).toBe('shopper.one@example.com');
    expect(emailChallenge.devOtpPreview).toBe('123456');

    // 2. Resend cooldown enforced (< 30 seconds)
    await expect(
      service.requestOtp(sessionToken, {
        channel: 'email',
        email: 'shopper.one@example.com',
      }),
    ).rejects.toThrow(BadRequestException);

    // 3. Upgrade session via Email OTP
    const emailUpgrade = await service.upgradeSession(sessionToken, {
      channel: 'email',
      email: 'shopper.one@example.com',
      otpCode: '123456',
      returnUrl: '/try-on?storeId=store_indiranagar_01',
    });
    expect(emailUpgrade.user.email).toBe('shopper.one@example.com');
    expect(emailUpgrade.redirectTo).toBe('/try-on?storeId=store_indiranagar_01');

    // 4. Reused OTP must fail immediately (one-time consumption)
    await expect(
      service.upgradeSession(sessionToken, {
        channel: 'email',
        email: 'shopper.one@example.com',
        otpCode: '123456',
      }),
    ).rejects.toThrow(UnauthorizedException);

    // 5. Link SMS phone number to the SAME session/account after cooldown expires
    const sessRecord = sessionStore.get(sessionToken)!;
    sessRecord['otpRequestedAt'] = new Date(Date.now() - 60_000);
    sessionStore.set(sessionToken, sessRecord);

    const smsChallenge = await service.requestOtp(sessionToken, {
      channel: 'sms',
      phone: '9888877777',
    });
    expect(smsChallenge.channel).toBe('sms');
    expect(smsChallenge.phoneE164).toBe('+919888877777');

    const linkedUpgrade = await service.upgradeSession(sessionToken, {
      channel: 'sms',
      phone: '9888877777',
      otpCode: '123456',
      returnUrl: 'https://evil.example.com/phish', // Open redirect attempt must fall back to /my-wardrobe
    });
    expect(linkedUpgrade.user.id).toBe(emailUpgrade.user.id);
    expect(linkedUpgrade.user.email).toBe('shopper.one@example.com');
    expect(linkedUpgrade.user.phoneE164).toBe('+919888877777');
    expect(linkedUpgrade.redirectTo).toBe('/my-wardrobe');

    // 6. Expired OTP rejection
    const expiredSessToken = 'wm_expired_otp_session_02';
    await service.requestOtp(expiredSessToken, {
      channel: 'whatsapp',
      phone: '9777766666',
    });
    const expSess = sessionStore.get(expiredSessToken)!;
    expSess['otpExpiresAt'] = new Date(Date.now() - 1_000);
    sessionStore.set(expiredSessToken, expSess);

    await expect(
      service.upgradeSession(expiredSessToken, {
        channel: 'whatsapp',
        phone: '9777766666',
        otpCode: '123456',
      }),
    ).rejects.toThrow(UnauthorizedException);

    // 7. Brute-force lockout after 5 wrong attempts
    const lockSessToken = 'wm_lockout_otp_session_03';
    await service.requestOtp(lockSessToken, {
      channel: 'whatsapp',
      phone: '9666655555',
    });
    for (let i = 0; i < 5; i++) {
      await expect(
        service.upgradeSession(lockSessToken, {
          channel: 'whatsapp',
          phone: '9666655555',
          otpCode: '000000',
        }),
      ).rejects.toThrow(UnauthorizedException);
    }
    // 6th attempt even with right code must be blocked due to lockout
    await expect(
      service.upgradeSession(lockSessToken, {
        channel: 'whatsapp',
        phone: '9666655555',
        otpCode: '123456',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('disables dev OTP preview and requires live provider credentials when NODE_ENV=production', async () => {
    currentNodeEnv = 'production';
    process.env['NODE_ENV'] = 'production';

    const channels = service.getAuthChannels();
    expect(channels.channels.every((c) => c.isLiveConfigured === false)).toBe(true);

    await expect(
      service.requestOtp('wm_prod_session_0001', {
        channel: 'whatsapp',
        phone: '9876543210',
      }),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('enforces strict Customer/Shopkeeper privacy isolation across WardrobeService and StorageController', async () => {
    const customerSession = 'wm_customer_private_sess_01';
    const jobId = '44444444-5555-4666-8777-888888888888';
    const realUserId = '99999999-8888-4777-8666-555555555555';

    mockDb.user.upsert.mockImplementationOnce(
      async ({ create }: { create: Record<string, unknown> }) => {
        const created = {
          id: realUserId,
          phoneE164: null,
          email: null,
          phoneVerifiedAt: null,
          emailVerifiedAt: null,
          basePersonImageKey: null,
          originStoreId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...create,
        };
        userStore.set(realUserId, created);
        return created;
      },
    );

    jobStore.set(jobId, {
      id: jobId,
      status: 'COMPLETED',
      category: ClothingCategory.TSHIRT,
      personImageKey: `jobs/${jobId}/person.jpg`,
      garmentImageKey: `jobs/${jobId}/garment.jpg`,
      resultImageKey: `jobs/${jobId}/result.jpg`,
      personImageMeta: { sessionId: customerSession, mimeType: 'image/jpeg' },
      garmentImageMeta: { sessionId: customerSession, subcategory: 'TSHIRT' },
      savedToWardrobe: false,
      expiresAt: new Date(Date.now() + 7 * 86400_000),
      createdAt: new Date(),
    });

    // Tampered storeName in request is ignored in favor of server-trusted PARTNER_STORE_REGISTRY
    await service.requestOtp(customerSession, {
      channel: 'whatsapp',
      phone: '9876543210',
      storeId: 'store_indiranagar_01',
      storeName: 'MALICIOUS PHISHING BOUTIQUE NAME',
    });

    const upgraded = await service.upgradeSession(customerSession, {
      channel: 'whatsapp',
      phone: '9876543210',
      otpCode: '123456',
      jobId,
      storeId: 'store_indiranagar_01',
      storeName: 'MALICIOUS PHISHING BOUTIQUE NAME',
    });

    const savedJob = jobStore.get(jobId)!;
    // Server resolved the official verified boutique name, NOT the tampered URL parameter
    expect(savedJob['retailerSource']).toBe('Studio Namma Indiranagar');

    // 1. Shopkeeper cannot access customer's /wardrobe even if they somehow pass a token alongside partner headers
    await expect(
      service.getWardrobe(
        `Bearer ${upgraded.authToken}`,
        undefined,
        customerSession,
        undefined,
        'store_indiranagar_01',
        undefined,
      ),
    ).rejects.toThrow(ForbiddenException);

    // 2. Shopkeeper cannot access customer's job images or base portrait via StorageController
    const mockRes = {
      set: jest.fn(),
      send: jest.fn(),
    } as unknown as Response;

    await expect(
      storageController.serveFile(
        jobId,
        'person.jpg',
        mockRes,
        undefined,
        undefined,
        'store_indiranagar_01', // ?storeId= query attempt
        customerSession,
      ),
    ).rejects.toThrow(ForbiddenException);

    await expect(
      storageController.serveFile(
        jobId,
        'result.jpg',
        mockRes,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'store_indiranagar_01', // x-wearme-partner-store-id header
      ),
    ).rejects.toThrow(ForbiddenException);

    await expect(
      storageController.serveUserFile(
        upgraded.user.id,
        'base_portrait.jpg',
        mockRes,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'store_indiranagar_01',
      ),
    ).rejects.toThrow(ForbiddenException);

    // 3. Another customer cannot access this customer's job file or portrait file
    await expect(
      storageController.serveFile(
        jobId,
        'person.jpg',
        mockRes,
        undefined,
        undefined,
        undefined,
        'wm_other_customer_session_99',
      ),
    ).rejects.toThrow(ForbiddenException);

    await expect(
      storageController.serveUserFile(
        upgraded.user.id,
        'base_portrait.jpg',
        mockRes,
        undefined,
        undefined,
        undefined,
        'wm_other_customer_session_99',
      ),
    ).rejects.toThrow(ForbiddenException);

    // 4. Owning customer CAN access their job file and portrait file via Cookie or signed URL
    await storageController.serveFile(
      jobId,
      'result.jpg',
      mockRes,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      `wearme_auth_token_v1=${encodeURIComponent(upgraded.authToken)}`,
    );
    expect(mockRes.send).toHaveBeenCalledTimes(1);

    const signedUrl = appendSignedFileQuery(
      `http://localhost:3001/api/v1/files/users/${upgraded.user.id}/base_portrait.jpg`,
      `users/${upgraded.user.id}/base_portrait.jpg`,
    );
    const parsedSigned = new URL(signedUrl);
    await storageController.serveUserFile(
      upgraded.user.id,
      'base_portrait.jpg',
      mockRes,
      parsedSigned.searchParams.get('exp') ?? undefined,
      parsedSigned.searchParams.get('sig') ?? undefined,
    );
    expect(mockRes.send).toHaveBeenCalledTimes(2);

    // Tampered signature must fail with 403 Forbidden
    await expect(
      storageController.serveUserFile(
        upgraded.user.id,
        'base_portrait.jpg',
        mockRes,
        parsedSigned.searchParams.get('exp') ?? undefined,
        'tampered_sig_value',
      ),
    ).rejects.toThrow(ForbiddenException);

    // 5. Partner store analytics returns ONLY aggregated numbers and zero customer photos/PII
    const analytics = await service.getPartnerStoreAnalytics('store_indiranagar_01');
    expect(analytics.storeId).toBe('store_indiranagar_01');
    expect(analytics.privacyNotice).toContain('strictly isolated and inaccessible to shop partners');
    expect(JSON.stringify(analytics)).not.toContain('+919876543210');
    expect(JSON.stringify(analytics)).not.toContain('person.jpg');
    expect(JSON.stringify(analytics)).not.toContain('base_portrait.jpg');

    // 6. Customer can delete their saved portrait and then delete their entire account
    const delPortrait = await service.deleteUserPortrait(
      `Bearer ${upgraded.authToken}`,
      undefined,
      customerSession,
    );
    expect(delPortrait.deleted).toBe(true);
    expect(mockStorage.delete).toHaveBeenCalledWith(
      `users/${upgraded.user.id}/base_portrait.jpg`,
    );

    const delAccount = await service.deleteUserAccount(
      `Bearer ${upgraded.authToken}`,
      undefined,
      customerSession,
    );
    expect(delAccount.deleted).toBe(true);
    expect(delAccount.deletedJobsCount).toBe(1);
    expect(userStore.has(upgraded.user.id)).toBe(false);
    expect(jobStore.has(jobId)).toBe(false);
  });
});
