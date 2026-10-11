import { GatewayChargeInput, GatewayChargeResult, PaymentGateway } from './payment-gateway.interface';

/** The default gateway until a merchant account exists. Deterministic: tokens starting `tok_fail` decline, `tok_throw` throws. */
export class MockPaymentGateway implements PaymentGateway {
  readonly provider = 'MOCK' as const;

  async charge(input: GatewayChargeInput): Promise<GatewayChargeResult> {
    if (input.cardToken.startsWith('tok_throw')) throw new Error('mock gateway failure');
    if (input.cardToken.startsWith('tok_fail')) return { status: 'FAILED', providerPaymentId: null, message: 'Declined' };
    return { status: 'SUCCEEDED', providerPaymentId: `mock_${input.reference}`, message: 'Approved', card: { brand: 'VISA', last4: '4242' } };
  }

  verifyWebhook(_rawBody: string, headers: Record<string, string | undefined>): boolean {
    return headers['x-mock-signature'] === 'valid';
  }
}
