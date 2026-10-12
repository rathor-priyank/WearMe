import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TryOnStatus } from '@wearme/shared';

export class JobStatusResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  jobId!: string;

  @ApiProperty({ enum: TryOnStatus })
  status!: TryOnStatus;

  @ApiProperty({ example: 'TSHIRT' })
  category!: string;

  @ApiPropertyOptional({ example: 'TSHIRT' })
  subcategory?: string;

  @ApiPropertyOptional({ example: 'clothing' })
  domain?: string;

  @ApiProperty({ example: 'http://localhost:3001/files/jobs/abc/person.jpg', nullable: true })
  personImageUrl?: string;

  @ApiProperty({ example: 'http://localhost:3001/files/jobs/abc/garment.jpg', nullable: true })
  garmentImageUrl?: string;

  @ApiProperty({ example: 'http://localhost:3001/files/jobs/abc/result.jpg', nullable: true })
  resultUrl?: string;

  @ApiProperty({ example: 'mock', nullable: true })
  aiProvider?: string;

  @ApiPropertyOptional({ example: false })
  isExperimentalPoc?: boolean;

  @ApiPropertyOptional({ example: true })
  isMock?: boolean;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  aiProviderMeta?: Record<string, unknown>;

  @ApiProperty({ nullable: true })
  errorMessage?: string;

  @ApiPropertyOptional({ example: false })
  savedToWardrobe?: boolean;

  @ApiPropertyOptional({ example: 'Studio Namma Indiranagar' })
  retailerSource?: string;

  @ApiPropertyOptional({ example: 'Classic Oxford Shirt' })
  productTitle?: string;

  @ApiProperty({ example: '2026-10-08T18:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-10-08T18:00:02.000Z', nullable: true })
  completedAt?: string;

  @ApiPropertyOptional({ example: '2026-10-15T18:00:00.000Z' })
  expiresAt?: string;
}

export class CreateJobResponseDto {
  @ApiProperty()
  jobId!: string;

  @ApiProperty({ enum: TryOnStatus })
  status!: TryOnStatus;

  @ApiProperty()
  createdAt!: string;
}

export class ProcessJobResponseDto {
  @ApiProperty()
  jobId!: string;

  @ApiProperty({ enum: TryOnStatus })
  status!: TryOnStatus;

  @ApiProperty({ nullable: true })
  resultUrl?: string;

  @ApiProperty({ nullable: true })
  errorMessage?: string;
}

