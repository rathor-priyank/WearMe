import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { TryOnService } from './modules/try-on/try-on.service';

/**
 * CLI maintenance task for WearMe storage retention & orphan cleanup.
 *
 * Purges expired database jobs (`expiresAt <= now`) along with their physical
 * `uploads/jobs/<jobId>/` directories, and removes any orphaned `uploads/jobs/<jobId>/`
 * directories that do not have a matching database record.
 *
 * Usage:
 *   pnpm cleanup:storage
 *   pnpm cleanup:storage -- --dry-run
 */
async function runCleanup(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const appContext = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const tryOnService = appContext.get(TryOnService);
    const summary = await tryOnService.cleanupExpiredAndOrphanedJobs({ dryRun });
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await appContext.close();
  }
}

if (require.main === module) {
  runCleanup().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Storage cleanup failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

