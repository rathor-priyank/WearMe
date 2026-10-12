import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ClothingCategory, TryOnStatus } from '@wearme/shared';
import { DatabaseService } from '../../database/database.service';
import { StorageProvider } from '../../storage/storage.provider';
import { TryOnService } from '../../try-on/try-on.service';
import { WardrobeService } from '../wardrobe.service';

describe('WardrobeService — Network Effect Flywheel (B2B2C -> B2C Upgrade)', () => {
  let service: WardrobeService;
  let tmpTraceDir: string;
  let traceLogPath: string;

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
                id: 'sess-uuid-1',
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
    },
    user: {
      findUnique: jest.fn(async ({ where }: { where: { phoneE164?: string; id?: string } }) => {
        if (where.phoneE164) {
          return userStore.get(where.phoneE164) ?? null;
        }
        if (where.id) {
          return Array.from(userStore.values()).find((u) => u['id'] === where.id) ?? null;
        }
        return null;
      }),
      upsert: jest.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { phoneE164: string };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const existing = userStore.get(where.phoneE164);
          const merged = existing
            ? { ...existing, ...update, updatedAt: new Date() }
            : {
                id: 'user-uuid-1',
                createdAt: new Date(),
                updatedAt: new Date(),
                ...create,
              };
          userStore.set(where.phoneE164, merged);
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
          for (const [phone, user] of userStore.entries()) {
            if (user['id'] === where.id) {
              const updated = { ...user, ...data, updatedAt: new Date() };
              userStore.set(phone, updated);
              return updated;
            }
          }
          return null;
        },
      ),
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
      if (key === 'app.nodeEnv') return 'development';
      return undefined;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
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
  });

  afterEach(async () => {
    delete process.env['SESSION_UPGRADE_TRACE_LOG_PATH'];
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
});
