import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { AuthorizationService } from '../../src/authorization/authorization.service';
import { MedicationService } from '../../src/medication/medication.service';
import { disconnectAll, fixturePrisma, uniqueSuffix } from '../test-utils';
import { assignToRoom, makeChild, seedFamily } from './security-fixtures';

/**
 * Security finding C1: GET /medication/administrations returned the whole
 * centre's administrations (child names + medication names) to ANY
 * authenticated role in the centre, including PARENT. Expected:
 *   - PARENT -> ForbiddenException
 *   - EDUCATOR -> only children in rooms with an active StaffRoomAssignment
 *   - CENTRE_ADMIN -> whole centre (unchanged)
 */
describe('C1: MedicationService.listAdministrations is scoped by role', () => {
  let prismaService: PrismaService;
  let medication: MedicationService;

  beforeAll(async () => {
    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    const tenancy = new TenancyService(prismaService);
    const audit = new AuditService(tenancy);
    const authorization = new AuthorizationService(tenancy, audit);
    medication = new MedicationService(tenancy, audit, authorization);
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await disconnectAll();
  });

  async function seed() {
    const fam = await seedFamily('C1MedList');
    const { tenant, educator, parent, child: mine } = fam;
    const otherRoom = await fixturePrisma.room.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, name: `C1 Other Room ${uniqueSuffix()}` },
    });
    const other = await makeChild(tenant, otherRoom.id, 'Other');

    const adminIds: Record<string, string> = {};
    for (const c of [mine, other]) {
      const auth = await fixturePrisma.medicationAuthorization.create({
        data: {
          orgId: tenant.orgId,
          centreId: tenant.centreId,
          childId: c.id,
          medicationName: 'Paracetamol',
          dosageInstructions: '5ml',
          authorizedByGuardianId: parent.id,
        },
      });
      const adm = await fixturePrisma.medicationAdministration.create({
        data: {
          orgId: tenant.orgId,
          centreId: tenant.centreId,
          authorizationId: auth.id,
          administeredByUserId: educator.id,
          administeredAt: new Date(),
          dosageGiven: '5ml',
        },
      });
      adminIds[c.id] = adm.id;
    }
    return { ...fam, otherRoom, mine, other, mineAdmId: adminIds[mine.id], otherAdmId: adminIds[other.id] };
  }

  it('a PARENT is refused with ForbiddenException', async () => {
    const { parentUser } = await seed();
    await expect(medication.listAdministrations(parentUser)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a PARENT is refused even when filtering by status', async () => {
    const { parentUser } = await seed();
    await expect(medication.listAdministrations(parentUser, 'CONFIRMED')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('an EDUCATOR only receives administrations for children in their assigned rooms', async () => {
    const { educatorUser, mineAdmId } = await seed();
    const list = await medication.listAdministrations(educatorUser);
    expect(list.map((a) => a.id)).toEqual([mineAdmId]);
  });

  it('an EDUCATOR with only an ended room assignment receives nothing', async () => {
    const { educator, educatorUser } = await seed();
    await fixturePrisma.staffRoomAssignment.updateMany({ where: { userId: educator.id }, data: { endDate: new Date('2026-06-30') } });
    expect(await medication.listAdministrations(educatorUser)).toEqual([]);
  });

  it('an EDUCATOR assigned to both rooms sees both (sanity)', async () => {
    const { tenant, educator, educatorUser, otherRoom, mineAdmId, otherAdmId } = await seed();
    await assignToRoom(tenant, educator.id, otherRoom.id);
    const ids = (await medication.listAdministrations(educatorUser)).map((a) => a.id).sort();
    expect(ids).toEqual([mineAdmId, otherAdmId].sort());
  });

  it('a CENTRE_ADMIN still sees the whole centre', async () => {
    const { adminUser, mineAdmId, otherAdmId } = await seed();
    const ids = (await medication.listAdministrations(adminUser)).map((a) => a.id).sort();
    expect(ids).toEqual([mineAdmId, otherAdmId].sort());
  });
});
