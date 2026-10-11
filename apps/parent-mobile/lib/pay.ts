import { formatCents } from './format';

export interface PaymentConfig {
  provider: 'MOCK' | 'FAT_ZEBRA';
  mode: 'mock' | 'live';
}

export interface CardPaymentResult {
  status: 'SUCCEEDED' | 'FAILED';
  paymentId: string | null;
  amountCents: number;
  card?: { brand: string; last4: string };
  message?: string;
}

export interface PayOption {
  kind: 'demo';
  amountCents: number;
  label: string;
}

/** The server refuses a single card payment above this. */
export const MAX_PAYMENT_CENTS = 1_000_000;

/**
 * What the Bills screen can offer. Only the demo payment exists: real card entry needs the gateway's hosted fields, which
 * wait for a merchant account (ADR 0006), so live mode offers nothing yet.
 */
export function payOption(config: PaymentConfig | null, balanceCents: number): PayOption | null {
  if (!config || config.mode !== 'mock' || balanceCents <= 0) return null;
  const amountCents = Math.min(balanceCents, MAX_PAYMENT_CENTS);
  return { kind: 'demo', amountCents, label: `Pay ${formatCents(amountCents)} (demo, no real money)` };
}

/** One per attempt; sending the same key again is safe, a new key is a new payment. */
export function newIdempotencyKey(): string {
  const part = () => Math.random().toString(36).slice(2, 12);
  return `pay-${Date.now().toString(36)}-${part()}${part()}`;
}

export function resultMessage(r: CardPaymentResult): string {
  if (r.status === 'SUCCEEDED') {
    return `Payment of ${formatCents(r.amountCents)} received${r.card ? ` (${r.card.brand} ending ${r.card.last4})` : ''}.`;
  }
  return `The payment was declined${r.message ? ` (${r.message})` : ''}. Nothing was charged.`;
}
