import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload, RequestUser } from '../../authorization/request-user.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET ?? 'dev-only-change-me',
    });
  }

  validate(payload: JwtPayload): RequestUser {
    if ((payload as unknown as { mfaPending?: boolean }).mfaPending) {
      // An MFA-pending token must never be usable as a real access token.
      throw new Error('MFA not completed');
    }
    return {
      userId: payload.sub,
      orgId: payload.orgId,
      centreId: payload.centreId,
      role: payload.role,
    };
  }
}
