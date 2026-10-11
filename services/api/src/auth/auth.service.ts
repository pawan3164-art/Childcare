import { createHash, randomBytes, randomInt } from 'crypto';
import { BadRequestException, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenancyService } from '../common/tenancy/tenancy.service';
import { AuditService } from '../audit/audit.service';
import { JwtPayload, RequestUser } from '../authorization/request-user.interface';
import { FeaturesService } from '../features/features.service';
import { BrandingService } from '../branding/branding.service';

export interface TokenResult {
  mfaRequired: false;
  accessToken: string;
  /** Opaque, single-use; swap it at POST /auth/refresh for a new pair. Returned once and never stored in clear. */
  refreshToken: string;
  /** Access token lifetime in seconds. */
  expiresIn: number;
}

export interface MfaChallengeResult {
  mfaRequired: true;
  mfaToken: string;
}

export interface MfaSetupRequiredResult {
  mfaRequired: false;
  mfaSetupRequired: true;
  setupToken: string;
}

export type LoginResult = MfaChallengeResult | MfaSetupRequiredResult | TokenResult;

/** BRD §18: privileged accounts must use MFA. */
const MFA_REQUIRED_ROLES = ['PLATFORM_ADMIN', 'ORG_ADMIN', 'AREA_MANAGER', 'CENTRE_ADMIN'];
const RECOVERY_CODE_COUNT = 8;
const RECOVERY_CODE_PATTERN = /^[a-z0-9]{5}-[a-z0-9]{5}$/;
const RECOVERY_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const SETUP_TOKEN_TTL = '10m';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Policy is read at call time so deployments (and tests) can change it without a rebuild. */
function mfaEnforced(): boolean {
  return process.env.MFA_ENFORCEMENT === 'required';
}

/**
 * Absolute session length: a shift for staff, long-lived for parents, who open
 * the app briefly and should not be asked for a password every day. Refreshing
 * never extends it, so a stolen refresh token has a hard end.
 */
function sessionLifetimeMs(role: string): number {
  if (role === 'PARENT') return Number(process.env.SESSION_MAX_DAYS_PARENT ?? 30) * 24 * 60 * 60 * 1000;
  return Number(process.env.SESSION_MAX_HOURS_STAFF ?? 12) * 60 * 60 * 1000;
}

function newRecoveryCode(): string {
  const pick = () => Array.from({ length: 5 }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]).join('');
  return `${pick()}-${pick()}`;
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
    private readonly tenancy: TenancyService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    // Optional so older call sites and tests keep working; the running app provides both.
    @Optional() private readonly features?: FeaturesService,
    @Optional() private readonly branding?: BrandingService,
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      // No orgId known yet on a failed/unknown login — log centrally without
      // a tenant (the audit table's RLS policy will hide this row from
      // tenant-scoped reads, which is fine: it's a platform-level security event).
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.mfaEnabled) {
      const mfaToken = this.jwt.sign({ sub: user.id, mfaPending: true }, { expiresIn: '2m' });
      return { mfaRequired: true, mfaToken };
    }

    // Privileged accounts without MFA cannot get a session at all: they get a
    // short-lived token that only works for enrolling.
    if (mfaEnforced() && MFA_REQUIRED_ROLES.includes(user.role)) {
      const setupToken = this.jwt.sign({ sub: user.id, mfaSetup: true }, { expiresIn: SETUP_TOKEN_TTL });
      return { mfaRequired: false, mfaSetupRequired: true, setupToken };
    }

    return this.issueTokens(user);
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

    const normalised = code.trim().toLowerCase();
    if (RECOVERY_CODE_PATTERN.test(normalised)) {
      if (await this.consumeRecoveryCode(user.id, user.orgId, user.role, normalised)) return this.issueTokens(user);
    } else if (authenticator.verify({ token: code, secret: user.mfaSecret })) {
      return this.issueTokens(user);
    }

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

  /** Single-use: the matching hash is removed, conditionally, so two requests cannot spend the same code. */
  private async consumeRecoveryCode(userId: string, orgId: string | null, role: UserRole, code: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { mfaRecoveryHashes: true } });
    for (const hash of user?.mfaRecoveryHashes ?? []) {
      if (!(await bcrypt.compare(code, hash))) continue;
      const remaining = (user?.mfaRecoveryHashes ?? []).filter((h) => h !== hash);
      const claimed = await this.prisma.user.updateMany({
        where: { id: userId, mfaRecoveryHashes: { has: hash } },
        data: { mfaRecoveryHashes: remaining },
      });
      if (claimed.count !== 1) return false;
      await this.audit.record({
        orgId: orgId ?? 'unknown',
        actorUserId: userId,
        actorRole: role,
        action: 'auth.mfa.recovery_used',
        entityType: 'User',
        entityId: userId,
        outcome: 'SUCCESS',
        metadata: { remaining: remaining.length },
      });
      return true;
    }
    return false;
  }

  /**
   * Enrolment, step 1: generates a TOTP secret and holds it as PENDING. MFA is
   * not switched on until a code from it is confirmed, so a typo or a lost
   * phone cannot lock the account out.
   */
  async enrollMfa(userId: string): Promise<{ secret: string; otpauthUrl: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const secret = authenticator.generateSecret();
    await this.prisma.user.update({ where: { id: userId }, data: { mfaPendingSecret: secret } });
    return { secret, otpauthUrl: authenticator.keyuri(user.email, 'Next-Gen Childcare', secret) };
  }

  /** Enrolment, step 2: a valid code proves the authenticator works. Returns single-use recovery codes, shown once. */
  async confirmMfaEnrollment(userId: string, code: string): Promise<{ recoveryCodes: string[] }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.mfaPendingSecret) throw new BadRequestException('Start enrolment first');

    if (!authenticator.verify({ token: code, secret: user.mfaPendingSecret })) {
      await this.audit.record({
        orgId: user.orgId ?? 'unknown',
        actorUserId: user.id,
        actorRole: user.role,
        action: 'auth.mfa.confirm',
        entityType: 'User',
        entityId: user.id,
        outcome: 'DENIED',
      });
      throw new UnauthorizedException('Invalid MFA code');
    }

    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
    // Cost 8, not 10: these are ~52 bits of random entropy (not human-chosen), so a lower work factor is
    // still far beyond brute force, and pure-JS bcrypt at cost 10 makes enrolment take seconds.
    const mfaRecoveryHashes = await Promise.all(recoveryCodes.map((c) => bcrypt.hash(c, 8)));
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: user.mfaPendingSecret, mfaEnabled: true, mfaPendingSecret: null, mfaRecoveryHashes },
    });
    await this.audit.record({
      orgId: user.orgId ?? 'unknown',
      actorUserId: user.id,
      actorRole: user.role,
      action: 'auth.mfa.confirm',
      entityType: 'User',
      entityId: user.id,
      outcome: 'SUCCESS',
    });
    return { recoveryCodes };
  }

  private subjectOfSetupToken(setupToken: string): string {
    try {
      const payload = this.jwt.verify<{ sub: string; mfaSetup?: boolean }>(setupToken);
      if (payload.mfaSetup === true) return payload.sub;
    } catch {
      /* fall through */
    }
    throw new UnauthorizedException('MFA setup session expired, please log in again');
  }

  /** Forced enrolment (no session yet): the setup token from login stands in for being signed in. */
  async startMfaSetup(setupToken: string): Promise<{ secret: string; otpauthUrl: string }> {
    return this.enrollMfa(this.subjectOfSetupToken(setupToken));
  }

  /** Confirms the code, then (and only then) creates the session. */
  async finishMfaSetup(setupToken: string, code: string): Promise<TokenResult & { recoveryCodes: string[] }> {
    const userId = this.subjectOfSetupToken(setupToken);
    const { recoveryCodes } = await this.confirmMfaEnrollment(userId, code);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return { ...(await this.issueTokens(user)), recoveryCodes };
  }

  /** Creates the session (absolute lifetime by role), a short-lived access token and the first refresh token. */
  private async issueTokens(user: { id: string; orgId: string | null; centreId: string | null; role: string }): Promise<TokenResult> {
    const sessionId = uuidv4();
    const expiresAt = new Date(Date.now() + sessionLifetimeMs(user.role));
    await this.prisma.session.create({ data: { id: sessionId, userId: user.id, expiresAt } });
    const refreshToken = await this.createRefreshToken(sessionId, expiresAt);
    return { mfaRequired: false, ...this.signAccessToken(user, sessionId), refreshToken };
  }

  private signAccessToken(
    user: { id: string; orgId: string | null; centreId: string | null; role: string },
    sessionId: string,
  ): { accessToken: string; expiresIn: number } {
    const payload: JwtPayload = { sub: user.id, orgId: user.orgId, centreId: user.centreId, role: user.role as JwtPayload['role'], sessionId };
    const accessToken = this.jwt.sign(payload);
    const { exp, iat } = this.jwt.decode(accessToken) as { exp: number; iat: number };
    return { accessToken, expiresIn: exp - iat };
  }

  private async createRefreshToken(sessionId: string, expiresAt: Date): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.prisma.refreshToken.create({ data: { sessionId, tokenHash: sha256(token), expiresAt } });
    return token;
  }

  /**
   * Swaps a refresh token for a new access token and a new refresh token.
   * Each refresh token works once. Presenting one a second time means it was
   * copied, so the whole session is revoked; the real user signs in again.
   */
  async refresh(refreshToken: string, now: Date = new Date()): Promise<TokenResult> {
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      include: { session: { include: { user: true } } },
    });
    if (!row) throw new UnauthorizedException('Invalid refresh token');

    const { session } = row;
    if (session.revokedAt || session.expiresAt.getTime() <= now.getTime() || !session.user) {
      throw new UnauthorizedException('Session has ended, please log in again');
    }
    if (row.expiresAt.getTime() <= now.getTime()) throw new UnauthorizedException('Refresh token expired');

    // The conditional update is the lock: only one caller can flip usedAt from null.
    const claimed = await this.prisma.refreshToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) {
      await this.prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      await this.audit.record({
        orgId: session.user.orgId ?? 'unknown',
        centreId: session.user.centreId,
        actorUserId: session.user.id,
        actorRole: session.user.role,
        action: 'auth.refresh.reuse_detected',
        entityType: 'Session',
        entityId: session.id,
        outcome: 'DENIED',
      });
      throw new UnauthorizedException('Refresh token already used, please log in again');
    }

    // Same session, same absolute expiry: refreshing never extends it.
    const next = await this.createRefreshToken(session.id, session.expiresAt);
    await this.prisma.refreshToken.update({
      where: { id: row.id },
      data: { replacedById: (await this.prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: sha256(next) } })).id },
    });
    return { mfaRequired: false, ...this.signAccessToken(session.user, session.id), refreshToken: next };
  }

  /** Revokes a session so its already-issued JWT and every refresh token are rejected on the next request. */
  async logout(sessionId: string): Promise<void> {
    await this.prisma.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
  }

  /** The JWT payload has no name/email — the UI needs this after login to render anything. */
  async getProfile(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { organisation: true },
    });
    const centre =
      user.centreId && user.orgId
        ? await this.tenancy.withTenant({ orgId: user.orgId, centreId: user.centreId }, (tx) =>
            tx.centre.findUnique({ where: { id: user.centreId as string } }),
          )
        : null;

    // What the apps need to look and behave right for this person's organisation and centre.
    const subject: RequestUser = { userId: user.id, orgId: user.orgId, centreId: user.centreId, role: user.role, sessionId: 'profile' };
    const [enabledModules, brand] = await Promise.all([this.features?.enabledKeys(subject), this.branding?.getBrand(subject)]);

    return {
      userId: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      orgId: user.orgId,
      orgName: user.organisation?.name ?? null,
      centreId: user.centreId,
      centreName: centre?.name ?? null,
      mfaEnabled: user.mfaEnabled,
      ...(enabledModules ? { enabledModules } : {}),
      ...(brand ? { brand } : {}),
    };
  }
}
