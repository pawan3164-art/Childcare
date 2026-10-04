import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { AuthorizationService } from '../../src/authorization/authorization.service';
import { ChildrenService } from '../../src/centre-admin/children.service';
import { RoomsService } from '../../src/centre-admin/rooms.service';
import { RequestUser } from '../../src/authorization/request-user.interface';
import { disconnectAll, fixturePrisma, seedOrgCentreRoom, uniqueSuffix } from '../test-utils';

/**
 * Regression test for a bug found in the portal's visual click-through: the
 * /children list returned the whole centre roster to an EDUCATOR, but
 * AuthorizationService only lets an educator open a child in a room they are
 * currently assigned to (BRD §22 relationship-based access). The list leaked
 * names/DOBs of children outside the educator's rooms, and every one of those
 * rows 403'd on click. The list must apply the same rule as the detail check.
 */
describe('ChildrenService.list: an educator sees only children in their assigned rooms', () => {
  let prismaService: PrismaService;
  let children: ChildrenService;
  let authorization: AuthorizationService;

  beforeAll(async () => {
    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    const tenancy = new TenancyService(prismaService);
    const audit = new AuditService(tenancy);
    authorization = new AuthorizationService(tenancy, audit);
    children = new ChildrenService(tenancy, audit);
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await disconnectAll();
  });

  async function seedTwoRooms() {
    const tenant = await seedOrgCentreRoom('EducatorScope');
    const otherRoom = await fixturePrisma.room.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, name: `Other Room ${uniqueSuffix()}` },
    });
    const educator = await fixturePrisma.user.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, email: `edu-${uniqueSuffix()}@example.test`, passwordHash: 'x', role: 'EDUCATOR', firstName: 'E', lastName: 'D' },
    });
    await fixturePrisma.staffRoomAssignment.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, userId: educator.id, roomId: tenant.roomId, startDate: new Date('2026-01-01') },
    });
    const mine = await fixturePrisma.child.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, roomId: tenant.roomId, firstName: 'Mine', lastName: `Edu-${uniqueSuffix()}`, dateOfBirth: new Date('2023-01-01') },
    });
    const other = await fixturePrisma.child.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, roomId: otherRoom.id, firstName: 'Other', lastName: `Edu-${uniqueSuffix()}`, dateOfBirth: new Date('2023-01-01') },
    });
    const user: RequestUser = { userId: educator.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'EDUCATOR', sessionId: 's' };
    return { tenant, otherRoom, educator, mine, other, user };
  }

  it('excludes children in rooms the educator is not assigned to', async () => {
    const { user, mine } = await seedTwoRooms();
    const list = await children.list(user);
    expect(list.map((c) => c.id)).toEqual([mine.id]);
  });

  it('returns an empty list when an educator filters by a room they are not assigned to', async () => {
    const { user, otherRoom } = await seedTwoRooms();
    expect(await children.list(user, otherRoom.id)).toEqual([]);
  });

  it('ignores ended room assignments', async () => {
    const { user, educator, mine } = await seedTwoRooms();
    await fixturePrisma.staffRoomAssignment.updateMany({ where: { userId: educator.id }, data: { endDate: new Date('2026-06-30') } });
    expect(await children.list(user)).toEqual([]);
    expect(await authorization.canAccessChild(user, mine.id, 'view')).toBe(false);
  });

  it('every child in the list is one the educator is authorized to view', async () => {
    const { user } = await seedTwoRooms();
    for (const c of await children.list(user)) {
      expect(await authorization.canAccessChild(user, c.id, 'view')).toBe(true);
    }
  });

  it('a centre admin still sees the whole centre roster', async () => {
    const { tenant, mine, other } = await seedTwoRooms();
    const admin: RequestUser = { userId: 'admin', orgId: tenant.orgId, centreId: tenant.centreId, role: 'CENTRE_ADMIN', sessionId: 's' };
    const ids = (await children.list(admin)).map((c) => c.id).sort();
    expect(ids).toEqual([mine.id, other.id].sort());
  });
});

describe('RoomsService.list: scoped to the caller', () => {
  let prismaService: PrismaService;
  let rooms: RoomsService;

  beforeAll(async () => {
    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    const tenancy = new TenancyService(prismaService);
    rooms = new RoomsService(tenancy, new AuditService(tenancy));
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await disconnectAll();
  });

  async function seed() {
    const tenant = await seedOrgCentreRoom('RoomScope');
    const otherRoom = await fixturePrisma.room.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, name: `Other Room ${uniqueSuffix()}` },
    });
    const educator = await fixturePrisma.user.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, email: `edu-${uniqueSuffix()}@example.test`, passwordHash: 'x', role: 'EDUCATOR', firstName: 'E', lastName: 'D' },
    });
    await fixturePrisma.staffRoomAssignment.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, userId: educator.id, roomId: tenant.roomId, startDate: new Date('2026-01-01') },
    });
    return { tenant, otherRoom, educator };
  }

  it('an educator sees only rooms they are currently assigned to', async () => {
    const { tenant, educator } = await seed();
    const user: RequestUser = { userId: educator.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'EDUCATOR', sessionId: 's' };
    expect((await rooms.list(user)).map((r) => r.id)).toEqual([tenant.roomId]);
  });

  it('a parent is refused', async () => {
    const { tenant } = await seed();
    const user: RequestUser = { userId: 'p', orgId: tenant.orgId, centreId: tenant.centreId, role: 'PARENT', sessionId: 's' };
    await expect(rooms.list(user)).rejects.toThrow();
  });

  it('a centre admin sees every room in the centre', async () => {
    const { tenant, otherRoom } = await seed();
    const user: RequestUser = { userId: 'a', orgId: tenant.orgId, centreId: tenant.centreId, role: 'CENTRE_ADMIN', sessionId: 's' };
    expect((await rooms.list(user)).map((r) => r.id).sort()).toEqual([tenant.roomId, otherRoom.id].sort());
  });
});
