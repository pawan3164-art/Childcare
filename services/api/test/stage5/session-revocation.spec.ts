import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuthService } from '../../src/auth/auth.service';
import { JwtStrategy } from '../../src/auth/strategies/jwt.strategy';
import { JwtPayload } from '../../src/authorization/request-user.interface';
import { disconnectAll, fixturePrisma, uniqueSuffix } from '../test-utils';

/**
 * Stage 5 hardening finding: JwtStrategy previously never checked session
 * revocation, so logout (or a future remote-wipe) couldn't actually
 * invalidate an already-issued access token before its natural 15-minute
 * expiry. This proves the fix: a token is rejected immediately after logout.
 */
describe('Session revocation (Stage 5 hardening fix)', () => {
  let prismaService: PrismaService;
  let authService: AuthService;
  let jwtStrategy: JwtStrategy;
  const jwt = new JwtService({ secret: 'test-secret' });

  beforeAll(async () => {
    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    const tenancy = new TenancyService(prismaService);
    const audit = new AuditService(tenancy);
    authService = new AuthService(prismaService, tenancy, jwt, audit);
    jwtStrategy = new JwtStrategy(prismaService);
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await disconnectAll();
  });

  async function createLoggedInUser() {
    const passwordHash = await bcrypt.hash('correct-horse-battery-staple', 10);
    const user = await fixturePrisma.user.create({
      data: {
        email: `revoke-${uniqueSuffix()}@example.test`,
        passwordHash,
        role: 'EDUCATOR',
        firstName: 'R',
        lastName: 'V',
      },
    });
    const result = await authService.login(user.email, 'correct-horse-battery-staple');
    if (result.mfaRequired) throw new Error('unexpected MFA in test setup');
    return { user, accessToken: result.accessToken };
  }

  it('a token is valid immediately after login', async () => {
    const { accessToken } = await createLoggedInUser();
    const payload = jwt.decode(accessToken) as JwtPayload;

    await expect(jwtStrategy.validate(payload)).resolves.toMatchObject({ sessionId: payload.sessionId });
  });

  it('the same token is rejected immediately after logout, even though it has not expired', async () => {
    const { accessToken } = await createLoggedInUser();
    const payload = jwt.decode(accessToken) as JwtPayload;

    await authService.logout(payload.sessionId);

    await expect(jwtStrategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('a token referencing a session that never existed is rejected', async () => {
    const fakePayload: JwtPayload = {
      sub: 'nonexistent-user',
      orgId: null,
      centreId: null,
      role: 'EDUCATOR',
      sessionId: 'nonexistent-session',
    };
    await expect(jwtStrategy.validate(fakePayload)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
