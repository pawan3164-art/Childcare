import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { authenticator } from 'otplib';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuthService } from '../../src/auth/auth.service';
import { JwtStrategy } from '../../src/auth/strategies/jwt.strategy';
import { fixturePrisma, seedOrgCentreRoom, uniqueSuffix } from '../test-utils';

export const PASSWORD = 'correct-horse-battery-staple';

export type Role = 'PLATFORM_ADMIN' | 'ORG_ADMIN' | 'CENTRE_ADMIN' | 'EDUCATOR' | 'PARENT';

export interface Harness {
  prisma: PrismaService;
  auth: AuthService;
  strategy: JwtStrategy;
  jwt: JwtService;
  close: () => Promise<void>;
}

export async function buildHarness(): Promise<Harness> {
  const prisma = new PrismaService();
  await prisma.onModuleInit();
  const tenancy = new TenancyService(prisma);
  const audit = new AuditService(tenancy);
  const jwt = new JwtService({ secret: 'test-secret', signOptions: { expiresIn: '15m' } });
  const auth = new AuthService(prisma, tenancy, jwt, audit);
  const strategy = new JwtStrategy(prisma);
  return {
    prisma,
    auth,
    strategy,
    jwt,
    close: async () => {
      await prisma.onModuleDestroy();
    },
  };
}

export async function createUser(role: Role = 'EDUCATOR', opts: { withOrg?: boolean } = {}) {
  const withOrg = opts.withOrg ?? role !== 'PLATFORM_ADMIN';
  const tenant = withOrg ? await seedOrgCentreRoom(`auth-${role}`) : null;
  const user = await fixturePrisma.user.create({
    data: {
      email: `pr-auth-${uniqueSuffix()}@example.test`,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      role,
      orgId: tenant?.orgId ?? null,
      centreId: role === 'ORG_ADMIN' || role === 'PLATFORM_ADMIN' ? null : (tenant?.centreId ?? null),
      firstName: 'T',
      lastName: 'U',
    },
  });
  return user;
}

/** Logs in a non-MFA user and returns the (typed loosely) token result. */
export async function loginOk(h: Harness, email: string) {
  const r = (await h.auth.login(email, PASSWORD)) as any;
  if (r.mfaRequired !== false || !r.accessToken) throw new Error(`unexpected login result ${JSON.stringify(Object.keys(r))}`);
  return r as { mfaRequired: false; accessToken: string; refreshToken: string; expiresIn: number };
}

/** Enrols and confirms MFA for a user; returns secret + recovery codes. */
export async function enableMfa(h: Harness, userId: string) {
  const { secret } = await h.auth.enrollMfa(userId);
  const { recoveryCodes } = await h.auth.confirmMfaEnrollment(userId, authenticator.generate(secret));
  return { secret, recoveryCodes };
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export async function auditFor(action: string, entityId: string) {
  return fixturePrisma.auditLogEntry.findMany({ where: { action, entityId }, orderBy: { timestamp: 'asc' } });
}

export async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}
