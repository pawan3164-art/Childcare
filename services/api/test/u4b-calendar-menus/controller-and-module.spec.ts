import 'reflect-metadata';
import { ExecutionContext, ForbiddenException, RequestMethod } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from '../../src/authorization/guards/jwt-auth.guard';
import { MODULES, PLANS } from '../../src/features/features.registry';
import { ModuleGuard, REQUIRES_MODULE_KEY } from '../../src/features/module.guard';
import { AppModule } from '../../src/app.module';
import { CalendarController } from '../../src/calendar/calendar.controller';
import { CalendarModule } from '../../src/calendar/calendar.module';
import { MenusController } from '../../src/menus/menus.controller';
import { MenusModule } from '../../src/menus/menus.module';
import { buildFeatures, db, setupOrg } from '../c0-features/helpers';
import { disconnectAll } from '../test-utils';

const GET = RequestMethod.GET;
const POST = RequestMethod.POST;
const PUT = RequestMethod.PUT;
const PATCH = RequestMethod.PATCH;
const DELETE = RequestMethod.DELETE;

function fullPath(ctrl: any, handler: string): string {
  const base: string = Reflect.getMetadata('path', ctrl) ?? '';
  const sub: string = Reflect.getMetadata('path', ctrl.prototype[handler]) ?? '';
  return [base, sub].join('/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
}

const guardsOf = (ctrl: any): unknown[] => Reflect.getMetadata('__guards__', ctrl) ?? [];
const guardsOfHandler = (ctrl: any, handler: string): unknown[] => [...guardsOf(ctrl), ...(Reflect.getMetadata('__guards__', ctrl.prototype[handler]) ?? [])];

describe('U4b feature registry entries', () => {
  it.each([
    ['calendar', 'Calendar'],
    ['menus', 'Menus'],
  ])('%s is a non-critical module on core and full plans', (key, label) => {
    const entry = MODULES.find((m) => m.key === key);
    expect(entry).toBeDefined();
    expect(entry).toMatchObject({ key, label, critical: false });
    expect([...entry!.plans].sort()).toEqual(['core', 'full']);
    expect(PLANS.core).toContain(key);
    expect(PLANS.full).toContain(key);
  });

  it('the critical module count is unchanged at 7', () => {
    expect(MODULES.filter((m) => m.critical)).toHaveLength(7);
  });
});

describe('CalendarController', () => {
  it.each([
    ['listEvents', GET, 'calendar/events'],
    ['createEvent', POST, 'calendar/events'],
    ['updateEvent', [PATCH, PUT], 'calendar/events/:id'],
    ['cancelEvent', POST, 'calendar/events/:id/cancel'],
  ])('%s has a sensible verb, path and JwtAuthGuard', (handler, method, path) => {
    const fn = (CalendarController.prototype as any)[handler];
    expect(typeof fn).toBe('function');
    const verb = Reflect.getMetadata('method', fn);
    expect(Array.isArray(method) ? method : [method]).toContain(verb);
    expect(fullPath(CalendarController, handler)).toBe(path);
    expect(guardsOfHandler(CalendarController, handler)).toContain(JwtAuthGuard);
  });

  it('requires the calendar module, with ModuleGuard after JwtAuthGuard', () => {
    expect(Reflect.getMetadata(REQUIRES_MODULE_KEY, CalendarController)).toBe('calendar');
    const g = guardsOf(CalendarController);
    expect(g.indexOf(JwtAuthGuard)).toBeGreaterThanOrEqual(0);
    expect(g.indexOf(ModuleGuard)).toBeGreaterThan(g.indexOf(JwtAuthGuard));
  });
});

describe('MenusController', () => {
  it.each([
    ['list', GET, 'menus'],
    ['set', PUT, 'menus/:date/:meal'],
    ['clear', DELETE, 'menus/:date/:meal'],
  ])('%s has the right verb, path and JwtAuthGuard', (handler, method, path) => {
    const fn = (MenusController.prototype as any)[handler];
    expect(typeof fn).toBe('function');
    expect(Reflect.getMetadata('method', fn)).toBe(method);
    expect(fullPath(MenusController, handler)).toBe(path);
    expect(guardsOfHandler(MenusController, handler)).toContain(JwtAuthGuard);
  });

  it('requires the menus module, with ModuleGuard after JwtAuthGuard', () => {
    expect(Reflect.getMetadata(REQUIRES_MODULE_KEY, MenusController)).toBe('menus');
    const g = guardsOf(MenusController);
    expect(g.indexOf(JwtAuthGuard)).toBeGreaterThanOrEqual(0);
    expect(g.indexOf(ModuleGuard)).toBeGreaterThan(g.indexOf(JwtAuthGuard));
  });
});

describe('CalendarModule and MenusModule', () => {
  it('are imported by AppModule', () => {
    const imports: unknown[] = Reflect.getMetadata('imports', AppModule) ?? [];
    expect(imports).toContain(CalendarModule);
    expect(imports).toContain(MenusModule);
  });
});

describe('U4b ModuleGuard with a real FeaturesService', () => {
  let features: any;
  beforeAll(async () => {
    features = (await buildFeatures()).features;
  });
  afterAll(async () => {
    await disconnectAll();
  });

  function ctx(cls: any, handler: string, user: any): ExecutionContext {
    return { getHandler: () => cls.prototype[handler], getClass: () => cls, switchToHttp: () => ({ getRequest: () => ({ user }) }) } as any;
  }

  it.each([
    ['calendar', CalendarController, 'listEvents'],
    ['menus', MenusController, 'list'],
  ])('%s routes pass by default, are blocked once the centre disables the module, and other modules are unaffected', async (key, cls, handler) => {
    const o = await setupOrg(`guard-${key}`);
    const guard = new ModuleGuard(new Reflector(), features);
    await expect(guard.canActivate(ctx(cls, handler, o.parent))).resolves.toBe(true);
    await db.centreModuleSetting.create({
      data: { orgId: o.tenant.orgId, centreId: o.tenant.centreId, moduleKey: key, enabled: false, updatedByUserId: o.admin.userId },
    });
    await expect(guard.canActivate(ctx(cls, handler, o.parent))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(ctx(cls, handler, o.admin))).rejects.toBeInstanceOf(ForbiddenException);
    const other = key === 'calendar' ? MenusController : CalendarController;
    await expect(guard.canActivate(ctx(other, key === 'calendar' ? 'list' : 'listEvents', o.parent))).resolves.toBe(true);
  });

  it('disabling calendar or menus never disables a critical module', async () => {
    const o = await setupOrg('guard-critical');
    for (const moduleKey of ['calendar', 'menus']) {
      await db.centreModuleSetting.create({ data: { orgId: o.tenant.orgId, centreId: o.tenant.centreId, moduleKey, enabled: false, updatedByUserId: o.admin.userId } });
    }
    for (const key of ['attendance', 'care_records', 'medication', 'incidents', 'messaging', 'privacy', 'health_records']) {
      expect(await features.isEnabled(o.tenant.orgId, o.tenant.centreId, key, new Date('2026-10-13T20:00:00Z'))).toBe(true);
    }
  });
});
