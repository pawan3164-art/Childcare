import { ForbiddenException } from '@nestjs/common';
import { CalendarService } from '../../src/calendar/calendar.service';
import { AttendanceService } from '../../src/attendance/attendance.service';
import { buildForms } from '../u4c-forms/helpers';
import { disconnectAll } from '../test-utils';
import { NOW, assignAreaManager, buildHq, makeHqChild, seedHqOrg, attend, ledger, CHILD_SURNAME_PREFIX, HqOrg } from './helpers';

/**
 * An AREA_MANAGER has orgId set and centreId null (like ORG_ADMIN) but must gain no centre-level or
 * child-level access: the HQ module is the only thing the role unlocks.
 */
describe('AREA_MANAGER least privilege', () => {
  let hq: Awaited<ReturnType<typeof buildHq>>;
  let forms: Awaited<ReturnType<typeof buildForms>>;
  let org: HqOrg;
  let child: Awaited<ReturnType<typeof makeHqChild>>;

  beforeAll(async () => {
    hq = await buildHq();
    forms = await buildForms();
    org = await seedHqOrg('hq-least-priv');
    await assignAreaManager(org, [0, 1, 2]); // assigned to every centre: still no centre-level access
    child = await makeHqChild(org, 0, 'Secretname');
    await attend(org, 0, child.id, 'SIGN_IN', '2026-10-13T18:00Z');
    await ledger(org, 0, child.id, 'FEE', 12345, '2026-10-10');
  });
  afterAll(async () => {
    await hq.prismaService.onModuleDestroy();
    await forms.prismaService.onModuleDestroy();
    await disconnectAll();
  });

  it('the fixture matches the contract: orgId set, centreId null', () => {
    expect(org.areaManager.orgId).toBe(org.orgId);
    expect(org.areaManager.centreId).toBeNull();
    expect(org.areaManager.role).toBe('AREA_MANAGER');
  });

  it('FormsService.listTemplates is Forbidden', async () => {
    await expect(forms.service.listTemplates(org.areaManager, NOW)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('CalendarService.createEvent is Forbidden and creates nothing', async () => {
    const calendar = new CalendarService(hq.tenancy, hq.audit, hq.authorization);
    await expect(calendar.createEvent(org.areaManager, { title: 'Sneaky', startsAt: '2026-11-01T00:00:00Z' }, NOW)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('AuthorizationService.assertCanAccessChild is denied for view', async () => {
    await expect(hq.authorization.assertCanAccessChild(org.areaManager, child.id, 'view')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('AttendanceService.history and recordEvent are denied', async () => {
    const attendance = new AttendanceService(hq.tenancy, hq.audit, hq.authorization);
    await expect(attendance.history(org.areaManager, child.id)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(attendance.recordEvent(org.areaManager, { childId: child.id, eventType: 'SIGN_IN', method: 'EDUCATOR', timestamp: NOW.toISOString() } as any)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('an area manager is not treated as an org admin by the authorization layer for roles it does not hold', async () => {
    await expect(hq.authorization.assertRole(org.areaManager, ['CENTRE_ADMIN', 'ORG_ADMIN', 'PLATFORM_ADMIN'] as any, 'test.admin_only')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('HqService occupancy and financials return no child-level data to an area manager', async () => {
    const occ = JSON.stringify(await hq.service.occupancy(org.areaManager, {}, NOW));
    const fin = JSON.stringify(await hq.service.financials(org.areaManager, { from: '2026-10-01', to: '2026-10-31' }, NOW));
    const csv: string = await hq.service.financialsCsv(org.areaManager, { from: '2026-10-01', to: '2026-10-31' }, NOW);
    for (const out of [occ, fin, csv]) {
      expect(out).not.toContain('Secretname');
      expect(out).not.toContain(child.lastName);
      expect(out).not.toContain(CHILD_SURNAME_PREFIX);
      expect(out).not.toContain(child.id);
    }
    expect(occ + fin).not.toMatch(/firstName|lastName|dateOfBirth|childId/);
  });

  it('HqService.listCentres returns no child-level or staff data either', async () => {
    const out = JSON.stringify(await hq.service.listCentres(org.areaManager));
    expect(out).not.toContain(child.lastName);
    expect(out).not.toMatch(/email|firstName|lastName|userId/);
  });
});
