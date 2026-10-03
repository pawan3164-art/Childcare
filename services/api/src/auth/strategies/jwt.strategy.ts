import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtPayload, RequestUser } from '../../authorization/request-user.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET ?? 'dev-only-change-me',
    });
  }

  async validate(payload: JwtPayload): Promise<RequestUser> {
    if ((payload as unknown as { mfaPending?: boolean }).mfaPending) {
      // An MFA-pending token must never be usable as a real access token.
      throw new UnauthorizedException('MFA not completed');
    }

    // Session revocation check: a JWT's own expiry (15 min) is not the only
    // way it can become invalid — logout or an admin's remote-wipe revokes
    // the Session row immediately, and that must take effect before the
    // token's natural expiry, not after.
    const session = await this.prisma.session.findUnique({ where: { id: payload.sessionId } });
    if (!session || session.revokedAt) {
      throw new UnauthorizedException('Session has been revoked, please log in again');
    }

    return {
      userId: payload.sub,
      orgId: payload.orgId,
      centreId: payload.centreId,
      role: payload.role,
      sessionId: payload.sessionId,
    };
  }
}
