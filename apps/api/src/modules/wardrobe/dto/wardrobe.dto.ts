import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { ContactInquiryCategory, OtpChannel } from '@wearme/shared';

export class RequestOtpDto {
  @ApiPropertyOptional({
    example: 'whatsapp',
    enum: ['whatsapp', 'sms', 'email'],
    description: 'Verification channel (defaults to whatsapp)',
  })
  @IsOptional()
  @IsIn(['whatsapp', 'sms', 'email'])
  channel?: OtpChannel;

  @ApiPropertyOptional({
    example: '+919876543210',
    description: 'Phone number (required when channel is whatsapp or sms)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(24)
  phone?: string;

  @ApiPropertyOptional({
    example: 'shopper@example.com',
    description: 'Email address (required when channel is email)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  email?: string;

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
    description: 'Optional display hint (resolved against trusted server registry when storeId is registered)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  storeName?: string;
}

export class UpgradeSessionDto {
  @ApiPropertyOptional({
    example: 'whatsapp',
    enum: ['whatsapp', 'sms', 'email'],
  })
  @IsOptional()
  @IsIn(['whatsapp', 'sms', 'email'])
  channel?: OtpChannel;

  @ApiPropertyOptional({
    example: '+919876543210',
    description: 'Phone number matching the OTP challenge (for whatsapp/sms channels)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(24)
  phone?: string;

  @ApiPropertyOptional({
    example: 'shopper@example.com',
    description: 'Email address matching the OTP challenge (for email channel)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  email?: string;

  @ApiProperty({
    example: '123456',
    description: '6-digit OTP verification code',
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

  @ApiPropertyOptional({
    example: '/my-wardrobe',
    description: 'Optional safe internal return URL after authentication',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  returnUrl?: string;
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

export class ContactInquiryDto {
  @ApiProperty({
    example: 'partner',
    enum: ['general', 'partner', 'support', 'privacy', 'security'],
  })
  @IsIn(['general', 'partner', 'support', 'privacy', 'security'])
  category!: ContactInquiryCategory;

  @ApiProperty({ example: 'Aarav Sharma' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: 'aarav@example.com' })
  @IsEmail()
  @MaxLength(160)
  email!: string;

  @ApiPropertyOptional({ example: 'Namma Indie Boutique' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  organization?: string;

  @ApiProperty({
    example: 'We would like to onboard our Indiranagar boutique for QR try-on.',
  })
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  message!: string;
}
