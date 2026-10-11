import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import { JwtPayload } from '../../src/authorization/request-user.interface';
import { disconnectAll, fixturePrisma } from '../test-utils';
import { auditFor, buildHarness, createUser, enableMfa, Harness, loginOk, PASSWORD, Role, withEnv } from './helpers';

jest.setTimeout(60_000); // bcrypt-heavy (recovery codes)

/** OI-16: confirmed TOTP enrolment, recovery codes, and enforcement for admin roles. */
describe('MFA enrolment, recovery codes and enforcement (OI-16)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await buildHarness();
  });

  afterAll(async () => {
    await h.close();
    await disconnectAll();
  });

  const ADMIN_ROLES: Role[] = ['PLATFORM_ADMIN', 'ORG_ADMIN', 'CENTRE_ADMIN'];
  const RECOVERY_SHAPE = /^[a-z0-9]{5}-[a-z0-9]{5}$/;
  const dbUser = (id: string) => fixturePrisma.user.findUniqueOrThrow({ where: { id } }) as Promise<any>;
  const login = (email: string) => h.auth.login(email, PASSWORD) as Promise<any>;

  describe('two-step enrolment', () => {
    it('enrollMfa stores a PENDING secret and does not enable MFA', async () => {
      const user = await createUser('EDUCATOR');
      const { secret, otpauthUrl } = await h.auth.enrollMfa(user.id);
      expect(secret).toBeTruthy();
      expect(otpauthUrl).toContain('otpauth://totp/');
      const row = await dbUser(user.id);
      expect(row.mfaEnabled).toBe(false);
      expect(row.mfaSecret).toBeNull();
      expect(row.mfaPendingSecret).toBe(secret);
      // login is still a plain login while only pending
      const r = await login(user.email);
      expect(r.mfaRequired).toBe(false);
    });

    it('enrolling again replaces the pending secret and leaves an active secret untouched', async () => {
      const user = await createUser('EDUCATOR');
      const first = await h.auth.enrollMfa(user.id);
      const second = await h.auth.enrollMfa(user.id);
      expect(second.secret).not.toBe(first.secret);
      expect((await dbUser(user.id)).mfaPendingSecret).toBe(second.secret);

      const active = await createUser('EDUCATOR');
      const { secret } = await enableMfa(h, active.id);
      await h.auth.enrollMfa(active.id);
      const row = await dbUser(active.id);
      expect(row.mfaSecret).toBe(secret);
      expect(row.mfaEnabled).toBe(true);
      expect(row.mfaPendingSecret).not.toBe(secret);
    });

    it('confirmMfaEnrollment with a valid code enables MFA, clears pending, returns 8 recovery codes', async () => {
      const user = await createUser('EDUCATOR');
      const { secret } = await h.auth.enrollMfa(user.id);
      const { recoveryCodes } = await h.auth.confirmMfaEnrollment(user.id, authenticator.generate(secret));

      expect(recoveryCodes).toHaveLength(8);
      expect(new Set(recoveryCodes).size).toBe(8);
      for (const c of recoveryCodes) expect(c).toMatch(RECOVERY_SHAPE);

      const row = await dbUser(user.id);
      expect(row.mfaEnabled).toBe(true);
      expect(row.mfaSecret).toBe(secret);
      expect(row.mfaPendingSecret).toBeNull();
    });

    it('recovery codes are stored only as bcrypt hashes', async () => {
      const user = await createUser('EDUCATOR');
      const { recoveryCodes } = await enableMfa(h, user.id);
      const row = await dbUser(user.id);
      expect(row.mfaRecoveryHashes).toHaveLength(8);
      const blob = JSON.stringify(row);
      for (const c of recoveryCodes) expect(blob).not.toContain(c);
      for (const hash of row.mfaRecoveryHashes as string[]) expect(hash).toMatch(/^\$2[aby]\$/);
      for (const c of recoveryCodes) {
        const matches = await Promise.all((row.mfaRecoveryHashes as string[]).map((x) => bcrypt.compare(c, x)));
        expect(matches.filter(Boolean)).toHaveLength(1);
      }
    });

    it('a wrong code throws Unauthorized, audits auth.mfa.confirm DENIED and leaves MFA off', async () => {
      const user = await createUser('EDUCATOR');
      const { secret } = await h.auth.enrollMfa(user.id);
      const wrong = authenticator.generate(secret) === '000000' ? '111111' : '000000';
      await expect(h.auth.confirmMfaEnrollment(user.id, wrong)).rejects.toBeInstanceOf(UnauthorizedException);
      const row = await dbUser(user.id);
      expect(row.mfaEnabled).toBe(false);
      expect(row.mfaSecret).toBeNull();
      expect(row.mfaPendingSecret).toBe(secret);
      const entries = await auditFor('auth.mfa.confirm', user.id);
      expect(entries.some((e) => e.outcome === 'DENIED')).toBe(true);
    });

    it('a code generated from a different secret is rejected', async () => {
      const user = await createUser('EDUCATOR');
      await h.auth.enrollMfa(user.id);
      const other = authenticator.generateSecret();
      const code = authenticator.generate(other);
      await expect(h.auth.confirmMfaEnrollment(user.id, code)).rejects.toBeInstanceOf(UnauthorizedException);
      expect((await dbUser(user.id)).mfaEnabled).toBe(false);
    });

    it('no pending secret -> BadRequest', async () => {
      const user = await createUser('EDUCATOR');
      await expect(h.auth.confirmMfaEnrollment(user.id, '123456')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('verifyMfa with TOTP and recovery codes', () => {
    it('login returns mfaToken once enabled, and a current TOTP code completes login with a session + refresh token', async () => {
      const user = await createUser('EDUCATOR');
      const { secret } = await enableMfa(h, user.id);
      const l = await login(user.email);
      expect(l).toMatchObject({ mfaRequired: true });
      expect(typeof l.mfaToken).toBe('string');
      expect(l.accessToken).toBeUndefined();
      expect(l.refreshToken).toBeUndefined();
      expect(await fixturePrisma.session.count({ where: { userId: user.id } })).toBe(0);

      const done = (await h.auth.verifyMfa(l.mfaToken, authenticator.generate(secret))) as any;
      expect(done.mfaRequired).toBe(false);
      expect(done.expiresIn).toBe(900);
      expect(done.refreshToken).toMatch(/^[A-Za-z0-9_-]{43,}$/);
      const p = h.jwt.decode(done.accessToken) as JwtPayload;
      await expect(h.strategy.validate(p)).resolves.toMatchObject({ userId: user.id });
      expect(await fixturePrisma.session.count({ where: { userId: user.id } })).toBe(1);
    });

    it('wrong code -> Unauthorized and audit auth.mfa.verify DENIED', async () => {
      const user = await createUser('EDUCATOR');
      const { secret } = await enableMfa(h, user.id);
      const l = await login(user.email);
      const wrong = authenticator.generate(secret) === '000000' ? '111111' : '000000';
      await expect(h.auth.verifyMfa(l.mfaToken, wrong)).rejects.toBeInstanceOf(UnauthorizedException);
      const entries = await auditFor('auth.mfa.verify', user.id);
      expect(entries.some((e) => e.outcome === 'DENIED')).toBe(true);
    });

    it('a recovery code logs in once; the second use is Unauthorized; the other 7 stay usable', async () => {
      const user = await createUser('EDUCATOR');
      const { recoveryCodes } = await enableMfa(h, user.id);

      const l1 = await login(user.email);
      const ok = (await h.auth.verifyMfa(l1.mfaToken, recoveryCodes[0])) as any;
      expect(ok.mfaRequired).toBe(false);
      expect(ok.refreshToken).toBeTruthy();

      const l2 = await login(user.email);
      await expect(h.auth.verifyMfa(l2.mfaToken, recoveryCodes[0])).rejects.toBeInstanceOf(UnauthorizedException);

      for (const code of recoveryCodes.slice(1)) {
        const l = await login(user.email);
        const r = (await h.auth.verifyMfa(l.mfaToken, code)) as any;
        expect(r.mfaRequired).toBe(false);
      }
    });

    it('using a recovery code audits auth.mfa.recovery_used SUCCESS without any code in metadata', async () => {
      const user = await createUser('EDUCATOR');
      const { recoveryCodes } = await enableMfa(h, user.id);
      const l = await login(user.email);
      await h.auth.verifyMfa(l.mfaToken, recoveryCodes[3]);

      const entries = await auditFor('auth.mfa.recovery_used', user.id);
      expect(entries).toHaveLength(1);
      expect(entries[0].outcome).toBe('SUCCESS');
      const blob = JSON.stringify(entries[0]);
      for (const c of recoveryCodes) expect(blob).not.toContain(c);
    });

    it('a used recovery code is removed/invalidated in the DB (7 remain usable)', async () => {
      const user = await createUser('EDUCATOR');
      const { recoveryCodes } = await enableMfa(h, user.id);
      const l = await login(user.email);
      await h.auth.verifyMfa(l.mfaToken, recoveryCodes[0]);
      const row = await dbUser(user.id);
      const stillValid: boolean[] = await Promise.all(
        (row.mfaRecoveryHashes as string[]).map(async (x) => bcrypt.compare(recoveryCodes[0], x)),
      );
      expect(stillValid.some(Boolean)).toBe(false);
    });

    it('five wrong codes in a row are each Unauthorized and each audited', async () => {
      const user = await createUser('EDUCATOR');
      const { secret } = await enableMfa(h, user.id);
      const l = await login(user.email);
      const current = authenticator.generate(secret);
      const wrong = current === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) {
        await expect(h.auth.verifyMfa(l.mfaToken, wrong)).rejects.toBeInstanceOf(UnauthorizedException);
      }
      const entries = (await auditFor('auth.mfa.verify', user.id)).filter((e) => e.outcome === 'DENIED');
      expect(entries).toHaveLength(5);
      // the account still works afterwards
      const done = (await h.auth.verifyMfa(l.mfaToken, authenticator.generate(secret))) as any;
      expect(done.mfaRequired).toBe(false);
    });
  });

  describe('enforcement (MFA_ENFORCEMENT)', () => {
    it.each(ADMIN_ROLES)('required: unenrolled %s gets mfaSetupRequired + setupToken and NO session', async (role) => {
      await withEnv({ MFA_ENFORCEMENT: 'required' }, async () => {
        const user = await createUser(role);
        const r = await login(user.email);
        expect(r.mfaRequired).toBe(false);
        expect(r.mfaSetupRequired).toBe(true);
        expect(typeof r.setupToken).toBe('string');
        expect(r.accessToken).toBeUndefined();
        expect(r.refreshToken).toBeUndefined();
        expect(await fixturePrisma.session.count({ where: { userId: user.id } })).toBe(0);
        expect(await fixturePrisma.refreshToken.count({ where: { session: { userId: user.id } } })).toBe(0);
      });
    });

    it.each(['EDUCATOR', 'PARENT'] as Role[])('required: %s logs in normally and is never forced', async (role) => {
      await withEnv({ MFA_ENFORCEMENT: 'required' }, async () => {
        const user = await createUser(role);
        const r = await login(user.email);
        expect(r.mfaRequired).toBe(false);
        expect(r.mfaSetupRequired).toBeUndefined();
        expect(r.accessToken).toBeTruthy();
        expect(r.refreshToken).toBeTruthy();
      });
    });

    it.each([undefined, 'off'])('MFA_ENFORCEMENT=%s: unenrolled admins log in normally', async (mode) => {
      await withEnv({ MFA_ENFORCEMENT: mode }, async () => {
        for (const role of ADMIN_ROLES) {
          const user = await createUser(role);
          const r = await login(user.email);
          expect(r.mfaRequired).toBe(false);
          expect(r.mfaSetupRequired).toBeUndefined();
          expect(r.accessToken).toBeTruthy();
        }
      });
    });

    it.each(['required', 'off'])('MFA_ENFORCEMENT=%s: an enrolled admin goes through the normal MFA step', async (mode) => {
      await withEnv({ MFA_ENFORCEMENT: mode }, async () => {
        const user = await createUser('CENTRE_ADMIN');
        await enableMfa(h, user.id);
        const r = await login(user.email);
        expect(r.mfaRequired).toBe(true);
        expect(r.mfaToken).toBeTruthy();
        expect(r.mfaSetupRequired).toBeUndefined();
      });
    });

    it('an educator may opt in even when enforcement is required', async () => {
      await withEnv({ MFA_ENFORCEMENT: 'required' }, async () => {
        const user = await createUser('EDUCATOR');
        await enableMfa(h, user.id);
        expect((await login(user.email)).mfaRequired).toBe(true);
      });
    });

    it('the policy is read at call time (flipping the env var changes the next login)', async () => {
      const user = await createUser('CENTRE_ADMIN');
      await withEnv({ MFA_ENFORCEMENT: 'off' }, async () => {
        expect((await login(user.email)).accessToken).toBeTruthy();
      });
      await withEnv({ MFA_ENFORCEMENT: 'required' }, async () => {
        expect((await login(user.email)).mfaSetupRequired).toBe(true);
      });
    });
  });

  describe('setup flow with the setup token', () => {
    async function setupTokenFor(role: Role = 'CENTRE_ADMIN') {
      const user = await createUser(role);
      const r = await withEnv({ MFA_ENFORCEMENT: 'required' }, () => login(user.email));
      return { user, setupToken: r.setupToken as string };
    }

    it('setup token expires in 10 minutes and carries mfaSetup (not mfaPending)', async () => {
      const { user, setupToken } = await setupTokenFor();
      const p = h.jwt.decode(setupToken) as any;
      expect(p.exp - p.iat).toBe(600);
      expect(p.sub).toBe(user.id);
      expect(p.mfaSetup).toBe(true);
      expect(p.mfaPending).toBeFalsy();
      expect(p.sessionId).toBeUndefined();
    });

    it('startMfaSetup returns a secret + otpauthUrl and stores it as pending', async () => {
      const { user, setupToken } = await setupTokenFor();
      const { secret, otpauthUrl } = await h.auth.startMfaSetup(setupToken);
      expect(otpauthUrl).toContain('otpauth://totp/');
      const row = await dbUser(user.id);
      expect(row.mfaPendingSecret).toBe(secret);
      expect(row.mfaEnabled).toBe(false);
    });

    it('finishMfaSetup with a valid code creates the session only now and returns tokens + 8 recovery codes', async () => {
      const { user, setupToken } = await setupTokenFor();
      const { secret } = await h.auth.startMfaSetup(setupToken);
      expect(await fixturePrisma.session.count({ where: { userId: user.id } })).toBe(0);

      const done = await h.auth.finishMfaSetup(setupToken, authenticator.generate(secret));
      expect(done.mfaRequired).toBe(false);
      expect(done.expiresIn).toBe(900);
      expect(done.refreshToken).toMatch(/^[A-Za-z0-9_-]{43,}$/);
      expect(done.recoveryCodes).toHaveLength(8);
      for (const c of done.recoveryCodes) expect(c).toMatch(RECOVERY_SHAPE);

      expect(await fixturePrisma.session.count({ where: { userId: user.id } })).toBe(1);
      const row = await dbUser(user.id);
      expect(row.mfaEnabled).toBe(true);
      expect(row.mfaSecret).toBe(secret);
      expect(row.mfaPendingSecret).toBeNull();
      await expect(h.strategy.validate(h.jwt.decode(done.accessToken) as JwtPayload)).resolves.toMatchObject({ userId: user.id });

      // next login is the normal MFA step
      const next = await withEnv({ MFA_ENFORCEMENT: 'required' }, () => login(user.email));
      expect(next.mfaRequired).toBe(true);
    });

    it('finishMfaSetup with a wrong code is Unauthorized, audited, and creates no session', async () => {
      const { user, setupToken } = await setupTokenFor();
      const { secret } = await h.auth.startMfaSetup(setupToken);
      const wrong = authenticator.generate(secret) === '000000' ? '111111' : '000000';
      await expect(h.auth.finishMfaSetup(setupToken, wrong)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(await fixturePrisma.session.count({ where: { userId: user.id } })).toBe(0);
      expect((await dbUser(user.id)).mfaEnabled).toBe(false);
      const denied = await fixturePrisma.auditLogEntry.findMany({
        where: { actorUserId: user.id, outcome: 'DENIED', action: { startsWith: 'auth.mfa.' } },
      });
      expect(denied.length).toBeGreaterThanOrEqual(1);
    });

    it('five wrong codes in a row are each Unauthorized and audited, then the right code still works', async () => {
      const { user, setupToken } = await setupTokenFor();
      const { secret } = await h.auth.startMfaSetup(setupToken);
      const wrong = authenticator.generate(secret) === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) {
        await expect(h.auth.finishMfaSetup(setupToken, wrong)).rejects.toBeInstanceOf(UnauthorizedException);
      }
      const denied = await fixturePrisma.auditLogEntry.findMany({
        where: { actorUserId: user.id, outcome: 'DENIED', action: { startsWith: 'auth.mfa.' } },
      });
      expect(denied).toHaveLength(5);
      const done = await h.auth.finishMfaSetup(setupToken, authenticator.generate(secret));
      expect(done.mfaRequired).toBe(false);
    });

    it('finishMfaSetup without a prior startMfaSetup (no pending secret) is rejected', async () => {
      const { user, setupToken } = await setupTokenFor();
      await expect(h.auth.finishMfaSetup(setupToken, '123456')).rejects.toThrow();
      expect(await fixturePrisma.session.count({ where: { userId: user.id } })).toBe(0);
    });

    it('garbage, expired and wrong-type tokens are Unauthorized for both start and finish', async () => {
      const user = await createUser('CENTRE_ADMIN');
      const expired = h.jwt.sign({ sub: user.id, mfaSetup: true }, { expiresIn: '-10s' });
      const { secret } = await enableMfa(h, (await createUser('EDUCATOR')).id);

      const mfaUser = await createUser('CENTRE_ADMIN');
      await enableMfa(h, mfaUser.id);
      const mfaPending = (await login(mfaUser.email)).mfaToken as string;

      const plain = await createUser('EDUCATOR');
      const access = (await loginOk(h, plain.email)).accessToken;

      const noFlag = h.jwt.sign({ sub: user.id });

      for (const bad of ['not-a-jwt', '', expired, mfaPending, access, noFlag]) {
        await expect((async () => h.auth.startMfaSetup(bad))()).rejects.toBeInstanceOf(UnauthorizedException);
        await expect(h.auth.finishMfaSetup(bad, authenticator.generate(secret))).rejects.toBeInstanceOf(UnauthorizedException);
      }
      expect(await fixturePrisma.session.count({ where: { userId: user.id } })).toBe(0);
    });

    it('a setup token cannot be used as an mfaToken in verifyMfa, nor an mfaToken in finishMfaSetup', async () => {
      const { setupToken } = await setupTokenFor();
      await expect(h.auth.verifyMfa(setupToken, '123456')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('a setup token is rejected by JwtStrategy.validate (never an access token)', async () => {
      const { setupToken } = await setupTokenFor();
      const payload = h.jwt.decode(setupToken) as unknown as JwtPayload;
      await expect(h.strategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
