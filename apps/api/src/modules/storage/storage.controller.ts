import {
  Controller,
  Get,
  Headers,
  Optional,
  Param,
  Query,
  Res,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import type { Response } from 'express';
import * as path from 'path';
import { DatabaseService } from '../database/database.service';
import { StorageProvider } from './storage.provider';
import {
  extractAuthTokenFromCookieHeader,
  extractSessionIdFromCookieHeader,
  verifyCustomerAuthToken,
  verifySignedFileQuery,
} from './file-token.util';

const SAFE_UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_JOB_FILENAME_REGEX = /^(person|garment|result)\.(jpg|jpeg|png|webp)$/i;
const SAFE_USER_FILENAME_REGEX = /^base_portrait\.(jpg|jpeg|png|webp)$/i;
const SAFE_SESSION_ID_REGEX = /^[a-zA-Z0-9_-]{8,128}$/;

export interface FileAccessAuthContext {
  exp?: string;
  sig?: string;
  sessionId?: string;
  authorization?: string;
  authToken?: string;
  cookieHeader?: string;
  partnerStoreId?: string;
  partnerKey?: string;
  storeIdQuery?: string;
}

/**
 * Serves stored files via HTTP with server-side ownership & signed-URL enforcement.
 *
 * Patterns:
 * - GET /files/jobs/:jobId/:filename
 * - GET /files/users/:userId/:filename
 *
 * Security Guarantees:
 * - Shopkeepers (`x-wearme-partner-store-id`, `x-wearme-partner-key`, or `?storeId=`)
 *   are strictly forbidden from retrieving customer portraits or generated try-on images.
 * - Files are never served with a directory listing — only exact validated key lookups.
 */
@ApiTags('files')
@Controller('files')
export class StorageController {
  private readonly logger = new Logger(StorageController.name);

  constructor(
    private readonly storage: StorageProvider,
    @Optional() private readonly db?: DatabaseService,
  ) {}

  private assertNotShopkeeperRequest(ctx?: FileAccessAuthContext): void {
    if (!ctx) return;
    if (ctx.partnerStoreId || ctx.partnerKey || ctx.storeIdQuery) {
      throw new ForbiddenException(
        'Shopkeepers and store QR parameters are not permitted to access private customer photos or generated try-on assets.',
      );
    }
  }

  private resolveCallerIdentity(ctx?: FileAccessAuthContext): {
    userId?: string;
    sessionId?: string;
  } {
    if (!ctx) return {};
    const rawToken =
      ctx.authToken ??
      ctx.authorization ??
      extractAuthTokenFromCookieHeader(ctx.cookieHeader);
    const verified = verifyCustomerAuthToken(rawToken);
    const cookieSessionId = extractSessionIdFromCookieHeader(ctx.cookieHeader);
    const candidateSession = ctx.sessionId ?? cookieSessionId;
    const sessionId =
      candidateSession && SAFE_SESSION_ID_REGEX.test(candidateSession.trim())
        ? candidateSession.trim()
        : verified?.sessionToken;
    return {
      userId: verified?.sub,
      sessionId,
    };
  }

  private async authorizeJobFileAccess(
    jobId: string,
    key: string,
    ctx?: FileAccessAuthContext,
  ): Promise<void> {
    this.assertNotShopkeeperRequest(ctx);

    const hasSignedQuery = ctx?.exp !== undefined || ctx?.sig !== undefined;
    if (hasSignedQuery) {
      if (!verifySignedFileQuery(key, ctx.exp, ctx.sig)) {
        throw new ForbiddenException('Invalid or expired signed file URL.');
      }
    }

    if (!this.db) {
      return;
    }

    const job = await this.db.tryOnJob.findUnique({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException('Requested file not found.');
    }
    if (job.expiresAt && new Date(job.expiresAt).getTime() <= Date.now()) {
      throw new NotFoundException('Requested file not found.');
    }

    const caller = this.resolveCallerIdentity(ctx);

    if (hasSignedQuery) {
      if (job.userId && caller.userId && caller.userId !== job.userId) {
        throw new ForbiddenException(
          'You are not authorized to access this private try-on asset.',
        );
      }
      return;
    }

    const garmentMeta = (job.garmentImageMeta ?? {}) as Record<string, unknown>;
    const personMeta = (job.personImageMeta ?? {}) as Record<string, unknown>;
    const ownerSessionId =
      typeof garmentMeta['sessionId'] === 'string'
        ? garmentMeta['sessionId']
        : typeof personMeta['sessionId'] === 'string'
          ? personMeta['sessionId']
          : undefined;

    if (job.userId) {
      if (caller.userId && caller.userId === job.userId) {
        return;
      }
      if (caller.userId && caller.userId !== job.userId) {
        throw new ForbiddenException(
          'You are not authorized to access this private try-on asset.',
        );
      }
      if (caller.sessionId && (this.db as unknown as Record<string, unknown>)['tryOnSession']) {
        const session = await this.db.tryOnSession.findUnique({
          where: { sessionToken: caller.sessionId },
        });
        if (session?.status === 'UPGRADED' && session.userId === job.userId) {
          return;
        }
        throw new ForbiddenException(
          'You are not authorized to access this private try-on asset.',
        );
      }
      if (ownerSessionId && caller.sessionId === ownerSessionId) {
        return;
      }
      throw new ForbiddenException(
        'You are not authorized to access this private try-on asset.',
      );
    }

    if (ownerSessionId && caller.sessionId === ownerSessionId) {
      return;
    }
    if (!job.userId && !ownerSessionId) {
      return;
    }

    throw new ForbiddenException(
      'You are not authorized to access this private try-on asset.',
    );
  }

  private async authorizeUserPortraitAccess(
    userId: string,
    key: string,
    ctx?: FileAccessAuthContext,
  ): Promise<void> {
    this.assertNotShopkeeperRequest(ctx);

    const hasSignedQuery = ctx?.exp !== undefined || ctx?.sig !== undefined;
    if (hasSignedQuery) {
      if (!verifySignedFileQuery(key, ctx.exp, ctx.sig)) {
        throw new ForbiddenException('Invalid or expired signed portrait URL.');
      }
    }

    if (!this.db) {
      return;
    }

    const userRepo = (this.db as unknown as Record<string, { findUnique?: (args: unknown) => Promise<{ id: string; basePersonImageKey?: string | null } | null> }>)['user'];
    if (userRepo?.findUnique) {
      const userRecord = await userRepo.findUnique({ where: { id: userId } });
      if (!userRecord || (userRecord.basePersonImageKey && userRecord.basePersonImageKey !== key) || !userRecord.basePersonImageKey) {
        throw new NotFoundException('Requested file not found.');
      }
    }

    const caller = this.resolveCallerIdentity(ctx);
    if (hasSignedQuery) {
      if (caller.userId && caller.userId !== userId) {
        throw new ForbiddenException(
          'You are not authorized to access this private user portrait.',
        );
      }
      return;
    }

    if (caller.userId && caller.userId === userId) {
      return;
    }

    if (caller.sessionId) {
      const session = await this.db.tryOnSession.findUnique({
        where: { sessionToken: caller.sessionId },
      });
      if (session?.status === 'UPGRADED' && session.userId === userId) {
        return;
      }
    }

    throw new ForbiddenException(
      'You are not authorized to access this private user portrait.',
    );
  }

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
      'Cache-Control': 'private, no-store, max-age=0',
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
    @Query('exp') exp?: string,
    @Query('sig') sig?: string,
    @Query('storeId') storeIdQuery?: string,
    @Headers('x-wearme-session-id') sessionId?: string,
    @Headers('authorization') authorization?: string,
    @Headers('x-wearme-auth-token') authToken?: string,
    @Headers('cookie') cookieHeader?: string,
    @Headers('x-wearme-partner-store-id') partnerStoreId?: string,
    @Headers('x-wearme-partner-key') partnerKey?: string,
  ) {
    if (!SAFE_UUID_REGEX.test(jobId)) {
      throw new BadRequestException('Invalid job ID format.');
    }
    if (!SAFE_JOB_FILENAME_REGEX.test(filename)) {
      throw new BadRequestException('Invalid or disallowed file name.');
    }

    const key = `jobs/${jobId}/${filename}`;
    await this.authorizeJobFileAccess(jobId, key, {
      exp,
      sig,
      sessionId,
      authorization,
      authToken,
      cookieHeader,
      partnerStoreId,
      partnerKey,
      storeIdQuery,
    });
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
    @Query('exp') exp?: string,
    @Query('sig') sig?: string,
    @Query('storeId') storeIdQuery?: string,
    @Headers('x-wearme-session-id') sessionId?: string,
    @Headers('authorization') authorization?: string,
    @Headers('x-wearme-auth-token') authToken?: string,
    @Headers('cookie') cookieHeader?: string,
    @Headers('x-wearme-partner-store-id') partnerStoreId?: string,
    @Headers('x-wearme-partner-key') partnerKey?: string,
  ) {
    if (!SAFE_UUID_REGEX.test(userId)) {
      throw new BadRequestException('Invalid user ID format.');
    }
    if (!SAFE_USER_FILENAME_REGEX.test(filename)) {
      throw new BadRequestException('Invalid or disallowed user file name.');
    }

    const key = `users/${userId}/${filename}`;
    await this.authorizeUserPortraitAccess(userId, key, {
      exp,
      sig,
      sessionId,
      authorization,
      authToken,
      cookieHeader,
      partnerStoreId,
      partnerKey,
      storeIdQuery,
    });
    await this.streamKeyToResponse(key, filename, res);
  }
}
