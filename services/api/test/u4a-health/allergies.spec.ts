import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { disconnectAll } from '../test-utils';
import { NOW, auditFor, buildHealth, expectNoInternals, fixturePrisma, makeChild, makeUser, seedAllergy, setupFamily } from './helpers';

describe('U4a allergies', () => {
  let h: Awaited<ReturnType<typeof buildHealth>>;
  let svc: any;
  beforeAll(async () => {
    h = await buildHealth();
    svc = h.service;
  });
  afterAll(async () => {
    await disconnectAll();
  });

  describe('addAllergy', () => {
    it('creates an allergy with the documented shape', async () => {
      const f = await setupFamily('al-add');
      const a = await svc.addAllergy(f.admin, f.child.id, { allergen: '  Peanuts ', severity: 'ANAPHYLAXIS', reaction: 'Hives', actionPlan: 'EpiPen' }, NOW);
      expect(a).toMatchObject({ childId: f.child.id, allergen: 'Peanuts', severity: 'ANAPHYLAXIS', reaction: 'Hives', actionPlan: 'EpiPen', replacesId: null, endedAt: null });
      expect(a.id).toBeTruthy();
      expect(a.createdAt).toBeInstanceOf(Date);
      expectNoInternals(a);
    });

    it('stores the row in the database with the recorder', async () => {
      const f = await setupFamily('al-row');
      const a = await svc.addAllergy(f.admin, f.child.id, { allergen: 'Egg', severity: 'MILD' }, NOW);
      const row = await fixturePrisma.childAllergy.findUniqueOrThrow({ where: { id: a.id } });
      expect(row.recordedByUserId).toBe(f.admin.userId);
      expect(row.orgId).toBe(f.tenant.orgId);
      expect(row.centreId).toBe(f.tenant.centreId);
    });

    it.each(['ORG_ADMIN', 'PLATFORM_ADMIN'] as const)('%s with a centreId may write', async (role) => {
      const f = await setupFamily(`al-role-${role}`);
      const u = await makeUser(f.tenant, role);
      await expect(svc.addAllergy(u, f.child.id, { allergen: 'Milk', severity: 'MILD' }, NOW)).resolves.toMatchObject({ allergen: 'Milk' });
    });

    it('educators and parents never write', async () => {
      const f = await setupFamily('al-nowrite');
      await expect(svc.addAllergy(f.educator, f.child.id, { allergen: 'Milk', severity: 'MILD' }, NOW)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(svc.addAllergy(f.parent, f.child.id, { allergen: 'Milk', severity: 'MILD' }, NOW)).rejects.toBeInstanceOf(ForbiddenException);
      expect(await fixturePrisma.childAllergy.count({ where: { childId: f.child.id } })).toBe(0);
    });

    it('an admin cannot write for a child in another centre of the same org', async () => {
      const f = await setupFamily('al-xcentre');
      const otherCentre = await fixturePrisma.centre.create({ data: { orgId: f.tenant.orgId, name: `Other ${Date.now()}` } });
      const room = await fixturePrisma.room.create({ data: { orgId: f.tenant.orgId, centreId: otherCentre.id, name: 'R' } });
      const kid = await makeChild({ orgId: f.tenant.orgId, centreId: otherCentre.id, roomId: room.id });
      await expect(svc.addAllergy(f.admin, kid.id, { allergen: 'Milk', severity: 'MILD' }, NOW)).rejects.toThrow(/Forbidden|Not Found|not found/i);
    });

    it('another org admin cannot write', async () => {
      const f = await setupFamily('al-xorg-a');
      const g = await setupFamily('al-xorg-b');
      await expect(svc.addAllergy(g.admin, f.child.id, { allergen: 'Milk', severity: 'MILD' }, NOW)).rejects.toThrow(/Forbidden|Not Found|not found/i);
      expect(await fixturePrisma.childAllergy.count({ where: { childId: f.child.id } })).toBe(0);
    });

    it('validates allergen length (trimmed, 1..100)', async () => {
      const f = await setupFamily('al-val');
      for (const allergen of ['', '   ', 'x'.repeat(101)]) {
        await expect(svc.addAllergy(f.admin, f.child.id, { allergen, severity: 'MILD' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
      }
      await expect(svc.addAllergy(f.admin, f.child.id, { allergen: 'x'.repeat(100), severity: 'MILD' }, NOW)).resolves.toBeTruthy();
    });

    it('validates reaction and actionPlan up to 1000 chars', async () => {
      const f = await setupFamily('al-val2');
      await expect(svc.addAllergy(f.admin, f.child.id, { allergen: 'A', severity: 'MILD', reaction: 'r'.repeat(1001) }, NOW)).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.addAllergy(f.admin, f.child.id, { allergen: 'B', severity: 'MILD', actionPlan: 'p'.repeat(1001) }, NOW)).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.addAllergy(f.admin, f.child.id, { allergen: 'C', severity: 'MILD', reaction: 'r'.repeat(1000), actionPlan: 'p'.repeat(1000) }, NOW)).resolves.toBeTruthy();
    });

    it('rejects a duplicate active allergen case-insensitively', async () => {
      const f = await setupFamily('al-dup');
      await svc.addAllergy(f.admin, f.child.id, { allergen: 'Peanuts', severity: 'SEVERE' }, NOW);
      await expect(svc.addAllergy(f.admin, f.child.id, { allergen: 'pEANUTS', severity: 'MILD' }, NOW)).rejects.toBeInstanceOf(ConflictException);
    });

    it('allows the same allergen again once the earlier one has ended', async () => {
      const f = await setupFamily('al-readd');
      const a = await svc.addAllergy(f.admin, f.child.id, { allergen: 'Peanuts', severity: 'SEVERE' }, NOW);
      await svc.endAllergy(f.admin, f.child.id, a.id, 'Entered in error', NOW);
      await expect(svc.addAllergy(f.admin, f.child.id, { allergen: 'Peanuts', severity: 'MILD' }, NOW)).resolves.toBeTruthy();
    });

    it('the same allergen for different children is fine', async () => {
      const f = await setupFamily('al-twokids');
      const kid2 = await makeChild(f.tenant);
      await svc.addAllergy(f.admin, f.child.id, { allergen: 'Peanuts', severity: 'SEVERE' }, NOW);
      await expect(svc.addAllergy(f.admin, kid2.id, { allergen: 'Peanuts', severity: 'SEVERE' }, NOW)).resolves.toBeTruthy();
    });

    describe('replacesId', () => {
      it('ends the replaced allergy in the same call and links the new one', async () => {
        const f = await setupFamily('al-repl');
        const old = await svc.addAllergy(f.admin, f.child.id, { allergen: 'Peanuts', severity: 'MODERATE' }, NOW);
        const later = new Date(NOW.getTime() + 3600_000);
        const next = await svc.addAllergy(f.admin, f.child.id, { allergen: 'Peanuts', severity: 'ANAPHYLAXIS', replacesId: old.id }, later);
        expect(next.replacesId).toBe(old.id);
        const oldRow = await fixturePrisma.childAllergy.findUniqueOrThrow({ where: { id: old.id } });
        expect(oldRow.endedAt).toEqual(later);
        expect(oldRow.endReason).toBe('Replaced');
        expect(oldRow.endedByUserId).toBe(f.admin.userId);
        expect(oldRow.severity).toBe('MODERATE');
      });

      it('may replace with a different allergen name', async () => {
        const f = await setupFamily('al-repl-name');
        const old = await svc.addAllergy(f.admin, f.child.id, { allergen: 'Nuts', severity: 'MODERATE' }, NOW);
        await expect(svc.addAllergy(f.admin, f.child.id, { allergen: 'Tree nuts', severity: 'SEVERE', replacesId: old.id }, NOW)).resolves.toBeTruthy();
      });

      it('rejects a replaced allergy from another child', async () => {
        const f = await setupFamily('al-repl-other');
        const kid2 = await makeChild(f.tenant);
        const other = await svc.addAllergy(f.admin, kid2.id, { allergen: 'Peanuts', severity: 'MILD' }, NOW);
        await expect(svc.addAllergy(f.admin, f.child.id, { allergen: 'Peanuts', severity: 'MILD', replacesId: other.id }, NOW)).rejects.toBeInstanceOf(BadRequestException);
        const row = await fixturePrisma.childAllergy.findUniqueOrThrow({ where: { id: other.id } });
        expect(row.endedAt).toBeNull();
      });

      it('rejects a replaced allergy that is already ended, or does not exist', async () => {
        const f = await setupFamily('al-repl-ended');
        const old = await svc.addAllergy(f.admin, f.child.id, { allergen: 'Peanuts', severity: 'MILD' }, NOW);
        await svc.endAllergy(f.admin, f.child.id, old.id, 'No longer applies', NOW);
        await expect(svc.addAllergy(f.admin, f.child.id, { allergen: 'Peanuts', severity: 'MILD', replacesId: old.id }, NOW)).rejects.toBeInstanceOf(BadRequestException);
        await expect(
          svc.addAllergy(f.admin, f.child.id, { allergen: 'Peanuts', severity: 'MILD', replacesId: '00000000-0000-4000-8000-000000000000' }, NOW),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it('a failed add (validation) leaves the replaced allergy active', async () => {
        const f = await setupFamily('al-repl-atomic');
        const old = await svc.addAllergy(f.admin, f.child.id, { allergen: 'Peanuts', severity: 'MILD' }, NOW);
        await expect(
          svc.addAllergy(f.admin, f.child.id, { allergen: 'x'.repeat(101), severity: 'MILD', replacesId: old.id }, NOW),
        ).rejects.toBeInstanceOf(BadRequestException);
        const row = await fixturePrisma.childAllergy.findUniqueOrThrow({ where: { id: old.id } });
        expect(row.endedAt).toBeNull();
      });
    });

    it('audits health.allergy_added with ids and severity only, never the allergen or reaction', async () => {
      const f = await setupFamily('al-audit');
      const a = await svc.addAllergy(f.admin, f.child.id, { allergen: 'SecretAllergenXyz', severity: 'SEVERE', reaction: 'SecretReactionXyz', actionPlan: 'SecretPlanXyz' }, NOW);
      const rows = (await auditFor(a.id)).filter((r) => r.action === 'health.allergy_added');
      expect(rows).toHaveLength(1);
      expect(rows[0].entityType).toBe('ChildAllergy');
      expect(rows[0].metadata).toEqual({ childId: f.child.id, severity: 'SEVERE' });
      expect(JSON.stringify(rows[0])).not.toMatch(/SecretAllergenXyz|SecretReactionXyz|SecretPlanXyz/);
    });

    it('serialises concurrent adds of the same new allergen: one created, one Conflict', async () => {
      const f = await setupFamily('al-race');
      const results = await Promise.allSettled([
        svc.addAllergy(f.admin, f.child.id, { allergen: 'Sesame', severity: 'SEVERE' }, NOW),
        svc.addAllergy(f.admin, f.child.id, { allergen: 'sesame', severity: 'SEVERE' }, NOW),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(ConflictException);
      expect(await fixturePrisma.childAllergy.count({ where: { childId: f.child.id, endedAt: null } })).toBe(1);
    });
  });

  describe('endAllergy', () => {
    it('ends the allergy, keeps the row and its details', async () => {
      const f = await setupFamily('al-end');
      const a = await svc.addAllergy(f.admin, f.child.id, { allergen: 'Peanuts', severity: 'SEVERE' }, NOW);
      const later = new Date(NOW.getTime() + 60_000);
      const res = await svc.endAllergy(f.admin, f.child.id, a.id, 'Outgrown, doctor letter', later);
      expect(res).toEqual({ id: a.id, endedAt: later });
      const row = await fixturePrisma.childAllergy.findUniqueOrThrow({ where: { id: a.id } });
      expect(row.endedAt).toEqual(later);
      expect(row.endReason).toBe('Outgrown, doctor letter');
      expect(row.endedByUserId).toBe(f.admin.userId);
      expect(row.allergen).toBe('Peanuts');
      expect(row.severity).toBe('SEVERE');
    });

    it('requires a 3..300 character reason', async () => {
      const f = await setupFamily('al-end-reason');
      const a = await svc.addAllergy(f.admin, f.child.id, { allergen: 'Peanuts', severity: 'SEVERE' }, NOW);
      for (const reason of ['', 'ab', '  ', 'x'.repeat(301)]) {
        await expect(svc.endAllergy(f.admin, f.child.id, a.id, reason, NOW)).rejects.toBeInstanceOf(BadRequestException);
      }
      await expect(svc.endAllergy(f.admin, f.child.id, a.id, 'x'.repeat(300), NOW)).resolves.toBeTruthy();
    });

    it('an already ended allergy is a Conflict', async () => {
      const f = await setupFamily('al-end-twice');
      const a = await svc.addAllergy(f.admin, f.child.id, { allergen: 'Peanuts', severity: 'SEVERE' }, NOW);
      await svc.endAllergy(f.admin, f.child.id, a.id, 'Outgrown', NOW);
      await expect(svc.endAllergy(f.admin, f.child.id, a.id, 'Again', NOW)).rejects.toBeInstanceOf(ConflictException);
    });

    it('an allergy of another child is NotFound and untouched', async () => {
      const f = await setupFamily('al-end-other');
      const kid2 = await makeChild(f.tenant);
      const a = await svc.addAllergy(f.admin, kid2.id, { allergen: 'Peanuts', severity: 'SEVERE' }, NOW);
      await expect(svc.endAllergy(f.admin, f.child.id, a.id, 'Wrong child', NOW)).rejects.toBeInstanceOf(NotFoundException);
      expect((await fixturePrisma.childAllergy.findUniqueOrThrow({ where: { id: a.id } })).endedAt).toBeNull();
    });

    it('educators and parents cannot end an allergy', async () => {
      const f = await setupFamily('al-end-perm');
      const a = await svc.addAllergy(f.admin, f.child.id, { allergen: 'Peanuts', severity: 'SEVERE' }, NOW);
      await expect(svc.endAllergy(f.educator, f.child.id, a.id, 'Nope nope', NOW)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(svc.endAllergy(f.parent, f.child.id, a.id, 'Nope nope', NOW)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('audits health.allergy_ended with childId only', async () => {
      const f = await setupFamily('al-end-audit');
      const a = await svc.addAllergy(f.admin, f.child.id, { allergen: 'Peanuts', severity: 'SEVERE' }, NOW);
      await svc.endAllergy(f.admin, f.child.id, a.id, 'SecretReasonXyz', NOW);
      const rows = (await auditFor(a.id)).filter((r) => r.action === 'health.allergy_ended');
      expect(rows).toHaveLength(1);
      expect(rows[0].metadata).toEqual({ childId: f.child.id });
      expect(JSON.stringify(rows[0])).not.toMatch(/SecretReasonXyz|Peanuts/);
    });
  });

  describe('listAllergies', () => {
    it('orders ANAPHYLAXIS, SEVERE, MODERATE, MILD then allergen; active only by default', async () => {
      const f = await setupFamily('al-list');
      await seedAllergy(f.tenant, f.child.id, f.admin.userId, 'Zucchini', 'MILD');
      await seedAllergy(f.tenant, f.child.id, f.admin.userId, 'Bees', 'MODERATE');
      await seedAllergy(f.tenant, f.child.id, f.admin.userId, 'Wheat', 'SEVERE');
      await seedAllergy(f.tenant, f.child.id, f.admin.userId, 'Soy', 'SEVERE');
      await seedAllergy(f.tenant, f.child.id, f.admin.userId, 'Peanuts', 'ANAPHYLAXIS');
      await seedAllergy(f.tenant, f.child.id, f.admin.userId, 'Old', 'ANAPHYLAXIS', { ended: true });
      const list = await svc.listAllergies(f.admin, f.child.id);
      expect(list.map((a: any) => a.allergen)).toEqual(['Peanuts', 'Soy', 'Wheat', 'Bees', 'Zucchini']);
      expectNoInternals(list);
    });

    it('includeEnded adds ended ones with endedAt and endReason for staff', async () => {
      const f = await setupFamily('al-list-ended');
      await seedAllergy(f.tenant, f.child.id, f.admin.userId, 'Old', 'MILD', { ended: true });
      await seedAllergy(f.tenant, f.child.id, f.admin.userId, 'Cur', 'MILD');
      for (const u of [f.admin, f.educator]) {
        const list = await svc.listAllergies(u, f.child.id, { includeEnded: true });
        expect(list.map((a: any) => a.allergen).sort()).toEqual(['Cur', 'Old']);
        const old = list.find((a: any) => a.allergen === 'Old');
        expect(old.endedAt).toBeInstanceOf(Date);
        expect(old.endReason).toBe('Outgrown');
      }
    });

    it('includeEnded is ignored for a parent', async () => {
      const f = await setupFamily('al-list-parent');
      await seedAllergy(f.tenant, f.child.id, f.admin.userId, 'Old', 'MILD', { ended: true });
      await seedAllergy(f.tenant, f.child.id, f.admin.userId, 'Cur', 'MILD');
      const list = await svc.listAllergies(f.parent, f.child.id, { includeEnded: true });
      expect(list.map((a: any) => a.allergen)).toEqual(['Cur']);
    });

    it('a departed child is still readable by an admin', async () => {
      const f = await setupFamily('al-list-departed');
      await seedAllergy(f.tenant, f.child.id, f.admin.userId, 'Peanuts', 'SEVERE');
      await fixturePrisma.child.update({ where: { id: f.child.id }, data: { departedOn: new Date('2026-09-30') } });
      const list = await svc.listAllergies(f.admin, f.child.id);
      expect(list).toHaveLength(1);
    });
  });
});
