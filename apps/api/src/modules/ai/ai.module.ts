import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VirtualTryOnProvider } from './virtual-tryon.provider';
import { MockProvider } from './providers/mock.provider';
import { FastApiProvider } from './providers/fastapi.provider';
import type { AiConfig } from '../../config/configuration';

@Global()
@Module({
  providers: [
    {
      provide: VirtualTryOnProvider,
      useFactory: (configService: ConfigService): VirtualTryOnProvider => {
        const config = configService.get<AiConfig>('ai')!;
        switch (config.provider) {
          case 'mock':
            // Calls Python FastAPI service first, falls back to in-process MockProvider if Python service is down
            return new FastApiProvider(config, new MockProvider());
          case 'fashn-api':
          case 'huggingface':
          case 'necklace-poc':
          case 'fal':
          case 'external':
            // Strict delegation to Python FastAPI service (no mock fallback)
            return new FastApiProvider(config);
          default:
            throw new Error(`Unknown AI provider: ${config.provider as string}`);
        }
      },
      inject: [ConfigService],
    },
  ],
  exports: [VirtualTryOnProvider],
})
export class AiModule {}
