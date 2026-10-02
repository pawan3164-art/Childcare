import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { JwtPayload } from '../authorization/request-user.interface';

export interface LoginResult {
  mfaRequired: true;
  mfaToken: string;
}

export interface TokenResult {
  mfaRequired: false;
  accessToken: string;
}

/**
 * The `users` table is intentionally outside RLS (see the enable_rls
 * migration note) — authentication has to resolve an email to a user before
 * any org context exists, so this service queries PrismaService directly
 * rather than through TenancyService.withTenant. Everything downstream of
 * login (actual child/family/billing data) goes through the tenant-scoped
 * path.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async login(email: string, password: string): Promise<LoginResult | TokenResult> {
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      // No orgId known yet on a failed/unknown login — log centrally without
      // a tenant (the audit table's RLS policy will hide this row from
      // tenant-scoped reads, which is fine: it's a platform-level security event).
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.mfaEnabled) {
      const mfaToken = this.jwt.sign(
        { sub: user.id, mfaPending: true },
        { expiresIn: '2m' },
      );
      return { mfaRequired: true, mfaToken };
    }

    return { mfaRequired: false, accessToken: await this.issueAccessToken(user.id, user.orgId, user.centreId, user.role) };
  }

  async verifyMfa(mfaToken: string, code: string): Promise<TokenResult> {
    let payload: { sub: string; mfaPending?: boolean };
    try {
      payload = this.jwt.verify(mfaToken);
    } catch {
      throw new UnauthorizedException('MFA session expired, please log in again');
    }
    if (!payload.mfaPending) {
      throw new UnauthorizedException('Invalid MFA session');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.mfaSecret) {
      throw new UnauthorizedException('Invalid MFA session');
    }

    const valid = authenticator.verify({ token: code, secret: user.mfaSecret });
    if (!valid) {
      await this.audit.record({
        orgId: user.orgId ?? 'unknown',
        actorUserId: user.id,
        actorRole: user.role,
        action: 'auth.mfa.verify',
        entityType: 'User',
        entityId: user.id,
        outcome: 'DENIED',
      });
      throw new UnauthorizedException('Invalid MFA code');
    }

    return { mfaRequired: false, accessToken: await this.issueAccessToken(user.id, user.orgId, user.centreId, user.role) };
  }

  /** Enrolment: generates a TOTP secret for a staff/admin account (BRD §18 — MFA for privileged accounts). */
  async enrollMfa(userId: string): Promise<{ secret: string; otpauthUrl: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const secret = authenticator.generateSecret();
    await this.prisma.user.update({ where: { id: userId }, data: { mfaSecret: secret, mfaEnabled: true } });
    const otpauthUrl = authenticator.keyuri(user.email, 'Next-Gen Childcare', secret);
    return { secret, otpauthUrl };
  }

  private async issueAccessToken(
    userId: string,
    orgId: string | null,
    centreId: string | null,
    role: string,
  ): Promise<string> {
    const sessionId = uuidv4();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await this.prisma.session.create({
      data: { id: sessionId, userId, expiresAt },
    });

    const payload: JwtPayload = { sub: userId, orgId, centreId, role: role as JwtPayload['role'] };
    return this.jwt.sign(payload);
  }
}
