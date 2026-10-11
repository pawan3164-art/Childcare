import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { VerifyMfaDto } from './dto/verify-mfa.dto';
import { ConfirmMfaDto, MfaSetupFinishDto, MfaSetupStartDto, RefreshDto } from './dto/refresh.dto';
import { RequestUser } from '../authorization/request-user.interface';

// BRD §18 "secure password/session management": login and MFA verification
// are brute-forceable without throttling — 5 attempts per minute per IP,
// tighter than the global default configured in app.module.ts.
const AUTH_THROTTLE = { default: { limit: 5, ttl: 60000 } };

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Throttle(AUTH_THROTTLE)
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Throttle(AUTH_THROTTLE)
  @Post('mfa/verify')
  verifyMfa(@Body() dto: VerifyMfaDto) {
    return this.auth.verifyMfa(dto.mfaToken, dto.code);
  }

  /** Swap a refresh token for a new access token (and a new refresh token). Each one works once. */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  /** Forced enrolment for privileged accounts that have no session yet (setup token from login). */
  @Throttle(AUTH_THROTTLE)
  @Post('mfa/setup/start')
  @HttpCode(HttpStatus.OK)
  startMfaSetup(@Body() dto: MfaSetupStartDto) {
    return this.auth.startMfaSetup(dto.setupToken);
  }

  @Throttle(AUTH_THROTTLE)
  @Post('mfa/setup/finish')
  @HttpCode(HttpStatus.OK)
  finishMfaSetup(@Body() dto: MfaSetupFinishDto) {
    return this.auth.finishMfaSetup(dto.setupToken, dto.code);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('me')
  me(@Req() req: { user: RequestUser }) {
    return this.auth.getProfile(req.user.userId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('mfa/enroll')
  enrollMfa(@Req() req: { user: RequestUser }) {
    return this.auth.enrollMfa(req.user.userId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Throttle(AUTH_THROTTLE)
  @Post('mfa/confirm')
  @HttpCode(HttpStatus.OK)
  confirmMfa(@Req() req: { user: RequestUser }, @Body() dto: ConfirmMfaDto) {
    return this.auth.confirmMfaEnrollment(req.user.userId, dto.code);
  }

  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  async logout(@Req() req: { user: RequestUser }): Promise<void> {
    await this.auth.logout(req.user.sessionId);
  }
}
