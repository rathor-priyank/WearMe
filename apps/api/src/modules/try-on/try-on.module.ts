import { Module } from '@nestjs/common';
import { TryOnController } from './try-on.controller';
import { TryOnService } from './try-on.service';

@Module({
  controllers: [TryOnController],
  providers: [TryOnService],
})
export class TryOnModule {}

