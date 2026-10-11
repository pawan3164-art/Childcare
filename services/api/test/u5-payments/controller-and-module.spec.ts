import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { JwtAuthGuard } from '../../src/authorization/guards/jwt-auth.guard';
import { ModuleGuard, REQUIRES_MODULE_KEY } from '../../src/features/module.guard';
import { BillingController } from '../../src/billing/billing.controller';
import { BillingModule } from '../../src/billing/billing.module';
import { PAYMENT_GATEWAY } from '../../src/billing/gateway/payment-gateway.interface';
import { PaymentsService } from '../../src/billing/payments.service';

const path = (h: string) => Reflect.getMetadata('path', (BillingController.prototype as any)[h]);

describe('BillingController card payment routes', () => {
  it('POST billing/payments/card (handler payByCard) is guarded, module-gated and tightly throttled', () => {
    const fn = (BillingController.prototype as any).payByCard;
    expect(typeof fn).toBe('function');
    expect(Reflect.getMetadata('method', fn)).toBe(RequestMethod.POST);
    expect(path('payByCard')).toBe('billing/payments/card');
    expect(Reflect.getMetadata(REQUIRES_MODULE_KEY, BillingController)).toBe('billing');
    expect(Reflect.getMetadata('__guards__', BillingController)).toEqual(expect.arrayContaining([JwtAuthGuard, ModuleGuard]));
    const keys: string[] = Reflect.getMetadataKeys(fn).map(String);
    const limitKey = keys.find((k) => /THROTTLER.*LIMIT/i.test(k));
    expect(limitKey).toBeDefined();
    expect(Reflect.getMetadata(limitKey!, fn)).toBeLessThanOrEqual(10);
  });

  it('passes the server-observed req.ip, never a body field', () => {
    expect((BillingController.prototype as any).payByCard.toString()).toMatch(/\.ip\b/);
  });

  it('GET billing/payments/config (handler paymentConfig) exists', () => {
    const fn = (BillingController.prototype as any).paymentConfig;
    expect(Reflect.getMetadata('method', fn)).toBe(RequestMethod.GET);
    expect(path('paymentConfig')).toBe('billing/payments/config');
  });

  it.each([
    ['MOCK', 'mock'],
    ['FAT_ZEBRA', 'live'],
  ])('config for provider %s reports mode %s and nothing else (controller gets the gateway as 4th ctor arg)', (provider, mode) => {
    const ctrl = new (BillingController as any)({}, {}, {}, { provider });
    expect(ctrl.paymentConfig()).toEqual({ provider, mode });
  });
});

describe('BillingModule', () => {
  const providers = (): any[] => Reflect.getMetadata('providers', BillingModule);
  it('provides PAYMENT_GATEWAY via a factory, and PaymentsService', () => {
    const gw = providers().find((p) => p && p.provide === PAYMENT_GATEWAY);
    expect(gw).toBeDefined();
    expect(typeof gw.useFactory).toBe('function');
    expect(providers()).toContain(PaymentsService);
  });
  it('the factory with no PAYMENT_GATEWAY env yields the mock', () => {
    const gw = providers().find((p) => p && p.provide === PAYMENT_GATEWAY);
    const saved = { ...process.env };
    delete process.env.PAYMENT_GATEWAY;
    process.env.NODE_ENV = 'test';
    try { expect(gw.useFactory().provider).toBe('MOCK'); } finally { process.env = saved; }
  });
});
