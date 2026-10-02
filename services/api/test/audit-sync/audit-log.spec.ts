import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { disconnectAll, fixturePrisma, seedOrgCentreRoom, setTenantContext, appPrisma } from '../test-utils';

describe('AuditService: append-only logging', () => {
  let prismaService: PrismaService;
  let tenancy: TenancyService;
  let audit: AuditService;

  beforeAll(async () => {
    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    tenancy = new TenancyService(prismaService);
    audit = new AuditService(tenancy);
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await disconnectAll();
  });

  it('records a SUCCESS entry with metadata and correlation id', async () => {
    const tenant = await seedOrgCentreRoom('AuditSuccess');

    await audit.record({
      orgId: tenant.orgId,
      centreId: tenant.centreId,
      action: 'child.view',
      entityType: 'Child',
      entityId: 'child-123',
      outcome: 'SUCCESS',
      metadata: { reason: 'routine access' },
      correlationId: 'corr-abc',
    });

    await setTenantContext(appPrisma, tenant.orgId, tenant.centreId);
    const rows = await appPrisma.auditLogEntry.findMany({
      where: { orgId: tenant.orgId, action: 'child.view' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe('SUCCESS');
    expect(rows[0].correlationId).toBe('corr-abc');
    expect((rows[0].metadata as Record<string, unknown>).reason).toBe('routine access');
  });

  it('each call creates a new row — audit entries are events, not a mutable state record', async () => {
    const tenant = await seedOrgCentreRoom('AuditMultiple');

    await audit.record({ orgId: tenant.orgId, centreId: tenant.centreId, action: 'x', entityType: 'T', outcome: 'SUCCESS' });
    await audit.record({ orgId: tenant.orgId, centreId: tenant.centreId, action: 'x', entityType: 'T', outcome: 'SUCCESS' });

    const rows = await fixturePrisma.auditLogEntry.findMany({ where: { orgId: tenant.orgId, action: 'x' } });
    expect(rows).toHaveLength(2);
  });

  it('has no update/delete method exposed on the service at all', () => {
    const methodNames = Object.getOwnPropertyNames(Object.getPrototypeOf(audit));
    expect(methodNames).not.toContain('update');
    expect(methodNames).not.toContain('delete');
  });
});
