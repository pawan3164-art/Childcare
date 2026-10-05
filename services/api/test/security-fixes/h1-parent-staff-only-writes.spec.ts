import { ForbiddenException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { AuthorizationService } from '../../src/authorization/authorization.service';
import { AttendanceService } from '../../src/attendance/attendance.service';
import { CareRecordsService } from '../../src/care-records/care-records.service';
import { IncidentsService } from '../../src/incidents/incidents.service';
import { MedicationService } from '../../src/medication/medication.service';
import { MediaService } from '../../src/media/media.service';
import { InMemoryObjectStorage } from '../../src/media/storage/in-memory-object-storage';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { StubPushProvider } from '../../src/notifications/providers/stub-push.provider';
import { SyncService } from '../../src/sync/sync.service';
import { SyncOperation } from '@prisma/client';
import { disconnectAll, fixturePrisma, uniqueSuffix } from '../test-utils';
import { seedFamily } from './security-fixtures';

/**
 * Security finding H1: the staff-only write paths only checked
 * canAccessChild(..., 'view'), which a non-restricted PARENT passes for
 * their own child. A parent could therefore forge attendance sign-in/out,
 * care records, incidents, medication administrations and media tags —
 * directly or via offline sync. Every one of these must refuse a PARENT
 * outright, even for their own child.
 */
describe('H1: parents are refused on staff-only writes, even for their own child', () => {
  let prismaService: PrismaService;
  let attendance: AttendanceService;
  let careRecords: CareRecordsService;
  let incidents: IncidentsService;
  let medication: MedicationService;
  let media: MediaService;
  let sync: SyncService;
  let authorization: AuthorizationService;

  beforeAll(async () => {
    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    const tenancy = new TenancyService(prismaService);
    const audit = new AuditService(tenancy);
    authorization = new AuthorizationService(tenancy, audit);
    const notifications = new NotificationsService(tenancy, new StubPushProvider());
    attendance = new AttendanceService(tenancy, audit, authorization);
    careRecords = new CareRecordsService(tenancy, audit, authorization);
    incidents = new IncidentsService(tenancy, audit, authorization, notifications);
    medication = new MedicationService(tenancy, audit, authorization);
    media = new MediaService(tenancy, audit, authorization, new InMemoryObjectStorage());
    sync = new SyncService(tenancy, authorization, audit);
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await disconnectAll();
  });

  async function seed(label: string) {
    const fam = await seedFamily(label);
    // Precondition for the finding: the parent genuinely passes the 'view'
    // check, so a denial can only come from a role rule, not the relationship.
    expect(await authorization.canAccessChild(fam.parentUser, fam.child.id, 'view')).toBe(true);
    return fam;
  }

  /**
   * SyncService.submit reports a per-op authorization failure by throwing
   * (assertCanAccessChild's ForbiddenException propagates out of the
   * transaction, rolling back the SyncOperation row too). A fix may instead
   * choose to record the op as REJECTED/CONFLICT — either is acceptable, but
   * it must never be APPLIED.
   */
  async function expectSyncRejected(p: Promise<SyncOperation>): Promise<void> {
    let result: SyncOperation | undefined;
    let error: unknown;
    try {
      result = await p;
    } catch (err) {
      error = err;
    }
    if (error !== undefined) {
      expect(error).toBeInstanceOf(ForbiddenException);
    } else {
      expect(result?.status).not.toBe('APPLIED');
    }
  }

  describe('AttendanceService.recordEvent', () => {
    it.each(['SIGN_IN', 'SIGN_OUT'] as const)('refuses a PARENT %s for their own child', async (eventType) => {
      const { parentUser, child } = await seed(`H1Att${eventType}`);
      await expect(
        attendance.recordEvent(parentUser, { childId: child.id, eventType, method: 'EDUCATOR', timestamp: new Date().toISOString() }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(await fixturePrisma.attendanceEvent.count({ where: { childId: child.id } })).toBe(0);
    });

    it('still allows an EDUCATOR assigned to the child\'s room (sanity)', async () => {
      const { educatorUser, child } = await seed('H1AttEdu');
      const event = await attendance.recordEvent(educatorUser, {
        childId: child.id,
        eventType: 'SIGN_IN',
        method: 'EDUCATOR',
        timestamp: new Date().toISOString(),
      });
      expect(event.childId).toBe(child.id);
    });
  });

  describe('CareRecordsService.createGroupEvent', () => {
    it('refuses a PARENT for their own child and writes nothing', async () => {
      const { parentUser, child } = await seed('H1Care');
      await expect(
        careRecords.createGroupEvent(parentUser, { type: 'MEAL', timestamp: new Date().toISOString(), childIds: [child.id] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(await fixturePrisma.careRecord.count({ where: { childId: child.id } })).toBe(0);
    });

    it('still allows an EDUCATOR assigned to the child\'s room (sanity)', async () => {
      const { educatorUser, child } = await seed('H1CareEdu');
      const result = await careRecords.createGroupEvent(educatorUser, {
        type: 'MEAL',
        timestamp: new Date().toISOString(),
        childIds: [child.id],
      });
      expect(result.records).toHaveLength(1);
    });
  });

  describe('IncidentsService.create', () => {
    it('refuses a PARENT for their own child', async () => {
      const { parentUser, child } = await seed('H1Inc');
      await expect(
        incidents.create(parentUser, { childId: child.id, severity: 'MINOR', description: 'forged', occurredAt: new Date().toISOString() }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(await fixturePrisma.incident.count({ where: { childId: child.id } })).toBe(0);
    });
  });

  describe('MedicationService.recordAdministration', () => {
    it('refuses a PARENT for their own child\'s authorization', async () => {
      const { tenant, parent, parentUser, child } = await seed('H1Med');
      const auth = await fixturePrisma.medicationAuthorization.create({
        data: {
          orgId: tenant.orgId,
          centreId: tenant.centreId,
          childId: child.id,
          medicationName: 'Ventolin',
          dosageInstructions: '2 puffs',
          authorizedByGuardianId: parent.id,
        },
      });
      await expect(
        medication.recordAdministration(parentUser, { authorizationId: auth.id, administeredAt: new Date().toISOString(), dosageGiven: '2 puffs' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(await fixturePrisma.medicationAdministration.count({ where: { authorizationId: auth.id } })).toBe(0);
    });
  });

  describe('MediaService.register', () => {
    it('refuses a PARENT tagging their own child', async () => {
      const { parentUser, child } = await seed('H1Media');
      const storageKey = `h1-forged-${uniqueSuffix()}`;
      await expect(media.register(parentUser, { storageKey, childIds: [child.id] })).rejects.toBeInstanceOf(ForbiddenException);
      expect(await fixturePrisma.mediaAsset.count({ where: { storageKey } })).toBe(0);
    });
  });

  describe('SyncService.submit', () => {
    function op(entityType: 'AttendanceEvent' | 'CareRecord', payload: Record<string, unknown>) {
      return {
        idempotencyKey: `h1-${uuidv4()}`,
        clientOperationId: uuidv4(),
        entityType,
        entityId: uuidv4(),
        operationType: 'CREATE' as const,
        payload,
        clientTimestamp: new Date().toISOString(),
      };
    }

    it('rejects a PARENT AttendanceEvent CREATE for their own child and applies nothing', async () => {
      const { parentUser, child } = await seed('H1SyncAtt');
      const dto = op('AttendanceEvent', { childId: child.id, eventType: 'SIGN_OUT', method: 'EDUCATOR', timestamp: new Date().toISOString() });
      await expectSyncRejected(sync.submit(parentUser, dto));
      expect(await fixturePrisma.attendanceEvent.findUnique({ where: { id: dto.entityId } })).toBeNull();
    });

    it('rejects a PARENT CareRecord CREATE for their own child and applies nothing', async () => {
      const { parentUser, child } = await seed('H1SyncCare');
      const dto = op('CareRecord', { childId: child.id, type: 'SLEEP', timestamp: new Date().toISOString() });
      await expectSyncRejected(sync.submit(parentUser, dto));
      expect(await fixturePrisma.careRecord.findUnique({ where: { id: dto.entityId } })).toBeNull();
    });

    it('still applies an EDUCATOR AttendanceEvent CREATE (sanity)', async () => {
      const { educatorUser, child } = await seed('H1SyncEdu');
      const dto = op('AttendanceEvent', { childId: child.id, eventType: 'SIGN_IN', method: 'EDUCATOR', timestamp: new Date().toISOString() });
      const result = await sync.submit(educatorUser, dto);
      expect(result.status).toBe('APPLIED');
      expect(await fixturePrisma.attendanceEvent.findUnique({ where: { id: dto.entityId } })).not.toBeNull();
    });
  });
});
