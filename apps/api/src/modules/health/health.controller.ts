import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { DatabaseService } from '../database/database.service';
import { StorageProvider } from '../storage/storage.provider';
import { VirtualTryOnProvider } from '../ai/virtual-tryon.provider';
import type { HealthResponse } from '@wearme/shared';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageProvider,
    private readonly ai: VirtualTryOnProvider,
  ) {}

  @Get()
  @ApiOperation({ summary: 'System health check' })
  async check(): Promise<HealthResponse> {
    const [dbOk, storageOk, aiOk] = await Promise.allSettled([
      this.db.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      this.storage.healthCheck(),
      this.ai.healthCheck(),
    ]);

    const services = {
      database: dbOk.status === 'fulfilled' && dbOk.value ? ('ok' as const) : ('error' as const),
      storage: storageOk.status === 'fulfilled' && storageOk.value ? ('ok' as const) : ('error' as const),
      ai: aiOk.status === 'fulfilled' && aiOk.value ? ('ok' as const) : ('error' as const),
    };

    const allOk = Object.values(services).every((s) => s === 'ok');

    return {
      status: allOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      services,
    };
  }
}

