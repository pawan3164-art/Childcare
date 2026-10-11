import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { disconnectAll } from '../test-utils';
import { NOW, auditFor, buildCalendar, expectNoInternals, fixturePrisma, makeUser, seedEvent, setupFamily } from './helpers';

describe('U4b calendar: writes', () => {
  let h: Awaited<ReturnType<typeof buildCalendar>>;
  let svc: any;
  beforeAll(async () => {
    h = await buildCalendar();
    svc = h.service;
  });
  afterAll(async () => {
    await disconnectAll();
  });
  afterEach(() => jest.restoreAllMocks());

  const base = { title: 'Open day', startsAt: '2026-10-30T23:00:00Z' };

  describe('createEvent', () => {
    it('creates a centre-wide event with trimmed title and the documented shape', async () => {
      const f = await setupFamily('ce-create');
      const e = await svc.createEvent(f.admin, { title: '  Open day  ', description: 'Bring a hat', startsAt: '2026-10-30T23:00:00Z', endsAt: '2026-10-31T02:00:00Z' }, NOW);
      expect(e).toMatchObject({ title: 'Open day', description: 'Bring a hat', allDay: false, roomId: null, cancelledAt: null, cancelReason: null });
      expect(e.id).toBeTruthy();
      expect(e.startsAt).toBeInstanceOf(Date);
      expect(e.endsAt).toBeInstanceOf(Date);
      expectNoInternals(e);
      const row = await fixturePrisma.centreEvent.findUniqueOrThrow({ where: { id: e.id } });
      expect(row.centreId).toBe(f.tenant.centreId);
      expect(row.orgId).toBe(f.tenant.orgId);
      expect(row.createdByUserId).toBe(f.admin.userId);
    });

    it('supports all-day and room-specific events; endsAt may equal startsAt', async () => {
      const f = await setupFamily('ce-create-room');
      const e = await svc.createEvent(f.admin, { ...base, allDay: true, roomId: f.tenant.roomId, endsAt: base.startsAt }, NOW);
      expect(e).toMatchObject({ allDay: true, roomId: f.tenant.roomId });
    });

    it('ORG_ADMIN can create at their centre', async () => {
      const f = await setupFamily('ce-orgadmin');
      const orgAdmin = await makeUser(f.tenant, 'ORG_ADMIN');
      await expect(svc.createEvent(orgAdmin, base, NOW)).resolves.toMatchObject({ title: 'Open day' });
    });

    it.each([
      ['empty', ''],
      ['blank', '   '],
      ['over 200 chars', 'x'.repeat(201)],
    ])('rejects a %s title', async (_n, title) => {
      const f = await setupFamily('ce-title');
      await expect(svc.createEvent(f.admin, { ...base, title }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts a 200 char title and a 2000 char description, rejects 2001', async () => {
      const f = await setupFamily('ce-len');
      await expect(svc.createEvent(f.admin, { ...base, title: 'x'.repeat(200), description: 'd'.repeat(2000) }, NOW)).resolves.toBeDefined();
      await expect(svc.createEvent(f.admin, { ...base, description: 'd'.repeat(2001) }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a missing title, an invalid startsAt, and endsAt before startsAt', async () => {
      const f = await setupFamily('ce-dates');
      await expect(svc.createEvent(f.admin, { startsAt: base.startsAt }, NOW)).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.createEvent(f.admin, { ...base, startsAt: 'not-a-date' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.createEvent(f.admin, { title: 'x' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.createEvent(f.admin, { ...base, endsAt: '2026-10-30T22:59:59Z' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
      expect(await fixturePrisma.centreEvent.count({ where: { centreId: f.tenant.centreId } })).toBe(0);
    });

    it('rejects a room from another centre or org (BadRequest or NotFound) and writes nothing', async () => {
      const a = await setupFamily('ce-room-a');
      const b = await setupFamily('ce-room-b');
      const sibling = await fixturePrisma.centre.create({ data: { orgId: a.tenant.orgId, name: 'Sib' } });
      const sibRoom = await fixturePrisma.room.create({ data: { orgId: a.tenant.orgId, centreId: sibling.id, name: 'SibRoom' } });
      for (const roomId of [b.tenant.roomId, sibRoom.id, '00000000-0000-0000-0000-000000000000']) {
        const err = await svc.createEvent(a.admin, { ...base, roomId }, NOW).catch((x: any) => x);
        expect([BadRequestException, NotFoundException].some((c) => err instanceof c)).toBe(true);
      }
      expect(await fixturePrisma.centreEvent.count({ where: { centreId: a.tenant.centreId } })).toBe(0);
    });

    it.each(['educator', 'parent'] as const)('%s is Forbidden and nothing is written', async (who) => {
      const f = await setupFamily(`ce-forbid-${who}`);
      await expect(svc.createEvent((f as any)[who], base, NOW)).rejects.toBeInstanceOf(ForbiddenException);
      expect(await fixturePrisma.centreEvent.count({ where: { centreId: f.tenant.centreId } })).toBe(0);
    });

    it('audits calendar.event_created with ids/categories only, never the title or description', async () => {
      const f = await setupFamily('ce-audit');
      const e = await svc.createEvent(f.admin, { title: 'SecretTitleXyz', description: 'SecretDescXyz', startsAt: base.startsAt, roomId: f.tenant.roomId }, NOW);
      const rows = (await auditFor(e.id)).filter((r) => r.action === 'calendar.event_created');
      expect(rows).toHaveLength(1);
      expect(rows[0].entityType).toBe('CentreEvent');
      expect(rows[0].actorUserId).toBe(f.admin.userId);
      expect(rows[0].centreId).toBe(f.tenant.centreId);
      expect(JSON.stringify(rows[0])).not.toMatch(/SecretTitleXyz|SecretDescXyz/);
    });

    it('rolls the event back when the audit write fails (same transaction)', async () => {
      const f = await setupFamily('ce-tx');
      jest.spyOn(h.audit, 'record').mockRejectedValue(new Error('audit down'));
      await expect(svc.createEvent(f.admin, base, NOW)).rejects.toThrow();
      expect(await fixturePrisma.centreEvent.count({ where: { centreId: f.tenant.centreId } })).toBe(0);
    });
  });

  describe('updateEvent', () => {
    it('applies a partial update, leaving other fields alone', async () => {
      const f = await setupFamily('ue-partial');
      const e = await seedEvent(f.tenant, f.admin.userId, { title: 'Old', startsAt: '2026-10-20T00:00:00Z', endsAt: '2026-10-20T02:00:00Z' });
      const out = await svc.updateEvent(f.admin, e.id, { title: '  New  ' }, NOW);
      expect(out).toMatchObject({ id: e.id, title: 'New' });
      expect(out.startsAt).toEqual(new Date('2026-10-20T00:00:00Z'));
      expect(out.endsAt).toEqual(new Date('2026-10-20T02:00:00Z'));
      expectNoInternals(out);
    });

    it('can move to another room, back to the whole centre (roomId null), and change the times', async () => {
      const f = await setupFamily('ue-room');
      const e = await seedEvent(f.tenant, f.admin.userId);
      expect((await svc.updateEvent(f.admin, e.id, { roomId: f.tenant.roomId }, NOW)).roomId).toBe(f.tenant.roomId);
      expect((await svc.updateEvent(f.admin, e.id, { roomId: null }, NOW)).roomId).toBeNull();
      const t = await svc.updateEvent(f.admin, e.id, { startsAt: '2026-10-21T00:00:00Z', endsAt: '2026-10-21T01:00:00Z' }, NOW);
      expect(t.startsAt).toEqual(new Date('2026-10-21T00:00:00Z'));
    });

    it('validates the merged result: endsAt before the existing startsAt, blank title, foreign room', async () => {
      const f = await setupFamily('ue-validate');
      const other = await setupFamily('ue-validate-other');
      const e = await seedEvent(f.tenant, f.admin.userId, { startsAt: '2026-10-20T00:00:00Z' });
      await expect(svc.updateEvent(f.admin, e.id, { endsAt: '2026-10-19T00:00:00Z' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.updateEvent(f.admin, e.id, { title: '  ' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
      const err = await svc.updateEvent(f.admin, e.id, { roomId: other.tenant.roomId }, NOW).catch((x: any) => x);
      expect([BadRequestException, NotFoundException].some((c) => err instanceof c)).toBe(true);
      const row = await fixturePrisma.centreEvent.findUniqueOrThrow({ where: { id: e.id } });
      expect(row.title).toBe('Seeded event');
      expect(row.roomId).toBeNull();
    });

    it.each(['educator', 'parent'] as const)('%s is Forbidden', async (who) => {
      const f = await setupFamily(`ue-forbid-${who}`);
      const e = await seedEvent(f.tenant, f.admin.userId);
      await expect(svc.updateEvent((f as any)[who], e.id, { title: 'Hacked' }, NOW)).rejects.toBeInstanceOf(ForbiddenException);
      expect((await fixturePrisma.centreEvent.findUniqueOrThrow({ where: { id: e.id } })).title).toBe('Seeded event');
    });

    it('unknown id is NotFound', async () => {
      const f = await setupFamily('ue-404');
      await expect(svc.updateEvent(f.admin, '00000000-0000-0000-0000-000000000000', { title: 'x' }, NOW)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('another centre or org event is NotFound and unchanged', async () => {
      const a = await setupFamily('ue-iso-a');
      const b = await setupFamily('ue-iso-b');
      const sibling = await fixturePrisma.centre.create({ data: { orgId: a.tenant.orgId, name: 'Sib' } });
      const theirs = await seedEvent(b.tenant, b.admin.userId);
      const sib = await seedEvent({ orgId: a.tenant.orgId, centreId: sibling.id }, a.admin.userId);
      for (const ev of [theirs, sib]) {
        await expect(svc.updateEvent(a.admin, ev.id, { title: 'Hacked' }, NOW)).rejects.toBeInstanceOf(NotFoundException);
        await expect(svc.cancelEvent(a.admin, ev.id, 'No', NOW)).rejects.toBeInstanceOf(NotFoundException);
        const row = await fixturePrisma.centreEvent.findUniqueOrThrow({ where: { id: ev.id } });
        expect(row.title).toBe('Seeded event');
        expect(row.cancelledAt).toBeNull();
      }
    });

    it('a cancelled event cannot be updated (Conflict) and stays unchanged', async () => {
      const f = await setupFamily('ue-cancelled');
      const e = await seedEvent(f.tenant, f.admin.userId, { cancelled: true });
      await expect(svc.updateEvent(f.admin, e.id, { title: 'Revive' }, NOW)).rejects.toBeInstanceOf(ConflictException);
      expect((await fixturePrisma.centreEvent.findUniqueOrThrow({ where: { id: e.id } })).title).toBe('Seeded event');
    });

    it('audits calendar.event_updated without free text, in the same transaction', async () => {
      const f = await setupFamily('ue-audit');
      const e = await seedEvent(f.tenant, f.admin.userId);
      await svc.updateEvent(f.admin, e.id, { title: 'SecretNewTitleXyz', description: 'SecretNewDescXyz' }, NOW);
      const rows = (await auditFor(e.id)).filter((r) => r.action === 'calendar.event_updated');
      expect(rows).toHaveLength(1);
      expect(rows[0].entityType).toBe('CentreEvent');
      expect(JSON.stringify(rows[0])).not.toMatch(/SecretNewTitleXyz|SecretNewDescXyz/);

      jest.spyOn(h.audit, 'record').mockRejectedValue(new Error('audit down'));
      await expect(svc.updateEvent(f.admin, e.id, { title: 'RolledBack' }, NOW)).rejects.toThrow();
      expect((await fixturePrisma.centreEvent.findUniqueOrThrow({ where: { id: e.id } })).title).toBe('SecretNewTitleXyz');
    });
  });

  describe('cancelEvent', () => {
    it('keeps the record, marks it cancelled with the reason, and still lists it', async () => {
      const f = await setupFamily('cx-ok');
      const e = await seedEvent(f.tenant, f.admin.userId, { startsAt: '2026-10-20T00:00:00Z' });
      const out = await svc.cancelEvent(f.admin, e.id, '  Rain  ', NOW);
      expect(out).toMatchObject({ id: e.id, cancelReason: 'Rain' });
      expect(out.cancelledAt).toBeInstanceOf(Date);
      expectNoInternals(out);
      const row = await fixturePrisma.centreEvent.findUniqueOrThrow({ where: { id: e.id } });
      expect(row.cancelledAt).not.toBeNull();
      expect(row.cancelledByUserId).toBe(f.admin.userId);
      const listed = (await svc.listEvents(f.parent, {}, NOW)).find((x: any) => x.id === e.id);
      expect(listed).toMatchObject({ cancelReason: 'Rain' });
      expect(listed.cancelledAt).toBeInstanceOf(Date);
    });

    it('cancelling twice is Conflict and keeps the first reason', async () => {
      const f = await setupFamily('cx-twice');
      const e = await seedEvent(f.tenant, f.admin.userId);
      await svc.cancelEvent(f.admin, e.id, 'First', NOW);
      await expect(svc.cancelEvent(f.admin, e.id, 'Second', NOW)).rejects.toBeInstanceOf(ConflictException);
      expect((await fixturePrisma.centreEvent.findUniqueOrThrow({ where: { id: e.id } })).cancelReason).toBe('First');
    });

    it.each([
      ['empty', ''],
      ['blank', '   '],
      ['over 500 chars', 'r'.repeat(501)],
    ])('rejects a %s reason', async (_n, reason) => {
      const f = await setupFamily('cx-reason');
      const e = await seedEvent(f.tenant, f.admin.userId);
      await expect(svc.cancelEvent(f.admin, e.id, reason, NOW)).rejects.toBeInstanceOf(BadRequestException);
      expect((await fixturePrisma.centreEvent.findUniqueOrThrow({ where: { id: e.id } })).cancelledAt).toBeNull();
    });

    it.each(['educator', 'parent'] as const)('%s is Forbidden', async (who) => {
      const f = await setupFamily(`cx-forbid-${who}`);
      const e = await seedEvent(f.tenant, f.admin.userId);
      await expect(svc.cancelEvent((f as any)[who], e.id, 'No', NOW)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('unknown id is NotFound', async () => {
      const f = await setupFamily('cx-404');
      await expect(svc.cancelEvent(f.admin, '00000000-0000-0000-0000-000000000000', 'No', NOW)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('audits calendar.event_cancelled without the reason text, in the same transaction', async () => {
      const f = await setupFamily('cx-audit');
      const e = await seedEvent(f.tenant, f.admin.userId);
      const e2 = await seedEvent(f.tenant, f.admin.userId);
      await svc.cancelEvent(f.admin, e.id, 'SecretReasonXyz', NOW);
      const rows = (await auditFor(e.id)).filter((r) => r.action === 'calendar.event_cancelled');
      expect(rows).toHaveLength(1);
      expect(rows[0].entityType).toBe('CentreEvent');
      expect(JSON.stringify(rows[0])).not.toMatch(/SecretReasonXyz/);

      jest.spyOn(h.audit, 'record').mockRejectedValue(new Error('audit down'));
      await expect(svc.cancelEvent(f.admin, e2.id, 'Nope', NOW)).rejects.toThrow();
      expect((await fixturePrisma.centreEvent.findUniqueOrThrow({ where: { id: e2.id } })).cancelledAt).toBeNull();
    });
  });
});
