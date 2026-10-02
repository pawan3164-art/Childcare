import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../authorization/guards/jwt-auth.guard';
import { RequestUser } from '../authorization/request-user.interface';
import { CcsService } from './ccs.service';
import { CreateEnrolmentDto } from './dto/create-enrolment.dto';
import { SubmitSessionReportDto } from './dto/submit-session-report.dto';

@UseGuards(JwtAuthGuard)
@Controller('ccs')
export class CcsController {
  constructor(private readonly ccs: CcsService) {}

  @Post('enrolments')
  createEnrolment(@Req() req: { user: RequestUser }, @Body() dto: CreateEnrolmentDto) {
    return this.ccs.createEnrolment(req.user, dto);
  }

  @Post('session-reports')
  submitSessionReport(@Req() req: { user: RequestUser }, @Body() dto: SubmitSessionReportDto) {
    return this.ccs.submitSessionReport(req.user, dto);
  }

  @Post('session-reports/:reportId/resubmit')
  resubmit(@Req() req: { user: RequestUser }, @Param('reportId') reportId: string) {
    return this.ccs.resubmit(req.user, reportId);
  }
}
