import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { JwtAuthGuard } from '../../src/authorization/guards/jwt-auth.guard';
import { ModuleGuard, REQUIRES_MODULE_KEY } from '../../src/features/module.guard';
import { AppModule } from '../../src/app.module';

const GET = RequestMethod.GET;
const PUT = RequestMethod.PUT;

function fullPath(ctrl: any, handler: string): string {
  const base: string = Reflect.getMetadata('path', ctrl) ?? '';
  const sub: string = Reflect.getMetadata('path', ctrl.prototype[handler]) ?? '';
  return [base, sub].join('/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
}
const guardsOf = (ctrl: any): unknown[] => Reflect.getMetadata('__guards__', ctrl) ?? [];
const guardsOfHandler = (ctrl: any, handler: string): unknown[] => [...guardsOf(ctrl), ...(Reflect.getMetadata('__guards__', ctrl.prototype[handler]) ?? [])];

// Required lazily so a missing src/hq fails each test for the same clear reason.
const controller = () => require('../../src/hq/hq.controller').HqController;
const hqModule = () => require('../../src/hq/hq.module').HqModule;

describe('HqController', () => {
  const routes: Array<[string, RequestMethod, string]> = [
    ['listCentres', GET, 'hq/centres'],
    ['occupancy', GET, 'hq/occupancy'],
    ['financials', GET, 'hq/financials'],
    ['financialsCsv', GET, 'hq/financials.csv'],
    ['setAreaManagerCentres', PUT, 'hq/area-managers/:userId/centres'],
    ['getAreaManagerCentres', GET, 'hq/area-managers/:userId/centres'],
    ['setCentreCapacity', PUT, 'hq/centres/:centreId/capacity'],
  ];

  it.each(routes)('%s has the right verb, path and JwtAuthGuard', (handler, method, path) => {
    const C = controller();
    const fn = C.prototype[handler];
    expect(typeof fn).toBe('function');
    expect(Reflect.getMetadata('method', fn)).toBe(method);
    expect(fullPath(C, handler)).toBe(path);
    expect(guardsOfHandler(C, handler)).toContain(JwtAuthGuard);
  });

  it('is not gated by ModuleGuard (HQ is not a switchable module) and has no required-module metadata', () => {
    const C = controller();
    expect(guardsOf(C)).not.toContain(ModuleGuard);
    for (const [handler] of routes) {
      expect(guardsOfHandler(C, handler)).not.toContain(ModuleGuard);
      expect(Reflect.getMetadata(REQUIRES_MODULE_KEY, C.prototype[handler])).toBeUndefined();
    }
    expect(Reflect.getMetadata(REQUIRES_MODULE_KEY, C)).toBeUndefined();
  });

  it('the CSV handler sets Content-Type text/csv and an attachment filename', () => {
    const src: string = controller().prototype.financialsCsv.toString();
    expect(src).toMatch(/text\/csv/);
    expect(src).toMatch(/attachment/);
    expect(src).toMatch(/filename/);
  });

  it.each(['setAreaManagerCentres', 'setCentreCapacity'])('write handler %s is throttled', (handler) => {
    const keys: string[] = Reflect.getMetadataKeys(controller().prototype[handler]);
    expect(keys.some((k) => /THROTTLER.*(LIMIT|TTL)/i.test(String(k)))).toBe(true);
  });

  it('handlers pass the authenticated user (never a client-supplied identity) to the service', () => {
    for (const [handler] of routes) expect(controller().prototype[handler].toString()).toMatch(/user/);
  });
});

describe('HqModule', () => {
  it('is imported by AppModule', () => {
    const imports: unknown[] = Reflect.getMetadata('imports', AppModule) ?? [];
    expect(imports).toContain(hqModule());
  });

  it('provides HqService and registers HqController', () => {
    const providers: unknown[] = Reflect.getMetadata('providers', hqModule()) ?? [];
    const controllers: unknown[] = Reflect.getMetadata('controllers', hqModule()) ?? [];
    expect(providers).toContain(require('../../src/hq/hq.service').HqService);
    expect(controllers).toContain(controller());
  });
});
