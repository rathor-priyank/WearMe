import { ApiProperty } from '@nestjs/swagger';
import { TryOnStatus } from '@wearme/shared';

export class JobStatusResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  jobId!: string;

  @ApiProperty({ enum: TryOnStatus })
  status!: TryOnStatus;

  @ApiProperty({ example: 'TSHIRT' })
  category!: string;

  @ApiProperty({ example: 'http://localhost:3001/files/jobs/abc/person.jpg', nullable: true })
  personImageUrl?: string;

  @ApiProperty({ example: 'http://localhost:3001/files/jobs/abc/garment.jpg', nullable: true })
  garmentImageUrl?: string;

  @ApiProperty({ example: 'http://localhost:3001/files/jobs/abc/result.jpg', nullable: true })
  resultUrl?: string;

  @ApiProperty({ example: 'mock', nullable: true })
  aiProvider?: string;

  @ApiProperty({ nullable: true })
  errorMessage?: string;

  @ApiProperty({ example: '2026-10-08T18:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-10-08T18:00:02.000Z', nullable: true })
  completedAt?: string;
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

