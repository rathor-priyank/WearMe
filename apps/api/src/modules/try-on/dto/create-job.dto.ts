import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ClothingCategory,
  UPLOADABLE_CLOTHING_CATEGORIES,
  WearableSubcategory,
} from '@wearme/shared';

export class CreateTryOnJobDto {
  @ApiProperty({
    enum: UPLOADABLE_CLOTHING_CATEGORIES,
    description:
      'Database category — upper-body clothing (TOP, SHIRT, TSHIRT, JACKET) or ACCESSORY (when subcategory is NECKLACE/PENDANT)',
    example: ClothingCategory.TSHIRT,
  })
  @IsEnum(UPLOADABLE_CLOTHING_CATEGORIES, {
    message: `category must be one of: ${UPLOADABLE_CLOTHING_CATEGORIES.join(', ')}`,
  })
  category!: ClothingCategory;

  @ApiPropertyOptional({
    enum: WearableSubcategory,
    description:
      'Optional specific wearable subcategory (e.g. TSHIRT, SHIRT, SWEATER, HOODIE, JACKET, TOP, NECKLACE, PENDANT)',
    example: WearableSubcategory.TSHIRT,
  })
  @IsOptional()
  @IsString()
  subcategory?: string;
}

