import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { JwtAuthGuard } from '../../src/authorization/guards/jwt-auth.guard';
import { ModuleGuard, REQUIRES_MODULE_KEY } from '../../src/features/module.guard';
import { LearningController } from '../../src/learning/learning.controller';
import { BillingController } from '../../src/billing/billing.controller';
import { CcsController } from '../../src/ccs/ccs.controller';
import { ChecklistsController } from '../../src/checklists/checklists.controller';
import { FamilyRequestsController } from '../../src/family-requests/family-requests.controller';
import { AttendanceController } from '../../src/attendance/attendance.controller';
import { CareRecordsController } from '../../src/care-records/care-records.controller';
import { MedicationController } from '../../src/medication/medication.controller';
import { IncidentsController } from '../../src/incidents/incidents.controller';
import { MessagingController } from '../../src/messaging/messaging.controller';
import { DirectMessagesController } from '../../src/messaging/direct-messages.controller';
import { PrivacyController } from '../../src/privacy/privacy.controller';
import { FeaturesController } from '../../src/features/features.controller';

const guardsOf = (cls: any): any[] => Reflect.getMetadata('__guards__', cls) ?? [];
const guardsOfHandler = (fn: any): any[] => Reflect.getMetadata('__guards__', fn) ?? [];

describe('C0 module coverage of controllers', () => {
  const optional: Array<[string, any, string]> = [
    ['LearningController', LearningController, 'learning'],
    ['BillingController', BillingController, 'billing'],
    ['CcsController', CcsController, 'billing'],
    ['ChecklistsController', ChecklistsController, 'checklists'],
    ['FamilyRequestsController', FamilyRequestsController, 'family_requests'],
  ];

  it.each(optional)('%s requires its module', (_name, cls, key) => {
    expect(Reflect.getMetadata(REQUIRES_MODULE_KEY, cls)).toBe(key);
  });

  it.each(optional)('%s lists ModuleGuard after JwtAuthGuard', (_name, cls) => {
    const guards = guardsOf(cls);
    const jwt = guards.indexOf(JwtAuthGuard);
    const mod = guards.indexOf(ModuleGuard);
    expect(jwt).toBeGreaterThanOrEqual(0);
    expect(mod).toBeGreaterThanOrEqual(0);
    expect(jwt).toBeLessThan(mod);
  });

  const critical: Array<[string, any]> = [
    ['AttendanceController', AttendanceController],
    ['CareRecordsController', CareRecordsController],
    ['MedicationController', MedicationController],
    ['IncidentsController', IncidentsController],
    ['MessagingController', MessagingController],
    ['DirectMessagesController', DirectMessagesController],
    ['PrivacyController', PrivacyController],
  ];

  it.each(critical)('%s (critical module) carries no RequiresModule, on class or any handler', (_name, cls) => {
    expect(Reflect.getMetadata(REQUIRES_MODULE_KEY, cls)).toBeUndefined();
    for (const name of Object.getOwnPropertyNames(cls.prototype)) {
      if (name === 'constructor') continue;
      expect(Reflect.getMetadata(REQUIRES_MODULE_KEY, cls.prototype[name])).toBeUndefined();
    }
    expect(guardsOf(cls)).not.toContain(ModuleGuard);
  });

  describe('FeaturesController', () => {
    const proto: any = FeaturesController.prototype;
    const route = (name: string) => ({
      method: Reflect.getMetadata('method', proto[name]),
      path: String(Reflect.getMetadata('path', proto[name])).replace(/^\//, ''),
    });
    const hasJwt = (name: string) => guardsOf(FeaturesController).includes(JwtAuthGuard) || guardsOfHandler(proto[name]).includes(JwtAuthGuard);

    it('list is GET modules', () => {
      expect(route('list')).toEqual({ method: RequestMethod.GET, path: 'modules' });
    });
    it('setEnabled is PUT modules/:key', () => {
      expect(route('setEnabled')).toEqual({ method: RequestMethod.PUT, path: 'modules/:key' });
    });
    it('plan is GET plan', () => {
      expect(route('plan')).toEqual({ method: RequestMethod.GET, path: 'plan' });
    });
    it('setPlan is PUT platform/organisations/:orgId/plan', () => {
      expect(route('setPlan')).toEqual({ method: RequestMethod.PUT, path: 'platform/organisations/:orgId/plan' });
    });
    it.each(['list', 'setEnabled', 'plan', 'setPlan'])('%s is behind JwtAuthGuard', (name) => {
      expect(hasJwt(name)).toBe(true);
    });
    it('the features controller itself is not module-gated', () => {
      expect(Reflect.getMetadata(REQUIRES_MODULE_KEY, FeaturesController)).toBeUndefined();
    });
  });
});
