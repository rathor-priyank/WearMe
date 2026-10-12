import type { ClothingCategory } from '@wearme/shared';

export interface TryOnRequest {
  jobId: string;
  personImageBuffer: Buffer;
  garmentImageBuffer: Buffer;
  personMimeType: string;
  garmentMimeType: string;
  category: ClothingCategory;
  subcategory?: string;
}

export interface TryOnResult {
  resultImageBuffer: Buffer;
  resultMimeType: string;
  provider: string;
  inferenceMs: number;
  metadata?: Record<string, unknown>;
}

/**
 * VirtualTryOnProvider — abstract interface for all AI inference backends.
 *
 * V1: MockProvider (deterministic composite — for pipeline testing only)
 * V2: ExternalApiProvider (FASHN API, fal.ai, Segmind — verify ToS before use)
 * V3: LocalModelProvider (self-hosted GPU inference)
 *
 * Never call inference SDKs directly from application code.
 * All inference goes through this abstraction.
 */
export abstract class VirtualTryOnProvider {
  /**
   * Process a virtual try-on request and return the result image buffer.
   * Throws on failure — caller is responsible for catching and recording errors.
   */
  abstract processJob(request: TryOnRequest): Promise<TryOnResult>;

  /**
   * Return true if the provider is reachable and ready to process requests.
   */
  abstract healthCheck(): Promise<boolean>;

  /**
   * Human-readable provider name for logging and DB tracking.
   */
  abstract readonly name: string;
}

