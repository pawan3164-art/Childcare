import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../authorization/guards/jwt-auth.guard';
import { RequestUser } from '../authorization/request-user.interface';
import { PrivacyService } from './privacy.service';

@UseGuards(JwtAuthGuard)
@Controller('privacy')
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  /** APP 12: everything the platform holds about the signed-in person and their children. A few a minute is plenty. */
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Get('export')
  export(@Req() req: { user: RequestUser }) {
    return this.privacy.exportMyData(req.user);
  }
}
