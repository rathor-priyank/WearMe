import { Module } from '@nestjs/common';
import { TryOnModule } from '../try-on/try-on.module';
import { WardrobeController } from './wardrobe.controller';
import { WardrobeService } from './wardrobe.service';

@Module({
  imports: [TryOnModule],
  controllers: [WardrobeController],
  providers: [WardrobeService],
  exports: [WardrobeService],
})
export class WardrobeModule {}

