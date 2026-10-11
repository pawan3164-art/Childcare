import { Module } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { AttendanceController } from './attendance.controller';
import { SelfSignInController } from './self-sign-in.controller';
import { SelfSignInService } from './self-sign-in.service';
import { CheckInCodeService } from './checkin-code.service';

@Module({
  providers: [AttendanceService, SelfSignInService, CheckInCodeService],
  controllers: [AttendanceController, SelfSignInController],
  exports: [AttendanceService],
})
export class AttendanceModule {}
