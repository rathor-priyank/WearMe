import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ClothingCategory, V1_CLOTHING_CATEGORIES } from '@wearme/shared';

export class CreateTryOnJobDto {
  @ApiProperty({
    enum: V1_CLOTHING_CATEGORIES,
    description: 'Clothing category — V1 supports upper-body only',
    example: ClothingCategory.TSHIRT,
  })
  @IsEnum(V1_CLOTHING_CATEGORIES, {
    message: `category must be one of: ${V1_CLOTHING_CATEGORIES.join(', ')}`,
  })
  category!: ClothingCategory;
}

