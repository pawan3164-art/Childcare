export interface GatewayChargeInput {
  amountCents: number;
  reference: string;
  customerIp: string;
  cardToken: string;
  currency?: string;
}

export interface GatewayChargeResult {
  status: 'SUCCEEDED' | 'FAILED';
  providerPaymentId: string | null;
  message: string;
  card?: { brand: string; last4: string };
}

/** A gateway failure (network, timeout, HTTP error). The message never carries tokens, credentials or provider bodies. */
export class PaymentGatewayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentGatewayError';
  }
}

/**
 * The isolation boundary for card payments (ADR 0006): nothing else talks to a payment provider. The card number never
 * reaches us; the hosted fields on the client give a token, and only the token is charged.
 */
export interface PaymentGateway {
  readonly provider: 'MOCK' | 'FAT_ZEBRA';
  charge(input: GatewayChargeInput): Promise<GatewayChargeResult>;
  verifyWebhook(rawBody: string, headers: Record<string, string | undefined>): boolean;
}

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');
