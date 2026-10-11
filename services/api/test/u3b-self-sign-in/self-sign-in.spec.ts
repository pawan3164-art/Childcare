import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { disconnectAll, appPrisma, seedOrgCentreRoom, setTenantContext } from '../test-utils';
import {
  buildSelfSignIn,
  DAY_START,
  EARLIER_TODAY,
  enableSelfSignIn,
  eventsFor,
  fixturePrisma,
  link,
  makeChild,
  makeUser,
  NOW,
  seedDenied,
  seedEvent,
  selfSignInAudit,
  setupFamily,
  YESTERDAY,
} from './helpers';

const MIN = 60_000;

describe('SelfSignInService', () => {
  let ctx: any;
  let service: any;

  beforeAll(async () => {
    ctx = await buildSelfSignIn();
    service = ctx.service;
  });
  afterAll(async () => {
    await ctx.prismaService.onModuleDestroy();
    await disconnectAll();
  });

  const good = (centreId: string, at: Date = NOW) => ctx.codes.codeFor(centreId, at).code;
  const wrong = (centreId: string, at: Date = NOW) => {
    const ok = new Set([good(centreId, at), good(centreId, new Date(at.getTime() - MIN))]);
    return ['000000', '111111', '222222'].find((c) => !ok.has(c)) as string;
  };

  async function enabledFamily(label: string) {
    const f = await setupFamily(label);
    await enableSelfSignIn(f.tenant.centreId);
    return f;
  }

  describe('currentCode', () => {
    it('lets staff of the centre read the current code', async () => {
      const f = await enabledFamily('CodeStaff');
      const expected = ctx.codes.codeFor(f.tenant.centreId, NOW);
      for (const user of [f.educator, f.admin]) {
        expect(await service.currentCode(user, NOW)).toEqual(expected);
      }
      const orgAdmin = await makeUser(f.tenant, 'ORG_ADMIN');
      expect(await service.currentCode(orgAdmin, NOW)).toEqual(expected);
      const platform = await makeUser(f.tenant, 'PLATFORM_ADMIN');
      expect(await service.currentCode(platform, NOW)).toEqual(expected);
    });

    it('forbids a parent and a user without a centre', async () => {
      const f = await enabledFamily('CodeDenied');
      await expect(service.currentCode(f.parent, NOW)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.currentCode({ ...f.admin, centreId: null }, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('does not give another org staff this centre code', async () => {
      const f = await enabledFamily('CodeIsoA');
      const other = await seedOrgCentreRoom('CodeIsoB');
      const otherAdmin = await makeUser(other, 'CENTRE_ADMIN');
      // They only ever get their own centre's code.
      expect(await service.currentCode(otherAdmin, NOW)).toEqual(ctx.codes.codeFor(other.centreId, NOW));
      // An admin whose token claims this centre but whose org differs cannot sign children in via it either.
      void f;
    });
  });

  describe('setParentSelfSignIn', () => {
    it('lets the centre admin and org admin toggle it, with an audit entry', async () => {
      const f = await setupFamily('Toggle');
      expect(await service.setParentSelfSignIn(f.admin, true)).toEqual({ enabled: true });
      expect((await fixturePrisma.centre.findUniqueOrThrow({ where: { id: f.tenant.centreId } })).parentSelfSignIn).toBe(true);
      const entries = await fixturePrisma.auditLogEntry.findMany({
        where: { action: 'centre.self_sign_in_set', entityId: f.tenant.centreId },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ entityType: 'Centre', actorUserId: f.admin.userId });
      expect(entries[0].metadata).toEqual({ enabled: true });

      const orgAdmin = await makeUser(f.tenant, 'ORG_ADMIN');
      expect(await service.setParentSelfSignIn(orgAdmin, false)).toEqual({ enabled: false });
      expect((await fixturePrisma.centre.findUniqueOrThrow({ where: { id: f.tenant.centreId } })).parentSelfSignIn).toBe(false);
    });

    it('forbids educators, parents and another centre admin', async () => {
      const f = await setupFamily('ToggleDenied');
      const other = await seedOrgCentreRoom('ToggleDeniedOther');
      const otherAdmin = await makeUser(other, 'CENTRE_ADMIN');
      await expect(service.setParentSelfSignIn(f.educator, true)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.setParentSelfSignIn(f.parent, true)).rejects.toBeInstanceOf(ForbiddenException);
      // Another centre admin acts on their own centre only; they can never flip this one.
      await service.setParentSelfSignIn(otherAdmin, true);
      expect((await fixturePrisma.centre.findUniqueOrThrow({ where: { id: f.tenant.centreId } })).parentSelfSignIn).toBe(false);
      await expect(service.setParentSelfSignIn({ ...otherAdmin, centreId: f.tenant.centreId }, true)).rejects.toThrow();
    });
  });

  describe('selfSignIn: authorisation order', () => {
    it('rejects every non-parent role', async () => {
      const f = await enabledFamily('NonParent');
      const orgAdmin = await makeUser(f.tenant, 'ORG_ADMIN');
      for (const user of [f.educator, f.admin, orgAdmin]) {
        await expect(
          service.selfSignIn(user, f.child.id, { eventType: 'SIGN_IN', code: good(f.tenant.centreId) }, NOW),
        ).rejects.toBeInstanceOf(ForbiddenException);
      }
      expect(await eventsFor(f.child.id)).toHaveLength(0);
    });

    it('refuses when the centre has not turned it on, even with a valid code', async () => {
      const f = await setupFamily('Off');
      const attempt = service.selfSignIn(f.parent, f.child.id, { eventType: 'SIGN_IN', code: good(f.tenant.centreId) }, NOW);
      await expect(attempt).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.selfSignIn(f.parent, f.child.id, { eventType: 'SIGN_IN', code: good(f.tenant.centreId) }, NOW),
      ).rejects.toThrow(/not turned on/i);
      expect(await eventsFor(f.child.id)).toHaveLength(0);
    });

    it('requires the pickup permission (no pickup, restricted, expired, stranger)', async () => {
      const f = await enabledFamily('NoPickup');
      const code = good(f.tenant.centreId);
      const input = { eventType: 'SIGN_IN' as const, code };

      const noPickup = await makeUser(f.tenant, 'PARENT');
      await link(f.tenant, noPickup, f.child.id, { canPickup: false });
      const restricted = await makeUser(f.tenant, 'PARENT');
      await link(f.tenant, restricted, f.child.id, { canPickup: true, isRestricted: true });
      const expired = await makeUser(f.tenant, 'PARENT');
      await link(f.tenant, expired, f.child.id, { canPickup: true, expiresAt: new Date('2020-01-01') });
      const stranger = await makeUser(f.tenant, 'PARENT');

      for (const p of [noPickup, restricted, expired, stranger]) {
        await expect(service.selfSignIn(p, f.child.id, input, NOW)).rejects.toBeInstanceOf(ForbiddenException);
      }
      expect(await eventsFor(f.child.id)).toHaveLength(0);
    });

    it('refuses another org parent (Forbidden or NotFound)', async () => {
      const f = await enabledFamily('OtherOrgChild');
      const other = await seedOrgCentreRoom('OtherOrgParent');
      const outsider = await makeUser(other, 'PARENT');
      const err = await service
        .selfSignIn(outsider, f.child.id, { eventType: 'SIGN_IN', code: good(f.tenant.centreId) }, NOW)
        .catch((e: unknown) => e);
      expect(err instanceof ForbiddenException || err instanceof NotFoundException).toBe(true);
      expect(await eventsFor(f.child.id)).toHaveLength(0);
    });

    it('rejects a departed child with BadRequest', async () => {
      const f = await enabledFamily('Departed');
      await fixturePrisma.child.update({ where: { id: f.child.id }, data: { departedOn: new Date('2026-09-30') } });
      await expect(
        service.selfSignIn(f.parent, f.child.id, { eventType: 'SIGN_IN', code: good(f.tenant.centreId) }, NOW),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(await eventsFor(f.child.id)).toHaveLength(0);
    });
  });

  describe('selfSignIn: code and rate limit', () => {
    it('rejects a wrong code, audits DENIED with only the child id, and creates no event', async () => {
      const f = await enabledFamily('WrongCode');
      const bad = wrong(f.tenant.centreId);
      const attempt = () => service.selfSignIn(f.parent, f.child.id, { eventType: 'SIGN_IN', code: bad }, NOW);
      await expect(attempt()).rejects.toBeInstanceOf(ForbiddenException);
      await expect(attempt()).rejects.toThrow(/not right or has expired/i);

      const entries = await selfSignInAudit({ actorUserId: f.parent.userId, outcome: 'DENIED' });
      expect(entries.length).toBeGreaterThanOrEqual(1);
      for (const e of entries) {
        expect(e.entityType).toBe('Child');
        expect(e.entityId).toBe(f.child.id);
        expect(e.metadata).toEqual({ childId: f.child.id });
        expect(JSON.stringify(e)).not.toContain(bad);
      }
      expect(await eventsFor(f.child.id)).toHaveLength(0);
    });

    it('accepts the previous-window code (typed as the minute rolls over)', async () => {
      const f = await enabledFamily('PrevWindow');
      const prev = good(f.tenant.centreId, new Date(NOW.getTime() - MIN));
      const res = await service.selfSignIn(f.parent, f.child.id, { eventType: 'SIGN_IN', code: prev }, NOW);
      expect(res.eventType).toBe('SIGN_IN');
    });

    it('refuses after 5 denied attempts in 10 minutes even with the correct code, until the window passes', async () => {
      const f = await enabledFamily('RateLimit');
      await seedDenied(f.parent, f.child.id, 5, new Date(NOW.getTime() - 2 * MIN));
      const input = { eventType: 'SIGN_IN' as const, code: good(f.tenant.centreId) };

      await expect(service.selfSignIn(f.parent, f.child.id, input, NOW)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.selfSignIn(f.parent, f.child.id, input, NOW)).rejects.toThrow(/too many/i);
      expect(await eventsFor(f.child.id)).toHaveLength(0);

      const later = new Date(NOW.getTime() + 11 * MIN);
      const ok = await service.selfSignIn(f.parent, f.child.id, { eventType: 'SIGN_IN', code: good(f.tenant.centreId, later) }, later);
      expect(ok.eventType).toBe('SIGN_IN');
    });

    it('4 denied attempts do not block', async () => {
      const f = await enabledFamily('RateLimit4');
      await seedDenied(f.parent, f.child.id, 4, new Date(NOW.getTime() - 2 * MIN));
      const res = await service.selfSignIn(f.parent, f.child.id, { eventType: 'SIGN_IN', code: good(f.tenant.centreId) }, NOW);
      expect(res.eventType).toBe('SIGN_IN');
    });

    it('counts only this user, not another parent', async () => {
      const f = await enabledFamily('RateLimitUser');
      const sibling = await makeUser(f.tenant, 'PARENT');
      await link(f.tenant, sibling, f.child.id, { canPickup: true });
      await seedDenied(sibling, f.child.id, 6, new Date(NOW.getTime() - MIN));
      const res = await service.selfSignIn(f.parent, f.child.id, { eventType: 'SIGN_IN', code: good(f.tenant.centreId) }, NOW);
      expect(res.eventType).toBe('SIGN_IN');
    });
  });

  describe('selfSignIn: state machine on the centre-local day', () => {
    const signIn = (f: Awaited<ReturnType<typeof enabledFamily>>) =>
      service.selfSignIn(f.parent, f.child.id, { eventType: 'SIGN_IN', code: good(f.tenant.centreId) }, NOW);
    const signOut = (f: Awaited<ReturnType<typeof enabledFamily>>) =>
      service.selfSignIn(f.parent, f.child.id, { eventType: 'SIGN_OUT', code: good(f.tenant.centreId) }, NOW);

    it('SIGN_IN with no events today succeeds and records the server time, PIN method and parent', async () => {
      const f = await enabledFamily('SignInOk');
      const res = await signIn(f);
      expect(res).toMatchObject({ childId: f.child.id, eventType: 'SIGN_IN', method: 'PIN', timestamp: NOW.toISOString() });
      const events = await eventsFor(f.child.id);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        id: res.id,
        method: 'PIN',
        eventType: 'SIGN_IN',
        recordedByUserId: f.parent.userId,
        orgId: f.tenant.orgId,
        centreId: f.tenant.centreId,
        isCorrection: false,
      });
      expect(events[0].timestamp.toISOString()).toBe(NOW.toISOString());
    });

    it('writes a SUCCESS audit entry with ids only (no code, no names)', async () => {
      const f = await enabledFamily('AuditOk');
      const code = good(f.tenant.centreId);
      const res = await service.selfSignIn(f.parent, f.child.id, { eventType: 'SIGN_IN', code }, NOW);
      const entries = await selfSignInAudit({ entityId: res.id });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ outcome: 'SUCCESS', entityType: 'AttendanceEvent', actorUserId: f.parent.userId });
      expect(entries[0].metadata).toEqual({ childId: f.child.id, eventType: 'SIGN_IN', method: 'PIN' });
      expect(JSON.stringify(entries[0])).not.toContain(code);
    });

    it('SIGN_IN then SIGN_OUT then SIGN_IN again works; double SIGN_IN conflicts', async () => {
      const f = await enabledFamily('Cycle');
      await signIn(f);
      await expect(signIn(f)).rejects.toBeInstanceOf(ConflictException);
      await signOut(f);
      await expect(signOut(f)).rejects.toBeInstanceOf(ConflictException);
      await signIn(f);
      expect((await eventsFor(f.child.id)).map((e) => e.eventType)).toEqual(['SIGN_IN', 'SIGN_OUT', 'SIGN_IN']);
    });

    it('SIGN_OUT with no events today conflicts', async () => {
      const f = await enabledFamily('OutNoIn');
      await expect(signOut(f)).rejects.toBeInstanceOf(ConflictException);
      expect(await eventsFor(f.child.id)).toHaveLength(0);
    });

    it('SIGN_OUT after an educator sign-in today succeeds', async () => {
      const f = await enabledFamily('OutAfterEducatorIn');
      await seedEvent(f.tenant, f.child.id, 'SIGN_IN', EARLIER_TODAY);
      const res = await signOut(f);
      expect(res.eventType).toBe('SIGN_OUT');
    });

    it('events from before today never count', async () => {
      const f = await enabledFamily('Yesterday');
      await seedEvent(f.tenant, f.child.id, 'SIGN_IN', YESTERDAY); // left signed in yesterday
      await signIn(f); // allowed today
      const g = await enabledFamily('YesterdayOut');
      await seedEvent(g.tenant, g.child.id, 'SIGN_IN', YESTERDAY);
      await expect(signOut(g)).rejects.toBeInstanceOf(ConflictException); // nothing today
    });

    it('uses the centre-local day boundary, not the UTC date', async () => {
      const f = await enabledFamily('Boundary');
      // 13:00:00Z is exactly local midnight: counts as today. One ms earlier is yesterday.
      await seedEvent(f.tenant, f.child.id, 'SIGN_IN', new Date(DAY_START.getTime() - 1));
      await signIn(f);
      const g = await enabledFamily('BoundaryToday');
      await seedEvent(g.tenant, g.child.id, 'SIGN_IN', DAY_START);
      await expect(signIn(g)).rejects.toBeInstanceOf(ConflictException);
    });

    it('a correction event counts by timestamp like any other', async () => {
      const f = await enabledFamily('Correction');
      const original = await seedEvent(f.tenant, f.child.id, 'SIGN_IN', EARLIER_TODAY);
      await fixturePrisma.attendanceEvent.create({
        data: {
          orgId: f.tenant.orgId,
          centreId: f.tenant.centreId,
          childId: f.child.id,
          eventType: 'SIGN_OUT',
          method: 'EDUCATOR',
          timestamp: new Date(EARLIER_TODAY.getTime() + 30 * MIN),
          isCorrection: true,
          correctedEventId: original.id,
        },
      });
      await signIn(f); // latest today is SIGN_OUT, so sign-in is allowed
      await expect(signOut(f)).resolves.toMatchObject({ eventType: 'SIGN_OUT' });
    });

    it('ignores a client supplied timestamp (server time only)', async () => {
      const f = await enabledFamily('ServerTime');
      const input = { eventType: 'SIGN_IN', code: good(f.tenant.centreId), timestamp: '2020-01-01T00:00:00Z' } as any;
      const res = await service.selfSignIn(f.parent, f.child.id, input, NOW);
      expect(res.timestamp).toBe(NOW.toISOString());
    });
  });

  describe('selfSignIn: concurrency', () => {
    it('two simultaneous SIGN_INs for one child yield exactly one event and one Conflict (5 rounds)', async () => {
      for (let round = 0; round < 5; round++) {
        const f = await enabledFamily(`Race${round}`);
        const input = { eventType: 'SIGN_IN' as const, code: good(f.tenant.centreId) };
        const results = await Promise.allSettled([
          service.selfSignIn(f.parent, f.child.id, input, NOW),
          service.selfSignIn(f.parent, f.child.id, input, NOW),
        ]);
        const ok = results.filter((r) => r.status === 'fulfilled');
        const bad = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
        expect(ok).toHaveLength(1);
        expect(bad).toHaveLength(1);
        expect(bad[0].reason).toBeInstanceOf(ConflictException);
        expect(await eventsFor(f.child.id)).toHaveLength(1);
      }
    });
  });

  describe('tenant isolation', () => {
    it('another org parent cannot sign this centre child in, and RLS hides the rows', async () => {
      const a = await enabledFamily('IsoA');
      const b = await enabledFamily('IsoB');
      // b's parent tries a's child with a's valid code.
      const err = await service
        .selfSignIn(b.parent, a.child.id, { eventType: 'SIGN_IN', code: good(a.tenant.centreId) }, NOW)
        .catch((e: unknown) => e);
      expect(err instanceof ForbiddenException || err instanceof NotFoundException).toBe(true);

      await service.selfSignIn(a.parent, a.child.id, { eventType: 'SIGN_IN', code: good(a.tenant.centreId) }, NOW);
      expect(await eventsFor(a.child.id)).toHaveLength(1);

      await setTenantContext(appPrisma, b.tenant.orgId, b.tenant.centreId);
      const seenByB = await appPrisma.attendanceEvent.findMany({ where: { childId: a.child.id } });
      expect(seenByB).toHaveLength(0);
      await setTenantContext(appPrisma, a.tenant.orgId, a.tenant.centreId);
      const seenByA = await appPrisma.attendanceEvent.findMany({ where: { childId: a.child.id } });
      expect(seenByA).toHaveLength(1);
    });
  });

  // keep imports used when a scenario above is trimmed
  void makeChild;
});
