import { Controller, Get, Param, Res, NotFoundException, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import type { Response } from 'express';
import { StorageProvider } from './storage.provider';
import * as path from 'path';

/**
 * Serves stored files via HTTP.
 *
 * Pattern: GET /files/:jobId/:filename
 * This endpoint proxies local file reads. For cloud providers (S3/R2),
 * this endpoint would instead redirect to a pre-signed URL.
 *
 * Files are never served with a directory listing — only exact key lookups.
 */
@ApiTags('files')
@Controller('files')
export class StorageController {
  private readonly logger = new Logger(StorageController.name);

  constructor(private readonly storage: StorageProvider) {}

  @Get('jobs/:jobId/:filename')
  @ApiOperation({ summary: 'Serve a stored job file (person, garment, or result image)' })
  @ApiParam({ name: 'jobId', description: 'Job UUID' })
  @ApiParam({ name: 'filename', description: 'File name (e.g. result.jpg)' })
  async serveFile(
    @Param('jobId') jobId: string,
    @Param('filename') filename: string,
    @Res() res: Response,
  ) {
    // Reconstruct storage key — must match the pattern used when uploading
    const key = `jobs/${jobId}/${filename}`;

    const exists = await this.storage.exists(key);
    if (!exists) {
      throw new NotFoundException(`File not found: ${key}`);
    }

    const buffer = await this.storage.download(key);
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
    };
    const mimeType = mimeTypes[ext] ?? 'application/octet-stream';

    res.set({
      'Content-Type': mimeType,
      'Content-Length': buffer.length.toString(),
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    });

    res.send(buffer);
  }
}

