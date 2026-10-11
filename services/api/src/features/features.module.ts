import { Global, Module } from '@nestjs/common';
import { FeaturesController } from './features.controller';
import { FeaturesService } from './features.service';
import { ModuleGuard } from './module.guard';

/** Global so any controller can use ModuleGuard without importing this module. */
@Global()
@Module({
  providers: [FeaturesService, ModuleGuard],
  controllers: [FeaturesController],
  exports: [FeaturesService, ModuleGuard],
})
export class FeaturesModule {}
