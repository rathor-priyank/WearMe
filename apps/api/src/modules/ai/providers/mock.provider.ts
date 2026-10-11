import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import { VirtualTryOnProvider, TryOnRequest, TryOnResult } from '../virtual-tryon.provider';

/**
 * MockProvider — a deterministic image composite used ONLY to verify
 * that the upload → NestJS → AI layer → storage → response pipeline is wired correctly.
 *
 * This is NOT a virtual try-on. It does not use any AI model.
 * It composites the garment image onto the person image.
 *
 * Replace with a real provider (fashn-api, fal, etc.) as soon as the pipeline is confirmed.
 */
@Injectable()
export class MockProvider extends VirtualTryOnProvider {
  readonly name = 'mock';
  private readonly logger = new Logger(MockProvider.name);

  async processJob(request: TryOnRequest): Promise<TryOnResult> {
    const start = Date.now();
    this.logger.log(`[mock] Processing job ${request.jobId}`);

    const personImage = sharp(request.personImageBuffer);
    const personMeta = await personImage.metadata();
    const width = personMeta.width ?? 512;
    const height = personMeta.height ?? 768;

    // Resize garment to 40% of person image width, maintain aspect ratio
    const garmentWidth = Math.max(32, Math.round(width * 0.4));
    const garmentResized = await sharp(request.garmentImageBuffer)
      .resize(garmentWidth, Math.round(height * 0.5), { fit: 'inside' })
      .png()
      .toBuffer();

    const garmentMeta = await sharp(garmentResized).metadata();
    const garmentHeight = garmentMeta.height ?? 200;

    // Center the garment horizontally, place it at ~25% from top (chest area)
    const left = Math.max(0, Math.round((width - (garmentMeta.width ?? garmentWidth)) / 2));
    const top = Math.max(0, Math.round(height * 0.25));

    const badgeWidth = Math.min(width, 240);
    const badgeHeight = 32;
    const svgWatermark = Buffer.from(
      `<svg width="${badgeWidth}" height="${badgeHeight}" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width="${badgeWidth}" height="${badgeHeight}" rx="6" fill="rgba(0,0,0,0.65)" />
        <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" fill="#fde047" font-family="sans-serif" font-size="12" font-weight="bold">
          MOCK — Pipeline Test
        </text>
      </svg>`,
    );

    const resultBuffer = await personImage
      .composite([
        {
          input: garmentResized,
          left,
          top,
          blend: 'over',
        },
        {
          input: svgWatermark,
          gravity: 'south',
          blend: 'over',
        },
      ])
      .jpeg({ quality: 90 })
      .toBuffer();

    const inferenceMs = Date.now() - start;
    this.logger.log(`[mock] Job ${request.jobId} completed in ${inferenceMs}ms`);

    return {
      resultImageBuffer: resultBuffer,
      resultMimeType: 'image/jpeg',
      provider: this.name,
      inferenceMs,
      metadata: {
        compositeLeft: left,
        compositeTop: top,
        garmentWidth,
        garmentHeight,
        personWidth: width,
        personHeight: height,
      },
    };
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}
