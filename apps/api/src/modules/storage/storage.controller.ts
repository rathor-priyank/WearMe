import {
  Controller,
  Get,
  Param,
  Res,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import type { Response } from 'express';
import { StorageProvider } from './storage.provider';
import * as path from 'path';

const SAFE_UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_JOB_FILENAME_REGEX = /^(person|garment|result)\.(jpg|jpeg|png|webp)$/i;
const SAFE_USER_FILENAME_REGEX = /^base_portrait\.(jpg|jpeg|png|webp)$/i;

/**
 * Serves stored files via HTTP.
 *
 * Patterns:
 * - GET /files/jobs/:jobId/:filename
 * - GET /files/users/:userId/:filename
 *
 * Files are never served with a directory listing — only exact validated key lookups.
 */
@ApiTags('files')
@Controller('files')
export class StorageController {
  private readonly logger = new Logger(StorageController.name);

  constructor(private readonly storage: StorageProvider) {}

  private async streamKeyToResponse(
    key: string,
    filename: string,
    res: Response,
  ): Promise<void> {
    const exists = await this.storage.exists(key);
    if (!exists) {
      throw new NotFoundException('Requested file not found.');
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

  @Get('jobs/:jobId/:filename')
  @ApiOperation({ summary: 'Serve a stored job file (person, garment, or result image)' })
  @ApiParam({ name: 'jobId', description: 'Job UUID' })
  @ApiParam({ name: 'filename', description: 'File name (e.g. result.jpg)' })
  async serveFile(
    @Param('jobId') jobId: string,
    @Param('filename') filename: string,
    @Res() res: Response,
  ) {
    if (!SAFE_UUID_REGEX.test(jobId)) {
      throw new BadRequestException('Invalid job ID format.');
    }
    if (!SAFE_JOB_FILENAME_REGEX.test(filename)) {
      throw new BadRequestException('Invalid or disallowed file name.');
    }

    const key = `jobs/${jobId}/${filename}`;
    await this.streamKeyToResponse(key, filename, res);
  }

  @Get('users/:userId/:filename')
  @ApiOperation({
    summary: 'Serve a decoupled persistent user base portrait (users/:userId/base_portrait.<ext>)',
  })
  @ApiParam({ name: 'userId', description: 'User UUID' })
  @ApiParam({ name: 'filename', description: 'File name (e.g. base_portrait.jpg)' })
  async serveUserFile(
    @Param('userId') userId: string,
    @Param('filename') filename: string,
    @Res() res: Response,
  ) {
    if (!SAFE_UUID_REGEX.test(userId)) {
      throw new BadRequestException('Invalid user ID format.');
    }
    if (!SAFE_USER_FILENAME_REGEX.test(filename)) {
      throw new BadRequestException('Invalid or disallowed user file name.');
    }

    const key = `users/${userId}/${filename}`;
    await this.streamKeyToResponse(key, filename, res);
  }
}
