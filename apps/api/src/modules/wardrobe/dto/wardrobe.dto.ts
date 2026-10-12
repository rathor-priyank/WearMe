import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class RequestOtpDto {
  @ApiProperty({
    example: '+919876543210',
    description: 'WhatsApp phone number (10-digit Indian mobile or E.164 format)',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(24)
  phone!: string;

  @ApiPropertyOptional({
    example: 'store_indiranagar_01',
    description: 'Optional B2B2C walk-in store identifier from QR scan',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  storeId?: string;

  @ApiPropertyOptional({
    example: 'Studio Namma Indiranagar',
    description: 'Optional human-readable walk-in store name',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  storeName?: string;
}

export class UpgradeSessionDto {
  @ApiProperty({
    example: '+919876543210',
    description: 'WhatsApp phone number matching the OTP challenge',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(24)
  phone!: string;

  @ApiProperty({
    example: '123456',
    description: '6-digit WhatsApp OTP verification code',
  })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'otpCode must be a 6-digit numeric code.' })
  otpCode!: string;

  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Optional try-on job UUID that triggered the Save to Wardrobe action',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  jobId?: string;

  @ApiPropertyOptional({ example: 'store_indiranagar_01' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  storeId?: string;

  @ApiPropertyOptional({ example: 'Studio Namma Indiranagar' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  storeName?: string;

  @ApiPropertyOptional({
    example: false,
    description:
      'Set true if an existing returning user explicitly wants to overwrite their saved base portrait',
  })
  @IsOptional()
  @IsBoolean()
  replaceBasePortrait?: boolean;
}

export class WardrobeCatalogTryOnDto {
  @ApiProperty({
    example: 'zara_oxford_shirt',
    description: 'ID of the cross-platform retailer catalog item to try on using saved base photo',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  catalogItemId!: string;
}

