import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { StorageConfig } from '../../../config/configuration';
import { StorageProvider } from '../storage.provider';

/**
 * Local filesystem storage provider.
 *
 * Stores files under a configurable base directory.
 * URLs are served by a NestJS static file endpoint.
 *
 * This provider is only for local development and testing.
 * It is NOT suitable for production multi-instance deployment.
 */
@Injectable()
export class LocalStorageProvider extends StorageProvider {
  private readonly logger = new Logger(LocalStorageProvider.name);
  private readonly basePath: string;
  private readonly baseUrl: string;

  constructor(configService: ConfigService) {
    super();
    const config = configService.get<StorageConfig>('storage')!;
    // Resolve relative paths relative to the process cwd (project root in dev)
    this.basePath = path.resolve(process.cwd(), config.localPath);
    this.baseUrl = config.localBaseUrl.replace(/\/$/, '');
    this.logger.log(`Local storage initialised at: ${this.basePath}`);
  }

  private fullPath(key: string): string {
    const trimmed = key.trim();
    if (!trimmed || trimmed.includes('\0')) {
      throw new Error(`Invalid storage key — path traversal detected: ${key}`);
    }
    // Security: prevent directory traversal by resolving and checking exact directory boundary
    const resolved = path.resolve(this.basePath, trimmed);
    const baseWithSep = this.basePath.endsWith(path.sep)
      ? this.basePath
      : `${this.basePath}${path.sep}`;
    if (!resolved.startsWith(baseWithSep)) {
      throw new Error(`Invalid storage key — path traversal detected: ${key}`);
    }
    return resolved;
  }

  async upload(key: string, buffer: Buffer, _mimeType: string): Promise<void> {
    const filePath = this.fullPath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);
    this.logger.debug(`Stored: ${key} (${buffer.length} bytes)`);
  }

  async download(key: string): Promise<Buffer> {
    const filePath = this.fullPath(key);
    return fs.readFile(filePath);
  }

  override async copy(
    sourceKey: string,
    destinationKey: string,
    _mimeType = 'image/jpeg',
  ): Promise<void> {
    const srcPath = this.fullPath(sourceKey);
    const destPath = this.fullPath(destinationKey);
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    await fs.copyFile(srcPath, destPath);
    this.logger.debug(`Copied: ${sourceKey} -> ${destinationKey}`);
  }

  async getUrl(key: string, _expiresInSeconds?: number): Promise<string> {
    // Serve via /api/v1/files/* endpoint in NestJS; key is used as-is in the URL path
    return `${this.baseUrl}/api/v1/files/${key}`;
  }

  async delete(key: string): Promise<void> {
    const filePath = this.fullPath(key);
    try {
      await fs.unlink(filePath);
      this.logger.debug(`Deleted: ${key}`);
    } catch (err: unknown) {
      // Ignore "file not found" errors — idempotent delete
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }
  }

  override async deleteJobDirectory(jobId: string): Promise<void> {
    const cleanId = jobId.trim();
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(cleanId)) {
      throw new Error(`Invalid jobId for directory deletion: ${jobId}`);
    }
    const dirPath = this.fullPath(`jobs/${cleanId}`);
    await fs.rm(dirPath, { recursive: true, force: true });
    this.logger.debug(`Deleted job directory: jobs/${cleanId}`);
  }

  override async listJobDirectories(): Promise<Array<{ jobId: string; mtimeMs: number }>> {
    const jobsRoot = path.join(this.basePath, 'jobs');
    try {
      const entries = await fs.readdir(jobsRoot, { withFileTypes: true });
      const results: Array<{ jobId: string; mtimeMs: number }> = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(entry.name)) continue;
        try {
          const stat = await fs.stat(path.join(jobsRoot, entry.name));
          results.push({ jobId: entry.name, mtimeMs: stat.mtimeMs });
        } catch {
          // Directory may have been removed concurrently
        }
      }
      return results;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    const filePath = this.fullPath(key);
    try {
      const stat = await fs.stat(filePath);
      return stat.isFile() && stat.size > 0;
    } catch {
      return false;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await fs.mkdir(this.basePath, { recursive: true });
      return true;
    } catch {
      return false;
    }
  }
}
