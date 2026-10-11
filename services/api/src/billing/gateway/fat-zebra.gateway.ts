import { createHmac, timingSafeEqual } from 'crypto';
import { GatewayChargeInput, GatewayChargeResult, PaymentGateway, PaymentGatewayError } from './payment-gateway.interface';

export interface FatZebraConfig {
  baseUrl: string;
  username: string;
  token: string;
  webhookSecret: string;
  fetchImpl?: typeof fetch;
}

const TIMEOUT_MS = 10_000;

interface PurchaseBody {
  successful?: boolean;
  response?: { id?: string; successful?: boolean; message?: string; card_number?: string; card_type?: string };
  errors?: unknown[];
}

/**
 * Fat Zebra adapter (ADR 0006). Built from the published API documentation (POST /purchases with a card token, HTTP Basic
 * auth) and NOT verified against a real sandbox: no merchant account exists yet. The webhook signing scheme below is an
 * assumption to confirm at onboarding. Errors never include the token, credentials or the provider's response body.
 */
export class FatZebraGateway implements PaymentGateway {
  readonly provider = 'FAT_ZEBRA' as const;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: FatZebraConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async charge(input: GatewayChargeInput): Promise<GatewayChargeResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.config.baseUrl}/purchases`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.token}`).toString('base64')}`,
        },
        body: JSON.stringify({
          amount: input.amountCents,
          reference: input.reference,
          customer_ip: input.customerIp,
          currency: input.currency ?? 'AUD',
          card_token: input.cardToken,
        }),
        signal: controller.signal,
        // A redirect would replay the request, token included, to another address.
        redirect: 'error',
      });
    } catch {
      throw new PaymentGatewayError('The payment gateway could not be reached');
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new PaymentGatewayError(`The payment gateway refused the request (HTTP ${res.status})`);

    let body: PurchaseBody;
    try {
      body = (await res.json()) as PurchaseBody;
    } catch {
      throw new PaymentGatewayError('The payment gateway sent an unreadable response');
    }
    const inner = body.response;
    if (body.successful === false) {
      return { status: 'FAILED', providerPaymentId: null, message: typeof body.errors?.[0] === 'string' ? (body.errors[0] as string) : 'Declined' };
    }
    if (!inner || inner.successful !== true || !inner.id) {
      return { status: 'FAILED', providerPaymentId: null, message: inner?.message || 'Declined' };
    }
    return {
      status: 'SUCCEEDED',
      providerPaymentId: inner.id,
      message: inner.message ?? 'Approved',
      card: inner.card_type && inner.card_number ? { brand: inner.card_type, last4: inner.card_number.slice(-4) } : undefined,
    };
  }

  verifyWebhook(rawBody: string, headers: Record<string, string | undefined>): boolean {
    const given = headers['x-fz-signature'];
    if (!this.config.webhookSecret || !given) return false;
    const expected = createHmac('sha256', this.config.webhookSecret).update(rawBody).digest('hex');
    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
