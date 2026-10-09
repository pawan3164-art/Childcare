import { formatCents, formatDeduction } from './format';
import type { LedgerBreakdown } from './types';

export interface BalanceSummary {
  headline: 'Amount due' | 'In credit' | 'All paid up';
  amountCents: number;
  tone: 'danger' | 'success' | 'neutral';
}

export function summariseBalance(l: LedgerBreakdown): BalanceSummary {
  if (l.balanceCents > 0) return { headline: 'Amount due', amountCents: l.balanceCents, tone: 'danger' };
  if (l.balanceCents < 0) return { headline: 'In credit', amountCents: -l.balanceCents, tone: 'success' };
  return { headline: 'All paid up', amountCents: 0, tone: 'neutral' };
}

export interface LedgerRow {
  key: 'fees' | 'subsidy' | 'payments' | 'credits' | 'adjustments';
  label: string;
  text: string;
}

/** The "how did we get this balance" lines: fees always, everything else only when non-zero. */
export function explainLedger(l: LedgerBreakdown): LedgerRow[] {
  const rows: LedgerRow[] = [{ key: 'fees', label: 'Fees', text: formatCents(l.grossCents) }];
  if (l.subsidyCents !== 0) rows.push({ key: 'subsidy', label: 'Government subsidy', text: formatDeduction(l.subsidyCents) });
  if (l.paymentsCents !== 0) rows.push({ key: 'payments', label: 'Payments received', text: formatDeduction(l.paymentsCents) });
  if (l.creditsCents !== 0) rows.push({ key: 'credits', label: 'Credits', text: formatDeduction(l.creditsCents) });
  if (l.adjustmentsCents !== 0) rows.push({ key: 'adjustments', label: 'Adjustments', text: formatCents(l.adjustmentsCents) });
  return rows;
}
