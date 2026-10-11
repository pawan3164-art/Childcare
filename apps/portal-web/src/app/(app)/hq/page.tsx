'use client';

import { useCallback, useEffect, useState } from 'react';
import { Building2, Download } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { PageSpinner, ErrorBanner, EmptyState } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Occupancy {
  centres: {
    centreId: string;
    name: string;
    licensedCapacity: number | null;
    today: { date: string; signedInNow: number; attended: number; occupancyPercent: number | null };
    trend: { date: string; attended: number }[];
  }[];
  totals: { attended: number; licensedCapacity: number | null; signedInNow: number; occupancyPercent: number | null; trend: { date: string; attended: number }[] };
}

interface Row {
  invoicedCents: number;
  subsidyEstimatedCents: number;
  subsidyConfirmedCents: number;
  paymentsReceivedCents: number;
  creditsCents: number;
  outstandingCents: number;
  debtorCount: number;
  ageing: { current: number; days31to60: number; days61to90: number; over90: number };
}

interface Financials {
  period: { from: string; to: string };
  centres: (Row & { centreId: string; name: string })[];
  totals: Row;
}

const money = (cents: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);

/** A small bar chart of daily attendance; no chart library needed for one series. */
function Trend({ points, label }: { points: { date: string; attended: number }[]; label: string }) {
  const max = Math.max(1, ...points.map((p) => p.attended));
  const w = 6;
  return (
    <svg viewBox={`0 0 ${points.length * w} 24`} className="h-8 w-40" role="img" aria-label={label}>
      {points.map((p, i) => {
        const h = (p.attended / max) * 22;
        return <rect key={p.date} x={i * w + 1} y={24 - h} width={w - 2} height={h} className="fill-current text-primary" />;
      })}
    </svg>
  );
}

/** The all-centres view for organisation administrators and area managers: occupancy and money side by side, totals are the sum of the rows. */
export default function HqPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ORG_ADMIN' || user?.role === 'PLATFORM_ADMIN';
  const [occupancy, setOccupancy] = useState<Occupancy | null>(null);
  const [fin, setFin] = useState<Financials | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [capacity, setCapacity] = useState<Record<string, string>>({});

  const query = from && to ? `?from=${from}&to=${to}` : '';

  const load = useCallback(() => {
    Promise.all([api.get<Occupancy>('/hq/occupancy'), api.get<Financials>(`/hq/financials${query}`)])
      .then(([o, f]) => {
        setOccupancy(o);
        setFin(f);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the centres'));
  }, [query]);
  useEffect(load, [load]);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const csv = await api.getText(`/hq/financials.csv${query}`);
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `financial-overview-${fin?.period.from ?? 'month'}-to-${fin?.period.to ?? ''}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not export');
    } finally {
      setBusy(false);
    }
  }

  async function saveCapacity(centreId: string) {
    const raw = (capacity[centreId] ?? '').trim();
    setBusy(true);
    setError(null);
    try {
      await api.put(`/hq/centres/${centreId}/capacity`, { capacity: raw === '' ? null : Number(raw) });
      setCapacity((c) => {
        const { [centreId]: _gone, ...rest } = c;
        return rest;
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the capacity');
    } finally {
      setBusy(false);
    }
  }

  if (error && !occupancy) return <ErrorBanner message={error} />;
  if (!occupancy || !fin) return <PageSpinner />;
  if (occupancy.centres.length === 0) {
    return <EmptyState icon={<Building2 size={32} />} title="No centres to show" description="An organisation administrator can assign centres to you." />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">All centres</h1>
        <p className="text-sm text-muted">Counts and money for each centre you look after. Totals are the sum of the centres. No child details are shown here.</p>
      </div>
      {error && <ErrorBanner message={error} />}

      <Card>
        <CardHeader>
          <CardTitle>Occupancy today</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted">
                <th className="py-1 pr-3 font-medium">Centre</th>
                <th className="py-1 pr-3 font-medium">In now</th>
                <th className="py-1 pr-3 font-medium">Attended today</th>
                <th className="py-1 pr-3 font-medium">Capacity</th>
                <th className="py-1 pr-3 font-medium">Occupancy</th>
                <th className="py-1 font-medium">Last 14 days</th>
              </tr>
            </thead>
            <tbody>
              {occupancy.centres.map((c) => (
                <tr key={c.centreId} className="border-t border-border">
                  <td className="py-2 pr-3 font-medium text-foreground">{c.name}</td>
                  <td className="py-2 pr-3">{c.today.signedInNow}</td>
                  <td className="py-2 pr-3">{c.today.attended}</td>
                  <td className="py-2 pr-3">
                    {isAdmin ? (
                      <span className="flex items-center gap-1">
                        <Input
                          aria-label={`Licensed capacity for ${c.name}`}
                          className="h-8 w-20"
                          inputMode="numeric"
                          value={capacity[c.centreId] ?? (c.licensedCapacity?.toString() ?? '')}
                          onChange={(e) => setCapacity((m) => ({ ...m, [c.centreId]: e.target.value }))}
                        />
                        {capacity[c.centreId] !== undefined && (
                          <Button size="sm" variant="secondary" disabled={busy} onClick={() => saveCapacity(c.centreId)}>Save</Button>
                        )}
                      </span>
                    ) : (
                      (c.licensedCapacity ?? 'Not set')
                    )}
                  </td>
                  <td className="py-2 pr-3">{c.today.occupancyPercent === null ? '–' : `${c.today.occupancyPercent}%`}</td>
                  <td className="py-2"><Trend points={c.trend} label={`${c.name} attendance, last ${c.trend.length} days`} /></td>
                </tr>
              ))}
              <tr className="border-t border-border font-semibold text-foreground">
                <td className="py-2 pr-3">Total</td>
                <td className="py-2 pr-3">{occupancy.totals.signedInNow}</td>
                <td className="py-2 pr-3">{occupancy.totals.attended}</td>
                <td className="py-2 pr-3">{occupancy.totals.licensedCapacity ?? '–'}</td>
                <td className="py-2 pr-3">
                  {occupancy.totals.occupancyPercent === null ? '–' : `${occupancy.totals.occupancyPercent}%`}
                </td>
                <td className="py-2"><Trend points={occupancy.totals.trend} label="All centres attendance" /></td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Money, {fin.period.from} to {fin.period.to}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div><Label htmlFor="hq-from">From</Label><Input id="hq-from" type="date" value={from || fin.period.from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div><Label htmlFor="hq-to">To</Label><Input id="hq-to" type="date" value={to || fin.period.to} onChange={(e) => setTo(e.target.value)} /></div>
            <Button variant="secondary" disabled={busy} onClick={download}><Download size={16} className="mr-1" /> Download CSV</Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted">
                  {['Centre', 'Invoiced', 'Subsidy expected', 'Subsidy received', 'Payments', 'Outstanding', 'Debtors', 'Current', '31–60', '61–90', 'Over 90'].map((h) => (
                    <th key={h} className="py-1 pr-3 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...fin.centres.map((c) => ({ key: c.centreId, name: c.name, r: c as Row })), { key: 'total', name: 'Total', r: fin.totals }].map(({ key, name, r }) => (
                  <tr key={key} className={key === 'total' ? 'border-t border-border font-semibold text-foreground' : 'border-t border-border'}>
                    <td className="py-2 pr-3">{name}</td>
                    <td className="py-2 pr-3">{money(r.invoicedCents)}</td>
                    <td className="py-2 pr-3">{money(r.subsidyEstimatedCents)}</td>
                    <td className="py-2 pr-3">{money(r.subsidyConfirmedCents)}</td>
                    <td className="py-2 pr-3">{money(r.paymentsReceivedCents)}</td>
                    <td className="py-2 pr-3">{money(r.outstandingCents)}</td>
                    <td className="py-2 pr-3">{r.debtorCount}</td>
                    <td className="py-2 pr-3">{money(r.ageing.current)}</td>
                    <td className="py-2 pr-3">{money(r.ageing.days31to60)}</td>
                    <td className="py-2 pr-3">{money(r.ageing.days61to90)}</td>
                    <td className="py-2 pr-3">{money(r.ageing.over90)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">Outstanding is the balance still owed across all time; the other figures are for the dates above. Ageing counts the newest unpaid charges first. Outstanding already allows for subsidy that is still only estimated, so it can change when the subsidy is confirmed.</p>
        </CardContent>
      </Card>
    </div>
  );
}
