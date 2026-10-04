import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { AuthorizationService } from '../../src/authorization/authorization.service';
import { MedicationService } from '../../src/medication/medication.service';
import { RelationshipType } from '@prisma/client';
import { disconnectAll, fixturePrisma } from '../test-utils';
import { expectBadRequestOrForbidden, linkGuardian, makeChild, makeUser, seedFamily } from './security-fixtures';

/**
 * Security finding H2: MedicationService.authorize stored whatever
 * authorizedByGuardianId the caller supplied, unchecked. A medication
 * authorization is the legal basis for an educator giving a child a drug, so
 * it must name a real, current, unrestricted PARENT/GUARDIAN of THAT child —
 * not a random id, a restricted (e.g. court-order) guardian, an expired
 * relationship, an authorized-pickup-only contact, or another child's parent.
 */
describe('H2: medication authorizations must name a valid parent/guardian of the child', () => {
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

  function dto(childId: string, authorizedByGuardianId: string) {
    return { childId, medicationName: 'Amoxicillin', dosageInstructions: '5ml twice daily', authorizedByGuardianId };
  }

  async function authorizationCount(childId: string) {
    return fixturePrisma.medicationAuthorization.count({ where: { childId } });
  }

  it('rejects a random, non-existent user id', async () => {
    const { adminUser, child } = await seedFamily('H2Random');
    await expectBadRequestOrForbidden(medication.authorize(adminUser, dto(child.id, uuidv4())));
    expect(await authorizationCount(child.id)).toBe(0);
  });

  it('rejects a real PARENT user with no relationship to this child', async () => {
    const { tenant, adminUser, child } = await seedFamily('H2Stranger');
    const stranger = await makeUser('PARENT', tenant.orgId, tenant.centreId);
    await expectBadRequestOrForbidden(medication.authorize(adminUser, dto(child.id, stranger.id)));
    expect(await authorizationCount(child.id)).toBe(0);
  });

  it('rejects the parent of a different child (sibling-family mix-up)', async () => {
    const { tenant, adminUser, child } = await seedFamily('H2OtherChild');
    const otherChild = await makeChild(tenant);
    const otherParent = await makeUser('PARENT', tenant.orgId, tenant.centreId);
    await linkGuardian(tenant, otherParent.id, otherChild.id, { relationshipType: 'PARENT' });
    await expectBadRequestOrForbidden(medication.authorize(adminUser, dto(child.id, otherParent.id)));
    expect(await authorizationCount(child.id)).toBe(0);
  });

  it('rejects a restricted guardian', async () => {
    const { tenant, adminUser, child } = await seedFamily('H2Restricted');
    const restricted = await makeUser('PARENT', tenant.orgId, tenant.centreId);
    await linkGuardian(tenant, restricted.id, child.id, { relationshipType: 'PARENT', isRestricted: true });
    await expectBadRequestOrForbidden(medication.authorize(adminUser, dto(child.id, restricted.id)));
    expect(await authorizationCount(child.id)).toBe(0);
  });

  it('rejects a guardian whose relationship has expired', async () => {
    const { tenant, adminUser, child } = await seedFamily('H2Expired');
    const expired = await makeUser('PARENT', tenant.orgId, tenant.centreId);
    await linkGuardian(tenant, expired.id, child.id, { relationshipType: 'GUARDIAN', expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) });
    await expectBadRequestOrForbidden(medication.authorize(adminUser, dto(child.id, expired.id)));
    expect(await authorizationCount(child.id)).toBe(0);
  });

  it('rejects an AUTHORIZED_PICKUP-only contact', async () => {
    const { tenant, adminUser, child } = await seedFamily('H2Pickup');
    const neighbour = await makeUser('PARENT', tenant.orgId, tenant.centreId);
    await linkGuardian(tenant, neighbour.id, child.id, { relationshipType: 'AUTHORIZED_PICKUP', canPickup: true });
    await expectBadRequestOrForbidden(medication.authorize(adminUser, dto(child.id, neighbour.id)));
    expect(await authorizationCount(child.id)).toBe(0);
  });

  it('rejects a staff user id masquerading as the authorizing guardian', async () => {
    const { adminUser, educator, child } = await seedFamily('H2Staff');
    await expectBadRequestOrForbidden(medication.authorize(adminUser, dto(child.id, educator.id)));
    expect(await authorizationCount(child.id)).toBe(0);
  });

  it.each(['PARENT', 'GUARDIAN'] as RelationshipType[])('accepts a current, unrestricted %s (sanity)', async (relationshipType) => {
    const { tenant, adminUser, child } = await seedFamily(`H2Ok${relationshipType}`);
    const guardian = await makeUser('PARENT', tenant.orgId, tenant.centreId);
    await linkGuardian(tenant, guardian.id, child.id, { relationshipType, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) });
    const created = await medication.authorize(adminUser, dto(child.id, guardian.id));
    expect(created.authorizedByGuardianId).toBe(guardian.id);
  });
});
