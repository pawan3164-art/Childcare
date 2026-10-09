import { summariseBalance, explainLedger } from '@/lib/ledger';
import type { LedgerBreakdown } from '@/lib/types';

const base: LedgerBreakdown = { grossCents: 0, subsidyCents: 0, paymentsCents: 0, adjustmentsCents: 0, creditsCents: 0, balanceCents: 0 };
const ledger = (o: Partial<LedgerBreakdown>): LedgerBreakdown => ({ ...base, ...o });

describe('summariseBalance', () => {
  it('amount due when balance is positive', () => {
    expect(summariseBalance(ledger({ balanceCents: 4500 }))).toEqual({ headline: 'Amount due', amountCents: 4500, tone: 'danger' });
  });
  it('in credit when balance is negative (amount is positive)', () => {
    expect(summariseBalance(ledger({ balanceCents: -2000 }))).toEqual({ headline: 'In credit', amountCents: 2000, tone: 'success' });
  });
  it('all paid up at zero', () => {
    expect(summariseBalance(ledger({}))).toEqual({ headline: 'All paid up', amountCents: 0, tone: 'neutral' });
  });
  it('one cent due', () => expect(summariseBalance(ledger({ balanceCents: 1 })).headline).toBe('Amount due'));
});

describe('explainLedger', () => {
  it('always includes fees, even when zero', () => {
    expect(explainLedger(ledger({}))).toEqual([{ key: 'fees', label: 'Fees', text: '$0.00' }]);
  });
  it('lists all rows in fixed order', () => {
    const rows = explainLedger(
      ledger({ grossCents: 100000, subsidyCents: 60000, paymentsCents: 20000, creditsCents: 1500, adjustmentsCents: 250, balanceCents: 18750 }),
    );
    expect(rows).toEqual([
      { key: 'fees', label: 'Fees', text: '$1,000.00' },
      { key: 'subsidy', label: 'Government subsidy', text: '−$600.00' },
      { key: 'payments', label: 'Payments received', text: '−$200.00' },
      { key: 'credits', label: 'Credits', text: '−$15.00' },
      { key: 'adjustments', label: 'Adjustments', text: '$2.50' },
    ]);
  });
  it('omits zero rows', () => {
    const rows = explainLedger(ledger({ grossCents: 5000, paymentsCents: 5000 }));
    expect(rows.map((r) => r.key)).toEqual(['fees', 'payments']);
  });
  it('shows a negative adjustment with formatCents', () => {
    const rows = explainLedger(ledger({ grossCents: 5000, adjustmentsCents: -300 }));
    expect(rows.find((r) => r.key === 'adjustments')).toEqual({ key: 'adjustments', label: 'Adjustments', text: '-$3.00' });
  });
  it('keeps order when only later rows exist', () => {
    const rows = explainLedger(ledger({ creditsCents: 100, subsidyCents: 200 }));
    expect(rows.map((r) => r.key)).toEqual(['fees', 'subsidy', 'credits']);
  });
});
