import { JwtPayload } from '../../src/authorization/request-user.interface';
import { disconnectAll, fixturePrisma } from '../test-utils';
import { buildHarness, createUser, Harness, loginOk, Role, withEnv } from './helpers';

/** OI-28: absolute session lifetime by role, independent of the 15-minute access JWT. */
describe('Session absolute lifetime (OI-28)', () => {
  let h: Harness;
  const HOUR = 3600_000;
  const DAY = 24 * HOUR;
  const TOLERANCE_MS = 10_000;

  beforeAll(async () => {
    h = await buildHarness();
  });

  afterAll(async () => {
    await h.close();
    await disconnectAll();
  });

  async function sessionExpiryFor(role: Role) {
    const user = await createUser(role);
    const before = Date.now();
    const r = await loginOk(h, user.email);
    const sessionId = (h.jwt.decode(r.accessToken) as JwtPayload).sessionId;
    const sessions = await fixturePrisma.session.findMany({ where: { userId: user.id } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(sessionId);
    return { expiresAt: sessions[0].expiresAt.getTime(), before, r };
  }

  it('staff default is 12 hours', async () => {
    await withEnv({ SESSION_MAX_HOURS_STAFF: undefined, SESSION_MAX_DAYS_PARENT: undefined }, async () => {
      for (const role of ['EDUCATOR', 'CENTRE_ADMIN'] as Role[]) {
        const { expiresAt, before } = await sessionExpiryFor(role);
        expect(Math.abs(expiresAt - (before + 12 * HOUR))).toBeLessThan(TOLERANCE_MS);
      }
    });
  });

  it('parent default is 30 days', async () => {
    await withEnv({ SESSION_MAX_HOURS_STAFF: undefined, SESSION_MAX_DAYS_PARENT: undefined }, async () => {
      const { expiresAt, before } = await sessionExpiryFor('PARENT');
      expect(Math.abs(expiresAt - (before + 30 * DAY))).toBeLessThan(TOLERANCE_MS);
    });
  });

  it('SESSION_MAX_HOURS_STAFF changes the staff lifetime (read at call time)', async () => {
    await withEnv({ SESSION_MAX_HOURS_STAFF: '2' }, async () => {
      const { expiresAt, before } = await sessionExpiryFor('EDUCATOR');
      expect(Math.abs(expiresAt - (before + 2 * HOUR))).toBeLessThan(TOLERANCE_MS);
    });
    await withEnv({ SESSION_MAX_HOURS_STAFF: '48' }, async () => {
      const { expiresAt, before } = await sessionExpiryFor('EDUCATOR');
      expect(Math.abs(expiresAt - (before + 48 * HOUR))).toBeLessThan(TOLERANCE_MS);
    });
  });

  it('SESSION_MAX_DAYS_PARENT changes the parent lifetime and does not affect staff', async () => {
    await withEnv({ SESSION_MAX_DAYS_PARENT: '7', SESSION_MAX_HOURS_STAFF: '12' }, async () => {
      const parent = await sessionExpiryFor('PARENT');
      expect(Math.abs(parent.expiresAt - (parent.before + 7 * DAY))).toBeLessThan(TOLERANCE_MS);
      const staff = await sessionExpiryFor('EDUCATOR');
      expect(Math.abs(staff.expiresAt - (staff.before + 12 * HOUR))).toBeLessThan(TOLERANCE_MS);
    });
  });

  it('SESSION_MAX_HOURS_STAFF does not affect parents', async () => {
    await withEnv({ SESSION_MAX_HOURS_STAFF: '1', SESSION_MAX_DAYS_PARENT: '30' }, async () => {
      const { expiresAt, before } = await sessionExpiryFor('PARENT');
      expect(Math.abs(expiresAt - (before + 30 * DAY))).toBeLessThan(TOLERANCE_MS);
    });
  });

  it('every non-parent role uses the staff lifetime', async () => {
    await withEnv({ SESSION_MAX_HOURS_STAFF: '5', MFA_ENFORCEMENT: 'off' }, async () => {
      for (const role of ['PLATFORM_ADMIN', 'ORG_ADMIN', 'CENTRE_ADMIN', 'EDUCATOR'] as Role[]) {
        const { expiresAt, before } = await sessionExpiryFor(role);
        expect(Math.abs(expiresAt - (before + 5 * HOUR))).toBeLessThan(TOLERANCE_MS);
      }
    });
  });

  it('the access JWT still expires in 15 minutes regardless of session lifetime', async () => {
    await withEnv({ SESSION_MAX_DAYS_PARENT: '30' }, async () => {
      const { r } = await sessionExpiryFor('PARENT');
      const p = h.jwt.decode(r.accessToken) as { exp: number; iat: number };
      expect(p.exp - p.iat).toBe(900);
      expect(r.expiresIn).toBe(900);
    });
  });

  it('the refresh token row expiry equals the session expiry', async () => {
    const user = await createUser('PARENT');
    const r = await loginOk(h, user.email);
    const sessionId = (h.jwt.decode(r.accessToken) as JwtPayload).sessionId;
    const session = await fixturePrisma.session.findUniqueOrThrow({ where: { id: sessionId } });
    const rows = await fixturePrisma.refreshToken.findMany({ where: { sessionId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].expiresAt.getTime()).toBe(session.expiresAt.getTime());
  });

  it('a refresh after the shortened session lifetime fails even though the refresh token is unused', async () => {
    await withEnv({ SESSION_MAX_HOURS_STAFF: '1' }, async () => {
      const user = await createUser('EDUCATOR');
      const r = await loginOk(h, user.email);
      const later = new Date(Date.now() + 2 * HOUR);
      await expect(h.auth.refresh(r.refreshToken, later)).rejects.toThrow();
    });
  });
});
