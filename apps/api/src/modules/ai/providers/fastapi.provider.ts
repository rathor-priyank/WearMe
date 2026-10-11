import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { VirtualTryOnProvider, TryOnRequest, TryOnResult } from '../virtual-tryon.provider';
import type { AiConfig } from '../../../config/configuration';

interface FastApiTryOnResponse {
  job_id: string;
  provider: string;
  inference_ms: number;
  result_image_base64: string;
  result_mime_type: string;
  metadata?: Record<string, unknown>;
}

/**
 * FastApiProvider — delegates virtual try-on inference to the standalone
 * Python FastAPI AI microservice (`apps/ai`).
 *
 * This decouples the NestJS API from the underlying ML/AI model implementation.
 * Never silently falls back to MockProvider when the AI microservice returns
 * an explicit error or when configured for real inference (`fashn-api`).
 */
@Injectable()
export class FastApiProvider extends VirtualTryOnProvider {
  readonly name = 'fastapi';
  private readonly logger = new Logger(FastApiProvider.name);
  private readonly serviceUrl: string;
  private readonly timeoutMs: number;
  private readonly fallbackProvider?: VirtualTryOnProvider;

  constructor(config: AiConfig, fallbackProvider?: VirtualTryOnProvider) {
    super();
    this.serviceUrl = config.serviceUrl.replace(/\/$/, '');
    this.timeoutMs = config.timeoutMs;
    this.fallbackProvider = fallbackProvider;
  }

  private extForMime(mimeType: string): string {
    if (mimeType === 'image/png') return 'png';
    if (mimeType === 'image/webp') return 'webp';
    return 'jpg';
  }

  async processJob(request: TryOnRequest): Promise<TryOnResult> {
    this.logger.log(
      `Forwarding job ${request.jobId} (category=${request.category}) to AI service (${this.serviceUrl})`,
    );

    const formData = new FormData();
    formData.append('job_id', request.jobId);
    formData.append('category', request.category);

    const personExt = this.extForMime(request.personMimeType);
    const garmentExt = this.extForMime(request.garmentMimeType);

    formData.append(
      'person_image',
      new Blob([request.personImageBuffer], { type: request.personMimeType }),
      `person.${personExt}`,
    );
    formData.append(
      'garment_image',
      new Blob([request.garmentImageBuffer], { type: request.garmentMimeType }),
      `garment.${garmentExt}`,
    );

    try {
      const response = await axios.post<FastApiTryOnResponse>(
        `${this.serviceUrl}/try-on`,
        formData,
        {
          timeout: this.timeoutMs,
        },
      );

      const data = response.data;
      const resultBuffer = Buffer.from(data.result_image_base64, 'base64');

      return {
        resultImageBuffer: resultBuffer,
        resultMimeType: data.result_mime_type || 'image/jpeg',
        provider: data.provider || this.name,
        inferenceMs: data.inference_ms,
        metadata: data.metadata,
      };
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const responseData = err.response?.data as { detail?: unknown; message?: unknown } | undefined;
        const detail =
          typeof responseData?.detail === 'string'
            ? responseData.detail
            : typeof responseData?.message === 'string'
              ? responseData.message
              : undefined;

        if (detail) {
          throw new Error(detail);
        }

        // Only fall back to in-process MockProvider when AI_PROVIDER=mock AND the Python service is unreachable
        const isUnreachable =
          !err.response &&
          (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ERR_NETWORK');
        if (this.fallbackProvider && isUnreachable) {
          this.logger.warn(
            `Python AI service unreachable at ${this.serviceUrl}; falling back to in-process ${this.fallbackProvider.name}`,
          );
          return this.fallbackProvider.processJob(request);
        }

        if (err.code === 'ECONNABORTED') {
          throw new Error(
            `Virtual try-on request timed out after ${Math.round(this.timeoutMs / 1000)} seconds.`,
          );
        }
      }

      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(msg);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await axios.get<{ status: string }>(`${this.serviceUrl}/health`, {
        timeout: 3000,
      });
      return res.data.status === 'ok';
    } catch {
      if (this.fallbackProvider) {
        return this.fallbackProvider.healthCheck();
      }
      return false;
    }
  }
}
