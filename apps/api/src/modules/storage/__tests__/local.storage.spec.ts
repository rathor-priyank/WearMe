import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { LocalStorageProvider } from '../providers/local.storage';

describe('LocalStorageProvider', () => {
  let provider: LocalStorageProvider;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wearme-storage-test-'));
    const mockConfigService = {
      get: jest.fn().mockReturnValue({
        provider: 'local',
        localPath: tempDir,
        localBaseUrl: 'http://localhost:3001',
        maxFileSizeMb: 10,
        imageRetentionDays: 7,
      }),
    } as unknown as ConfigService;

    provider = new LocalStorageProvider(mockConfigService);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('uploads, checks existence, downloads, and deletes a file', async () => {
    const key = 'jobs/test-job/person.jpg';
    const content = Buffer.from('fake-jpeg-bytes');

    expect(await provider.exists(key)).toBe(false);

    await provider.upload(key, content, 'image/jpeg');
    expect(await provider.exists(key)).toBe(true);

    const downloaded = await provider.download(key);
    expect(downloaded.equals(content)).toBe(true);

    const url = await provider.getUrl(key);
    expect(url).toBe('http://localhost:3001/api/v1/files/jobs/test-job/person.jpg');

    await provider.delete(key);
    expect(await provider.exists(key)).toBe(false);
  });

  it('rejects path traversal keys', async () => {
    await expect(
      provider.upload('../../etc/passwd', Buffer.from('bad'), 'text/plain'),
    ).rejects.toThrow(/path traversal detected/);
  });
});
