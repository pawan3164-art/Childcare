import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { RetentionService } from '../../src/retention/retention.service';
import { AUDIT_READ_KEY } from '../../src/audit/audit-read';
import { RetentionController } from '../../src/retention/retention.controller';
import { disconnectAll, seedOrgCentreRoom } from '../test-utils';
import { buildServices, ELIGIBLE_7Y, makeChild, makeUser } from './helpers';

describe('PR retention: a child retention status for the admin screen', () => {
  let service: RetentionService;
  let prismaService: any;
  let t: Awaited<ReturnType<typeof seedOrgCentreRoom>>;
  let other: Awaited<ReturnType<typeof seedOrgCentreRoom>>;
  let admin: Awaited<ReturnType<typeof makeUser>>;
  let educator: Awaited<ReturnType<typeof makeUser>>;
  let parent: Awaited<ReturnType<typeof makeUser>>;
  let otherAdmin: Awaited<ReturnType<typeof makeUser>>;

  beforeAll(async () => {
    const s = await buildServices();
    prismaService = s.prismaService;
    service = new RetentionService(s.tenancy, s.audit, s.authorization);
    t = await seedOrgCentreRoom('status-a');
    other = await seedOrgCentreRoom('status-b');
    admin = await makeUser(t, 'CENTRE_ADMIN');
    educator = await makeUser(t, 'EDUCATOR', { roomId: t.roomId });
    parent = await makeUser(t, 'PARENT');
    otherAdmin = await makeUser(other, 'CENTRE_ADMIN');
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy?.();
    await disconnectAll();
  });

  it('shows departure date, hold and reason for a departed child on hold', async () => {
    const child = await makeChild(t, { departedOn: ELIGIBLE_7Y, legalHold: true, legalHoldReason: 'Open complaint 42' });
    expect(await service.childStatus(admin, child.id)).toEqual({
      childId: child.id,
      departedOn: ELIGIBLE_7Y,
      legalHold: true,
      legalHoldReason: 'Open complaint 42',
      anonymised: false,
    });
  });

  it('shows an active child with nothing set', async () => {
    const child = await makeChild(t);
    expect(await service.childStatus(admin, child.id)).toEqual({ childId: child.id, departedOn: null, legalHold: false, legalHoldReason: null, anonymised: false });
  });

  it('flags an anonymised child', async () => {
    const child = await makeChild(t, { departedOn: '2015-01-01', anonymisedAt: new Date('2026-01-01T00:00:00Z') });
    expect((await service.childStatus(admin, child.id)).anonymised).toBe(true);
  });

  it('is for admins of the child centre only', async () => {
    const child = await makeChild(t);
    await expect(service.childStatus(educator, child.id)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.childStatus(parent, child.id)).rejects.toBeInstanceOf(ForbiddenException);
    const err = await service.childStatus(otherAdmin, child.id).catch((e) => e);
    expect(err instanceof ForbiddenException || err instanceof NotFoundException).toBe(true);
    await expect(service.childStatus(admin, '00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('is exposed as GET children/:childId/retention and its read is audited', () => {
    const handler = (RetentionController.prototype as any).status;
    expect(typeof handler).toBe('function');
    expect(Reflect.getMetadata(AUDIT_READ_KEY, handler)).toEqual({ resource: 'child_retention', entityType: 'Child', idParam: 'childId' });
    expect(Reflect.getMetadata('path', handler)).toBe('children/:childId/retention');
    expect(Reflect.getMetadata('method', handler)).toBe(0); // RequestMethod.GET
  });
});
