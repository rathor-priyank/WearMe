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
    // Security: prevent directory traversal by resolving and checking prefix
    const resolved = path.resolve(this.basePath, key);
    if (!resolved.startsWith(this.basePath)) {
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

  async exists(key: string): Promise<boolean> {
    const filePath = this.fullPath(key);
    try {
      await fs.access(filePath);
      return true;
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

