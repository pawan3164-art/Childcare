import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../authorization/guards/jwt-auth.guard';
import { RequestUser } from '../authorization/request-user.interface';
import { AttendanceService } from './attendance.service';
import { RecordAttendanceDto } from './dto/record-attendance.dto';

@UseGuards(JwtAuthGuard)
@Controller()
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Post('attendance/events')
  record(@Req() req: { user: RequestUser }, @Body() dto: RecordAttendanceDto) {
    return this.attendance.recordEvent(req.user, dto);
  }

  @Post('attendance/events/:eventId/correct')
  correct(
    @Req() req: { user: RequestUser },
    @Param('eventId') eventId: string,
    @Body() dto: RecordAttendanceDto,
  ) {
    return this.attendance.correctEvent(req.user, eventId, dto);
  }

  @Get('children/:childId/attendance')
  history(@Req() req: { user: RequestUser }, @Param('childId') childId: string) {
    return this.attendance.history(req.user, childId);
  }
}
