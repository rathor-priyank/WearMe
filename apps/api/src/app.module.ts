import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import { appConfig, storageConfig, aiConfig } from './config/configuration';
import { StorageModule } from './modules/storage/storage.module';
import { AiModule } from './modules/ai/ai.module';
import { TryOnModule } from './modules/try-on/try-on.module';
import { HealthModule } from './modules/health/health.module';
import { DatabaseModule } from './modules/database/database.module';

@Module({
  imports: [
    // Config — loads env vars and makes typed config available app-wide
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
      load: [appConfig, storageConfig, aiConfig],
      expandVariables: true,
    }),

    // Rate limiting — 10 requests per minute per IP for upload endpoints
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 60,
      },
      {
        name: 'upload',
        ttl: 60_000,
        limit: 10,
      },
    ]),

    // Structured JSON logging via Winston
    WinstonModule.forRoot({
      transports: [
        new winston.transports.Console({
          format:
            process.env['NODE_ENV'] === 'production'
              ? winston.format.json()
              : winston.format.combine(
                  winston.format.colorize(),
                  winston.format.timestamp(),
                  winston.format.printf(({ level, message, timestamp, ...meta }) => {
                    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
                    return `${timestamp} [${level}] ${message}${metaStr}`;
                  }),
                ),
        }),
      ],
    }),

    DatabaseModule,
    StorageModule,
    AiModule,
    TryOnModule,
    HealthModule,
  ],
})
export class AppModule {}

