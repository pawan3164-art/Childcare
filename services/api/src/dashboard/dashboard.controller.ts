import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../authorization/guards/jwt-auth.guard';
import { RequestUser } from '../authorization/request-user.interface';
import { ChildGlanceService } from './child-glance.service';

@UseGuards(JwtAuthGuard)
@Controller()
export class DashboardController {
  constructor(private readonly childGlance: ChildGlanceService) {}

  @Get('children/:childId/at-a-glance')
  getChildAtAGlance(@Req() req: { user: RequestUser }, @Param('childId') childId: string) {
    return this.childGlance.get(req.user, childId);
  }
}
