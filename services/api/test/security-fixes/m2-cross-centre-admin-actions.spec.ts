import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { AuthorizationService } from '../../src/authorization/authorization.service';
import { AttendanceService } from '../../src/attendance/attendance.service';
import { IncidentsService } from '../../src/incidents/incidents.service';
import { MedicationService } from '../../src/medication/medication.service';
import { ChildrenService } from '../../src/centre-admin/children.service';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { StubPushProvider } from '../../src/notifications/providers/stub-push.provider';
import { disconnectAll, fixturePrisma, SeededTenant, uniqueSuffix } from '../test-utils';
import { captureRejection, makeChild, makeUser, seedFamily } from './security-fixtures';

/**
 * Security finding M2: RLS isolates by organisation only, so an admin at
 * centre A could act on centre B's records in the same org by id — mark
 * centre B's incidents reviewed, flip any medication administration's status
 * (not just PENDING_REVIEW ones), link a correction to another centre's
 * attendance event, or enrol a child into another centre's room (which then
 * grants that room's educators access). Every one of these must be refused
 * and leave the target row untouched.
 */
describe('M2: admin review/correction actions are confined to the admin\'s own centre', () => {
  let prismaService: PrismaService;
  let attendance: AttendanceService;
  let incidents: IncidentsService;
  let medication: MedicationService;
  let children: ChildrenService;

  beforeAll(async () => {
    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    const tenancy = new TenancyService(prismaService);
    const audit = new AuditService(tenancy);
    const authorization = new AuthorizationService(tenancy, audit);
    const notifications = new NotificationsService(tenancy, new StubPushProvider());
    attendance = new AttendanceService(tenancy, audit, authorization);
    incidents = new IncidentsService(tenancy, audit, authorization, notifications);
    medication = new MedicationService(tenancy, audit, authorization);
    children = new ChildrenService(tenancy, audit);
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await disconnectAll();
  });

  /** Centre A (the full family fixture) plus a sibling centre B in the same org. */
  async function seedTwoCentres(label: string) {
    const famA = await seedFamily(label);
    const centreB = await fixturePrisma.centre.create({
      data: { orgId: famA.tenant.orgId, name: `Centre B ${label} ${uniqueSuffix()}` },
    });
    const roomB = await fixturePrisma.room.create({
      data: { orgId: famA.tenant.orgId, centreId: centreB.id, name: `Room B ${uniqueSuffix()}` },
    });
    const tenantB: SeededTenant = { orgId: famA.tenant.orgId, centreId: centreB.id, roomId: roomB.id };
    const childB = await makeChild(tenantB);
    const staffB = await makeUser('EDUCATOR', tenantB.orgId, tenantB.centreId);
    return { famA, tenantB, childB, staffB };
  }

  function expectRefused(err: unknown) {
    expect(
      err instanceof NotFoundException || err instanceof ForbiddenException || err instanceof BadRequestException,
    ).toBe(true);
  }

  it('refuses to review an incident from another centre in the same org', async () => {
    const { famA, tenantB, childB, staffB } = await seedTwoCentres('m2-incident');
    const incidentB = await fixturePrisma.incident.create({
      data: {
        orgId: tenantB.orgId,
        centreId: tenantB.centreId,
        childId: childB.id,
        severity: 'MINOR',
        description: 'centre B incident',
        occurredAt: new Date(),
        reportedByUserId: staffB.id,
      },
    });

    expectRefused(await captureRejection(incidents.review(famA.adminUser, incidentB.id, 'not mine')));

    const after = await fixturePrisma.incident.findUniqueOrThrow({ where: { id: incidentB.id } });
    expect(after.reviewStatus).toBe('OPEN');
    expect(after.reviewedByUserId).toBeNull();
  });

  it('still lets an admin review an incident in their own centre', async () => {
    const { famA } = await seedTwoCentres('m2-incident-own');
    const own = await fixturePrisma.incident.create({
      data: {
        orgId: famA.tenant.orgId,
        centreId: famA.tenant.centreId,
        childId: famA.child.id,
        severity: 'MINOR',
        description: 'own incident',
        occurredAt: new Date(),
        reportedByUserId: famA.educator.id,
      },
    });
    const reviewed = await incidents.review(famA.adminUser, own.id, 'ok');
    expect(reviewed.reviewStatus).toBe('REVIEWED');
  });

  async function seedAdministration(tenant: SeededTenant, childId: string, guardianId: string, staffId: string, status: 'PENDING_REVIEW' | 'CONFIRMED') {
    const auth = await fixturePrisma.medicationAuthorization.create({
      data: {
        orgId: tenant.orgId,
        centreId: tenant.centreId,
        childId,
        medicationName: 'Paracetamol',
        dosageInstructions: '5ml',
        authorizedByGuardianId: guardianId,
      },
    });
    return fixturePrisma.medicationAdministration.create({
      data: {
        orgId: tenant.orgId,
        centreId: tenant.centreId,
        authorizationId: auth.id,
        administeredByUserId: staffId,
        administeredAt: new Date(),
        dosageGiven: '5ml',
        status,
      },
    });
  }

  it('refuses to review a medication administration from another centre', async () => {
    const { famA, tenantB, childB, staffB } = await seedTwoCentres('m2-med-xcentre');
    const guardianB = await makeUser('PARENT', tenantB.orgId, tenantB.centreId);
    const adminB = await seedAdministration(tenantB, childB.id, guardianB.id, staffB.id, 'PENDING_REVIEW');

    expectRefused(await captureRejection(medication.review(famA.adminUser, adminB.id, 'REJECTED')));

    const after = await fixturePrisma.medicationAdministration.findUniqueOrThrow({ where: { id: adminB.id } });
    expect(after.status).toBe('PENDING_REVIEW');
  });

  it('refuses to re-decide a medication administration that is not PENDING_REVIEW', async () => {
    const { famA } = await seedTwoCentres('m2-med-confirmed');
    const confirmed = await seedAdministration(famA.tenant, famA.child.id, famA.parent.id, famA.educator.id, 'CONFIRMED');

    const err = await captureRejection(medication.review(famA.adminUser, confirmed.id, 'REJECTED'));
    expect(err instanceof ConflictException || err instanceof BadRequestException).toBe(true);

    const after = await fixturePrisma.medicationAdministration.findUniqueOrThrow({ where: { id: confirmed.id } });
    expect(after.status).toBe('CONFIRMED');
  });

  it('still resolves a PENDING_REVIEW administration in the admin\'s own centre', async () => {
    const { famA } = await seedTwoCentres('m2-med-own');
    const pending = await seedAdministration(famA.tenant, famA.child.id, famA.parent.id, famA.educator.id, 'PENDING_REVIEW');
    const resolved = await medication.review(famA.adminUser, pending.id, 'CONFIRMED');
    expect(resolved.status).toBe('CONFIRMED');
  });

  it('refuses an attendance correction that points at another centre\'s event', async () => {
    const { famA, tenantB, childB, staffB } = await seedTwoCentres('m2-att-xcentre');
    const eventB = await fixturePrisma.attendanceEvent.create({
      data: {
        orgId: tenantB.orgId,
        centreId: tenantB.centreId,
        childId: childB.id,
        eventType: 'SIGN_IN',
        method: 'EDUCATOR',
        timestamp: new Date(),
        recordedByUserId: staffB.id,
      },
    });

    expectRefused(
      await captureRejection(
        attendance.correctEvent(famA.adminUser, eventB.id, {
          childId: famA.child.id,
          eventType: 'SIGN_IN',
          method: 'EDUCATOR',
          timestamp: new Date().toISOString(),
        }),
      ),
    );
    expect(await fixturePrisma.attendanceEvent.count({ where: { correctedEventId: eventB.id } })).toBe(0);
  });

  it('refuses an attendance correction whose original event belongs to a different child', async () => {
    const { famA } = await seedTwoCentres('m2-att-otherchild');
    const sibling = await makeChild(famA.tenant, famA.tenant.roomId, 'Sibling');
    const siblingEvent = await fixturePrisma.attendanceEvent.create({
      data: {
        orgId: famA.tenant.orgId,
        centreId: famA.tenant.centreId,
        childId: sibling.id,
        eventType: 'SIGN_IN',
        method: 'EDUCATOR',
        timestamp: new Date(),
        recordedByUserId: famA.educator.id,
      },
    });

    expectRefused(
      await captureRejection(
        attendance.correctEvent(famA.adminUser, siblingEvent.id, {
          childId: famA.child.id,
          eventType: 'SIGN_OUT',
          method: 'EDUCATOR',
          timestamp: new Date().toISOString(),
        }),
      ),
    );
    expect(await fixturePrisma.attendanceEvent.count({ where: { correctedEventId: siblingEvent.id } })).toBe(0);
  });

  it('still lets an admin correct their own centre\'s event for the same child', async () => {
    const { famA } = await seedTwoCentres('m2-att-own');
    const event = await fixturePrisma.attendanceEvent.create({
      data: {
        orgId: famA.tenant.orgId,
        centreId: famA.tenant.centreId,
        childId: famA.child.id,
        eventType: 'SIGN_IN',
        method: 'EDUCATOR',
        timestamp: new Date(),
        recordedByUserId: famA.educator.id,
      },
    });
    const corrected = await attendance.correctEvent(famA.adminUser, event.id, {
      childId: famA.child.id,
      eventType: 'SIGN_IN',
      method: 'EDUCATOR',
      timestamp: new Date().toISOString(),
    });
    expect(corrected.correctedEventId).toBe(event.id);
  });

  it('refuses to enrol a child into another centre\'s room', async () => {
    const { famA, tenantB } = await seedTwoCentres('m2-enrol');
    const lastName = `Xc-${uniqueSuffix()}`;

    expectRefused(
      await captureRejection(
        children.create(famA.adminUser, { firstName: 'Cross', lastName, dateOfBirth: '2023-05-01', roomId: tenantB.roomId }),
      ),
    );
    expect(await fixturePrisma.child.count({ where: { lastName } })).toBe(0);
  });

  it('still enrols a child into the admin\'s own room', async () => {
    const { famA } = await seedTwoCentres('m2-enrol-own');
    const child = await children.create(famA.adminUser, {
      firstName: 'Own',
      lastName: `Own-${uniqueSuffix()}`,
      dateOfBirth: '2023-05-01',
      roomId: famA.tenant.roomId,
    });
    expect(child.roomId).toBe(famA.tenant.roomId);
  });
});
