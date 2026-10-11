import { Body, Controller, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../authorization/guards/jwt-auth.guard';
import { RequestUser } from '../authorization/request-user.interface';
import { FeaturesService } from './features.service';
import { SetModuleDto, SetPlanDto } from './dto/features.dto';

type Req_ = { user: RequestUser };

/** Centre admins choose which optional modules their centre uses; platform administrators set an organisation's plan. */
@UseGuards(JwtAuthGuard)
@Controller()
export class FeaturesController {
  constructor(private readonly features: FeaturesService) {}

  @Get('modules')
  list(@Req() req: Req_) {
    return this.features.list(req.user);
  }

  @Put('modules/:key')
  setEnabled(@Req() req: Req_, @Param('key') key: string, @Body() dto: SetModuleDto) {
    return this.features.setEnabled(req.user, key, dto.enabled);
  }

  @Get('plan')
  plan(@Req() req: Req_) {
    return this.features.getPlan(req.user);
  }

  @Put('platform/organisations/:orgId/plan')
  setPlan(@Req() req: Req_, @Param('orgId') orgId: string, @Body() dto: SetPlanDto) {
    return this.features.setPlan(req.user, orgId, dto.plan, dto.validUntil);
  }
}
