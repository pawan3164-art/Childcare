import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { VerifyMfaDto } from './dto/verify-mfa.dto';
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
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  async logout(@Req() req: { user: RequestUser }): Promise<void> {
    await this.auth.logout(req.user.sessionId);
  }
}
