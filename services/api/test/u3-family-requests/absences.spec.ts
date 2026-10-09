import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { FamilyRequestsService } from '../../src/family-requests/family-requests.service';
import { FeeCalculationService } from '../../src/billing/fee-calculation.service';
import { appPrisma, disconnectAll, fixturePrisma, seedOrgCentreRoom, setTenantContext } from '../test-utils';
import { NOW, TODAY, addDays, auditFor, buildService, link, makeChild, makeFeeSchedule, makeUser, setupFamily } from './helpers';

/**
 * U3 slice 2: parents report an absence from the app. A parent-reported absence
 * is never allowable by default (the fee still applies until the centre
 * confirms), so the centre makes the money-affecting decision.
 */
describe('FamilyRequestsService: U3 absences', () => {
  let prismaService: PrismaService;
  let service: FamilyRequestsService;
  const feeCalculation = new FeeCalculationService();

  beforeAll(async () => {
    ({ prismaService, service } = await buildService());
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await disconnectAll();
  });

  it('a parent reports an absence: stored not-allowable, attributed to the parent, and audited without the reason text', async () => {
    const { tenant, parent, child } = await setupFamily('AbsReport');
    const date = addDays(TODAY, 2);

    const view = await service.reportAbsence(parent, child.id, { date, reason: 'Fever secret-reason' }, NOW);
    expect(view).toMatchObject({ childId: child.id, date, isAllowable: false, reason: 'Fever secret-reason', reportedByParent: true });
    expect(typeof view.createdAt).toBe('string');

    const row = await fixturePrisma.absence.findUniqueOrThrow({ where: { id: view.id } });
    expect(row.date.toISOString().slice(0, 10)).toBe(date);
    expect(row.isAllowable).toBe(false);
    expect(row.centreId).toBe(tenant.centreId);
    expect((row as unknown as { reportedByUserId: string | null }).reportedByUserId).toBe(parent.userId);

    const audits = (await auditFor(view.id)).filter((a) => a.action === 'absence.reported');
    expect(audits).toHaveLength(1);
    expect(audits[0].entityType).toBe('Absence');
    expect(audits[0].actorUserId).toBe(parent.userId);
    expect(JSON.stringify(audits[0].metadata)).toContain(child.id);
    expect(JSON.stringify(audits[0].metadata)).toContain(date);
    expect(JSON.stringify(audits[0].metadata)).not.toContain('secret-reason');
  });

  it('a reason is optional and comes back null; an admin report is not flagged reportedByParent', async () => {
    const { admin, parent, child } = await setupFamily('AbsAdmin');
    const a = await service.reportAbsence(parent, child.id, { date: addDays(TODAY, 1) }, NOW);
    expect(a.reason).toBeNull();
    const b = await service.reportAbsence(admin, child.id, { date: addDays(TODAY, 3), reason: 'Phoned in' }, NOW);
    expect(b).toMatchObject({ reportedByParent: false, isAllowable: false });
  });

  it('educators, other-family parents, and restricted or expired guardians are Forbidden and nothing is written', async () => {
    const { tenant, educator, child } = await setupFamily('AbsDeny');
    const strangerParent = await makeUser(tenant, 'PARENT');
    const otherChild = await makeChild(tenant);
    await link(tenant, strangerParent, otherChild.id);
    const restricted = await makeUser(tenant, 'PARENT');
    await link(tenant, restricted, child.id, { isRestricted: true });
    const expired = await makeUser(tenant, 'PARENT');
    await link(tenant, expired, child.id, { expiresAt: new Date('2026-01-01T00:00:00Z') });

    for (const actor of [educator, strangerParent, restricted, expired]) {
      await expect(service.reportAbsence(actor, child.id, { date: addDays(TODAY, 1) }, NOW)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.listAbsences(actor, child.id, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(await fixturePrisma.absence.count({ where: { childId: child.id } })).toBe(0);
  });

  it('the date window is centre-local: 7 days back to 90 days ahead, inclusive', async () => {
    const { parent, child } = await setupFamily('AbsWindow');
    // Centre-today is 2026-10-14 even though it is still 2026-10-13 in UTC.
    await expect(service.reportAbsence(parent, child.id, { date: addDays(TODAY, -8) }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.reportAbsence(parent, child.id, { date: addDays(TODAY, 91) }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.reportAbsence(parent, child.id, { date: 'not-a-date' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.reportAbsence(parent, child.id, { date: addDays(TODAY, -7) }, NOW)).resolves.toMatchObject({ date: addDays(TODAY, -7) });
    await expect(service.reportAbsence(parent, child.id, { date: addDays(TODAY, 90) }, NOW)).resolves.toMatchObject({ date: addDays(TODAY, 90) });
    await expect(service.reportAbsence(parent, child.id, { date: TODAY }, NOW)).resolves.toMatchObject({ date: TODAY });
    expect(await fixturePrisma.absence.count({ where: { childId: child.id } })).toBe(3);
  });

  it('reason is capped at 500 characters', async () => {
    const { parent, child } = await setupFamily('AbsReason');
    await expect(service.reportAbsence(parent, child.id, { date: addDays(TODAY, 1), reason: 'x'.repeat(501) }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.reportAbsence(parent, child.id, { date: addDays(TODAY, 1), reason: 'x'.repeat(500) }, NOW)).resolves.toMatchObject({ date: addDays(TODAY, 1) });
  });

  it('reporting the same child and date twice is a Conflict', async () => {
    const { parent, admin, child } = await setupFamily('AbsDup');
    const date = addDays(TODAY, 4);
    await service.reportAbsence(parent, child.id, { date }, NOW);
    await expect(service.reportAbsence(parent, child.id, { date }, NOW)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.reportAbsence(admin, child.id, { date }, NOW)).rejects.toBeInstanceOf(ConflictException);
    expect(await fixturePrisma.absence.count({ where: { childId: child.id } })).toBe(1);
  });

  it('listAbsences returns dates from 30 days back onward, ascending, to parents and admins only', async () => {
    const { admin, parent, educator, child } = await setupFamily('AbsList');
    const rows = [addDays(TODAY, -31), addDays(TODAY, -30), addDays(TODAY, 40), addDays(TODAY, 2), addDays(TODAY, -3)];
    for (const d of rows) {
      await fixturePrisma.absence.create({ data: { orgId: child.orgId, centreId: child.centreId, childId: child.id, date: new Date(d), isAllowable: false } });
    }
    const expected = [addDays(TODAY, -30), addDays(TODAY, -3), addDays(TODAY, 2), addDays(TODAY, 40)];
    expect((await service.listAbsences(parent, child.id, NOW)).map((a) => a.date)).toEqual(expected);
    expect((await service.listAbsences(admin, child.id, NOW)).map((a) => a.date)).toEqual(expected);
    await expect(service.listAbsences(educator, child.id, NOW)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('listCentreAbsences shows only this centre, defaults to today..+30 days, enriches with the child, and is admin-only', async () => {
    const { tenant, admin, parent, educator, child } = await setupFamily('AbsCentre');
    const inWindow = await service.reportAbsence(parent, child.id, { date: addDays(TODAY, 5) }, NOW);
    await service.reportAbsence(parent, child.id, { date: addDays(TODAY, 45) }, NOW);
    await service.reportAbsence(parent, child.id, { date: addDays(TODAY, -2) }, NOW);

    const otherCentre = await fixturePrisma.centre.create({ data: { orgId: tenant.orgId, name: 'Second centre' } });
    const otherRoom = await fixturePrisma.room.create({ data: { orgId: tenant.orgId, centreId: otherCentre.id, name: 'R2' } });
    const otherTenant = { orgId: tenant.orgId, centreId: otherCentre.id, roomId: otherRoom.id };
    const otherChild = await makeChild(otherTenant);
    await fixturePrisma.absence.create({ data: { orgId: tenant.orgId, centreId: otherCentre.id, childId: otherChild.id, date: new Date(addDays(TODAY, 5)), isAllowable: false } });
    const foreign = await seedOrgCentreRoom('AbsCentreForeign');
    const foreignChild = await makeChild(foreign);
    await fixturePrisma.absence.create({ data: { orgId: foreign.orgId, centreId: foreign.centreId, childId: foreignChild.id, date: new Date(addDays(TODAY, 5)), isAllowable: false } });

    const list = await service.listCentreAbsences(admin, {}, NOW);
    expect(list.map((a) => a.id)).toEqual([inWindow.id]);
    expect(list[0].child).toEqual({ id: child.id, firstName: child.firstName, lastName: child.lastName });

    const wide = await service.listCentreAbsences(admin, { from: addDays(TODAY, -5), to: addDays(TODAY, 60) }, NOW);
    expect(wide).toHaveLength(3);
    expect(wide.map((a) => a.date)).toEqual([addDays(TODAY, -2), addDays(TODAY, 5), addDays(TODAY, 45)]);

    await expect(service.listCentreAbsences(parent, {}, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.listCentreAbsences(educator, {}, NOW)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('an admin confirms an absence as allowable (and can revert), audited; other centres, parents and educators cannot', async () => {
    const { tenant, admin, parent, educator, child } = await setupFamily('AbsAllow');
    const absence = await service.reportAbsence(parent, child.id, { date: addDays(TODAY, 2) }, NOW);

    await expect(service.setAbsenceAllowable(parent, absence.id, true)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.setAbsenceAllowable(educator, absence.id, true)).rejects.toBeInstanceOf(ForbiddenException);

    const otherCentre = await fixturePrisma.centre.create({ data: { orgId: tenant.orgId, name: 'Other centre admin' } });
    const otherAdmin = await makeUser({ orgId: tenant.orgId, centreId: otherCentre.id }, 'CENTRE_ADMIN');
    await expect(service.setAbsenceAllowable(otherAdmin, absence.id, true)).rejects.toBeInstanceOf(ForbiddenException);
    expect((await fixturePrisma.absence.findUniqueOrThrow({ where: { id: absence.id } })).isAllowable).toBe(false);

    const confirmed = await service.setAbsenceAllowable(admin, absence.id, true);
    expect(confirmed).toMatchObject({ id: absence.id, isAllowable: true });
    expect((await fixturePrisma.absence.findUniqueOrThrow({ where: { id: absence.id } })).isAllowable).toBe(true);
    expect((await service.setAbsenceAllowable(admin, absence.id, false)).isAllowable).toBe(false);

    const audits = (await auditFor(absence.id)).filter((a) => a.action === 'absence.allowable_set');
    expect(audits).toHaveLength(2);
    expect(audits.map((a) => a.metadata)).toEqual(expect.arrayContaining([expect.objectContaining({ absenceId: absence.id, isAllowable: true })]));

    await expect(service.setAbsenceAllowable(admin, randomUUID(), true)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('fee integration: a parent-reported absence stays chargeable until the centre confirms it, then the day is free', async () => {
    const { tenant, admin, parent, child } = await setupFamily('AbsFees');
    const fee = await makeFeeSchedule(tenant, { amountCents: 10000 });
    await fixturePrisma.booking.create({
      data: {
        orgId: tenant.orgId, centreId: tenant.centreId, childId: child.id, roomId: tenant.roomId, feeScheduleId: fee.id,
        bookingType: 'PERMANENT', daysOfWeek: [1, 2, 3, 4, 5], startDate: new Date('2026-01-01'),
      },
    });
    const start = new Date('2026-10-12T00:00:00Z'); // Mon
    const end = new Date('2026-10-16T00:00:00Z'); // Fri
    const absentDay = TODAY; // Wednesday, booked

    expect(await feeCalculation.getChargeableSessions(fixturePrisma, child.id, start, end)).toHaveLength(5);

    const absence = await service.reportAbsence(parent, child.id, { date: absentDay }, NOW);
    const afterReport = await feeCalculation.getChargeableSessions(fixturePrisma, child.id, start, end);
    expect(afterReport).toHaveLength(5);
    expect(afterReport.some((s) => s.date.toISOString().slice(0, 10) === absentDay)).toBe(true);

    await service.setAbsenceAllowable(admin, absence.id, true);
    const afterConfirm = await feeCalculation.getChargeableSessions(fixturePrisma, child.id, start, end);
    expect(afterConfirm).toHaveLength(4);
    expect(afterConfirm.some((s) => s.date.toISOString().slice(0, 10) === absentDay)).toBe(false);
  });

  it('tenant isolation: another org cannot report, list, read or change these absences, and RLS hides the rows', async () => {
    const { tenant, parent, child } = await setupFamily('AbsIsoA');
    const other = await setupFamily('AbsIsoB');
    const absence = await service.reportAbsence(parent, child.id, { date: addDays(TODAY, 2) }, NOW);

    await expect(service.reportAbsence(other.parent, child.id, { date: addDays(TODAY, 3) }, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.reportAbsence(other.admin, child.id, { date: addDays(TODAY, 3) }, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.listAbsences(other.admin, child.id, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.setAbsenceAllowable(other.admin, absence.id, true)).rejects.toBeInstanceOf(NotFoundException);
    expect((await service.listCentreAbsences(other.admin, { from: addDays(TODAY, -30), to: addDays(TODAY, 100) }, NOW)).map((a) => a.id)).not.toContain(absence.id);
    expect((await fixturePrisma.absence.findUniqueOrThrow({ where: { id: absence.id } })).isAllowable).toBe(false);
    expect(await fixturePrisma.absence.count({ where: { childId: child.id } })).toBe(1);

    await setTenantContext(appPrisma, other.tenant.orgId, other.tenant.centreId);
    expect(await appPrisma.absence.findMany({ where: { id: absence.id } })).toHaveLength(0);
    await setTenantContext(appPrisma, tenant.orgId, tenant.centreId);
    expect(await appPrisma.absence.findMany({ where: { id: absence.id } })).toHaveLength(1);
  });
});
