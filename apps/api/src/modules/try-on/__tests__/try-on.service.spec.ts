import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import sharp from 'sharp';
import { ClothingCategory, TryOnStatus } from '@wearme/shared';
import { TryOnService } from '../try-on.service';
import { FastApiProvider } from '../../ai/providers/fastapi.provider';
import { MockProvider } from '../../ai/providers/mock.provider';
import { LocalStorageProvider } from '../../storage/providers/local.storage';
import { StorageController } from '../../storage/storage.controller';
import type { DatabaseService } from '../../database/database.service';
import type { StorageProvider } from '../../storage/storage.provider';
import type { VirtualTryOnProvider } from '../../ai/virtual-tryon.provider';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('TryOnService, LocalStorageProvider & FastApiProvider', () => {
  let service: TryOnService;
  let mockDb: {
    tryOnJob: {
      create: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    user: {
      findMany: jest.Mock;
    };
  };
  let mockStorage: jest.Mocked<StorageProvider>;
  let mockAi: jest.Mocked<VirtualTryOnProvider>;
  let validJpegBuffer: Buffer;
  let validPngBuffer: Buffer;
  let enableNecklacePocFlag = false;

  beforeAll(async () => {
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

  beforeEach(() => {
    jest.clearAllMocks();
    enableNecklacePocFlag = false;

    mockDb = {
      tryOnJob: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        delete: jest.fn().mockResolvedValue(undefined),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

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
        inferenceMs: 25,
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
            enableNecklacePoc: enableNecklacePocFlag,
          };
        }
        return {
          provider: 'local',
          localPath: './uploads',
          localBaseUrl: 'http://localhost:3001',
          maxFileSizeMb: 10,
          imageRetentionDays: 7,
        };
      }),
    } as unknown as ConfigService;

    service = new TryOnService(
      mockDb as unknown as DatabaseService,
      mockStorage,
      mockAi,
      mockConfig,
    );
  });

  it('creates a job when given valid JPEG and PNG images', async () => {
    const now = new Date();
    mockDb.tryOnJob.create.mockResolvedValue({
      id: 'job-uuid-1',
      status: 'PENDING',
      category: 'TSHIRT',
      createdAt: now,
    });

    const res = await service.createJob(
      makeMulterFile(validJpegBuffer, 'image/jpeg'),
      makeMulterFile(validPngBuffer, 'image/png'),
      ClothingCategory.TSHIRT,
    );

    expect(res.jobId).toBe('job-uuid-1');
    expect(res.status).toBe(TryOnStatus.PENDING);
    expect(mockStorage.upload).toHaveBeenCalledTimes(2);
    expect(mockDb.tryOnJob.create).toHaveBeenCalledTimes(1);
  });

  it('rejects files whose magic bytes do not match declared MIME type', async () => {
    const fakeJpeg = Buffer.from('not-an-image-at-all-just-plain-text');
    await expect(
      service.createJob(
        makeMulterFile(fakeJpeg, 'image/jpeg'),
        makeMulterFile(validJpegBuffer, 'image/jpeg'),
        ClothingCategory.TSHIRT,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects corrupt images even if JPEG magic bytes are present', async () => {
    const corruptJpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x00, 0x01,
    ]);
    await expect(
      service.createJob(
        makeMulterFile(corruptJpeg, 'image/jpeg'),
        makeMulterFile(validJpegBuffer, 'image/jpeg'),
        ClothingCategory.TSHIRT,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects images smaller than minimum dimensions (64x64px)', async () => {
    const tinyJpeg = await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 3,
        background: { r: 100, g: 100, b: 100 },
      },
    })
      .jpeg()
      .toBuffer();

    await expect(
      service.createJob(
        makeMulterFile(tinyJpeg, 'image/jpeg'),
        makeMulterFile(validJpegBuffer, 'image/jpeg'),
        ClothingCategory.TSHIRT,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('processes a pending job to COMPLETED state', async () => {
    mockDb.tryOnJob.findUnique.mockResolvedValue({
      id: 'job-uuid-1',
      status: 'PENDING',
      category: 'TSHIRT',
      personImageKey: 'jobs/job-uuid-1/person.jpg',
      garmentImageKey: 'jobs/job-uuid-1/garment.jpg',
      personImageMeta: { mimeType: 'image/jpeg' },
      garmentImageMeta: { mimeType: 'image/jpeg', subcategory: 'TSHIRT' },
      createdAt: new Date(),
    });
    mockDb.tryOnJob.update.mockResolvedValue({
      id: 'job-uuid-1',
      status: 'COMPLETED',
      resultImageKey: 'jobs/job-uuid-1/result.jpg',
    });

    const res = await service.processJob('job-uuid-1');
    expect(res.status).toBe(TryOnStatus.COMPLETED);
    expect(res.resultUrl).toBe(
      'http://localhost:3001/api/v1/files/jobs/job-uuid-1/result.jpg',
    );
    expect(mockAi.processJob).toHaveBeenCalledTimes(1);
  });

  it('marks job as FAILED and sanitizes tokens and internal paths when AI provider fails', async () => {
    mockDb.tryOnJob.findUnique.mockResolvedValue({
      id: 'job-fail-1',
      status: 'PENDING',
      category: 'SHIRT',
      personImageKey: 'jobs/job-fail-1/person.jpg',
      garmentImageKey: 'jobs/job-fail-1/garment.jpg',
      personImageMeta: { mimeType: 'image/jpeg' },
      garmentImageMeta: { mimeType: 'image/jpeg' },
      createdAt: new Date(),
    });
    mockAi.processJob.mockRejectedValueOnce(
      new Error(
        'Upstream failure at /Users/admin/secret/model.py with token hf_SecretToken123456 and Bearer supersecretjwt',
      ),
    );

    await expect(service.processJob('job-fail-1')).rejects.toThrow(
      InternalServerErrorException,
    );

    const lastUpdate = mockDb.tryOnJob.update.mock.calls.at(-1)?.[0];
    expect(lastUpdate.data.status).toBe('FAILED');
    expect(lastUpdate.data.errorMessage).not.toContain('hf_SecretToken123456');
    expect(lastUpdate.data.errorMessage).not.toContain('supersecretjwt');
    expect(lastUpdate.data.errorMessage).not.toContain('/Users/admin/secret/model.py');
    expect(lastUpdate.data.errorMessage).toContain('[REDACTED_HF_TOKEN]');
    expect(lastUpdate.data.errorMessage).toContain('[INTERNAL_PATH]');
  });

  it('deletes all stored images, job directory, and database record on deleteJob', async () => {
    mockDb.tryOnJob.findUnique.mockResolvedValue({
      id: 'job-del-1',
      personImageKey: 'jobs/job-del-1/person.jpg',
      garmentImageKey: 'jobs/job-del-1/garment.jpg',
      resultImageKey: 'jobs/job-del-1/result.jpg',
    });

    await service.deleteJob('job-del-1');
    expect(mockStorage.delete).toHaveBeenCalledTimes(3);
    expect(mockStorage.deleteJobDirectory).toHaveBeenCalledWith('job-del-1');
    expect(mockDb.tryOnJob.delete).toHaveBeenCalledWith({
      where: { id: 'job-del-1' },
    });
  });

  it('throws NotFoundException when deleting non-existent job', async () => {
    mockDb.tryOnJob.findUnique.mockResolvedValue(null);
    await expect(service.deleteJob('missing-id')).rejects.toThrow(NotFoundException);
  });

  it('FastApiProvider propagates structured detail error without falling back to mock on HTTP errors', async () => {
    const fallbackMock = new MockProvider();
    const fallbackSpy = jest.spyOn(fallbackMock, 'processJob');

    const provider = new FastApiProvider(
      {
        provider: 'fashn-api',
        serviceUrl: 'http://localhost:8001',
        timeoutMs: 30000,
        enableNecklacePoc: false,
      },
      undefined, // No fallback when fashn-api is configured
    );

    const axiosErr = Object.assign(new Error('Request failed with status code 503'), {
      isAxiosError: true,
      response: {
        status: 503,
        data: {
          detail:
            'Configuration error: AI_API_KEY is required when AI_PROVIDER=fashn-api.',
        },
      },
    });
    mockedAxios.isAxiosError.mockReturnValue(true);
    mockedAxios.post.mockRejectedValueOnce(axiosErr);

    await expect(
      provider.processJob({
        jobId: 'job-fashn-err',
        personImageBuffer: validJpegBuffer,
        garmentImageBuffer: validPngBuffer,
        personMimeType: 'image/jpeg',
        garmentMimeType: 'image/png',
        category: ClothingCategory.SHIRT,
      }),
    ).rejects.toThrow(
      'Configuration error: AI_API_KEY is required when AI_PROVIDER=fashn-api.',
    );

    expect(fallbackSpy).not.toHaveBeenCalled();
  });

  it('gates NECKLACE and PENDANT behind enableNecklacePoc and rejects API/AI config mismatch', async () => {
    // 1. Disabled by default -> BadRequestException
    await expect(
      service.createJob(
        makeMulterFile(validJpegBuffer, 'image/jpeg'),
        makeMulterFile(validPngBuffer, 'image/png'),
        ClothingCategory.ACCESSORY,
        'NECKLACE',
      ),
    ).rejects.toThrow(BadRequestException);

    // 2. Enabled on API, but AI service explicitly reports necklace_poc_enabled=false -> rejected before upload
    enableNecklacePocFlag = true;
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        active_provider: 'mock',
        necklace_poc_enabled: false,
        categories: [],
      },
    });

    await expect(
      service.createJob(
        makeMulterFile(validJpegBuffer, 'image/jpeg'),
        makeMulterFile(validPngBuffer, 'image/png'),
        ClothingCategory.ACCESSORY,
        'NECKLACE',
      ),
    ).rejects.toThrow(BadRequestException);
    expect(mockStorage.upload).not.toHaveBeenCalled();

    // 3. Enabled on both API and AI -> creates ACCESSORY job with subcategory NECKLACE and isExperimentalPoc=true
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        active_provider: 'mock',
        necklace_poc_enabled: true,
        categories: [],
      },
    });
    const now = new Date();
    mockDb.tryOnJob.create.mockResolvedValue({
      id: 'job-neck-1',
      status: 'PENDING',
      category: 'ACCESSORY',
      createdAt: now,
    });

    const neckJob = await service.createJob(
      makeMulterFile(validJpegBuffer, 'image/jpeg'),
      makeMulterFile(validPngBuffer, 'image/png'),
      ClothingCategory.ACCESSORY,
      'NECKLACE',
    );
    expect(neckJob.jobId).toBe('job-neck-1');
    expect(mockDb.tryOnJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          category: 'ACCESSORY',
          garmentImageMeta: expect.objectContaining({
            subcategory: 'NECKLACE',
            domain: 'jewellery',
            isExperimentalPoc: true,
          }),
        }),
      }),
    );

    // 4. EARRINGS and SUNGLASSES remain rejected with BadRequestException even when Necklace PoC is enabled
    await expect(
      service.createJob(
        makeMulterFile(validJpegBuffer, 'image/jpeg'),
        makeMulterFile(validPngBuffer, 'image/png'),
        ClothingCategory.ACCESSORY,
        'EARRINGS',
      ),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.createJob(
        makeMulterFile(validJpegBuffer, 'image/jpeg'),
        makeMulterFile(validPngBuffer, 'image/png'),
        ClothingCategory.ACCESSORY,
        'SUNGLASSES',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('requires both API and AI service to enable Necklace PoC in getCategories()', async () => {
    // Case A: API has flag true, AI has flag false -> necklacePocEnabled must be false
    enableNecklacePocFlag = true;
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        active_provider: 'mock',
        necklace_poc_enabled: false,
        categories: [],
      },
    });
    const mismatchRes = await service.getCategories();
    expect(mismatchRes.necklacePocEnabled).toBe(false);
    expect(
      mismatchRes.categories.find((c) => c.subcategory === 'NECKLACE')
        ?.providerSupportStatus,
    ).toBe('requires_specialized_model');

    // Case B: Offline fallback with local flag true -> 38 items returned
    mockedAxios.get.mockRejectedValueOnce(new Error('offline'));
    const res = await service.getCategories();
    expect(res.necklacePocEnabled).toBe(true);
    expect(res.categories).toHaveLength(38);

    const necklace = res.categories.find((c) => c.subcategory === 'NECKLACE');
    const earrings = res.categories.find((c) => c.subcategory === 'EARRINGS');
    const tshirt = res.categories.find((c) => c.subcategory === 'TSHIRT');

    expect(necklace?.providerSupportStatus).toBe('experimental_poc');
    expect(earrings?.providerSupportStatus).toBe('requires_specialized_model');
    expect(tshirt?.providerSupportStatus).toBe('supported');
  });

  it('enforces session ownership and prevents cross-session access or unscoped job listing', async () => {
    const sessionA = 'session_alice_12345678';
    const sessionB = 'session_bob_87654321';
    const jobOwnedByA = {
      id: '11111111-1111-4111-8111-111111111111',
      status: 'COMPLETED',
      category: 'TSHIRT',
      personImageKey: 'jobs/11111111-1111-4111-8111-111111111111/person.jpg',
      garmentImageKey: 'jobs/11111111-1111-4111-8111-111111111111/garment.jpg',
      resultImageKey: 'jobs/11111111-1111-4111-8111-111111111111/result.jpg',
      personImageMeta: { sessionId: sessionA },
      garmentImageMeta: { subcategory: 'TSHIRT', sessionId: sessionA },
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86400_000),
    };

    mockDb.tryOnJob.findUnique.mockResolvedValue(jobOwnedByA);

    // Session A can read status
    const statusA = await service.getJobStatus(jobOwnedByA.id, sessionA);
    expect(statusA.jobId).toBe(jobOwnedByA.id);

    // Session B or anonymous caller is forbidden from reading, processing, or deleting Session A's job
    await expect(service.getJobStatus(jobOwnedByA.id, sessionB)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.getJobStatus(jobOwnedByA.id, undefined)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.processJob(jobOwnedByA.id, sessionB)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.deleteJob(jobOwnedByA.id, sessionB)).rejects.toThrow(
      ForbiddenException,
    );

    // Unscoped listRecentJobs without ids or sessionId returns empty list (never dumps all users' jobs)
    const unscopedList = await service.listRecentJobs(undefined, undefined);
    expect(unscopedList.jobs).toEqual([]);
    expect(mockDb.tryOnJob.findMany).not.toHaveBeenCalled();

    // Scoped listRecentJobs filters out jobs belonging to other sessions
    mockDb.tryOnJob.findMany.mockResolvedValue([jobOwnedByA]);
    const bobList = await service.listRecentJobs(jobOwnedByA.id, sessionB);
    expect(bobList.jobs).toEqual([]);

    const aliceList = await service.listRecentJobs(jobOwnedByA.id, sessionA);
    expect(aliceList.jobs).toHaveLength(1);
    expect(aliceList.jobs[0]?.jobId).toBe(jobOwnedByA.id);
  });

  it('purges expired jobs on access and marks COMPLETED jobs as FAILED if result file is missing on disk', async () => {
    const expiredJob = {
      id: '22222222-2222-4222-8222-222222222222',
      status: 'COMPLETED',
      category: 'TSHIRT',
      personImageKey: 'jobs/22222222-2222-4222-8222-222222222222/person.jpg',
      garmentImageKey: 'jobs/22222222-2222-4222-8222-222222222222/garment.jpg',
      resultImageKey: 'jobs/22222222-2222-4222-8222-222222222222/result.jpg',
      createdAt: new Date(Date.now() - 10 * 86400_000),
      expiresAt: new Date(Date.now() - 1000),
    };

    mockDb.tryOnJob.findUnique.mockResolvedValueOnce(expiredJob);
    await expect(service.getJobStatus(expiredJob.id)).rejects.toThrow(NotFoundException);
    expect(mockStorage.deleteJobDirectory).toHaveBeenCalledWith(expiredJob.id);
    expect(mockDb.tryOnJob.delete).toHaveBeenCalledWith({ where: { id: expiredJob.id } });

    // Non-expired COMPLETED job whose result file was deleted from disk must report FAILED, not COMPLETED
    const missingResultJob = {
      ...expiredJob,
      id: '33333333-3333-4333-8333-333333333333',
      expiresAt: new Date(Date.now() + 86400_000),
    };
    mockDb.tryOnJob.findUnique.mockResolvedValueOnce(missingResultJob);
    mockStorage.exists.mockImplementation(async (key: string) => !key.endsWith('result.jpg'));

    const status = await service.getJobStatus(missingResultJob.id);
    expect(status.status).toBe(TryOnStatus.FAILED);
    expect(status.resultUrl).toBeUndefined();
    expect(status.errorMessage).toContain('no longer available in storage');
  });

  it('cleans up expired database jobs and orphaned storage directories in cleanupExpiredAndOrphanedJobs() while protecting User-referenced files and supporting dryRun', async () => {
    const expiredJob = {
      id: '44444444-4444-4444-8444-444444444444',
      personImageKey: 'jobs/44444444-4444-4444-8444-444444444444/person.jpg',
      garmentImageKey: 'jobs/44444444-4444-4444-8444-444444444444/garment.jpg',
      resultImageKey: 'jobs/44444444-4444-4444-8444-444444444444/result.jpg',
      savedToWardrobe: false,
    };
    const protectedJob = {
      id: '77777777-7777-4777-8777-777777777777',
      personImageKey: 'jobs/77777777-7777-4777-8777-777777777777/person.jpg',
      garmentImageKey: 'jobs/77777777-7777-4777-8777-777777777777/garment.jpg',
      resultImageKey: 'jobs/77777777-7777-4777-8777-777777777777/result.jpg',
      savedToWardrobe: false,
    };
    mockDb.user.findMany.mockResolvedValueOnce([
      { basePersonImageKey: 'jobs/77777777-7777-4777-8777-777777777777/person.jpg' },
    ]);
    mockDb.tryOnJob.findMany.mockResolvedValueOnce([expiredJob, protectedJob]);
    mockStorage.listJobDirectories.mockResolvedValueOnce([
      { jobId: '55555555-5555-4555-8555-555555555555', mtimeMs: Date.now() - 3600_000 },
      { jobId: '77777777-7777-4777-8777-777777777777', mtimeMs: Date.now() - 3600_000 },
    ]);
    mockDb.tryOnJob.findUnique.mockResolvedValueOnce(null);

    const summary = await service.cleanupExpiredAndOrphanedJobs({ orphanGraceMs: 0 });
    expect(summary.dryRun).toBe(false);
    expect(summary.expiredJobsDeleted).toBe(1);
    expect(summary.orphanDirsDeleted).toBe(1);
    expect(summary.deletedJobIds).toEqual([expiredJob.id]);
    expect(summary.deletedOrphanDirs).toEqual(['55555555-5555-4555-8555-555555555555']);
    expect(summary.protectedUserJobDirsSkipped).toEqual([
      '77777777-7777-4777-8777-777777777777',
    ]);
    expect(mockStorage.deleteJobDirectory).toHaveBeenCalledWith(expiredJob.id);
    expect(mockStorage.deleteJobDirectory).toHaveBeenCalledWith(
      '55555555-5555-4555-8555-555555555555',
    );
    expect(mockStorage.deleteJobDirectory).not.toHaveBeenCalledWith(
      '77777777-7777-4777-8777-777777777777',
    );

    // Dry-run mode reports candidates without mutating storage or DB
    mockStorage.deleteJobDirectory.mockClear();
    mockDb.tryOnJob.delete.mockClear();
    mockDb.user.findMany.mockResolvedValueOnce([]);
    mockDb.tryOnJob.findMany.mockResolvedValueOnce([expiredJob]);
    mockStorage.listJobDirectories.mockResolvedValueOnce([]);

    const drySummary = await service.cleanupExpiredAndOrphanedJobs({
      orphanGraceMs: 0,
      dryRun: true,
    });
    expect(drySummary.dryRun).toBe(true);
    expect(drySummary.expiredJobsDeleted).toBe(1);
    expect(mockStorage.deleteJobDirectory).not.toHaveBeenCalled();
    expect(mockDb.tryOnJob.delete).not.toHaveBeenCalled();
  });

  it('LocalStorageProvider blocks sibling-prefix path traversal, copies user base portraits, and physically removes job directories', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wearme-storage-test-'));
    const uploadsDir = path.join(tmpRoot, 'uploads');
    const localConfig = {
      get: jest.fn().mockReturnValue({
        provider: 'local',
        localPath: uploadsDir,
        localBaseUrl: 'http://localhost:3001',
        maxFileSizeMb: 10,
        imageRetentionDays: 7,
      }),
    } as unknown as ConfigService;

    const localProvider = new LocalStorageProvider(localConfig);

    // Sibling directory prefix bypass attempt (`../uploads-evil/secret.jpg`) must throw
    await expect(
      localProvider.upload('../uploads-evil/secret.jpg', validJpegBuffer, 'image/jpeg'),
    ).rejects.toThrow(/path traversal/i);

    await expect(localProvider.exists('../../etc/passwd')).rejects.toThrow(/path traversal/i);

    // Valid upload creates directory and file, copy decouples to users/<userId>/base_portrait.jpg, deleteJobDirectory removes physical job folder without affecting user portrait
    const validJobId = '66666666-6666-4666-8666-666666666666';
    const validUserId = '88888888-8888-4888-8888-888888888888';
    const key = `jobs/${validJobId}/person.jpg`;
    const userPortraitKey = `users/${validUserId}/base_portrait.jpg`;
    await localProvider.upload(key, validJpegBuffer, 'image/jpeg');
    expect(await localProvider.exists(key)).toBe(true);

    await localProvider.copy(key, userPortraitKey, 'image/jpeg');
    expect(await localProvider.exists(userPortraitKey)).toBe(true);

    const dirsBefore = await localProvider.listJobDirectories();
    expect(dirsBefore.map((d) => d.jobId)).toContain(validJobId);

    await localProvider.deleteJobDirectory(validJobId);
    expect(await localProvider.exists(key)).toBe(false);
    // Decoupled user portrait remains intact after job directory deletion!
    expect(await localProvider.exists(userPortraitKey)).toBe(true);
    const dirsAfter = await localProvider.listJobDirectories();
    expect(dirsAfter.map((d) => d.jobId)).not.toContain(validJobId);

    // StorageController rejects invalid jobId/userId or filename traversal attempts
    const storageController = new StorageController(localProvider);
    const dummyRes = { set: jest.fn(), send: jest.fn() } as unknown as import('express').Response;
    await expect(
      storageController.serveFile('not-a-uuid', 'result.jpg', dummyRes),
    ).rejects.toThrow(BadRequestException);
    await expect(
      storageController.serveFile(validJobId, '../secret.jpg', dummyRes),
    ).rejects.toThrow(BadRequestException);
    await expect(
      storageController.serveFile(validJobId, 'arbitrary.exe', dummyRes),
    ).rejects.toThrow(BadRequestException);
    await expect(
      storageController.serveUserFile('not-a-uuid', 'base_portrait.jpg', dummyRes),
    ).rejects.toThrow(BadRequestException);
    await expect(
      storageController.serveUserFile(validUserId, 'person.jpg', dummyRes),
    ).rejects.toThrow(BadRequestException);

    await storageController.serveUserFile(validUserId, 'base_portrait.jpg', dummyRes);
    expect(dummyRes.send).toHaveBeenCalled();

    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('atomically reserves quota BEFORE AI inference so two simultaneous requests cannot consume the last credit twice', async () => {
    const storeId = 'store_indiranagar_01';
    await service.setQuotaBalance(storeId, 1);

    const jobA = {
      id: 'aaaa1111-1111-4111-8111-111111111111',
      status: 'PENDING',
      category: 'TSHIRT',
      storeId,
      personImageKey: 'jobs/aaaa1111-1111-4111-8111-111111111111/person.jpg',
      garmentImageKey: 'jobs/aaaa1111-1111-4111-8111-111111111111/garment.jpg',
      personImageMeta: { mimeType: 'image/jpeg' },
      garmentImageMeta: { mimeType: 'image/jpeg', subcategory: 'TSHIRT', storeId },
      createdAt: new Date(),
    };
    const jobB = {
      id: 'bbbb2222-2222-4222-8222-222222222222',
      status: 'PENDING',
      category: 'TSHIRT',
      storeId,
      personImageKey: 'jobs/bbbb2222-2222-4222-8222-222222222222/person.jpg',
      garmentImageKey: 'jobs/bbbb2222-2222-4222-8222-222222222222/garment.jpg',
      personImageMeta: { mimeType: 'image/jpeg' },
      garmentImageMeta: { mimeType: 'image/jpeg', subcategory: 'TSHIRT', storeId },
      createdAt: new Date(),
    };

    mockDb.tryOnJob.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      if (where.id === jobA.id) return jobA;
      if (where.id === jobB.id) return jobB;
      return null;
    });
    mockDb.tryOnJob.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
      id: where.id,
      ...data,
    }));

    // Simulate slow AI inference (50ms) so both requests overlap in time
    mockAi.processJob.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return {
        resultImageBuffer: validJpegBuffer,
        resultMimeType: 'image/jpeg',
        provider: 'mock',
        inferenceMs: 50,
      };
    });

    // Fire both requests concurrently against the single remaining credit
    const results = await Promise.allSettled([
      service.processJob(jobA.id),
      service.processJob(jobB.id),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason?.message).toMatch(/credit quota exhausted/i);

    // Crucial invariant: AI provider was invoked ONLY ONCE, never twice
    expect(mockAi.processJob).toHaveBeenCalledTimes(1);

    const finalQuota = await service.getQuotaBalance(storeId);
    expect(finalQuota.creditBalance).toBe(0);
    expect(finalQuota.totalCreditsUsed).toBe(1);
  });

  it('refunds the reserved quota credit when AI inference fails and enforces DB conditional updateMany', async () => {
    const storeId = 'store_koramangala_02';
    await service.setQuotaBalance(storeId, 1);

    const jobFail = {
      id: 'cccc3333-3333-4333-8333-333333333333',
      status: 'PENDING',
      category: 'SHIRT',
      storeId,
      personImageKey: 'jobs/cccc3333-3333-4333-8333-333333333333/person.jpg',
      garmentImageKey: 'jobs/cccc3333-3333-4333-8333-333333333333/garment.jpg',
      personImageMeta: { mimeType: 'image/jpeg' },
      garmentImageMeta: { mimeType: 'image/jpeg', subcategory: 'SHIRT', storeId },
      createdAt: new Date(),
    };

    mockDb.tryOnJob.findUnique.mockResolvedValue(jobFail);
    mockDb.tryOnJob.update.mockResolvedValue({ ...jobFail, status: 'FAILED' });
    mockAi.processJob.mockRejectedValueOnce(new Error('Upstream GPU timeout'));

    await expect(service.processJob(jobFail.id)).rejects.toThrow(
      InternalServerErrorException,
    );

    // Reserved credit must be refunded back to 1 after AI failure
    const refundedQuota = await service.getQuotaBalance(storeId);
    expect(refundedQuota.creditBalance).toBe(1);
    expect(refundedQuota.totalCreditsUsed).toBe(0);

    // Also verify DB-level PartnerStore.updateMany atomic conditional rejection (count: 0)
    // Simulate two multi-worker instances where local memory has credits, but shared PostgreSQL
    // PartnerStore row only has 1 credit left (`WHERE storeId = $1 AND creditBalance >= 1`).
    await service.setQuotaBalance(storeId, 10);
    let pgStoreRowCredits = 1;
    (mockDb as Record<string, unknown>)['partnerStore'] = {
      updateMany: jest.fn().mockImplementation(async () => {
        if (pgStoreRowCredits >= 1) {
          pgStoreRowCredits -= 1;
          return { count: 1 };
        }
        return { count: 0 };
      }),
      findUnique: jest.fn().mockImplementation(async () => ({
        creditBalance: pgStoreRowCredits,
        totalCreditsUsed: 1 - pgStoreRowCredits,
      })),
    };

    const pgJob1 = { ...jobFail, id: 'eeee5555-5555-4555-8555-555555555551' };
    const pgJob2 = { ...jobFail, id: 'eeee5555-5555-4555-8555-555555555552' };
    mockDb.tryOnJob.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === pgJob1.id ? pgJob1 : pgJob2,
    );
    mockDb.tryOnJob.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
      id: where.id,
      ...data,
    }));
    mockAi.processJob.mockClear();
    mockAi.processJob.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return {
        resultImageBuffer: validJpegBuffer,
        resultMimeType: 'image/jpeg',
        provider: 'mock',
        inferenceMs: 30,
      };
    });

    const pgConcurrentResults = await Promise.allSettled([
      service.processJob(pgJob1.id),
      service.processJob(pgJob2.id),
    ]);

    expect(pgConcurrentResults.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(pgConcurrentResults.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(mockAi.processJob).toHaveBeenCalledTimes(1);
    expect(pgStoreRowCredits).toBe(0);
  });

  it('prevents duplicate AI inference when two concurrent requests call processJob on the same PENDING jobId', async () => {
    const storeId = 'store_jayanagar_03';
    await service.setQuotaBalance(storeId, 5);

    const sameJob = {
      id: 'dddd4444-4444-4444-8444-444444444444',
      status: 'PENDING',
      category: 'TSHIRT',
      storeId,
      personImageKey: 'jobs/dddd4444-4444-4444-8444-444444444444/person.jpg',
      garmentImageKey: 'jobs/dddd4444-4444-4444-8444-444444444444/garment.jpg',
      personImageMeta: { mimeType: 'image/jpeg' },
      garmentImageMeta: { mimeType: 'image/jpeg', subcategory: 'TSHIRT', storeId },
      createdAt: new Date(),
    };

    mockDb.tryOnJob.findUnique.mockResolvedValue(sameJob);
    mockDb.tryOnJob.update.mockResolvedValue({
      ...sameJob,
      status: 'COMPLETED',
      resultImageKey: 'jobs/dddd4444-4444-4444-8444-444444444444/result.jpg',
    });

    mockAi.processJob.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return {
        resultImageBuffer: validJpegBuffer,
        resultMimeType: 'image/jpeg',
        provider: 'mock',
        inferenceMs: 40,
      };
    });

    const [res1, res2] = await Promise.all([
      service.processJob(sameJob.id),
      service.processJob(sameJob.id),
    ]);

    expect([res1.status, res2.status]).toContain(TryOnStatus.COMPLETED);
    expect(mockAi.processJob).toHaveBeenCalledTimes(1);

    const quotaAfter = await service.getQuotaBalance(storeId);
    expect(quotaAfter.creditBalance).toBe(4);
    expect(quotaAfter.totalCreditsUsed).toBe(1);
  });
});
