import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { FamilyRequestsService } from '../../src/family-requests/family-requests.service';
import { appPrisma, disconnectAll, fixturePrisma, setTenantContext, uniqueSuffix } from '../test-utils';
import { NOW, TODAY, addDays, auditFor, buildService, link, makeChild, makeUser, setupFamily } from './helpers';

const PERSON = { personName: 'Nana Secretname', personPhone: '0412 345 678' };

/**
 * U3 slice 2: a parent nominates someone else to collect their child on a given
 * day; staff see the nomination for their room and verify the person at the door.
 */
describe('FamilyRequestsService: U3 pickup nominations', () => {
  let prismaService: PrismaService;
  let service: FamilyRequestsService;

  beforeAll(async () => {
    ({ prismaService, service } = await buildService());
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await disconnectAll();
  });

  async function otherRoom(tenant: { orgId: string; centreId: string }) {
    return fixturePrisma.room.create({ data: { orgId: tenant.orgId, centreId: tenant.centreId, name: `Room ${uniqueSuffix()}` } });
  }

  it('a parent with pickup rights nominates a person: ACTIVE, unverified, trimmed, audited without name or phone', async () => {
    const { tenant, parent, child } = await setupFamily('PickNominate');
    const date = addDays(TODAY, 2);
    const view = await service.nominatePickup(parent, child.id, { date, personName: '  Nana Secretname  ', personPhone: '0412 345 678', note: 'Has the car seat secret-note' }, NOW);
    expect(view).toMatchObject({ childId: child.id, date, personName: 'Nana Secretname', personPhone: '0412 345 678', note: 'Has the car seat secret-note', status: 'ACTIVE', verified: false });
    expect(typeof view.createdAt).toBe('string');

    const row = await fixturePrisma.pickupNomination.findUniqueOrThrow({ where: { id: view.id } });
    expect(row).toMatchObject({ orgId: tenant.orgId, centreId: tenant.centreId, createdByUserId: parent.userId, status: 'ACTIVE', verifiedByUserId: null, verifiedAt: null });
    expect(row.date.toISOString().slice(0, 10)).toBe(date);

    const audits = (await auditFor(view.id)).filter((a) => a.action === 'pickup.nominated');
    expect(audits).toHaveLength(1);
    const meta = JSON.stringify(audits[0].metadata);
    expect(meta).toContain(child.id);
    expect(meta).toContain(date);
    expect(meta).toContain(view.id);
    for (const secret of ['Secretname', '0412', 'secret-note']) expect(meta).not.toContain(secret);

    const noPhone = await service.nominatePickup(parent, child.id, { date, personName: 'Uncle Bob' }, NOW);
    expect(noPhone).toMatchObject({ personPhone: null, note: null });
  });

  it('admins may nominate; educators, guardians without pickup rights, strangers, restricted and expired guardians are Forbidden', async () => {
    const { tenant, admin, educator, child } = await setupFamily('PickDeny');
    const noPickup = await makeUser(tenant, 'PARENT');
    await link(tenant, noPickup, child.id, { canPickup: false });
    const stranger = await makeUser(tenant, 'PARENT');
    const strangerChild = await makeChild(tenant);
    await link(tenant, stranger, strangerChild.id);
    const restricted = await makeUser(tenant, 'PARENT');
    await link(tenant, restricted, child.id, { canPickup: true, isRestricted: true });
    const expired = await makeUser(tenant, 'PARENT');
    await link(tenant, expired, child.id, { canPickup: true, expiresAt: new Date('2026-01-01T00:00:00Z') });

    for (const actor of [educator, noPickup, stranger, restricted, expired]) {
      await expect(service.nominatePickup(actor, child.id, { date: addDays(TODAY, 1), ...PERSON }, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    }
    for (const actor of [educator, noPickup, stranger, restricted, expired]) {
      await expect(service.listPickupNominations(actor, child.id, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(await fixturePrisma.pickupNomination.count({ where: { childId: child.id } })).toBe(0);

    await expect(service.nominatePickup(admin, child.id, { date: addDays(TODAY, 1), ...PERSON }, NOW)).resolves.toMatchObject({ status: 'ACTIVE' });
  });

  it('validates date (centre today to +30), name (2-100 chars after trim), phone characters and length, and note length', async () => {
    const { parent, child } = await setupFamily('PickValidate');
    const ok = { date: addDays(TODAY, 1), personName: 'Jo Smith' };
    const bad = [
      { ...ok, date: addDays(TODAY, -1) },
      { ...ok, date: addDays(TODAY, 31) },
      { ...ok, date: 'tomorrow' },
      { ...ok, personName: ' J ' },
      { ...ok, personName: '   ' },
      { ...ok, personName: 'x'.repeat(101) },
      { ...ok, personPhone: '12345' },
      { ...ok, personPhone: '1'.repeat(21) },
      { ...ok, personPhone: '0412-abc-678' },
      { ...ok, personPhone: '04123456<script>' },
      { ...ok, note: 'x'.repeat(301) },
    ];
    for (const input of bad) {
      await expect(service.nominatePickup(parent, child.id, input, NOW)).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(await fixturePrisma.pickupNomination.count({ where: { childId: child.id } })).toBe(0);

    // Boundaries are accepted; centre-today counts even though it is still the previous day in UTC.
    await service.nominatePickup(parent, child.id, { date: TODAY, personName: 'Jo' }, NOW);
    await service.nominatePickup(parent, child.id, { date: addDays(TODAY, 30), personName: 'x'.repeat(100), personPhone: '+61 (4) 12-345-678', note: 'x'.repeat(300) }, NOW);
    await service.nominatePickup(parent, child.id, { date: addDays(TODAY, 2), personName: 'Jo Smith', personPhone: '123456' }, NOW);
    expect(await fixturePrisma.pickupNomination.count({ where: { childId: child.id } })).toBe(3);
  });

  it('allows at most 3 ACTIVE nominations per child per date; cancelled ones free a slot', async () => {
    const { parent, child } = await setupFamily('PickMax');
    const date = addDays(TODAY, 3);
    const made = [];
    for (const n of ['Aunt One', 'Aunt Two', 'Aunt Three']) made.push(await service.nominatePickup(parent, child.id, { date, personName: n }, NOW));
    await expect(service.nominatePickup(parent, child.id, { date, personName: 'Aunt Four' }, NOW)).rejects.toBeInstanceOf(ConflictException);
    // A different date is unaffected.
    await expect(service.nominatePickup(parent, child.id, { date: addDays(date, 1), personName: 'Aunt Four' }, NOW)).resolves.toMatchObject({ status: 'ACTIVE' });
    await service.cancelPickupNomination(parent, made[0].id);
    await expect(service.nominatePickup(parent, child.id, { date, personName: 'Aunt Four' }, NOW)).resolves.toMatchObject({ status: 'ACTIVE' });
    expect(await fixturePrisma.pickupNomination.count({ where: { childId: child.id, date: new Date(date), status: 'ACTIVE' } })).toBe(3);
  });

  it('lists upcoming ACTIVE nominations (today onward) ascending for pickup-entitled parents and admins', async () => {
    const { tenant, admin, parent, educator, child } = await setupFamily('PickList');
    for (const [d, status] of [[addDays(TODAY, -1), 'ACTIVE'], [addDays(TODAY, 5), 'ACTIVE'], [TODAY, 'ACTIVE'], [addDays(TODAY, 2), 'CANCELLED']] as const) {
      await fixturePrisma.pickupNomination.create({
        data: { orgId: tenant.orgId, centreId: tenant.centreId, childId: child.id, date: new Date(d), personName: 'Some One', status, createdByUserId: parent.userId },
      });
    }
    const expected = [TODAY, addDays(TODAY, 5)];
    expect((await service.listPickupNominations(parent, child.id, NOW)).map((n) => n.date)).toEqual(expected);
    expect((await service.listPickupNominations(admin, child.id, NOW)).map((n) => n.date)).toEqual(expected);
    await expect(service.listPickupNominations(educator, child.id, NOW)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('cancel: the creating parent or a centre admin; only ACTIVE; others cannot; audited', async () => {
    const { tenant, admin, parent, educator, child } = await setupFamily('PickCancel');
    const coParent = await makeUser(tenant, 'PARENT');
    await link(tenant, coParent, child.id, { canPickup: true });
    const stranger = await makeUser(tenant, 'PARENT');
    const strangerChild = await makeChild(tenant);
    await link(tenant, stranger, strangerChild.id);
    const otherCentre = await fixturePrisma.centre.create({ data: { orgId: tenant.orgId, name: 'Pick other centre' } });
    const otherAdmin = await makeUser({ orgId: tenant.orgId, centreId: otherCentre.id }, 'CENTRE_ADMIN');

    const nomination = await service.nominatePickup(parent, child.id, { date: addDays(TODAY, 1), ...PERSON }, NOW);
    for (const actor of [coParent, stranger, educator, otherAdmin]) {
      await expect(service.cancelPickupNomination(actor, nomination.id)).rejects.toThrow();
    }
    expect((await fixturePrisma.pickupNomination.findUniqueOrThrow({ where: { id: nomination.id } })).status).toBe('ACTIVE');

    expect(await service.cancelPickupNomination(parent, nomination.id)).toMatchObject({ id: nomination.id, status: 'CANCELLED' });
    await expect(service.cancelPickupNomination(parent, nomination.id)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.cancelPickupNomination(admin, nomination.id)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.cancelPickupNomination(admin, randomUUID())).rejects.toBeInstanceOf(NotFoundException);

    const byAdmin = await service.nominatePickup(parent, child.id, { date: addDays(TODAY, 1), ...PERSON }, NOW);
    expect((await service.cancelPickupNomination(admin, byAdmin.id)).status).toBe('CANCELLED');

    const audits = (await auditFor(nomination.id)).filter((a) => a.action === 'pickup.cancelled');
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0].metadata ?? {})).not.toContain('Secretname');
  });

  it('a creating parent who loses pickup rights can no longer cancel', async () => {
    const { parent, child } = await setupFamily('PickCancelRevoked');
    const n = await service.nominatePickup(parent, child.id, { date: addDays(TODAY, 1), ...PERSON }, NOW);
    await fixturePrisma.guardianChildRelationship.updateMany({ where: { guardianUserId: parent.userId, childId: child.id }, data: { canPickup: false } });
    await expect(service.cancelPickupNomination(parent, n.id)).rejects.toThrow();
    expect((await fixturePrisma.pickupNomination.findUniqueOrThrow({ where: { id: n.id } })).status).toBe('ACTIVE');
  });

  it('staff list for a date: educators see only their rooms, admins the whole centre, parents are Forbidden, never other centres or orgs', async () => {
    const { tenant, admin, educator, parent, child } = await setupFamily('PickStaffList');
    const room2 = await otherRoom(tenant);
    const child2 = await makeChild(tenant, { roomId: room2.id });
    const noRoom = await makeChild(tenant, { roomId: null });
    const parent2 = await makeUser(tenant, 'PARENT');
    await link(tenant, parent2, child2.id);

    const mine = await service.nominatePickup(parent, child.id, { date: TODAY, ...PERSON }, NOW);
    const theirs = await service.nominatePickup(admin, child2.id, { date: TODAY, personName: 'Other Room Person' }, NOW);
    const unassigned = await service.nominatePickup(admin, noRoom.id, { date: TODAY, personName: 'No Room Person' }, NOW);
    const tomorrow = await service.nominatePickup(parent, child.id, { date: addDays(TODAY, 1), personName: 'Tomorrow Person' }, NOW);
    const cancelled = await service.nominatePickup(parent, child.id, { date: TODAY, personName: 'Cancelled Person' }, NOW);
    await service.cancelPickupNomination(parent, cancelled.id);

    // Other centre (same org) and other org.
    const otherCentre = await fixturePrisma.centre.create({ data: { orgId: tenant.orgId, name: 'Pick list other centre' } });
    const oRoom = await fixturePrisma.room.create({ data: { orgId: tenant.orgId, centreId: otherCentre.id, name: 'R3' } });
    const oChild = await makeChild({ orgId: tenant.orgId, centreId: otherCentre.id, roomId: oRoom.id });
    await fixturePrisma.pickupNomination.create({ data: { orgId: tenant.orgId, centreId: otherCentre.id, childId: oChild.id, date: new Date(TODAY), personName: 'Elsewhere', createdByUserId: parent.userId } });
    const foreign = await setupFamily('PickStaffForeign');
    await service.nominatePickup(foreign.parent, foreign.child.id, { date: TODAY, personName: 'Foreign Person' }, NOW);

    const educatorView = await service.listPickupsForDate(educator, {}, NOW);
    expect(educatorView.map((n) => n.id)).toEqual([mine.id]);
    const room = await fixturePrisma.room.findUniqueOrThrow({ where: { id: tenant.roomId } });
    expect(educatorView[0]).toMatchObject({ personName: 'Nana Secretname', verified: false, child: { id: child.id, firstName: child.firstName, lastName: child.lastName }, roomName: room.name });

    const adminView = await service.listPickupsForDate(admin, { date: TODAY }, NOW);
    expect(adminView.map((n) => n.id).sort()).toEqual([mine.id, theirs.id, unassigned.id].sort());
    expect(adminView.find((n) => n.id === unassigned.id)?.roomName).toBeNull();

    expect((await service.listPickupsForDate(admin, { date: addDays(TODAY, 1) }, NOW)).map((n) => n.id)).toEqual([tomorrow.id]);
    expect((await service.listPickupsForDate(educator, { date: addDays(TODAY, 1) }, NOW)).map((n) => n.id)).toEqual([tomorrow.id]);

    // An educator whose assignment has ended sees nothing for that room.
    const ex = await makeUser(tenant, 'EDUCATOR');
    await fixturePrisma.staffRoomAssignment.create({ data: { orgId: tenant.orgId, centreId: tenant.centreId, userId: ex.userId, roomId: tenant.roomId, startDate: new Date('2026-01-01'), endDate: new Date('2026-06-01') } });
    expect(await service.listPickupsForDate(ex, {}, NOW)).toEqual([]);

    await expect(service.listPickupsForDate(parent, {}, NOW)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('verify: assigned educator or centre admin, on the day only, idempotent, audited once', async () => {
    const { tenant, admin, educator, parent, child } = await setupFamily('PickVerify');
    const n = await service.nominatePickup(parent, child.id, { date: TODAY, ...PERSON }, NOW);

    const verified = await service.verifyPickup(educator, n.id, NOW);
    expect(verified).toMatchObject({ id: n.id, verified: true, status: 'ACTIVE' });
    const first = await fixturePrisma.pickupNomination.findUniqueOrThrow({ where: { id: n.id } });
    expect(first.verifiedByUserId).toBe(educator.userId);
    expect(first.verifiedAt).toBeInstanceOf(Date);

    // Idempotent: a second call (even by an admin) keeps the first verifier and time.
    expect(await service.verifyPickup(admin, n.id, NOW)).toMatchObject({ verified: true });
    expect(await service.verifyPickup(educator, n.id, NOW)).toMatchObject({ verified: true });
    const second = await fixturePrisma.pickupNomination.findUniqueOrThrow({ where: { id: n.id } });
    expect(second.verifiedByUserId).toBe(educator.userId);
    expect(second.verifiedAt?.getTime()).toBe(first.verifiedAt?.getTime());

    const audits = (await auditFor(n.id)).filter((a) => a.action === 'pickup.verified');
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0].metadata ?? {})).not.toContain('Secretname');
    expect(JSON.stringify(audits[0].metadata ?? {})).not.toContain('0412');

    // Admin can verify on their own.
    const n2 = await service.nominatePickup(parent, child.id, { date: TODAY, personName: 'Second Person' }, NOW);
    expect((await service.verifyPickup(admin, n2.id, NOW)).verified).toBe(true);
    expect(tenant.orgId).toBeDefined();
  });

  it('verify is refused for parents, educators of another room, other-centre admins, wrong days and cancelled nominations', async () => {
    const { tenant, admin, educator, parent, child } = await setupFamily('PickVerifyDeny');
    const room2 = await otherRoom(tenant);
    const wrongRoomEducator = await makeUser(tenant, 'EDUCATOR', room2.id);
    const otherCentre = await fixturePrisma.centre.create({ data: { orgId: tenant.orgId, name: 'Verify other centre' } });
    const otherAdmin = await makeUser({ orgId: tenant.orgId, centreId: otherCentre.id }, 'CENTRE_ADMIN');

    const today = await service.nominatePickup(parent, child.id, { date: TODAY, ...PERSON }, NOW);
    for (const actor of [parent, wrongRoomEducator, otherAdmin]) {
      await expect(service.verifyPickup(actor, today.id, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    }
    await expect(service.verifyPickup(educator, randomUUID(), NOW)).rejects.toBeInstanceOf(NotFoundException);

    const future = await service.nominatePickup(parent, child.id, { date: addDays(TODAY, 1), ...PERSON }, NOW);
    await expect(service.verifyPickup(educator, future.id, NOW)).rejects.toBeInstanceOf(BadRequestException);
    // Once the day has passed it can no longer be verified either.
    await expect(service.verifyPickup(educator, today.id, new Date('2026-10-14T20:00:00Z'))).rejects.toBeInstanceOf(BadRequestException);

    const cancelled = await service.nominatePickup(parent, child.id, { date: TODAY, personName: 'Cancelled Person' }, NOW);
    await service.cancelPickupNomination(parent, cancelled.id);
    await expect(service.verifyPickup(admin, cancelled.id, NOW)).rejects.toBeInstanceOf(BadRequestException);

    const rows = await fixturePrisma.pickupNomination.findMany({ where: { childId: child.id } });
    expect(rows.every((r) => r.verifiedAt === null && r.verifiedByUserId === null)).toBe(true);
    expect((await fixturePrisma.auditLogEntry.count({ where: { action: 'pickup.verified', entityId: { in: rows.map((r) => r.id) } } }))).toBe(0);
  });

  it('tenant isolation: another org cannot nominate, list, cancel or verify, and RLS hides the rows', async () => {
    const a = await setupFamily('PickIsoA');
    const b = await setupFamily('PickIsoB');
    const n = await service.nominatePickup(a.parent, a.child.id, { date: TODAY, ...PERSON }, NOW);

    await expect(service.nominatePickup(b.parent, a.child.id, { date: TODAY, ...PERSON }, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.nominatePickup(b.admin, a.child.id, { date: TODAY, ...PERSON }, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.listPickupNominations(b.admin, a.child.id, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.cancelPickupNomination(b.admin, n.id)).rejects.toThrow();
    await expect(service.cancelPickupNomination(b.parent, n.id)).rejects.toThrow();
    await expect(service.verifyPickup(b.admin, n.id, NOW)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.verifyPickup(b.educator, n.id, NOW)).rejects.toThrow();
    expect((await service.listPickupsForDate(b.admin, { date: TODAY }, NOW)).map((x) => x.id)).not.toContain(n.id);
    expect(await fixturePrisma.pickupNomination.count({ where: { childId: a.child.id } })).toBe(1);
    expect((await fixturePrisma.pickupNomination.findUniqueOrThrow({ where: { id: n.id } })).status).toBe('ACTIVE');

    await setTenantContext(appPrisma, b.tenant.orgId, b.tenant.centreId);
    expect(await appPrisma.pickupNomination.findMany({ where: { id: n.id } })).toHaveLength(0);
    await setTenantContext(appPrisma, a.tenant.orgId, a.tenant.centreId);
    expect(await appPrisma.pickupNomination.findMany({ where: { id: n.id } })).toHaveLength(1);
  });
});
