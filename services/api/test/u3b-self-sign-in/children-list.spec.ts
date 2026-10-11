import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { ChildrenService } from '../../src/centre-admin/children.service';
import { disconnectAll } from '../test-utils';
import { enableSelfSignIn, fixturePrisma, link, makeChild, makeUser, setupFamily } from './helpers';

describe('ChildrenService.list: canSelfSignIn', () => {
  let prismaService: PrismaService;
  let children: ChildrenService;

  beforeAll(async () => {
    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    const tenancy = new TenancyService(prismaService);
    children = new ChildrenService(tenancy, new AuditService(tenancy));
  });
  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await disconnectAll();
  });

  const flagFor = async (user: Parameters<ChildrenService['list']>[0], childId: string) => {
    const item = (await children.list(user)).find((c) => c.id === childId) as any;
    expect(item).toBeDefined();
    expect(typeof item.canSelfSignIn).toBe('boolean');
    return item.canSelfSignIn as boolean;
  };

  it('is true for a parent with pickup rights when the centre has it on', async () => {
    const f = await setupFamily('ListOn');
    await enableSelfSignIn(f.tenant.centreId);
    expect(await flagFor(f.parent, f.child.id)).toBe(true);
  });

  it('is false when the centre has it off (the default)', async () => {
    const f = await setupFamily('ListOff');
    expect(await flagFor(f.parent, f.child.id)).toBe(false);
  });

  it('is false for a guardian without canPickup, but the child is still listed', async () => {
    const f = await setupFamily('ListNoPickup');
    await enableSelfSignIn(f.tenant.centreId);
    const p = await makeUser(f.tenant, 'PARENT');
    await link(f.tenant, p, f.child.id, { canPickup: false });
    expect(await flagFor(p, f.child.id)).toBe(false);
  });

  it('is false for an expired guardian (when still listed) and a restricted guardian never sees true', async () => {
    const f = await setupFamily('ListExpired');
    await enableSelfSignIn(f.tenant.centreId);
    const restricted = await makeUser(f.tenant, 'PARENT');
    await link(f.tenant, restricted, f.child.id, { canPickup: true, isRestricted: true });
    const list = await children.list(restricted);
    expect(list.every((c: any) => c.canSelfSignIn === false)).toBe(true);
    const expired = await makeUser(f.tenant, 'PARENT');
    await link(f.tenant, expired, f.child.id, { canPickup: true, expiresAt: new Date('2020-01-01') });
    const expiredList = await children.list(expired);
    expect(expiredList.every((c: any) => c.canSelfSignIn === false)).toBe(true);
  });

  it('is false for a child who has departed', async () => {
    const f = await setupFamily('ListDeparted');
    await enableSelfSignIn(f.tenant.centreId);
    await fixturePrisma.child.update({ where: { id: f.child.id }, data: { departedOn: new Date('2026-09-30') } });
    const item = (await children.list(f.parent)).find((c) => c.id === f.child.id) as any;
    if (item) expect(item.canSelfSignIn).toBe(false);
  });

  it('is false for every staff role, even with the centre setting on', async () => {
    const f = await setupFamily('ListStaff');
    await enableSelfSignIn(f.tenant.centreId);
    const orgAdmin = await makeUser(f.tenant, 'ORG_ADMIN');
    for (const staff of [f.admin, f.educator, orgAdmin]) {
      expect(await flagFor(staff, f.child.id)).toBe(false);
    }
  });

  it('is per child: a parent with two children in one on-centre gets the right flag for each', async () => {
    const f = await setupFamily('ListTwo');
    await enableSelfSignIn(f.tenant.centreId);
    const second = await makeChild(f.tenant);
    await link(f.tenant, f.parent, second.id, { canPickup: false });
    expect(await flagFor(f.parent, f.child.id)).toBe(true);
    expect(await flagFor(f.parent, second.id)).toBe(false);
  });

  it('keeps the existing fields', async () => {
    const f = await setupFamily('ListFields');
    const item = (await children.list(f.parent))[0];
    expect(item).toMatchObject({ id: f.child.id, attendanceStatus: 'NO_EVENTS_TODAY', previousDayNotSignedOut: false });
    expect(item).toHaveProperty('firstName');
    expect(item).toHaveProperty('roomName');
  });
});
