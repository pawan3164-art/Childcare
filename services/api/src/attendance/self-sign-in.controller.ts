import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsIn, IsString, Matches } from 'class-validator';
import { JwtAuthGuard } from '../authorization/guards/jwt-auth.guard';
import { RequestUser } from '../authorization/request-user.interface';
import { SelfSignInService } from './self-sign-in.service';

class SetSelfSignInDto {
  @IsBoolean()
  enabled!: boolean;
}

class SelfSignInDto {
  @IsIn(['SIGN_IN', 'SIGN_OUT'])
  eventType!: 'SIGN_IN' | 'SIGN_OUT';

  @IsString()
  @Matches(/^\d{6}$/, { message: 'The code is six digits' })
  code!: string;
}

@UseGuards(JwtAuthGuard)
@Controller()
export class SelfSignInController {
  constructor(private readonly service: SelfSignInService) {}

  @Get('centre/checkin-code')
  checkInCode(@Req() req: { user: RequestUser }) {
    return this.service.currentCode(req.user);
  }

  @Get('centre/self-sign-in')
  getSelfSignIn(@Req() req: { user: RequestUser }) {
    return this.service.getParentSelfSignIn(req.user);
  }

  @Put('centre/self-sign-in')
  setSelfSignIn(@Req() req: { user: RequestUser }, @Body() dto: SetSelfSignInDto) {
    return this.service.setParentSelfSignIn(req.user, dto.enabled);
  }

  // Tighter than the global limit: this endpoint checks a short numeric code.
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post('children/:childId/attendance/self')
  selfSignIn(@Req() req: { user: RequestUser }, @Param('childId') childId: string, @Body() dto: SelfSignInDto) {
    return this.service.selfSignIn(req.user, childId, dto);
  }
}
