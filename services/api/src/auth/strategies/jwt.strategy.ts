import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtPayload, RequestUser } from '../../authorization/request-user.interface';
import { resolveJwtSecret } from '../jwt-secret';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: resolveJwtSecret(),
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
    //
    // The session must also belong to the token's subject and still be in
    // date — otherwise a token minted with someone else's sub could ride on
    // the forger's own live session.
    const session = await this.prisma.session.findUnique({
      where: { id: payload.sessionId },
      include: { user: { select: { id: true, role: true, orgId: true, centreId: true } } },
    });
    if (!session || session.revokedAt || session.userId !== payload.sub || session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Session has been revoked, please log in again');
    }

    // Role and tenancy come from the DB, not the token, so a role change or
    // org move takes effect on the next request rather than at token expiry.
    return {
      userId: session.user.id,
      orgId: session.user.orgId,
      centreId: session.user.centreId,
      role: session.user.role,
      sessionId: session.id,
    };
  }
}
