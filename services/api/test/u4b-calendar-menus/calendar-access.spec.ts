import { BadRequestException } from '@nestjs/common';
import { disconnectAll } from '../test-utils';
import { NOW, buildCalendar, expectNoInternals, fixturePrisma, link, makeChild, makeUser, seedEvent, setupFamily } from './helpers';

describe('U4b calendar: listing and access', () => {
  let svc: any;
  beforeAll(async () => {
    svc = (await buildCalendar()).service;
  });
  afterAll(async () => {
    await disconnectAll();
  });

  it('returns events sorted by startsAt ascending with the documented shape', async () => {
    const f = await setupFamily('cal-list');
    const late = await seedEvent(f.tenant, f.admin.userId, { title: 'Late', startsAt: '2026-10-25T00:00:00Z' });
    const early = await seedEvent(f.tenant, f.admin.userId, { title: 'Early', startsAt: '2026-10-16T00:00:00Z', endsAt: '2026-10-16T02:00:00Z' });
    const mid = await seedEvent(f.tenant, f.admin.userId, { title: 'Mid', startsAt: '2026-10-20T00:00:00Z' });
    const out = await svc.listEvents(f.admin, {}, NOW);
    expect(out.map((e: any) => e.id)).toEqual([early.id, mid.id, late.id]);
    expect(out[0]).toMatchObject({ id: early.id, title: 'Early', roomId: null, allDay: false, cancelledAt: null, cancelReason: null });
    expect(out[0].startsAt).toBeInstanceOf(Date);
    expect(out[0].endsAt).toBeInstanceOf(Date);
    expectNoInternals(out);
  });

  it('defaults to today through +60 days in centre local time', async () => {
    const f = await setupFamily('cal-default');
    // Local (Sydney, UTC+11) today = 2026-10-14, so local midnight = 2026-10-13T13:00Z.
    const before = await seedEvent(f.tenant, f.admin.userId, { title: 'Before', startsAt: '2026-10-13T12:59:00Z' });
    const first = await seedEvent(f.tenant, f.admin.userId, { title: 'First', startsAt: '2026-10-13T13:00:00Z' });
    const inside = await seedEvent(f.tenant, f.admin.userId, { title: 'Inside', startsAt: '2026-12-01T00:00:00Z' });
    const beyond = await seedEvent(f.tenant, f.admin.userId, { title: 'Beyond', startsAt: '2027-01-20T00:00:00Z' });
    const ids = (await svc.listEvents(f.admin, {}, NOW)).map((e: any) => e.id);
    expect(ids).toContain(first.id);
    expect(ids).toContain(inside.id);
    expect(ids).not.toContain(before.id);
    expect(ids).not.toContain(beyond.id);
  });

  it('from/to are inclusive local dates', async () => {
    const f = await setupFamily('cal-range');
    const a = await seedEvent(f.tenant, f.admin.userId, { startsAt: '2026-11-01T00:00:00Z' });
    const b = await seedEvent(f.tenant, f.admin.userId, { startsAt: '2026-11-10T00:00:00Z' });
    const c = await seedEvent(f.tenant, f.admin.userId, { startsAt: '2026-11-20T00:00:00Z' });
    const ids = (await svc.listEvents(f.admin, { from: '2026-11-05', to: '2026-11-15' }, NOW)).map((e: any) => e.id);
    expect(ids).toEqual([b.id]);
    expect(ids).not.toContain(a.id);
    expect(ids).not.toContain(c.id);
    const onlyTo = await svc.listEvents(f.admin, { to: '2026-11-10' }, NOW);
    expect(onlyTo.map((e: any) => e.id)).toContain(a.id);
  });

  it('rejects an invalid date, to before from, and ranges over 366 days', async () => {
    const f = await setupFamily('cal-range-bad');
    await expect(svc.listEvents(f.admin, { from: 'nope' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.listEvents(f.admin, { from: '2026-11-10', to: '2026-11-01' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.listEvents(f.admin, { from: '2026-01-01', to: '2027-06-01' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.listEvents(f.admin, { from: '2026-10-01', to: '2027-03-01' }, NOW)).resolves.toBeDefined();
  });

  it('cancelled events are listed with cancelledAt and cancelReason', async () => {
    const f = await setupFamily('cal-cancelled-list');
    const e = await seedEvent(f.tenant, f.admin.userId, { cancelled: true });
    const out = await svc.listEvents(f.admin, {}, NOW);
    const row = out.find((x: any) => x.id === e.id);
    expect(row.cancelledAt).toBeInstanceOf(Date);
    expect(row.cancelReason).toBe('Seeded cancel');
    expectNoInternals(out);
  });

  describe('read matrix', () => {
    it('CENTRE_ADMIN and ORG_ADMIN see every event of their centre, room-specific included', async () => {
      const f = await setupFamily('cal-admin');
      const room2 = await fixturePrisma.room.create({ data: { orgId: f.tenant.orgId, centreId: f.tenant.centreId, name: 'R2' } });
      const wide = await seedEvent(f.tenant, f.admin.userId, { startsAt: '2026-10-20T00:00:00Z' });
      const r1 = await seedEvent(f.tenant, f.admin.userId, { startsAt: '2026-10-21T00:00:00Z', roomId: f.tenant.roomId });
      const r2 = await seedEvent(f.tenant, f.admin.userId, { startsAt: '2026-10-22T00:00:00Z', roomId: room2.id });
      const orgAdmin = await makeUser(f.tenant, 'ORG_ADMIN');
      for (const u of [f.admin, orgAdmin]) {
        const ids = (await svc.listEvents(u, {}, NOW)).map((e: any) => e.id);
        expect(ids).toEqual([wide.id, r1.id, r2.id]);
      }
    });

    it('educators see all events of their centre', async () => {
      const f = await setupFamily('cal-edu');
      const room2 = await fixturePrisma.room.create({ data: { orgId: f.tenant.orgId, centreId: f.tenant.centreId, name: 'R2' } });
      const wide = await seedEvent(f.tenant, f.admin.userId, { startsAt: '2026-10-20T00:00:00Z' });
      const other = await seedEvent(f.tenant, f.admin.userId, { startsAt: '2026-10-21T00:00:00Z', roomId: room2.id });
      const ids = (await svc.listEvents(f.educator, {}, NOW)).map((e: any) => e.id);
      expect(ids).toEqual([wide.id, other.id]);
    });

    it('parents see centre-wide events and events of rooms their linked children are enrolled in', async () => {
      const f = await setupFamily('cal-parent');
      const room2 = await fixturePrisma.room.create({ data: { orgId: f.tenant.orgId, centreId: f.tenant.centreId, name: 'R2' } });
      const wide = await seedEvent(f.tenant, f.admin.userId, { startsAt: '2026-10-20T00:00:00Z' });
      const mine = await seedEvent(f.tenant, f.admin.userId, { startsAt: '2026-10-21T00:00:00Z', roomId: f.tenant.roomId });
      const theirs = await seedEvent(f.tenant, f.admin.userId, { startsAt: '2026-10-22T00:00:00Z', roomId: room2.id });
      const out = await svc.listEvents(f.parent, {}, NOW);
      const ids = out.map((e: any) => e.id);
      expect(ids).toEqual([wide.id, mine.id]);
      expect(ids).not.toContain(theirs.id);
      expectNoInternals(out);
    });

    it('a parent with a second child in another room sees both rooms', async () => {
      const f = await setupFamily('cal-parent-two');
      const room2 = await fixturePrisma.room.create({ data: { orgId: f.tenant.orgId, centreId: f.tenant.centreId, name: 'R2' } });
      const kid2 = await makeChild(f.tenant, { roomId: room2.id });
      await link(f.tenant, f.parent, kid2.id);
      const a = await seedEvent(f.tenant, f.admin.userId, { startsAt: '2026-10-21T00:00:00Z', roomId: f.tenant.roomId });
      const b = await seedEvent(f.tenant, f.admin.userId, { startsAt: '2026-10-22T00:00:00Z', roomId: room2.id });
      const ids = (await svc.listEvents(f.parent, {}, NOW)).map((e: any) => e.id);
      expect(ids).toEqual([a.id, b.id]);
    });

    it('a parent whose child is not in a room sees only centre-wide events; moving the child back restores room events', async () => {
      const f = await setupFamily('cal-parent-noroom');
      const wide = await seedEvent(f.tenant, f.admin.userId, { startsAt: '2026-10-20T00:00:00Z' });
      const room = await seedEvent(f.tenant, f.admin.userId, { startsAt: '2026-10-21T00:00:00Z', roomId: f.tenant.roomId });
      await fixturePrisma.child.update({ where: { id: f.child.id }, data: { roomId: null } });
      expect((await svc.listEvents(f.parent, {}, NOW)).map((e: any) => e.id)).toEqual([wide.id]);
      await fixturePrisma.child.update({ where: { id: f.child.id }, data: { roomId: f.tenant.roomId } });
      expect((await svc.listEvents(f.parent, {}, NOW)).map((e: any) => e.id)).toEqual([wide.id, room.id]);
    });

    it('a parent with no linked child at the centre sees nothing', async () => {
      const f = await setupFamily('cal-parent-nolink');
      await seedEvent(f.tenant, f.admin.userId, { startsAt: '2026-10-20T00:00:00Z' });
      const stranger = await makeUser(f.tenant, 'PARENT');
      expect(await svc.listEvents(stranger, {}, NOW)).toEqual([]);
    });
  });

  describe('tenant isolation', () => {
    it('never shows another centre or org events to any role', async () => {
      const a = await setupFamily('cal-iso-a');
      const b = await setupFamily('cal-iso-b');
      const mine = await seedEvent(a.tenant, a.admin.userId, { startsAt: '2026-10-20T00:00:00Z' });
      const theirs = await seedEvent(b.tenant, b.admin.userId, { startsAt: '2026-10-20T00:00:00Z' });
      const sibling = await fixturePrisma.centre.create({ data: { orgId: a.tenant.orgId, name: 'Sibling centre' } });
      const sibEvent = await seedEvent({ orgId: a.tenant.orgId, centreId: sibling.id }, a.admin.userId, { startsAt: '2026-10-20T00:00:00Z' });
      for (const u of [a.admin, a.educator, a.parent]) {
        const ids = (await svc.listEvents(u, {}, NOW)).map((e: any) => e.id);
        expect(ids).toEqual([mine.id]);
        expect(ids).not.toContain(theirs.id);
        expect(ids).not.toContain(sibEvent.id);
      }
    });
  });
});
