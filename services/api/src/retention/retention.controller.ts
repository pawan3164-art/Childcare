import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../authorization/guards/jwt-auth.guard';
import { AuditRead } from '../audit/audit-read';
import { RequestUser } from '../authorization/request-user.interface';
import { RetentionService } from './retention.service';
import { DepartChildDto, LegalHoldDto, RetentionOverrideDto } from './dto/retention.dto';

type Req_ = { user: RequestUser };

/** Retention policy, child departure and legal hold. Deleting is not possible here: see RetentionPurger. */
@UseGuards(JwtAuthGuard)
@Controller()
export class RetentionController {
  constructor(private readonly retention: RetentionService) {}

  @Get('retention/policy')
  policy(@Req() req: Req_) {
    return this.retention.effectivePolicy(req.user);
  }

  @Put('retention/policy/:recordType')
  setOverride(@Req() req: Req_, @Param('recordType') recordType: string, @Body() dto: RetentionOverrideDto) {
    return this.retention.setRetentionOverride(req.user, recordType, dto.years);
  }

  @Get('retention/plan')
  plan(@Req() req: Req_) {
    return this.retention.plan(req.user);
  }

  @Get('children/:childId/retention')
  @AuditRead('child_retention', { entityType: 'Child', idParam: 'childId' })
  status(@Req() req: Req_, @Param('childId') childId: string) {
    return this.retention.childStatus(req.user, childId);
  }

  @Post('children/:childId/depart')
  depart(@Req() req: Req_, @Param('childId') childId: string, @Body() dto: DepartChildDto) {
    return this.retention.markDeparted(req.user, childId, dto);
  }

  @Post('children/:childId/reinstate')
  reinstate(@Req() req: Req_, @Param('childId') childId: string) {
    return this.retention.reinstateChild(req.user, childId);
  }

  @Put('children/:childId/legal-hold')
  legalHold(@Req() req: Req_, @Param('childId') childId: string, @Body() dto: LegalHoldDto) {
    return this.retention.setLegalHold(req.user, childId, dto);
  }
}
