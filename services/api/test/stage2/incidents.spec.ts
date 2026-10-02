import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { AuthorizationService } from '../../src/authorization/authorization.service';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { StubPushProvider } from '../../src/notifications/providers/stub-push.provider';
import { IncidentsService } from '../../src/incidents/incidents.service';
import { RequestUser } from '../../src/authorization/request-user.interface';
import { appPrisma, disconnectAll, fixturePrisma, seedOrgCentreRoom, setTenantContext, uniqueSuffix } from '../test-utils';

describe('IncidentsService: immutability, notification, acknowledgement', () => {
  let prismaService: PrismaService;
  let tenancy: TenancyService;
  let incidents: IncidentsService;

  beforeAll(async () => {
    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    tenancy = new TenancyService(prismaService);
    const audit = new AuditService(tenancy);
    const authorization = new AuthorizationService(tenancy, audit);
    const notifications = new NotificationsService(tenancy, new StubPushProvider());
    incidents = new IncidentsService(tenancy, audit, authorization, notifications);
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await disconnectAll();
  });

  async function setup(label: string) {
    const tenant = await seedOrgCentreRoom(label);
    const educator = await fixturePrisma.user.create({
      data: {
        orgId: tenant.orgId,
        centreId: tenant.centreId,
        email: `educator-${uniqueSuffix()}@example.test`,
        passwordHash: 'x',
        role: 'EDUCATOR',
        firstName: 'E',
        lastName: 'D',
      },
    });
    await fixturePrisma.staffRoomAssignment.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, userId: educator.id, roomId: tenant.roomId, startDate: new Date('2026-01-01') },
    });
    const child = await fixturePrisma.child.create({
      data: {
        orgId: tenant.orgId,
        centreId: tenant.centreId,
        roomId: tenant.roomId,
        firstName: 'Incidenty',
        lastName: `Child-${uniqueSuffix()}`,
        dateOfBirth: new Date('2023-01-01'),
      },
    });
    const guardian = await fixturePrisma.user.create({
      data: {
        orgId: tenant.orgId,
        centreId: tenant.centreId,
        email: `guardian-${uniqueSuffix()}@example.test`,
        passwordHash: 'x',
        role: 'PARENT',
        firstName: 'G',
        lastName: 'P',
      },
    });
    await fixturePrisma.guardianChildRelationship.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, guardianUserId: guardian.id, childId: child.id, relationshipType: 'PARENT' },
    });
    return { tenant, educator, child, guardian };
  }

  it('creating an incident notifies every guardian at URGENT priority', async () => {
    const { tenant, educator, child, guardian } = await setup('IncidentNotify');
    const educatorUser: RequestUser = { userId: educator.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'EDUCATOR' };

    const incident = await incidents.create(educatorUser, {
      childId: child.id,
      severity: 'MODERATE',
      description: 'Minor fall on the playground',
      occurredAt: new Date().toISOString(),
    });

    await setTenantContext(appPrisma, tenant.orgId, tenant.centreId);
    const queued = await appPrisma.notificationQueueItem.findMany({
      where: { recipientUserId: guardian.id, priority: 'URGENT' },
    });
    expect(queued.length).toBeGreaterThanOrEqual(1);
    expect((queued[0].payload as Record<string, unknown>).incidentId).toBe(incident.id);
  });

  it('a guardian can acknowledge an incident, and acknowledgement is tracked with a timestamp', async () => {
    const { tenant, educator, child, guardian } = await setup('IncidentAck');
    const educatorUser: RequestUser = { userId: educator.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'EDUCATOR' };
    const incident = await incidents.create(educatorUser, {
      childId: child.id,
      severity: 'MINOR',
      description: 'Scraped knee',
      occurredAt: new Date().toISOString(),
    });

    const guardianUser: RequestUser = { userId: guardian.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'PARENT' };
    await incidents.acknowledge(guardianUser, incident.id);

    const ack = await fixturePrisma.incidentAcknowledgement.findUnique({
      where: { incidentId_guardianUserId: { incidentId: incident.id, guardianUserId: guardian.id } },
    });
    expect(ack).not.toBeNull();
    expect(ack?.acknowledgedAt).toBeInstanceOf(Date);
  });

  it('an administrator can attach a review without changing the original incident facts, which remain immutable', async () => {
    const { tenant, educator, child } = await setup('IncidentReview');
    const educatorUser: RequestUser = { userId: educator.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'EDUCATOR' };
    const incident = await incidents.create(educatorUser, {
      childId: child.id,
      severity: 'SERIOUS',
      description: 'Original description of what happened',
      occurredAt: new Date('2026-01-01T10:00:00Z').toISOString(),
    });

    const adminUser: RequestUser = { userId: educator.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'CENTRE_ADMIN' };
    const reviewed = await incidents.review(adminUser, incident.id, 'Reviewed with director, appropriate first aid given');

    expect(reviewed.reviewStatus).toBe('REVIEWED');
    expect(reviewed.reviewedByUserId).toBe(adminUser.userId);
    // The original fact fields are untouched by review.
    expect(reviewed.description).toBe('Original description of what happened');
    expect(reviewed.severity).toBe('SERIOUS');
  });

  it('the core incident fields cannot be updated directly at the DB level, even by an admin', async () => {
    const { tenant, educator, child } = await setup('IncidentImmutable');
    const educatorUser: RequestUser = { userId: educator.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'EDUCATOR' };
    const incident = await incidents.create(educatorUser, {
      childId: child.id,
      severity: 'MINOR',
      description: 'Should never change',
      occurredAt: new Date().toISOString(),
    });

    await setTenantContext(appPrisma, tenant.orgId, tenant.centreId);
    await expect(
      appPrisma.incident.update({ where: { id: incident.id }, data: { description: 'Tampered' } }),
    ).rejects.toThrow();
  });
});
