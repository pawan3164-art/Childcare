'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError } from '@/lib/api-client';
import { PageSpinner, ErrorBanner } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCents } from '@/lib/format';
import type { LedgerBreakdown } from '@/lib/types';

const ADMIN_ROLES = ['CENTRE_ADMIN', 'ORG_ADMIN', 'PLATFORM_ADMIN'];

export default function ChildBillingPage() {
  const params = useParams<{ childId: string }>();
  const { user } = useAuth();
  const childId = params.childId;
  const isAdmin = user ? ADMIN_ROLES.includes(user.role) : false;

  const [ledger, setLedger] = useState<LedgerBreakdown | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [cycleStart, setCycleStart] = useState('');
  const [cycleEnd, setCycleEnd] = useState('');
  const [invoiceResult, setInvoiceResult] = useState<string | null>(null);
  const [invoicing, setInvoicing] = useState(false);

  const [paymentAmount, setPaymentAmount] = useState('');
  const [payingMethod, setPayingMethod] = useState('bank_transfer');
  const [paying, setPaying] = useState(false);
  const [paymentResult, setPaymentResult] = useState<string | null>(null);

  function loadLedger() {
    api
      .get<LedgerBreakdown>(`/children/${childId}/ledger`)
      .then(setLedger)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Unable to load billing'));
  }

  useEffect(loadLedger, [childId]);

  async function handleGenerateInvoice(e: FormEvent) {
    e.preventDefault();
    setInvoicing(true);
    setInvoiceResult(null);
    setError(null);
    try {
      const result = await api.post<{ grossCents: number; estimatedSubsidyCents: number; gapCents: number; sessionCount: number }>(
        '/invoices',
        { childId, cycleStart, cycleEnd },
      );
      setInvoiceResult(
        `Generated invoice for ${result.sessionCount} session(s): ${formatCents(result.grossCents)} gross, ${formatCents(result.estimatedSubsidyCents)} estimated subsidy, ${formatCents(result.gapCents)} gap.`,
      );
      loadLedger();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to generate invoice');
    } finally {
      setInvoicing(false);
    }
  }

  async function handleRecordPayment(e: FormEvent) {
    e.preventDefault();
    setPaying(true);
    setPaymentResult(null);
    setError(null);
    try {
      const amountCents = Math.round(parseFloat(paymentAmount) * 100);
      await api.post('/payments/manual', { childId, amountCents, method: payingMethod });
      setPaymentResult(`Recorded payment of ${formatCents(amountCents)}.`);
      setPaymentAmount('');
      loadLedger();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to record payment');
    } finally {
      setPaying(false);
    }
  }

  return (
    <div className="space-y-6">
      <Link href="/billing" className="flex items-center gap-1.5 text-sm text-muted hover:text-foreground">
        <ArrowLeft size={14} /> Back to billing
      </Link>

      <h1 className="text-2xl font-semibold text-foreground">Family ledger</h1>

      {error && <ErrorBanner message={error} />}

      <Card>
        <CardHeader>
          <CardTitle>Explainable balance</CardTitle>
        </CardHeader>
        <CardContent>
          {!ledger ? (
            <PageSpinner />
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
              <LedgerStat label="Gross fees" value={formatCents(ledger.grossCents)} />
              <LedgerStat label="Subsidy" value={`- ${formatCents(ledger.subsidyCents)}`} />
              <LedgerStat label="Payments" value={`- ${formatCents(ledger.paymentsCents)}`} />
              <LedgerStat label="Credits" value={`- ${formatCents(ledger.creditsCents)}`} />
              <LedgerStat
                label="Balance"
                value={formatCents(ledger.balanceCents)}
                tone={ledger.balanceCents > 0 ? 'danger' : 'success'}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {isAdmin && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Generate invoice</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleGenerateInvoice} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="cycleStart">Cycle start</Label>
                    <Input id="cycleStart" type="date" value={cycleStart} onChange={(e) => setCycleStart(e.target.value)} required />
                  </div>
                  <div>
                    <Label htmlFor="cycleEnd">Cycle end</Label>
                    <Input id="cycleEnd" type="date" value={cycleEnd} onChange={(e) => setCycleEnd(e.target.value)} required />
                  </div>
                </div>
                <Button type="submit" disabled={invoicing}>
                  {invoicing ? 'Generating…' : 'Generate invoice'}
                </Button>
                {invoiceResult && <p className="text-sm text-success">{invoiceResult}</p>}
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Record manual payment</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleRecordPayment} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="amount">Amount (AUD)</Label>
                    <Input
                      id="amount"
                      type="number"
                      step="0.01"
                      min="0"
                      value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="method">Method</Label>
                    <select
                      id="method"
                      value={payingMethod}
                      onChange={(e) => setPayingMethod(e.target.value)}
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <option value="bank_transfer">Bank transfer</option>
                      <option value="cash">Cash</option>
                    </select>
                  </div>
                </div>
                <Button type="submit" disabled={paying}>
                  {paying ? 'Recording…' : 'Record payment'}
                </Button>
                {paymentResult && <p className="text-sm text-success">{paymentResult}</p>}
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function LedgerStat({ label, value, tone }: { label: string; value: string; tone?: 'danger' | 'success' }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className={`text-lg font-semibold ${tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-success' : 'text-foreground'}`}>
        {value}
      </p>
    </div>
  );
}
