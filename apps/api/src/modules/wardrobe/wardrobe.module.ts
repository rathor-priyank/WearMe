import { Module } from '@nestjs/common';
import { TryOnModule } from '../try-on/try-on.module';
import { UsageEntitlementService } from './usage-entitlement.service';
import { WardrobeController } from './wardrobe.controller';
import { WardrobeService } from './wardrobe.service';

@Module({
  imports: [TryOnModule],
  controllers: [WardrobeController],
  providers: [WardrobeService, UsageEntitlementService],
  exports: [WardrobeService, UsageEntitlementService],
})
export class WardrobeModule {}

