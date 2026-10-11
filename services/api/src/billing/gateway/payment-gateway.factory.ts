import { FatZebraGateway } from './fat-zebra.gateway';
import { MockPaymentGateway } from './mock-payment.gateway';
import { PaymentGateway } from './payment-gateway.interface';

type Env = Record<string, string | undefined>;

/** Credentials are sent with every request, so the address must be https. A trailing slash is dropped. */
function httpsUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('FAT_ZEBRA_BASE_URL must be a valid https URL');
  }
  if (url.protocol !== 'https:') throw new Error('FAT_ZEBRA_BASE_URL must be a valid https URL');
  return value.replace(/\/+$/, '');
}

/** Chooses the gateway from configuration. The mock is the default, and is refused in production unless explicitly allowed. */
export function createPaymentGateway(env: Env): PaymentGateway {
  const choice = (env.PAYMENT_GATEWAY ?? 'mock').toLowerCase();
  if (choice === 'mock') {
    // Fail closed: the mock approves almost any token and credits real ledgers, so it only runs where it is explicitly
    // safe (test, development) or explicitly allowed (a demo). An unset or mistyped NODE_ENV never enables it.
    const safe = env.NODE_ENV === 'test' || env.NODE_ENV === 'development' || env.ALLOW_MOCK_PAYMENTS === 'true';
    if (!safe) {
      throw new Error('The mock payment gateway is not allowed here (set PAYMENT_GATEWAY=fatzebra, or ALLOW_MOCK_PAYMENTS=true for a demo)');
    }
    return new MockPaymentGateway();
  }
  if (choice === 'fatzebra') {
    const need = (name: string): string => {
      const v = env[name];
      if (!v) throw new Error(`${name} is required when PAYMENT_GATEWAY=fatzebra`);
      return v;
    };
    return new FatZebraGateway({
      baseUrl: httpsUrl(need('FAT_ZEBRA_BASE_URL')),
      username: need('FAT_ZEBRA_USERNAME'),
      token: need('FAT_ZEBRA_TOKEN'),
      webhookSecret: need('FAT_ZEBRA_WEBHOOK_SECRET'),
    });
  }
  throw new Error('PAYMENT_GATEWAY must be "mock" or "fatzebra"');
}
