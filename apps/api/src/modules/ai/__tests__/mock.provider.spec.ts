import sharp from 'sharp';
import { ClothingCategory } from '@wearme/shared';
import { MockProvider } from '../providers/mock.provider';

describe('MockProvider', () => {
  let provider: MockProvider;

  beforeEach(() => {
    provider = new MockProvider();
  });

  it('generates a valid composite JPEG image buffer', async () => {
    const personBuffer = await sharp({
      create: {
        width: 256,
        height: 384,
        channels: 3,
        background: { r: 220, g: 200, b: 190 },
      },
    })
      .jpeg()
      .toBuffer();

    const garmentBuffer = await sharp({
      create: {
        width: 128,
        height: 160,
        channels: 3,
        background: { r: 40, g: 80, b: 180 },
      },
    })
      .jpeg()
      .toBuffer();

    const result = await provider.processJob({
      jobId: 'job-123',
      personImageBuffer: personBuffer,
      garmentImageBuffer: garmentBuffer,
      personMimeType: 'image/jpeg',
      garmentMimeType: 'image/jpeg',
      category: ClothingCategory.TSHIRT,
    });

    expect(result.provider).toBe('mock');
    expect(result.resultMimeType).toBe('image/jpeg');
    expect(result.resultImageBuffer.length).toBeGreaterThan(100);

    const outMeta = await sharp(result.resultImageBuffer).metadata();
    expect(outMeta.width).toBe(256);
    expect(outMeta.height).toBe(384);
    expect(outMeta.format).toBe('jpeg');
  });
});
