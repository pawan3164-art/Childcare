import { createPaymentGateway } from '../../src/billing/gateway/payment-gateway.factory';
import { MockPaymentGateway } from '../../src/billing/gateway/mock-payment.gateway';
import { FatZebraGateway } from '../../src/billing/gateway/fat-zebra.gateway';

const FZ = { PAYMENT_GATEWAY: 'fatzebra', FAT_ZEBRA_BASE_URL: 'https://gateway.pmnts-sandbox.io/v1.0', FAT_ZEBRA_USERNAME: 'u-secret-name', FAT_ZEBRA_TOKEN: 't-secret-token', FAT_ZEBRA_WEBHOOK_SECRET: 'w-secret' };

describe('createPaymentGateway', () => {
  it('defaults to the mock when PAYMENT_GATEWAY is undefined, in test and development', () => {
    expect(createPaymentGateway({ NODE_ENV: 'test' })).toBeInstanceOf(MockPaymentGateway);
    expect(createPaymentGateway({ NODE_ENV: 'development' })).toBeInstanceOf(MockPaymentGateway);
  });
  it('mock gives the mock', () => expect(createPaymentGateway({ PAYMENT_GATEWAY: 'mock', NODE_ENV: 'test' })).toBeInstanceOf(MockPaymentGateway));

  it('fails closed: the mock is refused unless NODE_ENV is test or development, or ALLOW_MOCK_PAYMENTS=true', () => {
    for (const NODE_ENV of [undefined, '', 'prod', 'staging', 'production']) {
      expect(() => createPaymentGateway({ NODE_ENV })).toThrow();
      expect(() => createPaymentGateway({ NODE_ENV, PAYMENT_GATEWAY: 'mock' })).toThrow();
    }
    expect(createPaymentGateway({ NODE_ENV: 'staging', ALLOW_MOCK_PAYMENTS: 'true' })).toBeInstanceOf(MockPaymentGateway);
    expect(createPaymentGateway({ ALLOW_MOCK_PAYMENTS: 'true' })).toBeInstanceOf(MockPaymentGateway);
  });

  it.each(['http://gateway.pmnts-sandbox.io/v1.0', 'ftp://x', 'not a url', ''])('refuses a FAT_ZEBRA_BASE_URL that is not https (%s)', (url) => {
    expect(() => createPaymentGateway({ ...FZ, FAT_ZEBRA_BASE_URL: url })).toThrow();
  });
  it('strips a trailing slash from the base URL', async () => {
    const g: any = createPaymentGateway({ ...FZ, FAT_ZEBRA_BASE_URL: 'https://gateway.pmnts-sandbox.io/v1.0/' });
    expect(g.config.baseUrl).toBe('https://gateway.pmnts-sandbox.io/v1.0');
  });
  it('fatzebra gives FatZebraGateway', () => {
    const g = createPaymentGateway(FZ);
    expect(g).toBeInstanceOf(FatZebraGateway);
    expect(g.provider).toBe('FAT_ZEBRA');
  });

  it.each(['FAT_ZEBRA_BASE_URL', 'FAT_ZEBRA_USERNAME', 'FAT_ZEBRA_TOKEN', 'FAT_ZEBRA_WEBHOOK_SECRET'])('missing %s throws naming the variable, without printing values', (name) => {
    const env: Record<string, string | undefined> = { ...FZ };
    delete env[name];
    let msg = '';
    try { createPaymentGateway(env); } catch (e) { msg = (e as Error).message; }
    expect(msg).toContain(name);
    for (const v of Object.values(FZ)) if (v !== 'fatzebra') expect(msg).not.toContain(v);
  });

  it('an unknown value throws', () => expect(() => createPaymentGateway({ PAYMENT_GATEWAY: 'stripe' })).toThrow());

  it('refuses the mock in production unless ALLOW_MOCK_PAYMENTS=true', () => {
    expect(() => createPaymentGateway({ NODE_ENV: 'production' })).toThrow();
    expect(() => createPaymentGateway({ NODE_ENV: 'production', PAYMENT_GATEWAY: 'mock' })).toThrow();
    expect(() => createPaymentGateway({ NODE_ENV: 'production', ALLOW_MOCK_PAYMENTS: 'false' })).toThrow();
    expect(createPaymentGateway({ NODE_ENV: 'production', ALLOW_MOCK_PAYMENTS: 'true' })).toBeInstanceOf(MockPaymentGateway);
  });
  it('production with the real gateway is fine', () => expect(createPaymentGateway({ ...FZ, NODE_ENV: 'production' })).toBeInstanceOf(FatZebraGateway));
});
