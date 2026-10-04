import { UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { JwtStrategy } from '../../src/auth/strategies/jwt.strategy';
import { JwtPayload } from '../../src/authorization/request-user.interface';
import { disconnectAll, fixturePrisma, seedOrgCentreRoom } from '../test-utils';
import { makeUser } from './security-fixtures';

/**
 * Security finding H4:
 *  - JwtStrategy.validate only checked that the Session row existed and was
 *    not revoked. It did not check the session belongs to payload.sub, did
 *    not check session.expiresAt, and trusted role/orgId/centreId straight
 *    from the token — so a token minted with a stale or forged role claim
 *    (or leaked dev secret) was honoured as-is.
 *  - The JWT secret fell back to the literal 'dev-only-change-me' in every
 *    environment, including production. A new resolveJwtSecret() in
 *    src/auth/jwt-secret.ts must fail closed in production.
 */
describe('H4: JwtStrategy.validate binds the token to a live session and the DB user', () => {
  let prismaService: PrismaService;
  let jwtStrategy: JwtStrategy;

  beforeAll(async () => {
    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    jwtStrategy = new JwtStrategy(prismaService);
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await disconnectAll();
  });

  const HOUR = 60 * 60 * 1000;

  async function seedSession(expiresAt = new Date(Date.now() + HOUR)) {
    const tenant = await seedOrgCentreRoom('H4Jwt');
    const owner = await makeUser('PARENT', tenant.orgId, tenant.centreId, 'h4-owner');
    const session = await fixturePrisma.session.create({ data: { userId: owner.id, expiresAt } });
    return { tenant, owner, session };
  }

  it('accepts a token whose sub owns a live session (sanity)', async () => {
    const { owner, session } = await seedSession();
    const payload: JwtPayload = { sub: owner.id, orgId: owner.orgId, centreId: owner.centreId, role: 'PARENT', sessionId: session.id };
    await expect(jwtStrategy.validate(payload)).resolves.toMatchObject({ userId: owner.id, sessionId: session.id });
  });

  it('(a) rejects when the session belongs to a different user than payload.sub', async () => {
    const { tenant, session } = await seedSession();
    const attacker = await makeUser('CENTRE_ADMIN', tenant.orgId, tenant.centreId, 'h4-other');
    const payload: JwtPayload = { sub: attacker.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'CENTRE_ADMIN', sessionId: session.id };
    await expect(jwtStrategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('(b) rejects when session.expiresAt is in the past, even if not revoked', async () => {
    const { owner, session } = await seedSession(new Date(Date.now() - 60 * 1000));
    expect(session.revokedAt).toBeNull();
    const payload: JwtPayload = { sub: owner.id, orgId: owner.orgId, centreId: owner.centreId, role: 'PARENT', sessionId: session.id };
    await expect(jwtStrategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('(c) returns role/orgId/centreId from the DB user row, not the token claims', async () => {
    const { owner, session } = await seedSession();
    const elsewhere = await seedOrgCentreRoom('H4Elsewhere');
    const payload: JwtPayload = {
      sub: owner.id,
      orgId: elsewhere.orgId,
      centreId: elsewhere.centreId,
      role: 'PLATFORM_ADMIN',
      sessionId: session.id,
    };
    const result = await jwtStrategy.validate(payload);
    expect(result).toEqual({
      userId: owner.id,
      orgId: owner.orgId,
      centreId: owner.centreId,
      role: 'PARENT',
      sessionId: session.id,
    });
  });

  it('(c) reflects a role change made after the token was issued', async () => {
    const { owner, session } = await seedSession();
    const payload: JwtPayload = { sub: owner.id, orgId: owner.orgId, centreId: owner.centreId, role: 'PARENT', sessionId: session.id };
    await fixturePrisma.user.update({ where: { id: owner.id }, data: { role: 'EDUCATOR' } });
    await expect(jwtStrategy.validate(payload)).resolves.toMatchObject({ role: 'EDUCATOR' });
  });
});

/**
 * src/auth/jwt-secret.ts does not exist yet. Loading it lazily (instead of a
 * static import) keeps this a per-test assertion failure rather than a
 * TypeScript compile error that would take down the whole file.
 */
function loadResolveJwtSecret(): (() => string) | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const mod = require('../../src/auth/jwt-secret') as { resolveJwtSecret?: () => string };
    return mod.resolveJwtSecret;
  } catch {
    return undefined;
  }
}

describe('H4: resolveJwtSecret() fails closed in production', () => {
  const originalSecret = process.env.JWT_SECRET;
  const originalNodeEnv = process.env.NODE_ENV;
  const STRONG = 'k'.repeat(48);

  function setEnv(nodeEnv: string, secret: string | undefined) {
    process.env.NODE_ENV = nodeEnv;
    if (secret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = secret;
  }

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  function resolver(): () => string {
    const fn = loadResolveJwtSecret();
    expect(fn).toEqual(expect.any(Function));
    return fn as () => string;
  }

  it('is exported from src/auth/jwt-secret.ts', () => {
    expect(loadResolveJwtSecret()).toEqual(expect.any(Function));
  });

  it('throws in production when JWT_SECRET is unset', () => {
    const resolve = resolver();
    setEnv('production', undefined);
    expect(() => resolve()).toThrow();
  });

  it('throws in production when JWT_SECRET is shorter than 32 characters', () => {
    const resolve = resolver();
    setEnv('production', 'a'.repeat(31));
    expect(() => resolve()).toThrow();
  });

  it('throws in production when JWT_SECRET is the dev placeholder', () => {
    const resolve = resolver();
    setEnv('production', 'dev-only-change-me');
    expect(() => resolve()).toThrow();
  });

  it('returns the configured secret in production when it is strong enough', () => {
    const resolve = resolver();
    setEnv('production', STRONG);
    expect(resolve()).toBe(STRONG);
  });

  it.each(['development', 'test'])('returns a non-empty dev fallback in %s when JWT_SECRET is unset', (nodeEnv) => {
    const resolve = resolver();
    setEnv(nodeEnv, undefined);
    const secret = resolve();
    expect(typeof secret).toBe('string');
    expect(secret.length).toBeGreaterThan(0);
  });
});
