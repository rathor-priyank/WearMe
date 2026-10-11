import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageProvider } from './storage.provider';
import { LocalStorageProvider } from './providers/local.storage';
import { StorageController } from './storage.controller';
import type { StorageConfig } from '../../config/configuration';

@Global()
@Module({
  controllers: [StorageController],
  providers: [
    {
      provide: StorageProvider,
      useFactory: (configService: ConfigService): StorageProvider => {
        const config = configService.get<StorageConfig>('storage')!;
        switch (config.provider) {
          case 'local':
            return new LocalStorageProvider(configService);
          default:
            throw new Error(`Unknown storage provider: ${config.provider as string}`);
        }
      },
      inject: [ConfigService],
    },
  ],
  exports: [StorageProvider],
})
export class StorageModule {}

