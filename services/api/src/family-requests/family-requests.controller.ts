import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../authorization/guards/jwt-auth.guard';
import { RequestUser } from '../authorization/request-user.interface';
import { FamilyRequestsService } from './family-requests.service';
import { AuditRead } from '../audit/audit-read';
import { ModuleGuard, RequiresModule } from '../features/module.guard';
import {
  ApproveCasualDayDto,
  DeclineCasualDayDto,
  NominatePickupDto,
  ReportAbsenceDto,
  RequestCasualDayDto,
  SetAbsenceAllowableDto,
} from './dto/family-requests.dto';

type Req_ = { user: RequestUser };

// Writes create rows and audit entries, so they get a tighter limit than reads (security review L3).
const WRITE_LIMIT = Throttle({ default: { limit: 20, ttl: 60000 } });

/** U3: things a family asks the centre for (absence, casual day, a different pickup) and how the centre responds. */
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequiresModule('family_requests')
@Controller()
export class FamilyRequestsController {
  constructor(private readonly requests: FamilyRequestsService) {}

  // Absences
  @WRITE_LIMIT
  @Post('children/:childId/absences')
  reportAbsence(@Req() req: Req_, @Param('childId') childId: string, @Body() dto: ReportAbsenceDto) {
    return this.requests.reportAbsence(req.user, childId, dto);
  }

  @Get('children/:childId/absences')
  @AuditRead('absences', { entityType: 'Child', idParam: 'childId' })
  listAbsences(@Req() req: Req_, @Param('childId') childId: string) {
    return this.requests.listAbsences(req.user, childId);
  }

  @Get('absences')
  @AuditRead('absences_centre')
  listCentreAbsences(@Req() req: Req_, @Query('from') from?: string, @Query('to') to?: string) {
    return this.requests.listCentreAbsences(req.user, { from, to });
  }

  @Patch('absences/:absenceId')
  setAbsenceAllowable(@Req() req: Req_, @Param('absenceId') absenceId: string, @Body() dto: SetAbsenceAllowableDto) {
    return this.requests.setAbsenceAllowable(req.user, absenceId, dto.isAllowable);
  }

  // Casual days
  @WRITE_LIMIT
  @Post('children/:childId/casual-day-requests')
  requestCasualDay(@Req() req: Req_, @Param('childId') childId: string, @Body() dto: RequestCasualDayDto) {
    return this.requests.requestCasualDay(req.user, childId, dto);
  }

  @Get('children/:childId/casual-day-requests')
  @AuditRead('casual_day_requests', { entityType: 'Child', idParam: 'childId' })
  listCasualDayRequests(@Req() req: Req_, @Param('childId') childId: string) {
    return this.requests.listCasualDayRequests(req.user, childId);
  }

  @Get('casual-day-requests')
  @AuditRead('casual_day_requests_pending')
  listPendingCasualDayRequests(@Req() req: Req_) {
    return this.requests.listPendingCasualDayRequests(req.user);
  }

  @Post('casual-day-requests/:requestId/approve')
  approveCasualDay(@Req() req: Req_, @Param('requestId') requestId: string, @Body() dto: ApproveCasualDayDto) {
    return this.requests.approveCasualDay(req.user, requestId, dto);
  }

  @Post('casual-day-requests/:requestId/decline')
  declineCasualDay(@Req() req: Req_, @Param('requestId') requestId: string, @Body() dto: DeclineCasualDayDto) {
    return this.requests.declineCasualDay(req.user, requestId, dto);
  }

  @Post('casual-day-requests/:requestId/cancel')
  cancelCasualDay(@Req() req: Req_, @Param('requestId') requestId: string) {
    return this.requests.cancelCasualDayRequest(req.user, requestId);
  }

  // Pickup nominations
  @WRITE_LIMIT
  @Post('children/:childId/pickup-nominations')
  nominatePickup(@Req() req: Req_, @Param('childId') childId: string, @Body() dto: NominatePickupDto) {
    return this.requests.nominatePickup(req.user, childId, dto);
  }

  @Get('children/:childId/pickup-nominations')
  @AuditRead('pickup_nominations', { entityType: 'Child', idParam: 'childId' })
  listPickupNominations(@Req() req: Req_, @Param('childId') childId: string) {
    return this.requests.listPickupNominations(req.user, childId);
  }

  @Get('pickup-nominations')
  @AuditRead('pickup_nominations_for_date')
  listPickupsForDate(@Req() req: Req_, @Query('date') date?: string) {
    return this.requests.listPickupsForDate(req.user, { date });
  }

  @Post('pickup-nominations/:nominationId/cancel')
  cancelPickup(@Req() req: Req_, @Param('nominationId') nominationId: string) {
    return this.requests.cancelPickupNomination(req.user, nominationId);
  }

  @Post('pickup-nominations/:nominationId/verify')
  verifyPickup(@Req() req: Req_, @Param('nominationId') nominationId: string) {
    return this.requests.verifyPickup(req.user, nominationId);
  }
}
