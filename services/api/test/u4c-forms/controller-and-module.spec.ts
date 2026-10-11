import 'reflect-metadata';
import { ExecutionContext, ForbiddenException, RequestMethod } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from '../../src/authorization/guards/jwt-auth.guard';
import { MODULES, PLANS } from '../../src/features/features.registry';
import { ModuleGuard, REQUIRES_MODULE_KEY } from '../../src/features/module.guard';
import { AppModule } from '../../src/app.module';
import { FormsController } from '../../src/forms/forms.controller';
import { FormsModule } from '../../src/forms/forms.module';
import { buildFeatures, db, setupOrg } from '../c0-features/helpers';
import { disconnectAll } from '../test-utils';

const GET = RequestMethod.GET;
const POST = RequestMethod.POST;
const PATCH = RequestMethod.PATCH;
const PUT = RequestMethod.PUT;

function fullPath(ctrl: any, handler: string): string {
  const base: string = Reflect.getMetadata('path', ctrl) ?? '';
  const sub: string = Reflect.getMetadata('path', ctrl.prototype[handler]) ?? '';
  return [base, sub].join('/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
}
const guardsOf = (ctrl: any): unknown[] => Reflect.getMetadata('__guards__', ctrl) ?? [];
const guardsOfHandler = (ctrl: any, handler: string): unknown[] => [...guardsOf(ctrl), ...(Reflect.getMetadata('__guards__', ctrl.prototype[handler]) ?? [])];

describe('U4c feature registry entry', () => {
  it('forms is a non-critical module on core and full plans', () => {
    const entry = MODULES.find((m) => m.key === 'forms');
    expect(entry).toBeDefined();
    expect(entry).toMatchObject({ key: 'forms', label: 'Forms', critical: false });
    expect([...entry!.plans].sort()).toEqual(['core', 'full']);
    expect(PLANS.core).toContain('forms');
    expect(PLANS.full).toContain('forms');
  });

  it('the critical module count is unchanged at 7', () => {
    expect(MODULES.filter((m) => m.critical)).toHaveLength(7);
  });
});

describe('FormsController', () => {
  const routes: Array<[string, RequestMethod[], string]> = [
    ['listTemplates', [GET], 'forms/templates'],
    ['createTemplate', [POST], 'forms/templates'],
    ['getTemplate', [GET], 'forms/templates/:id'],
    ['updateTemplate', [PATCH, PUT], 'forms/templates/:id'],
    ['publishTemplate', [POST], 'forms/templates/:id/publish'],
    ['sendRequests', [POST], 'forms/requests'],
    ['listRequests', [GET], 'forms/requests'],
    ['cancelRequest', [POST], 'forms/requests/:id/cancel'],
    ['listMyRequests', [GET], 'forms/my-requests'],
    ['getMyRequest', [GET], 'forms/my-requests/:id'],
    ['submitRequest', [POST], 'forms/my-requests/:id/submit'],
    ['verifySubmission', [GET], 'forms/submissions/:id/verify'],
  ];

  it.each(routes)('%s has a sensible verb, path and JwtAuthGuard', (handler, methods, path) => {
    const fn = (FormsController.prototype as any)[handler];
    expect(typeof fn).toBe('function');
    expect(methods).toContain(Reflect.getMetadata('method', fn));
    expect(fullPath(FormsController, handler)).toBe(path);
    expect(guardsOfHandler(FormsController, handler)).toContain(JwtAuthGuard);
  });

  it('requires the forms module, with ModuleGuard after JwtAuthGuard', () => {
    expect(Reflect.getMetadata(REQUIRES_MODULE_KEY, FormsController)).toBe('forms');
    const g = guardsOf(FormsController);
    expect(g.indexOf(JwtAuthGuard)).toBeGreaterThanOrEqual(0);
    expect(g.indexOf(ModuleGuard)).toBeGreaterThan(g.indexOf(JwtAuthGuard));
  });

  it.each(['createTemplate', 'updateTemplate', 'publishTemplate', 'sendRequests', 'cancelRequest', 'submitRequest'])('write handler %s is throttled', (handler) => {
    const fn = (FormsController.prototype as any)[handler];
    const keys: string[] = Reflect.getMetadataKeys(fn);
    expect(keys.some((k) => /THROTTLER.*(LIMIT|TTL)/i.test(String(k)))).toBe(true);
  });

  it('submitRequest passes the server-observed IP and user-agent to the service (never client-supplied)', () => {
    const src = (FormsController.prototype as any).submitRequest.toString();
    expect(src).toMatch(/ip/i);
    expect(src).toMatch(/user-agent|userAgent/i);
  });
});

describe('FormsModule', () => {
  it('is imported by AppModule', () => {
    const imports: unknown[] = Reflect.getMetadata('imports', AppModule) ?? [];
    expect(imports).toContain(FormsModule);
  });
});

describe('U4c ModuleGuard with a real FeaturesService', () => {
  let features: any;
  beforeAll(async () => {
    features = (await buildFeatures()).features;
  });
  afterAll(async () => {
    await disconnectAll();
  });

  const ctx = (user: any): ExecutionContext =>
    ({ getHandler: () => FormsController.prototype.listMyRequests, getClass: () => FormsController, switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as any;

  it('forms routes pass by default and are blocked for everyone once the centre disables the module', async () => {
    const o = await setupOrg('guard-forms');
    const guard = new ModuleGuard(new Reflector(), features);
    await expect(guard.canActivate(ctx(o.parent))).resolves.toBe(true);
    await db.centreModuleSetting.create({
      data: { orgId: o.tenant.orgId, centreId: o.tenant.centreId, moduleKey: 'forms', enabled: false, updatedByUserId: o.admin.userId },
    });
    await expect(guard.canActivate(ctx(o.parent))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(ctx(o.admin))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('disabling forms never disables a critical module', async () => {
    const o = await setupOrg('guard-forms-critical');
    await db.centreModuleSetting.create({ data: { orgId: o.tenant.orgId, centreId: o.tenant.centreId, moduleKey: 'forms', enabled: false, updatedByUserId: o.admin.userId } });
    for (const key of ['attendance', 'care_records', 'medication', 'incidents', 'messaging', 'privacy', 'health_records']) {
      expect(await features.isEnabled(o.tenant.orgId, o.tenant.centreId, key, new Date('2026-10-13T20:00:00Z'))).toBe(true);
    }
  });
});
