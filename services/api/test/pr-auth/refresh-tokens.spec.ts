import { UnauthorizedException } from '@nestjs/common';
import { JwtPayload } from '../../src/authorization/request-user.interface';
import { disconnectAll, fixturePrisma } from '../test-utils';
import { auditFor, buildHarness, createUser, Harness, loginOk, sha256Hex } from './helpers';

/**
 * OI-28: refresh tokens. Opaque, hashed at rest, rotated on every use, with
 * reuse detection that revokes the whole session.
 */
describe('Refresh tokens (OI-28)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await buildHarness();
  });

  afterAll(async () => {
    await h.close();
    await disconnectAll();
  });

  const payloadOf = (token: string) => h.jwt.decode(token) as JwtPayload;

  describe('login issues a refresh token', () => {
    it('returns accessToken, refreshToken and expiresIn=900', async () => {
      const user = await createUser('EDUCATOR');
      const r = await loginOk(h, user.email);
      expect(typeof r.accessToken).toBe('string');
      expect(r.refreshToken).toMatch(/^[A-Za-z0-9_-]{43,}$/);
      expect(r.expiresIn).toBe(900);
      const p = h.jwt.decode(r.accessToken) as { exp: number; iat: number };
      expect(p.exp - p.iat).toBe(900);
    });

    it('stores only the sha256 hash; the raw token is in no column', async () => {
      const user = await createUser('EDUCATOR');
      const r = await loginOk(h, user.email);
      const sessionId = payloadOf(r.accessToken).sessionId;
      const rows = await fixturePrisma.refreshToken.findMany({ where: { sessionId } });
      expect(rows).toHaveLength(1);
      expect(rows[0].tokenHash).toBe(sha256Hex(r.refreshToken));
      expect(JSON.stringify(rows[0])).not.toContain(r.refreshToken);
      expect(rows[0].usedAt).toBeNull();
      expect(rows[0].replacedById).toBeNull();
      const session = await fixturePrisma.session.findUniqueOrThrow({ where: { id: sessionId } });
      expect(rows[0].expiresAt.getTime()).toBe(session.expiresAt.getTime());
    });

    it('also does not exist anywhere in the raw table (full-row text search)', async () => {
      const user = await createUser('EDUCATOR');
      const r = await loginOk(h, user.email);
      const found = await fixturePrisma.$queryRawUnsafe<unknown[]>(
        `SELECT 1 FROM refresh_tokens rt WHERE rt::text LIKE '%' || $1 || '%'`,
        r.refreshToken,
      );
      expect(found).toHaveLength(0);
    });

    it('tokenHash is UNIQUE', async () => {
      const user = await createUser('EDUCATOR');
      const r = await loginOk(h, user.email);
      const sessionId = payloadOf(r.accessToken).sessionId;
      await expect(
        fixturePrisma.refreshToken.create({
          data: { sessionId, tokenHash: sha256Hex(r.refreshToken), expiresAt: new Date(Date.now() + 60_000) },
        }),
      ).rejects.toThrow();
    });
  });

  describe('rotation', () => {
    it('returns a new access token and a new refresh token on the same session', async () => {
      const user = await createUser('EDUCATOR');
      const r = await loginOk(h, user.email);
      const rotated = await h.auth.refresh(r.refreshToken);

      expect(rotated.mfaRequired).toBe(false);
      expect(rotated.refreshToken).not.toBe(r.refreshToken);
      expect(rotated.refreshToken).toMatch(/^[A-Za-z0-9_-]{43,}$/);
      expect(rotated.expiresIn).toBe(900);
      expect(payloadOf(rotated.accessToken).sessionId).toBe(payloadOf(r.accessToken).sessionId);
      await expect(h.strategy.validate(payloadOf(rotated.accessToken))).resolves.toMatchObject({
        userId: user.id,
        sessionId: payloadOf(r.accessToken).sessionId,
      });
    });

    it('marks the old row usedAt + replacedById and stores the new one hashed', async () => {
      const user = await createUser('EDUCATOR');
      const r = await loginOk(h, user.email);
      const rotated = await h.auth.refresh(r.refreshToken);

      const oldRow = await fixturePrisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: sha256Hex(r.refreshToken) } });
      const newRow = await fixturePrisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: sha256Hex(rotated.refreshToken) } });
      expect(oldRow.usedAt).not.toBeNull();
      expect(oldRow.replacedById).toBe(newRow.id);
      expect(newRow.usedAt).toBeNull();
      expect(newRow.sessionId).toBe(oldRow.sessionId);
      expect(JSON.stringify(newRow)).not.toContain(rotated.refreshToken);
    });

    it('the old refresh token no longer works, the new chain keeps working', async () => {
      const user = await createUser('EDUCATOR');
      const r = await loginOk(h, user.email);
      const r2 = await h.auth.refresh(r.refreshToken);
      const r3 = await h.auth.refresh(r2.refreshToken);
      expect(r3.refreshToken).not.toBe(r2.refreshToken);
      await expect(h.strategy.validate(payloadOf(r3.accessToken))).resolves.toBeDefined();
    });

    it('does not extend the absolute session lifetime', async () => {
      const user = await createUser('EDUCATOR');
      const r = await loginOk(h, user.email);
      const sessionId = payloadOf(r.accessToken).sessionId;
      const before = await fixturePrisma.session.findUniqueOrThrow({ where: { id: sessionId } });
      const rotated = await h.auth.refresh(r.refreshToken);
      const after = await fixturePrisma.session.findUniqueOrThrow({ where: { id: sessionId } });
      expect(after.expiresAt.getTime()).toBe(before.expiresAt.getTime());
      const newRow = await fixturePrisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: sha256Hex(rotated.refreshToken) } });
      expect(newRow.expiresAt.getTime()).toBe(before.expiresAt.getTime());
    });
  });

  describe('reuse detection', () => {
    it('presenting a used token revokes the session, the latest tokens, and audits without token material', async () => {
      const user = await createUser('EDUCATOR');
      const r = await loginOk(h, user.email);
      const sessionId = payloadOf(r.accessToken).sessionId;
      const latest = await h.auth.refresh(r.refreshToken);

      await expect(h.auth.refresh(r.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);

      const session = await fixturePrisma.session.findUniqueOrThrow({ where: { id: sessionId } });
      expect(session.revokedAt).not.toBeNull();
      await expect(h.strategy.validate(payloadOf(latest.accessToken))).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(h.auth.refresh(latest.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);

      const entries = await auditFor('auth.refresh.reuse_detected', sessionId);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ entityType: 'Session', outcome: 'DENIED', actorUserId: user.id });
      const blob = JSON.stringify(entries[0]);
      for (const secret of [r.refreshToken, latest.refreshToken, sha256Hex(r.refreshToken), sha256Hex(latest.refreshToken)]) {
        expect(blob).not.toContain(secret);
      }
    });

    it('two concurrent refreshes with the same token: exactly one succeeds, session then revoked', async () => {
      const user = await createUser('EDUCATOR');
      const r = await loginOk(h, user.email);
      const sessionId = payloadOf(r.accessToken).sessionId;

      const results = await Promise.allSettled([h.auth.refresh(r.refreshToken), h.auth.refresh(r.refreshToken)]);
      const ok = results.filter((x) => x.status === 'fulfilled');
      const bad = results.filter((x) => x.status === 'rejected') as PromiseRejectedResult[];
      expect(ok).toHaveLength(1);
      expect(bad).toHaveLength(1);
      expect(bad[0].reason).toBeInstanceOf(UnauthorizedException);

      const session = await fixturePrisma.session.findUniqueOrThrow({ where: { id: sessionId } });
      expect(session.revokedAt).not.toBeNull();
    });
  });

  describe('rejections', () => {
    it('unknown token', async () => {
      await expect(h.auth.refresh('x'.repeat(43))).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('expired token (now beyond expiresAt)', async () => {
      const user = await createUser('EDUCATOR');
      const r = await loginOk(h, user.email);
      const row = await fixturePrisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: sha256Hex(r.refreshToken) } });
      const later = new Date(row.expiresAt.getTime() + 1000);
      await expect(h.auth.refresh(r.refreshToken, later)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('session revoked via logout', async () => {
      const user = await createUser('EDUCATOR');
      const r = await loginOk(h, user.email);
      await h.auth.logout(payloadOf(r.accessToken).sessionId);
      await expect(h.auth.refresh(r.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('logout revokes all refresh tokens of the session, including rotated ones', async () => {
      const user = await createUser('EDUCATOR');
      const r = await loginOk(h, user.email);
      const r2 = await h.auth.refresh(r.refreshToken);
      await h.auth.logout(payloadOf(r2.accessToken).sessionId);
      await expect(h.auth.refresh(r2.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(h.strategy.validate(payloadOf(r2.accessToken))).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('session past its absolute expiry', async () => {
      const user = await createUser('EDUCATOR');
      const r = await loginOk(h, user.email);
      const sessionId = payloadOf(r.accessToken).sessionId;
      await fixturePrisma.session.update({ where: { id: sessionId }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await expect(h.auth.refresh(r.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('user no longer exists', async () => {
      const user = await createUser('EDUCATOR');
      const r = await loginOk(h, user.email);
      const sessionId = payloadOf(r.accessToken).sessionId;
      // Remove dependants then the user (fixture connection bypasses RLS).
      await fixturePrisma.refreshToken.deleteMany({ where: { sessionId } });
      await fixturePrisma.session.deleteMany({ where: { userId: user.id } });
      await fixturePrisma.user.delete({ where: { id: user.id } });
      await expect(h.auth.refresh(r.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('session independence', () => {
    it('refresh tokens of two sessions of one user are independent', async () => {
      const user = await createUser('EDUCATOR');
      const a = await loginOk(h, user.email);
      const b = await loginOk(h, user.email);
      expect(payloadOf(a.accessToken).sessionId).not.toBe(payloadOf(b.accessToken).sessionId);

      await h.auth.logout(payloadOf(a.accessToken).sessionId);
      await expect(h.auth.refresh(a.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
      const bRotated = await h.auth.refresh(b.refreshToken);
      await expect(h.strategy.validate(payloadOf(bRotated.accessToken))).resolves.toBeDefined();
    });
  });

  describe('JwtStrategy', () => {
    it('rejects a mfaSetup payload so a setup token can never act as an access token', async () => {
      const user = await createUser('EDUCATOR');
      const r = await loginOk(h, user.email);
      const real = payloadOf(r.accessToken);
      const forged = { ...real, mfaSetup: true } as unknown as JwtPayload;
      await expect(h.strategy.validate(forged)).rejects.toThrow(/MFA not completed/);
      await expect(h.strategy.validate(forged)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
