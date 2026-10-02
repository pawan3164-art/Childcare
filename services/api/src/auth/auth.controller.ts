import { Body, Controller, Post, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { VerifyMfaDto } from './dto/verify-mfa.dto';
import { RequestUser } from '../authorization/request-user.interface';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Post('mfa/verify')
  verifyMfa(@Body() dto: VerifyMfaDto) {
    return this.auth.verifyMfa(dto.mfaToken, dto.code);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('mfa/enroll')
  enrollMfa(@Req() req: { user: RequestUser }) {
    return this.auth.enrollMfa(req.user.userId);
  }
}
