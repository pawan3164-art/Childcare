import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { disconnectAll } from '../test-utils';
import { NOW, TODAY, auditFor, buildHealth, expectNoInternals, fixturePrisma, makeChild, seedImmunisation, setupFamily } from './helpers';

// NOW is 2026-10-13T20:00Z = 2026-10-14 07:00 in Sydney, so the centre-local today is 2026-10-14 (UTC date is the 13th).
// The child's date of birth (makeChild) is 2023-01-01.

describe('immunisationFlag (pure)', () => {
  const { immunisationFlag } = require('../../src/health/health.service');

  it('UNKNOWN is CHECK', () => {
    expect(immunisationFlag('UNKNOWN', null, TODAY)).toBe('CHECK');
    expect(immunisationFlag('UNKNOWN', '2026-09-01', TODAY)).toBe('CHECK');
  });
  it('UP_TO_DATE with no statement date is CHECK', () => {
    expect(immunisationFlag('UP_TO_DATE', null, TODAY)).toBe('CHECK');
  });
  it('UP_TO_DATE with a recent statement is OK', () => {
    expect(immunisationFlag('UP_TO_DATE', '2026-09-01', TODAY)).toBe('OK');
    expect(immunisationFlag('UP_TO_DATE', TODAY, TODAY)).toBe('OK');
  });
  it('UP_TO_DATE is stale only when older than 365 days before today', () => {
    expect(immunisationFlag('UP_TO_DATE', '2025-10-14', TODAY)).toBe('OK'); // exactly 365 days
    expect(immunisationFlag('UP_TO_DATE', '2025-10-13', TODAY)).toBe('CHECK'); // 366 days
  });
  it('CATCH_UP_PLAN and MEDICAL_EXEMPTION are OK regardless of statement date', () => {
    expect(immunisationFlag('CATCH_UP_PLAN', null, TODAY)).toBe('OK');
    expect(immunisationFlag('MEDICAL_EXEMPTION', null, TODAY)).toBe('OK');
    expect(immunisationFlag('CATCH_UP_PLAN', '2020-01-01', TODAY)).toBe('OK');
    expect(immunisationFlag('MEDICAL_EXEMPTION', '2020-01-01', TODAY)).toBe('OK');
  });
});

describe('U4a immunisation records', () => {
  let h: Awaited<ReturnType<typeof buildHealth>>;
  let svc: any;
  beforeAll(async () => {
    h = await buildHealth();
    svc = h.service;
  });
  afterAll(async () => {
    await disconnectAll();
  });

  describe('addImmunisation', () => {
    it('records a dose with the documented shape', async () => {
      const f = await setupFamily('im-add');
      const r = await svc.addImmunisation(f.admin, f.child.id, { vaccine: ' MMR ', doseDate: '2025-02-01', source: 'CERTIFICATE' }, NOW);
      expect(r).toMatchObject({ childId: f.child.id, vaccine: 'MMR', source: 'CERTIFICATE', voidedAt: null });
      expect(r.id).toBeTruthy();
      expect(String(r.doseDate instanceof Date ? r.doseDate.toISOString() : r.doseDate)).toContain('2025-02-01');
      expectNoInternals(r);
    });

    it.each(['AIR_STATEMENT', 'PARENT_DECLARED'] as const)('accepts source %s', async (source) => {
      const f = await setupFamily(`im-src-${source}`);
      await expect(svc.addImmunisation(f.admin, f.child.id, { vaccine: 'MMR', doseDate: '2025-02-01', source }, NOW)).resolves.toMatchObject({ source });
    });

    it('educators and parents never write', async () => {
      const f = await setupFamily('im-nowrite');
      const dto = { vaccine: 'MMR', doseDate: '2025-02-01', source: 'CERTIFICATE' };
      await expect(svc.addImmunisation(f.educator, f.child.id, dto, NOW)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(svc.addImmunisation(f.parent, f.child.id, dto, NOW)).rejects.toBeInstanceOf(ForbiddenException);
      expect(await fixturePrisma.childImmunisation.count({ where: { childId: f.child.id } })).toBe(0);
    });

    it('another org admin cannot write', async () => {
      const f = await setupFamily('im-xorg-a');
      const g = await setupFamily('im-xorg-b');
      await expect(svc.addImmunisation(g.admin, f.child.id, { vaccine: 'MMR', doseDate: '2025-02-01', source: 'CERTIFICATE' }, NOW)).rejects.toThrow(
        /Not authorized|Forbidden|Not Found|not found/i,
      );
    });

    it('validates vaccine length 1..100', async () => {
      const f = await setupFamily('im-vac');
      for (const vaccine of ['', '  ', 'v'.repeat(101)]) {
        await expect(svc.addImmunisation(f.admin, f.child.id, { vaccine, doseDate: '2025-02-01', source: 'CERTIFICATE' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
      }
    });

    it('rejects dates that are not real dates', async () => {
      const f = await setupFamily('im-baddate');
      for (const doseDate of ['2025-02-30', 'not-a-date', '2025-13-01', '']) {
        await expect(svc.addImmunisation(f.admin, f.child.id, { vaccine: 'MMR', doseDate, source: 'CERTIFICATE' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
      }
    });

    it('uses the centre-local today: today is allowed, tomorrow is not (UTC date would reverse this)', async () => {
      const f = await setupFamily('im-future');
      await expect(svc.addImmunisation(f.admin, f.child.id, { vaccine: 'A', doseDate: TODAY, source: 'CERTIFICATE' }, NOW)).resolves.toBeTruthy();
      await expect(svc.addImmunisation(f.admin, f.child.id, { vaccine: 'B', doseDate: '2026-10-15', source: 'CERTIFICATE' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a dose before the date of birth, allows the date of birth itself', async () => {
      const f = await setupFamily('im-dob');
      await expect(svc.addImmunisation(f.admin, f.child.id, { vaccine: 'A', doseDate: '2022-12-31', source: 'CERTIFICATE' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.addImmunisation(f.admin, f.child.id, { vaccine: 'A', doseDate: '2023-01-01', source: 'CERTIFICATE' }, NOW)).resolves.toBeTruthy();
    });

    it('exact duplicate (vaccine case-insensitive + date, not voided) is a Conflict', async () => {
      const f = await setupFamily('im-dup');
      await svc.addImmunisation(f.admin, f.child.id, { vaccine: 'MMR', doseDate: '2025-02-01', source: 'CERTIFICATE' }, NOW);
      await expect(svc.addImmunisation(f.admin, f.child.id, { vaccine: 'mmr', doseDate: '2025-02-01', source: 'AIR_STATEMENT' }, NOW)).rejects.toBeInstanceOf(ConflictException);
    });

    it('same vaccine on a different date, or different vaccine on the same date, is fine', async () => {
      const f = await setupFamily('im-notdup');
      await svc.addImmunisation(f.admin, f.child.id, { vaccine: 'MMR', doseDate: '2025-02-01', source: 'CERTIFICATE' }, NOW);
      await expect(svc.addImmunisation(f.admin, f.child.id, { vaccine: 'MMR', doseDate: '2025-03-01', source: 'CERTIFICATE' }, NOW)).resolves.toBeTruthy();
      await expect(svc.addImmunisation(f.admin, f.child.id, { vaccine: 'Varicella', doseDate: '2025-02-01', source: 'CERTIFICATE' }, NOW)).resolves.toBeTruthy();
    });

    it('a voided dose no longer blocks re-adding the same dose', async () => {
      const f = await setupFamily('im-readd');
      const r = await svc.addImmunisation(f.admin, f.child.id, { vaccine: 'MMR', doseDate: '2025-02-01', source: 'CERTIFICATE' }, NOW);
      await svc.voidImmunisation(f.admin, f.child.id, r.id, 'Entered in error', NOW);
      await expect(svc.addImmunisation(f.admin, f.child.id, { vaccine: 'MMR', doseDate: '2025-02-01', source: 'CERTIFICATE' }, NOW)).resolves.toBeTruthy();
    });

    it('audits health.immunisation_added with childId and source only', async () => {
      const f = await setupFamily('im-audit');
      const r = await svc.addImmunisation(f.admin, f.child.id, { vaccine: 'SecretVaccineXyz', doseDate: '2025-02-01', source: 'AIR_STATEMENT' }, NOW);
      const rows = (await auditFor(r.id)).filter((a) => a.action === 'health.immunisation_added');
      expect(rows).toHaveLength(1);
      expect(rows[0].entityType).toBe('ChildImmunisation');
      expect(rows[0].metadata).toEqual({ childId: f.child.id, source: 'AIR_STATEMENT' });
      expect(JSON.stringify(rows[0])).not.toContain('SecretVaccineXyz');
    });
  });

  describe('voidImmunisation', () => {
    it('voids with a reason and never deletes', async () => {
      const f = await setupFamily('im-void');
      const r = await svc.addImmunisation(f.admin, f.child.id, { vaccine: 'MMR', doseDate: '2025-02-01', source: 'CERTIFICATE' }, NOW);
      const later = new Date(NOW.getTime() + 60_000);
      const res = await svc.voidImmunisation(f.admin, f.child.id, r.id, 'Wrong child certificate', later);
      expect(res).toEqual({ id: r.id, voidedAt: later });
      const row = await fixturePrisma.childImmunisation.findUniqueOrThrow({ where: { id: r.id } });
      expect(row.voidedAt).toEqual(later);
      expect(row.voidReason).toBe('Wrong child certificate');
      expect(row.voidedByUserId).toBe(f.admin.userId);
      expect(row.vaccine).toBe('MMR');
    });

    it('requires a 3..300 character reason', async () => {
      const f = await setupFamily('im-void-reason');
      const r = await svc.addImmunisation(f.admin, f.child.id, { vaccine: 'MMR', doseDate: '2025-02-01', source: 'CERTIFICATE' }, NOW);
      for (const reason of ['', 'ab', '   ', 'x'.repeat(301)]) {
        await expect(svc.voidImmunisation(f.admin, f.child.id, r.id, reason, NOW)).rejects.toBeInstanceOf(BadRequestException);
      }
    });

    it('already voided is a Conflict; another child is NotFound', async () => {
      const f = await setupFamily('im-void-conf');
      const kid2 = await makeChild(f.tenant);
      const r = await svc.addImmunisation(f.admin, f.child.id, { vaccine: 'MMR', doseDate: '2025-02-01', source: 'CERTIFICATE' }, NOW);
      await expect(svc.voidImmunisation(f.admin, kid2.id, r.id, 'Wrong child', NOW)).rejects.toBeInstanceOf(NotFoundException);
      await svc.voidImmunisation(f.admin, f.child.id, r.id, 'Entered in error', NOW);
      await expect(svc.voidImmunisation(f.admin, f.child.id, r.id, 'Entered in error', NOW)).rejects.toBeInstanceOf(ConflictException);
    });

    it('educators and parents cannot void', async () => {
      const f = await setupFamily('im-void-perm');
      const r = await svc.addImmunisation(f.admin, f.child.id, { vaccine: 'MMR', doseDate: '2025-02-01', source: 'CERTIFICATE' }, NOW);
      await expect(svc.voidImmunisation(f.educator, f.child.id, r.id, 'Nope nope', NOW)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(svc.voidImmunisation(f.parent, f.child.id, r.id, 'Nope nope', NOW)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('audits health.immunisation_voided with childId only', async () => {
      const f = await setupFamily('im-void-audit');
      const r = await svc.addImmunisation(f.admin, f.child.id, { vaccine: 'MMR', doseDate: '2025-02-01', source: 'CERTIFICATE' }, NOW);
      await svc.voidImmunisation(f.admin, f.child.id, r.id, 'SecretReasonXyz', NOW);
      const rows = (await auditFor(r.id)).filter((a) => a.action === 'health.immunisation_voided');
      expect(rows).toHaveLength(1);
      expect(rows[0].metadata).toEqual({ childId: f.child.id });
    });
  });

  describe('setImmunisationStatus', () => {
    it('upserts one row per child and returns the documented shape', async () => {
      const f = await setupFamily('st-upsert');
      const a = await svc.setImmunisationStatus(f.admin, f.child.id, { status: 'UP_TO_DATE', statementDate: '2026-09-01', note: 'AIR history statement' }, NOW);
      expect(a).toMatchObject({ childId: f.child.id, status: 'UP_TO_DATE', note: 'AIR history statement' });
      expect(a.updatedAt).toEqual(NOW);
      const later = new Date(NOW.getTime() + 60_000);
      const b = await svc.setImmunisationStatus(f.admin, f.child.id, { status: 'CATCH_UP_PLAN' }, later);
      expect(b).toMatchObject({ childId: f.child.id, status: 'CATCH_UP_PLAN', statementDate: null, note: null });
      expect(b.updatedAt).toEqual(later);
      expect(await fixturePrisma.childImmunisationStatus.count({ where: { childId: f.child.id } })).toBe(1);
      expectNoInternals(b);
    });

    it('MEDICAL_EXEMPTION requires a non-empty note', async () => {
      const f = await setupFamily('st-exempt');
      await expect(svc.setImmunisationStatus(f.admin, f.child.id, { status: 'MEDICAL_EXEMPTION' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.setImmunisationStatus(f.admin, f.child.id, { status: 'MEDICAL_EXEMPTION', note: '   ' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.setImmunisationStatus(f.admin, f.child.id, { status: 'MEDICAL_EXEMPTION', note: 'GP letter on file' }, NOW)).resolves.toMatchObject({ status: 'MEDICAL_EXEMPTION' });
    });

    it('note up to 500 chars', async () => {
      const f = await setupFamily('st-note');
      await expect(svc.setImmunisationStatus(f.admin, f.child.id, { status: 'UNKNOWN', note: 'n'.repeat(501) }, NOW)).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.setImmunisationStatus(f.admin, f.child.id, { status: 'UNKNOWN', note: 'n'.repeat(500) }, NOW)).resolves.toBeTruthy();
    });

    it('statementDate must be a valid past-or-today date in the centre timezone', async () => {
      const f = await setupFamily('st-date');
      for (const statementDate of ['2026-10-15', '2026-02-30', 'garbage']) {
        await expect(svc.setImmunisationStatus(f.admin, f.child.id, { status: 'UP_TO_DATE', statementDate }, NOW)).rejects.toBeInstanceOf(BadRequestException);
      }
      await expect(svc.setImmunisationStatus(f.admin, f.child.id, { status: 'UP_TO_DATE', statementDate: TODAY }, NOW)).resolves.toBeTruthy();
    });

    it('educators and parents never write; other orgs cannot', async () => {
      const f = await setupFamily('st-perm');
      const g = await setupFamily('st-perm-other');
      await expect(svc.setImmunisationStatus(f.educator, f.child.id, { status: 'UP_TO_DATE' }, NOW)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(svc.setImmunisationStatus(f.parent, f.child.id, { status: 'UP_TO_DATE' }, NOW)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(svc.setImmunisationStatus(g.admin, f.child.id, { status: 'UP_TO_DATE' }, NOW)).rejects.toThrow(/Not authorized|Forbidden|Not Found|not found/i);
      expect(await fixturePrisma.childImmunisationStatus.count({ where: { childId: f.child.id } })).toBe(0);
    });

    it('audits health.immunisation_status_set with childId and status only', async () => {
      const f = await setupFamily('st-audit');
      await svc.setImmunisationStatus(f.admin, f.child.id, { status: 'MEDICAL_EXEMPTION', note: 'SecretNoteXyz' }, NOW);
      const rows = (await fixturePrisma.auditLogEntry.findMany({ where: { action: 'health.immunisation_status_set', actorUserId: f.admin.userId } }));
      expect(rows).toHaveLength(1);
      expect(rows[0].metadata).toEqual({ childId: f.child.id, status: 'MEDICAL_EXEMPTION' });
      expect(JSON.stringify(rows[0])).not.toContain('SecretNoteXyz');
    });
  });

  describe('getHealth', () => {
    it('defaults the immunisation status to UNKNOWN / CHECK when never set', async () => {
      const f = await setupFamily('gh-default');
      const h1 = await svc.getHealth(f.admin, f.child.id, NOW);
      expect(h1.childId).toBe(f.child.id);
      expect(h1.allergies).toEqual([]);
      expect(h1.immunisations).toEqual([]);
      expect(h1.immunisationStatus).toMatchObject({ status: 'UNKNOWN', statementDate: null, note: null, flag: 'CHECK' });
    });

    it('returns active allergies, non-voided immunisations newest first, and the flag', async () => {
      const f = await setupFamily('gh-full');
      await svc.addAllergy(f.admin, f.child.id, { allergen: 'Peanuts', severity: 'ANAPHYLAXIS' }, NOW);
      await svc.addAllergy(f.admin, f.child.id, { allergen: 'Dust', severity: 'MILD' }, NOW);
      await seedImmunisation(f.tenant, f.child.id, f.admin.userId, 'MMR', '2025-02-01');
      await seedImmunisation(f.tenant, f.child.id, f.admin.userId, 'Hep B', '2025-06-01');
      await seedImmunisation(f.tenant, f.child.id, f.admin.userId, 'Voided', '2025-08-01', { voided: true });
      await svc.setImmunisationStatus(f.admin, f.child.id, { status: 'UP_TO_DATE', statementDate: '2026-09-01' }, NOW);
      for (const user of [f.admin, f.educator, f.parent]) {
        const r = await svc.getHealth(user, f.child.id, NOW);
        expect(r.allergies.map((a: any) => a.allergen)).toEqual(['Peanuts', 'Dust']);
        expect(r.immunisations.map((i: any) => i.vaccine)).toEqual(['Hep B', 'MMR']);
        expect(r.immunisationStatus).toMatchObject({ status: 'UP_TO_DATE', flag: 'OK' });
        expectNoInternals(r);
      }
    });

    it('flags a stale UP_TO_DATE statement relative to the supplied now', async () => {
      const f = await setupFamily('gh-stale');
      await fixturePrisma.childImmunisationStatus.create({
        data: { orgId: f.tenant.orgId, centreId: f.tenant.centreId, childId: f.child.id, status: 'UP_TO_DATE', statementDate: new Date('2025-10-01'), updatedByUserId: f.admin.userId },
      });
      expect((await svc.getHealth(f.admin, f.child.id, NOW)).immunisationStatus.flag).toBe('CHECK');
    });

    it('an educator outside the room and a stranger parent cannot read', async () => {
      const f = await setupFamily('gh-iso');
      const g = await setupFamily('gh-iso-other');
      await expect(svc.getHealth(g.educator, f.child.id, NOW)).rejects.toThrow(/Not authorized|Forbidden|Not Found|not found/i);
      await expect(svc.getHealth(g.parent, f.child.id, NOW)).rejects.toThrow(/Not authorized|Forbidden|Not Found|not found/i);
      await expect(svc.getHealth(g.admin, f.child.id, NOW)).rejects.toThrow(/Not authorized|Forbidden|Not Found|not found/i);
    });

    it('an educator in another room of the same centre cannot read', async () => {
      const f = await setupFamily('gh-room');
      const room2 = await fixturePrisma.room.create({ data: { orgId: f.tenant.orgId, centreId: f.tenant.centreId, name: 'Other room' } });
      const { makeUser } = require('./helpers');
      const other = await makeUser(f.tenant, 'EDUCATOR', room2.id);
      await expect(svc.getHealth(other, f.child.id, NOW)).rejects.toThrow(/Not authorized|Forbidden|Not Found|not found/i);
    });

    it('a parent with a restricted or expired relationship cannot read', async () => {
      const f = await setupFamily('gh-restricted');
      const { makeUser, link } = require('./helpers');
      const restricted = await makeUser(f.tenant, 'PARENT');
      await link(f.tenant, restricted, f.child.id, { isRestricted: true });
      const expired = await makeUser(f.tenant, 'PARENT');
      await link(f.tenant, expired, f.child.id, { expiresAt: new Date('2026-01-01') });
      await expect(svc.getHealth(restricted, f.child.id, NOW)).rejects.toThrow(/Not authorized|Forbidden|Not Found|not found/i);
      await expect(svc.getHealth(expired, f.child.id, NOW)).rejects.toThrow(/Not authorized|Forbidden|Not Found|not found/i);
    });

    it('a departed child is still readable by an admin', async () => {
      const f = await setupFamily('gh-departed');
      await fixturePrisma.child.update({ where: { id: f.child.id }, data: { departedOn: new Date('2026-09-30') } });
      await expect(svc.getHealth(f.admin, f.child.id, NOW)).resolves.toMatchObject({ childId: f.child.id });
    });
  });
});
