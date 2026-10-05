import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { AuthorizationService } from '../../src/authorization/authorization.service';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { StubPushProvider } from '../../src/notifications/providers/stub-push.provider';
import { DirectMessagesService } from '../../src/messaging/direct-messages.service';
import { RequestUser } from '../../src/authorization/request-user.interface';
import { disconnectAll, fixturePrisma, seedOrgCentreRoom, uniqueSuffix } from '../test-utils';

/**
 * U1 direct messages (OWNA review: "unclear whether a message goes to one
 * educator or the whole feed"). A thread is between one guardian and the
 * staff caring for one child; the recipients are named on the thread.
 */
describe('DirectMessagesService: parent <-> room staff threads', () => {
  let prismaService: PrismaService;
  let dms: DirectMessagesService;

  beforeAll(async () => {
    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    const tenancy = new TenancyService(prismaService);
    const audit = new AuditService(tenancy);
    dms = new DirectMessagesService(tenancy, audit, new AuthorizationService(tenancy, audit), new NotificationsService(tenancy, new StubPushProvider()));
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await disconnectAll();
  });

  async function setup(label: string) {
    const tenant = await seedOrgCentreRoom(label);
    const otherRoom = await fixturePrisma.room.create({ data: { orgId: tenant.orgId, centreId: tenant.centreId, name: `Possums ${uniqueSuffix()}` } });
    const mkUser = async (role: 'PARENT' | 'EDUCATOR' | 'CENTRE_ADMIN', firstName: string): Promise<RequestUser> => {
      const u = await fixturePrisma.user.create({
        data: { orgId: tenant.orgId, centreId: tenant.centreId, email: `${role}-${uniqueSuffix()}@example.test`, passwordHash: 'x', role, firstName, lastName: 'X' },
      });
      return { userId: u.id, orgId: tenant.orgId, centreId: tenant.centreId, role, sessionId: 's' };
    };
    const roomEducator = await mkUser('EDUCATOR', 'Priya');
    const otherEducator = await mkUser('EDUCATOR', 'Sam');
    await fixturePrisma.staffRoomAssignment.create({ data: { orgId: tenant.orgId, centreId: tenant.centreId, userId: roomEducator.userId, roomId: tenant.roomId, startDate: new Date('2026-01-01') } });
    await fixturePrisma.staffRoomAssignment.create({ data: { orgId: tenant.orgId, centreId: tenant.centreId, userId: otherEducator.userId, roomId: otherRoom.id, startDate: new Date('2026-01-01') } });
    const admin = await mkUser('CENTRE_ADMIN', 'Alex');
    const parent = await mkUser('PARENT', 'Anh');
    const otherParent = await mkUser('PARENT', 'Bo');
    const child = await fixturePrisma.child.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, roomId: tenant.roomId, firstName: 'Mia', lastName: `DM-${uniqueSuffix()}`, dateOfBirth: new Date('2023-01-01') },
    });
    await fixturePrisma.guardianChildRelationship.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, guardianUserId: parent.userId, childId: child.id, relationshipType: 'PARENT' },
    });
    return { tenant, child, parent, otherParent, roomEducator, otherEducator, admin };
  }

  it('a parent messages their child\'s room; the thread names who will read it', async () => {
    const { tenant, child, parent } = await setup('DmStart');
    const room = await fixturePrisma.room.findUniqueOrThrow({ where: { id: tenant.roomId } });

    const thread = await dms.sendFromGuardian(parent, child.id, 'Mia had a rough night, may be tired');

    expect(thread.recipients).toBe(`${room.name} educators and centre staff`);
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]).toMatchObject({ body: 'Mia had a rough night, may be tired', fromStaff: false, author: { firstName: 'Anh' } });

    // A second message lands in the same thread, not a new one.
    const again = await dms.sendFromGuardian(parent, child.id, 'Thanks!');
    expect(again.id).toBe(thread.id);
    expect(again.messages).toHaveLength(2);
  });

  it('room educators and admins see and answer the thread; educators of other rooms do not', async () => {
    const { child, parent, roomEducator, otherEducator, admin } = await setup('DmStaff');
    const thread = await dms.sendFromGuardian(parent, child.id, 'Question about pickup');

    expect((await dms.listThreads(roomEducator)).map((t) => t.id)).toContain(thread.id);
    expect((await dms.listThreads(admin)).map((t) => t.id)).toContain(thread.id);
    expect((await dms.listThreads(otherEducator)).map((t) => t.id)).not.toContain(thread.id);
    await expect(dms.reply(otherEducator, thread.id, 'Hi')).rejects.toThrow();

    const replied = await dms.reply(roomEducator, thread.id, 'No problem, see you at 5');
    expect(replied.messages[1]).toMatchObject({ fromStaff: true, author: { firstName: 'Priya' } });
  });

  it('a staff reply notifies the guardian; message text is never written to the audit log', async () => {
    const { child, parent, roomEducator } = await setup('DmNotify');
    const thread = await dms.sendFromGuardian(parent, child.id, 'Private details about Mia');
    await dms.reply(roomEducator, thread.id, 'Reply with private details');

    const queued = await fixturePrisma.notificationQueueItem.findMany({ where: { recipientUserId: parent.userId } });
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ priority: 'CHILD_UPDATE', payload: { type: 'direct_message', threadId: thread.id } });

    const audits = await fixturePrisma.auditLogEntry.findMany({ where: { entityId: thread.id } });
    expect(audits.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(audits)).not.toMatch(/private details/i);
  });

  it('other parents cannot read or post to the thread, or start one about someone else\'s child', async () => {
    const { child, parent, otherParent } = await setup('DmDeny');
    const thread = await dms.sendFromGuardian(parent, child.id, 'hello');

    await expect(dms.getThread(otherParent, thread.id)).rejects.toThrow();
    await expect(dms.sendFromGuardian(otherParent, child.id, 'hi')).rejects.toThrow();
    expect((await dms.listThreads(otherParent)).map((t) => t.id)).not.toContain(thread.id);
  });

  it('tracks unread messages per side', async () => {
    const { child, parent, roomEducator } = await setup('DmUnread');
    const thread = await dms.sendFromGuardian(parent, child.id, 'one');
    await dms.sendFromGuardian(parent, child.id, 'two');

    const staffView = (await dms.listThreads(roomEducator)).find((t) => t.id === thread.id);
    expect(staffView?.unread).toBe(2);
    await dms.getThread(roomEducator, thread.id); // opening marks read for staff
    expect((await dms.listThreads(roomEducator)).find((t) => t.id === thread.id)?.unread).toBe(0);
    expect((await dms.listThreads(parent)).find((t) => t.id === thread.id)?.unread).toBe(0);
  });
});
