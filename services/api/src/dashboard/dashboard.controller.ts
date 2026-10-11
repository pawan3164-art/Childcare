import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../authorization/guards/jwt-auth.guard';
import { RequestUser } from '../authorization/request-user.interface';
import { ChildGlanceService } from './child-glance.service';
import { AuditRead } from '../audit/audit-read';

@UseGuards(JwtAuthGuard)
@Controller()
export class DashboardController {
  constructor(private readonly childGlance: ChildGlanceService) {}

  @Get('children/:childId/at-a-glance')
  @AuditRead('child_at_a_glance', { entityType: 'Child', idParam: 'childId' })
  getChildAtAGlance(@Req() req: { user: RequestUser }, @Param('childId') childId: string) {
    return this.childGlance.get(req.user, childId);
  }
}
