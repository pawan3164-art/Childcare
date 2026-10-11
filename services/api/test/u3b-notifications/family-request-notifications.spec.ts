import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { AuthorizationService } from '../../src/authorization/authorization.service';
import { FamilyRequestsService } from '../../src/family-requests/family-requests.service';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { StubPushProvider } from '../../src/notifications/providers/stub-push.provider';
import { disconnectAll, fixturePrisma, uniqueSuffix } from '../test-utils';
import { NOW, TODAY, addDays, link, makeChild, makeFeeSchedule, makeUser, setupFamily } from '../u3-family-requests/helpers';

/**
 * U3b (OI-30): staff and families are told about family requests. Best effort:
 * a notification problem never fails the request. Payloads carry ids, a date and
 * a status only: never names, phone numbers, notes or reasons.
 */
const DAY = addDays(TODAY, 7);
const SECRETS = ['Zed-Secret-Person', '0412 999 777', 'secret-note', 'secret-reason'];

describe('FamilyRequestsService: U3b notifications', () => {
  let prismaService: PrismaService;
  let tenancy: TenancyService;
  let audit: AuditService;
  let authorization: AuthorizationService;
  let service: FamilyRequestsService;
  let outsiders: { admin: { userId: string }; educator: { userId: string } };

  beforeAll(async () => {
    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    tenancy = new TenancyService(prismaService);
    audit = new AuditService(tenancy);
    authorization = new AuthorizationService(tenancy, audit);
    service = new FamilyRequestsService(tenancy, audit, authorization, new NotificationsService(tenancy, new StubPushProvider()));
    // A completely separate org and centre, with their own admin and educator.
    outsiders = await setupFamily('NotifOutside');
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await disconnectAll();
  });

  async function family(label: string) {
    const f = await setupFamily(label);
    const admin2 = await makeUser(f.tenant, 'CENTRE_ADMIN');
    const fee = await makeFeeSchedule(f.tenant);
    return { ...f, admin2, fee };
  }

  async function inbox(userId: string, type?: string) {
    const rows = await fixturePrisma.notificationQueueItem.findMany({ where: { recipientUserId: userId } });
    return type ? rows.filter((r) => (r.payload as { type?: string }).type === type) : rows;
  }

  async function expectOutsidersEmpty() {
    expect(await inbox(outsiders.admin.userId)).toHaveLength(0);
    expect(await inbox(outsiders.educator.userId)).toHaveLength(0);
  }

  function expectNoSecrets(rows: { payload: unknown }[]) {
    for (const r of rows) for (const s of SECRETS) expect(JSON.stringify(r.payload)).not.toContain(s);
  }

  const failingNotifications = () => ({ enqueue: jest.fn().mockRejectedValue(new Error('queue down')) }) as unknown as NotificationsService;
  const withFailingNotifications = () => new FamilyRequestsService(tenancy, audit, authorization, failingNotifications());

  // ------------------------------------------------------------- absences

  it('a parent reporting an absence notifies every centre admin once, ACTION_REQUIRED, ids and date only', async () => {
    const { tenant, admin, admin2, educator, parent, child } = await family('NAbs');
    const view = await service.reportAbsence(parent, child.id, { date: DAY, reason: 'secret-reason' }, NOW);

    for (const a of [admin, admin2]) {
      const items = await inbox(a.userId);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ priority: 'ACTION_REQUIRED', channel: 'PUSH', status: 'QUEUED', orgId: tenant.orgId, centreId: tenant.centreId });
      expect(items[0].payload).toEqual({ type: 'absence_reported', absenceId: view.id, childId: child.id, date: DAY });
      expectNoSecrets(items);
    }
    expect(await inbox(educator.userId)).toHaveLength(0);
    expect(await inbox(parent.userId)).toHaveLength(0);
    await expectOutsidersEmpty();
  });

  it('an admin reporting the absence themselves notifies nobody', async () => {
    const { admin, admin2, child } = await family('NAbsAdmin');
    await service.reportAbsence(admin, child.id, { date: DAY }, NOW);
    expect(await inbox(admin.userId)).toHaveLength(0);
    expect(await inbox(admin2.userId)).toHaveLength(0);
  });

  it('a notification failure does not fail or roll back the absence', async () => {
    const { admin, child, parent } = await family('NAbsFail');
    const view = await withFailingNotifications().reportAbsence(parent, child.id, { date: DAY }, NOW);
    expect(await fixturePrisma.absence.findUnique({ where: { id: view.id } })).not.toBeNull();
    expect(await inbox(admin.userId)).toHaveLength(0);
  });

  // ---------------------------------------------------------- casual days

  it('a casual day request notifies every centre admin once, ACTION_REQUIRED', async () => {
    const { admin, admin2, educator, child, parent } = await family('NCasReq');
    const view = await service.requestCasualDay(parent, child.id, { date: DAY, note: 'secret-note' }, NOW);
    for (const a of [admin, admin2]) {
      const items = await inbox(a.userId);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ priority: 'ACTION_REQUIRED', channel: 'PUSH', status: 'QUEUED' });
      expect(items[0].payload).toEqual({ type: 'casual_day_requested', requestId: view.id, childId: child.id, date: DAY });
      expectNoSecrets(items);
    }
    expect(await inbox(educator.userId)).toHaveLength(0);
    await expectOutsidersEmpty();
  });

  it('a notification failure does not fail or roll back the casual day request', async () => {
    const { child, parent } = await family('NCasReqFail');
    const view = await withFailingNotifications().requestCasualDay(parent, child.id, { date: DAY }, NOW);
    expect(await fixturePrisma.casualDayRequest.findUnique({ where: { id: view.id } })).toMatchObject({ status: 'PENDING' });
  });

  it('approving tells the requesting parent only: CHILD_UPDATE with APPROVED', async () => {
    const { admin, admin2, parent, child } = await family('NCasApprove');
    const req = await service.requestCasualDay(parent, child.id, { date: DAY, note: 'secret-note' }, NOW);
    await service.approveCasualDay(admin, req.id, {}, NOW);

    const items = await inbox(parent.userId);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ priority: 'CHILD_UPDATE', channel: 'PUSH', status: 'QUEUED' });
    expect(items[0].payload).toEqual({ type: 'casual_day_decided', requestId: req.id, childId: child.id, date: DAY, status: 'APPROVED' });
    expectNoSecrets(items);
    // The deciding admin and the other admin get no decision notification.
    expect(await inbox(admin.userId, 'casual_day_decided')).toHaveLength(0);
    expect(await inbox(admin2.userId, 'casual_day_decided')).toHaveLength(0);
    await expectOutsidersEmpty();
  });

  it('declining tells the parent DECLINED and never includes the reason', async () => {
    const { admin, parent, child } = await family('NCasDecline');
    const req = await service.requestCasualDay(parent, child.id, { date: DAY }, NOW);
    await service.declineCasualDay(admin, req.id, { reason: 'secret-reason' });

    const items = await inbox(parent.userId, 'casual_day_decided');
    expect(items).toHaveLength(1);
    expect(items[0].priority).toBe('CHILD_UPDATE');
    expect(items[0].payload).toEqual({ type: 'casual_day_decided', requestId: req.id, childId: child.id, date: DAY, status: 'DECLINED' });
    expectNoSecrets(items);
  });

  it('a notification failure does not fail approve or decline', async () => {
    const { admin, parent, child } = await family('NCasDecideFail');
    const failing = withFailingNotifications();
    const a = await failing.requestCasualDay(parent, child.id, { date: DAY }, NOW);
    const approved = await failing.approveCasualDay(admin, a.id, {}, NOW);
    expect(approved.status).toBe('APPROVED');
    expect(await fixturePrisma.booking.count({ where: { childId: child.id, specificDate: new Date(`${DAY}T00:00:00Z`) } })).toBe(1);

    const b = await failing.requestCasualDay(parent, child.id, { date: addDays(DAY, 7) }, NOW);
    const declined = await failing.declineCasualDay(admin, b.id, { reason: 'secret-reason' });
    expect(declined.status).toBe('DECLINED');
    expect(await inbox(parent.userId)).toHaveLength(0);
  });

  // -------------------------------------------------------------- pickups

  async function pickupWorld(label: string) {
    const f = await family(label);
    const otherRoom = await fixturePrisma.room.create({ data: { orgId: f.tenant.orgId, centreId: f.tenant.centreId, name: `Other room ${uniqueSuffix()}` } });
    const educator2 = await makeUser(f.tenant, 'EDUCATOR', f.tenant.roomId);
    const otherRoomEducator = await makeUser(f.tenant, 'EDUCATOR', otherRoom.id);
    const endedEducator = await makeUser(f.tenant, 'EDUCATOR');
    await fixturePrisma.staffRoomAssignment.create({
      data: { orgId: f.tenant.orgId, centreId: f.tenant.centreId, userId: endedEducator.userId, roomId: f.tenant.roomId, startDate: new Date('2026-01-01'), endDate: new Date('2026-09-01') },
    });
    return { ...f, educator2, otherRoomEducator, endedEducator };
  }
  const person = { personName: 'Zed-Secret-Person', personPhone: '0412 999 777', note: 'secret-note' };

  it('a pickup nominated for today notifies each current educator of the room, once, CHILD_UPDATE', async () => {
    const w = await pickupWorld('NPick');
    const nom = await service.nominatePickup(w.parent, w.child.id, { date: TODAY, ...person }, NOW);

    for (const e of [w.educator, w.educator2]) {
      const items = await inbox(e.userId);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ priority: 'CHILD_UPDATE', channel: 'PUSH', status: 'QUEUED' });
      expect(items[0].payload).toEqual({ type: 'pickup_nominated', nominationId: nom.id, childId: w.child.id, date: TODAY });
      expectNoSecrets(items);
    }
    expect(await inbox(w.otherRoomEducator.userId)).toHaveLength(0);
    expect(await inbox(w.endedEducator.userId)).toHaveLength(0);
    expect(await inbox(w.admin.userId)).toHaveLength(0);
    expect(await inbox(w.admin2.userId)).toHaveLength(0);
    expect(await inbox(w.parent.userId)).toHaveLength(0);
    await expectOutsidersEmpty();
  });

  it('a pickup nominated for another day notifies nobody', async () => {
    const w = await pickupWorld('NPickLater');
    await service.nominatePickup(w.parent, w.child.id, { date: addDays(TODAY, 3), ...person }, NOW);
    expect(await inbox(w.educator.userId)).toHaveLength(0);
    expect(await inbox(w.educator2.userId)).toHaveLength(0);
  });

  it('an admin nominating for today also notifies the room educators', async () => {
    const w = await pickupWorld('NPickAdmin');
    await service.nominatePickup(w.admin, w.child.id, { date: TODAY, ...person }, NOW);
    expect(await inbox(w.educator.userId, 'pickup_nominated')).toHaveLength(1);
    expect(await inbox(w.admin.userId)).toHaveLength(0);
  });

  it('cancelling a nomination for today notifies the same educators; another day notifies nobody', async () => {
    const w = await pickupWorld('NPickCancel');
    const today = await service.nominatePickup(w.parent, w.child.id, { date: TODAY, ...person }, NOW);
    const later = await service.nominatePickup(w.parent, w.child.id, { date: addDays(TODAY, 2), ...person }, NOW);
    await service.cancelPickupNomination(w.parent, today.id, NOW);
    await service.cancelPickupNomination(w.parent, later.id, NOW);

    for (const e of [w.educator, w.educator2]) {
      const cancelled = await inbox(e.userId, 'pickup_cancelled');
      expect(cancelled).toHaveLength(1);
      expect(cancelled[0].priority).toBe('CHILD_UPDATE');
      expect(cancelled[0].payload).toEqual({ type: 'pickup_cancelled', nominationId: today.id, childId: w.child.id, date: TODAY });
      expectNoSecrets(await inbox(e.userId));
      expect(await inbox(e.userId)).toHaveLength(2); // nominated + cancelled, nothing for the later day
    }
    expect(await inbox(w.otherRoomEducator.userId)).toHaveLength(0);
    expect(await inbox(w.endedEducator.userId)).toHaveLength(0);
    expect(await inbox(w.admin.userId)).toHaveLength(0);
    await expectOutsidersEmpty();
  });

  it('a notification failure does not fail or roll back pickup nominate or cancel', async () => {
    const w = await pickupWorld('NPickFail');
    const failing = withFailingNotifications();
    const nom = await failing.nominatePickup(w.parent, w.child.id, { date: TODAY, ...person }, NOW);
    expect(await fixturePrisma.pickupNomination.findUnique({ where: { id: nom.id } })).toMatchObject({ status: 'ACTIVE' });
    const cancelled = await failing.cancelPickupNomination(w.parent, nom.id);
    expect(cancelled.status).toBe('CANCELLED');
    expect(await inbox(w.educator.userId)).toHaveLength(0);
  });

  // ------------------------------------------------------ denied / failed

  it('denied or failed requests enqueue nothing', async () => {
    const w = await pickupWorld('NDenied');
    const stranger = await makeUser(w.tenant, 'PARENT');
    const stranger2Child = await makeChild(w.tenant);
    await link(w.tenant, stranger, stranger2Child.id);

    // Validation errors.
    await expect(service.reportAbsence(w.parent, w.child.id, { date: 'nope' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.requestCasualDay(w.parent, w.child.id, { date: addDays(TODAY, -1) }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.nominatePickup(w.parent, w.child.id, { date: TODAY, personName: 'x' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    // Forbidden: an educator cannot report an absence, a parent cannot approve, a stranger cannot nominate.
    await expect(service.reportAbsence(w.educator, w.child.id, { date: DAY }, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.nominatePickup(stranger, w.child.id, { date: TODAY, personName: 'Valid Name' }, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    // Conflict: a duplicate absence, and deciding an already-decided request.
    await service.reportAbsence(w.parent, w.child.id, { date: DAY }, NOW);
    const adminItemsAfterFirst = (await inbox(w.admin.userId)).length;
    expect(adminItemsAfterFirst).toBe(1);
    await expect(service.reportAbsence(w.parent, w.child.id, { date: DAY }, NOW)).rejects.toBeInstanceOf(ConflictException);
    const req = await service.requestCasualDay(w.parent, w.child.id, { date: addDays(DAY, 7) }, NOW);
    await service.declineCasualDay(w.admin, req.id, {});
    const parentItems = (await inbox(w.parent.userId)).length;
    await expect(service.approveCasualDay(w.admin, req.id, {}, NOW)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.declineCasualDay(w.admin, req.id, {})).rejects.toBeInstanceOf(ConflictException);

    expect((await inbox(w.parent.userId)).length).toBe(parentItems);
    // Admin saw exactly: the one absence and the one casual-day request.
    expect(await inbox(w.admin.userId)).toHaveLength(2);
    expect(await inbox(w.educator.userId)).toHaveLength(0);
    expect(await inbox(stranger.userId)).toHaveLength(0);
  });

  // ------------------------------------------------- backwards compatible

  it('works unchanged with the original three constructor arguments', async () => {
    const f = await family('NNoNotif');
    const legacy = new FamilyRequestsService(tenancy, audit, authorization);
    const view = await legacy.reportAbsence(f.parent, f.child.id, { date: DAY }, NOW);
    expect(view.childId).toBe(f.child.id);
    expect(await inbox(f.admin.userId)).toHaveLength(0);
  });
});
