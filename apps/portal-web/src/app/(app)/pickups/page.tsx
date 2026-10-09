'use client';

import { useEffect, useState } from 'react';
import { UserCheck, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { PageSpinner, ErrorBanner, EmptyState } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { PickupNominationView } from '@/lib/types';

type Row = PickupNominationView & { child: { id: string; firstName: string; lastName: string }; roomName: string | null };

/** The centre's today as YYYY-MM-DD in the browser's locale-independent form (the server decides what "today" means when no date is sent). */
export default function PickupsPage() {
  const [date, setDate] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function load(d: string | null) {
    setRows(null);
    setError(null);
    api
      .get<Row[]>(`/pickup-nominations${d ? `?date=${d}` : ''}`)
      .then(setRows)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load pickups'));
  }

  useEffect(() => load(date), [date]);

  async function verify(id: string) {
    setBusy(id);
    setError(null);
    try {
      await api.post(`/pickup-nominations/${id}/verify`);
      load(date);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record the check');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Nominated pickups</h1>
          <p className="text-sm text-muted">
            Someone other than the usual guardians is collecting. Check who they are before the child leaves, then record the check.
          </p>
        </div>
        <div>
          <Label htmlFor="pickup-date">Day</Label>
          <Input id="pickup-date" type="date" value={date ?? ''} onChange={(e) => setDate(e.target.value || null)} />
        </div>
      </div>

      {error && <ErrorBanner message={error} />}
      {!rows && !error && <PageSpinner />}
      {rows?.length === 0 && (
        <Card>
          <CardContent>
            <EmptyState icon={<UserCheck size={28} />} title="No nominated pickups" description="Nothing to check for this day." />
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {rows?.map((r) => (
          <Card key={r.id}>
            <CardContent className="flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1">
                <p className="font-medium text-foreground">
                  {r.child.firstName} {r.child.lastName}
                  {r.roomName && <span className="ml-2 text-sm font-normal text-muted">{r.roomName}</span>}
                </p>
                <p className="text-sm text-foreground">
                  Collected by <strong>{r.personName}</strong>
                  {r.personPhone && <span className="text-muted"> · {r.personPhone}</span>}
                </p>
                {r.note && <p className="text-sm text-muted">{r.note}</p>}
              </div>
              {r.verified ? (
                <Badge tone="success">
                  <ShieldCheck size={14} /> Checked
                </Badge>
              ) : (
                <Button onClick={() => verify(r.id)} disabled={busy === r.id}>
                  {busy === r.id ? 'Saving…' : 'I checked their ID'}
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
