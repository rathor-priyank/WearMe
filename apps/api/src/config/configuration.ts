import { registerAs } from '@nestjs/config';

export interface AppConfig {
  port: number;
  nodeEnv: string;
  corsOrigins: string[];
}

export interface StorageConfig {
  provider: 'local';
  localPath: string;
  localBaseUrl: string;
  maxFileSizeMb: number;
  imageRetentionDays: number;
}

export interface AiConfig {
  provider: 'mock' | 'fashn-api' | 'huggingface' | 'fal' | 'external';
  serviceUrl: string;
  apiKey?: string;
  timeoutMs: number;
}

function resolveAiTimeoutMs(): number {
  const timeoutSec = process.env['AI_REQUEST_TIMEOUT_SECONDS'];
  if (timeoutSec) {
    const parsedSec = parseInt(timeoutSec, 10);
    if (!Number.isNaN(parsedSec) && parsedSec > 0) {
      return parsedSec * 1000;
    }
  }
  const timeoutMs = process.env['AI_TIMEOUT_MS'];
  if (timeoutMs) {
    const parsedMs = parseInt(timeoutMs, 10);
    if (!Number.isNaN(parsedMs) && parsedMs > 0) {
      return parsedMs;
    }
  }
  return 120_000; // Default 120 seconds for real VTON inference + polling
}

export const appConfig = registerAs('app', (): AppConfig => ({
  port: parseInt(process.env['API_PORT'] ?? '3001', 10),
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  corsOrigins: (process.env['API_CORS_ORIGINS'] ?? 'http://localhost:3000').split(','),
}));

export const storageConfig = registerAs('storage', (): StorageConfig => ({
  provider: (process.env['STORAGE_PROVIDER'] as StorageConfig['provider']) ?? 'local',
  localPath: process.env['LOCAL_STORAGE_PATH'] ?? './uploads',
  localBaseUrl: process.env['LOCAL_STORAGE_BASE_URL'] ?? 'http://localhost:3001',
  maxFileSizeMb: parseInt(process.env['MAX_FILE_SIZE_MB'] ?? '10', 10),
  imageRetentionDays: parseInt(process.env['IMAGE_RETENTION_DAYS'] ?? '7', 10),
}));

export const aiConfig = registerAs('ai', (): AiConfig => ({
  provider: (process.env['AI_PROVIDER'] as AiConfig['provider']) ?? 'mock',
  serviceUrl: process.env['AI_SERVICE_URL'] ?? 'http://localhost:8001',
  apiKey: process.env['AI_API_KEY'],
  timeoutMs: resolveAiTimeoutMs(),
}));
