import { Module } from '@nestjs/common';
import { BrandingController } from './branding.controller';
import { BrandingService, DOMAIN_VERIFIER, defaultDomainVerifier } from './branding.service';

@Module({
  providers: [BrandingService, { provide: DOMAIN_VERIFIER, useValue: defaultDomainVerifier }],
  controllers: [BrandingController],
  exports: [BrandingService],
})
export class BrandingModule {}
