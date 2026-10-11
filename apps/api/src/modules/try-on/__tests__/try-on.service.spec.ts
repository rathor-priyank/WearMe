import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import sharp from 'sharp';
import { ClothingCategory, TryOnStatus } from '@wearme/shared';
import { TryOnService } from '../try-on.service';
import { FastApiProvider } from '../../ai/providers/fastapi.provider';
import { MockProvider } from '../../ai/providers/mock.provider';
import type { DatabaseService } from '../../database/database.service';
import type { StorageProvider } from '../../storage/storage.provider';
import type { VirtualTryOnProvider } from '../../ai/virtual-tryon.provider';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('TryOnService & FastApiProvider', () => {
  let service: TryOnService;
  let mockDb: {
    tryOnJob: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };
  let mockStorage: jest.Mocked<StorageProvider>;
  let mockAi: jest.Mocked<VirtualTryOnProvider>;
  let validJpegBuffer: Buffer;
  let validPngBuffer: Buffer;

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

    mockDb = {
      tryOnJob: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    mockStorage = {
      upload: jest.fn().mockResolvedValue(undefined),
      download: jest.fn().mockResolvedValue(validJpegBuffer),
      getUrl: jest
        .fn()
        .mockImplementation(
          async (key: string) => `http://localhost:3001/api/v1/files/${key}`,
        ),
      delete: jest.fn().mockResolvedValue(undefined),
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
      get: jest.fn().mockReturnValue({
        provider: 'local',
        localPath: './uploads',
        localBaseUrl: 'http://localhost:3001',
        maxFileSizeMb: 10,
        imageRetentionDays: 7,
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
      garmentImageMeta: { mimeType: 'image/jpeg' },
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

  it('marks job as FAILED and stores user-safe errorMessage when AI provider fails', async () => {
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
      new Error('Configuration error: AI_API_KEY is required when AI_PROVIDER=fashn-api.'),
    );

    await expect(service.processJob('job-fail-1')).rejects.toThrow(
      InternalServerErrorException,
    );

    expect(mockDb.tryOnJob.update).toHaveBeenLastCalledWith({
      where: { id: 'job-fail-1' },
      data: {
        status: 'FAILED',
        errorMessage:
          'Configuration error: AI_API_KEY is required when AI_PROVIDER=fashn-api.',
      },
    });
  });

  it('deletes all stored images and database record on deleteJob', async () => {
    mockDb.tryOnJob.findUnique.mockResolvedValue({
      id: 'job-del-1',
      personImageKey: 'jobs/job-del-1/person.jpg',
      garmentImageKey: 'jobs/job-del-1/garment.jpg',
      resultImageKey: 'jobs/job-del-1/result.jpg',
    });

    await service.deleteJob('job-del-1');
    expect(mockStorage.delete).toHaveBeenCalledTimes(3);
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
});
