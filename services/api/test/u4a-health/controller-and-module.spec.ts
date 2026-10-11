import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { JwtAuthGuard } from '../../src/authorization/guards/jwt-auth.guard';
import { AUDIT_READ_KEY } from '../../src/audit/audit-read';
import { MODULES, PLANS } from '../../src/features/features.registry';
import { ModuleGuard, REQUIRES_MODULE_KEY } from '../../src/features/module.guard';
import { AppModule } from '../../src/app.module';
import { HealthController } from '../../src/health/health.controller';
import { HealthModule } from '../../src/health/health.module';

const GET = RequestMethod.GET;
const POST = RequestMethod.POST;
const PUT = RequestMethod.PUT;

function fullPath(ctrl: any, handler: string): string {
  const base: string = Reflect.getMetadata('path', ctrl) ?? '';
  const sub: string = Reflect.getMetadata('path', ctrl.prototype[handler]) ?? '';
  return [base, sub].join('/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
}

function guards(ctrl: any, handler: string): unknown[] {
  return [...(Reflect.getMetadata('__guards__', ctrl) ?? []), ...(Reflect.getMetadata('__guards__', ctrl.prototype[handler]) ?? [])];
}

describe('U4a health_records feature module', () => {
  const entry = MODULES.find((m) => m.key === 'health_records');

  it('is registered as a critical module on both plans', () => {
    expect(entry).toBeDefined();
    expect(entry).toMatchObject({ key: 'health_records', label: 'Health records', critical: true });
    expect([...entry!.plans].sort()).toEqual(['core', 'full']);
  });

  it('is in PLANS.core and PLANS.full', () => {
    expect(PLANS.core).toContain('health_records');
    expect(PLANS.full).toContain('health_records');
  });

  it('there are now 7 critical modules', () => {
    expect(MODULES.filter((m) => m.critical)).toHaveLength(7);
  });
});

describe('HealthController', () => {
  it.each([
    ['getHealth', GET, 'children/:childId/health'],
    ['addAllergy', POST, 'children/:childId/allergies'],
    ['endAllergy', POST, 'children/:childId/allergies/:allergyId/end'],
    ['addImmunisation', POST, 'children/:childId/immunisations'],
    ['voidImmunisation', POST, 'children/:childId/immunisations/:immunisationId/void'],
    ['setImmunisationStatus', PUT, 'children/:childId/immunisation-status'],
    ['allergyRegister', GET, 'health/allergy-register'],
  ])('%s has the right verb, path and JwtAuthGuard', (handler, method, path) => {
    const fn = (HealthController.prototype as any)[handler];
    expect(typeof fn).toBe('function');
    expect(Reflect.getMetadata('method', fn)).toBe(method);
    expect(fullPath(HealthController, handler)).toBe(path);
    expect(guards(HealthController, handler)).toContain(JwtAuthGuard);
  });

  it.each(['getHealth', 'allergyRegister'])('%s is read-audited', (handler) => {
    const meta = Reflect.getMetadata(AUDIT_READ_KEY, (HealthController.prototype as any)[handler]);
    expect(meta).toBeDefined();
    expect(typeof meta.resource).toBe('string');
  });

  it('getHealth read audit records the child id', () => {
    const meta = Reflect.getMetadata(AUDIT_READ_KEY, (HealthController.prototype as any).getHealth);
    expect(meta).toMatchObject({ entityType: 'Child', idParam: 'childId' });
  });

  it.each(['addAllergy', 'endAllergy', 'addImmunisation', 'voidImmunisation', 'setImmunisationStatus'])('%s write is not read-audited', (handler) => {
    expect(Reflect.getMetadata(AUDIT_READ_KEY, (HealthController.prototype as any)[handler])).toBeUndefined();
  });

  it('is never gated by ModuleGuard or RequiresModule (critical module)', () => {
    for (const handler of ['getHealth', 'addAllergy', 'endAllergy', 'addImmunisation', 'voidImmunisation', 'setImmunisationStatus', 'allergyRegister']) {
      expect(guards(HealthController, handler)).not.toContain(ModuleGuard);
      expect(Reflect.getMetadata(REQUIRES_MODULE_KEY, (HealthController.prototype as any)[handler])).toBeUndefined();
    }
    expect(Reflect.getMetadata(REQUIRES_MODULE_KEY, HealthController)).toBeUndefined();
  });
});

describe('HealthModule', () => {
  it('is imported by AppModule', () => {
    const imports: unknown[] = Reflect.getMetadata('imports', AppModule) ?? [];
    expect(imports).toContain(HealthModule);
  });
});
