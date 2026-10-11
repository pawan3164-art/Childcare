import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { RetentionService } from '../../src/retention/retention.service';
import { disconnectAll, seedOrgCentreRoom } from '../test-utils';
import { auditFor, buildServices, childRow, makeChild, makeUser, NOW, TODAY } from './helpers';

describe('PR retention: departure, reinstatement and legal hold', () => {
  let service: RetentionService;
  let prismaService: any;
  let t: Awaited<ReturnType<typeof seedOrgCentreRoom>>;
  let t2: Awaited<ReturnType<typeof seedOrgCentreRoom>>;
  let admin: Awaited<ReturnType<typeof makeUser>>;
  let educator: Awaited<ReturnType<typeof makeUser>>;
  let parent: Awaited<ReturnType<typeof makeUser>>;
  let otherCentreAdmin: Awaited<ReturnType<typeof makeUser>>;
  let otherOrgAdmin: Awaited<ReturnType<typeof makeUser>>;
  let orgAdmin: Awaited<ReturnType<typeof makeUser>>;

  beforeAll(async () => {
    const s = await buildServices();
    prismaService = s.prismaService;
    service = new RetentionService(s.tenancy, s.audit, s.authorization);
    t = await seedOrgCentreRoom('dep-a');
    t2 = await seedOrgCentreRoom('dep-b');
    admin = await makeUser(t, 'CENTRE_ADMIN');
    educator = await makeUser(t, 'EDUCATOR', { roomId: t.roomId });
    parent = await makeUser(t, 'PARENT');
    otherCentreAdmin = await makeUser(t2, 'CENTRE_ADMIN');
    otherOrgAdmin = otherCentreAdmin;
    orgAdmin = await makeUser(t, 'ORG_ADMIN');
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy?.();
    await disconnectAll();
  });

  describe('markDeparted', () => {
    it('records the departure date and audits it', async () => {
      const child = await makeChild(t);
      const res = await service.markDeparted(admin, child.id, { date: '2026-09-30' }, NOW);
      expect(res).toEqual({ childId: child.id, departedOn: '2026-09-30' });
      const row = await childRow(child.id);
      expect(row.departedOn.toISOString().slice(0, 10)).toBe('2026-09-30');
      const entries = await auditFor(child.id, 'child.departed');
      expect(entries).toHaveLength(1);
      expect(entries[0].metadata).toEqual({ childId: child.id, date: '2026-09-30' });
      expect(entries[0].actorUserId).toBe(admin.userId);
    });

    it('accepts centre-local today, and rejects tomorrow (UTC date is one day behind at NOW)', async () => {
      const c1 = await makeChild(t);
      await expect(service.markDeparted(admin, c1.id, { date: TODAY }, NOW)).resolves.toMatchObject({ departedOn: TODAY });
      const c2 = await makeChild(t);
      await expect(service.markDeparted(admin, c2.id, { date: '2026-10-15' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
      expect((await childRow(c2.id)).departedOn).toBeNull();
    });

    it('rejects a date before the date of birth, and malformed dates', async () => {
      const child = await makeChild(t, { dob: '2020-06-01' });
      await expect(service.markDeparted(admin, child.id, { date: '2020-05-31' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
      for (const bad of ['', 'yesterday', '2026-13-01', '2026-02-30', '30/09/2026', '2026-9-3', '2026-09-30T00:00:00Z']) {
        await expect(service.markDeparted(admin, child.id, { date: bad }, NOW)).rejects.toBeInstanceOf(BadRequestException);
      }
      await expect(service.markDeparted(admin, child.id, {} as any, NOW)).rejects.toBeInstanceOf(BadRequestException);
      expect((await childRow(child.id)).departedOn).toBeNull();
    });

    it('conflicts when the child is already departed', async () => {
      const child = await makeChild(t);
      await service.markDeparted(admin, child.id, { date: '2026-09-01' }, NOW);
      await expect(service.markDeparted(admin, child.id, { date: '2026-09-02' }, NOW)).rejects.toBeInstanceOf(ConflictException);
      expect((await childRow(child.id)).departedOn.toISOString().slice(0, 10)).toBe('2026-09-01');
    });

    it('ignores legal hold', async () => {
      const child = await makeChild(t, { legalHold: true, legalHoldReason: 'dispute' });
      await expect(service.markDeparted(admin, child.id, { date: '2026-09-01' }, NOW)).resolves.toBeDefined();
    });

    it('allows the centre admin and org-level admins of the child only', async () => {
      const c = await makeChild(t);
      await expect(service.markDeparted(educator, c.id, { date: '2026-09-01' }, NOW)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.markDeparted(parent, c.id, { date: '2026-09-01' }, NOW)).rejects.toBeInstanceOf(ForbiddenException);
      const err = await service.markDeparted(otherCentreAdmin, c.id, { date: '2026-09-01' }, NOW).catch((e) => e);
      expect(err instanceof ForbiddenException || err instanceof NotFoundException).toBe(true);
      const stillThere = await childRow(c.id);
      expect(stillThere.departedOn).toBeNull();
      await expect(service.markDeparted(orgAdmin, c.id, { date: '2026-09-01' }, NOW)).resolves.toBeDefined();
    });

    it('another org admin is Forbidden or NotFound and nothing changes', async () => {
      const c = await makeChild(t);
      const err = await service.markDeparted(otherOrgAdmin, c.id, { date: '2026-09-01' }, NOW).catch((e) => e);
      expect(err instanceof ForbiddenException || err instanceof NotFoundException).toBe(true);
      expect((await childRow(c.id)).departedOn).toBeNull();
    });

    it('unknown child is NotFound', async () => {
      await expect(
        service.markDeparted(admin, '00000000-0000-4000-8000-000000000000', { date: '2026-09-01' }, NOW),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('reinstateChild', () => {
    it('clears departedOn and audits', async () => {
      const c = await makeChild(t, { departedOn: '2026-09-01' });
      await service.reinstateChild(admin, c.id);
      expect((await childRow(c.id)).departedOn).toBeNull();
      expect(await auditFor(c.id, 'child.reinstated')).toHaveLength(1);
    });

    it('conflicts if not departed', async () => {
      const c = await makeChild(t);
      await expect(service.reinstateChild(admin, c.id)).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses an anonymised child', async () => {
      const c = await makeChild(t, { departedOn: '2018-01-01', anonymisedAt: new Date('2026-01-01T00:00:00Z') });
      await expect(service.reinstateChild(admin, c.id)).rejects.toBeInstanceOf(ConflictException);
      expect((await childRow(c.id)).departedOn).not.toBeNull();
    });

    it('is admin-only and centre-scoped', async () => {
      const c = await makeChild(t, { departedOn: '2026-09-01' });
      await expect(service.reinstateChild(educator, c.id)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.reinstateChild(parent, c.id)).rejects.toBeInstanceOf(ForbiddenException);
      const err = await service.reinstateChild(otherCentreAdmin, c.id).catch((e) => e);
      expect(err instanceof ForbiddenException || err instanceof NotFoundException).toBe(true);
      expect((await childRow(c.id)).departedOn).not.toBeNull();
    });
  });

  describe('setLegalHold', () => {
    it('places a hold with a reason, audits without the reason text', async () => {
      const c = await makeChild(t);
      await service.setLegalHold(admin, c.id, { hold: true, reason: 'Subpoena ref 12345' });
      const row = await childRow(c.id);
      expect(row.legalHold).toBe(true);
      expect(row.legalHoldReason).toBe('Subpoena ref 12345');
      const entries = await auditFor(c.id, 'child.legal_hold_set');
      expect(entries).toHaveLength(1);
      expect(entries[0].metadata).toEqual({ childId: c.id, hold: true });
      expect(JSON.stringify(entries[0])).not.toContain('Subpoena');
    });

    it('requires a non-empty reason of at most 500 characters', async () => {
      const c = await makeChild(t);
      for (const reason of [undefined, '', '   ', 'x'.repeat(501)]) {
        await expect(service.setLegalHold(admin, c.id, { hold: true, reason })).rejects.toBeInstanceOf(BadRequestException);
      }
      expect((await childRow(c.id)).legalHold).toBe(false);
      await expect(service.setLegalHold(admin, c.id, { hold: true, reason: 'x'.repeat(500) })).resolves.toBeDefined();
    });

    it('strips control characters from the stored reason', async () => {
      const c = await makeChild(t);
      await service.setLegalHold(admin, c.id, { hold: true, reason: 'Court\u0000 order\u0007‮ 9' });
      const row = await childRow(c.id);
      // eslint-disable-next-line no-control-regex
      expect(row.legalHoldReason).not.toMatch(/[\u0000-\u0008\u000B-\u001F\u007F]/);
      expect(row.legalHoldReason).toContain('Court');
      expect(row.legalHoldReason).toContain('order');
    });

    it('releasing clears the reason and audits hold false', async () => {
      const c = await makeChild(t, { legalHold: true, legalHoldReason: 'dispute' });
      await service.setLegalHold(admin, c.id, { hold: false });
      const row = await childRow(c.id);
      expect(row.legalHold).toBe(false);
      expect(row.legalHoldReason).toBeNull();
      const entries = await auditFor(c.id, 'child.legal_hold_set');
      expect(entries[0].metadata).toEqual({ childId: c.id, hold: false });
    });

    it('is admin-only and centre-scoped', async () => {
      const c = await makeChild(t);
      await expect(service.setLegalHold(educator, c.id, { hold: true, reason: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.setLegalHold(parent, c.id, { hold: true, reason: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
      const err = await service.setLegalHold(otherCentreAdmin, c.id, { hold: true, reason: 'x' }).catch((e) => e);
      expect(err instanceof ForbiddenException || err instanceof NotFoundException).toBe(true);
      expect((await childRow(c.id)).legalHold).toBe(false);
    });
  });
});
