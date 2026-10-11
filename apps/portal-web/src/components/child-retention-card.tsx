'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Archive, Scale } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ErrorBanner } from '@/components/ui/misc';
import { formatDate } from '@/lib/format';

interface RetentionStatus {
  childId: string;
  departedOn: string | null;
  legalHold: boolean;
  legalHoldReason: string | null;
  anonymised: boolean;
}

/**
 * Centre admins only. Marking a child as departed starts the records-retention clock
 * (BRD v2.3 §36.3); a legal hold stops any purging. Records are never deleted from this
 * screen: deletion is a separate maintenance job and does not run for at least seven years.
 */
export function ChildRetentionCard({ childId }: { childId: string }) {
  const [status, setStatus] = useState<RetentionStatus | null>(null);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [departDate, setDepartDate] = useState('');
  const [reason, setReason] = useState('');

  const load = useCallback(() => {
    api
      .get<RetentionStatus>(`/children/${childId}/retention`)
      .then(setStatus)
      .catch((err) => {
        // Not an admin of this centre: the card simply is not shown.
        if (err instanceof ApiError && (err.status === 403 || err.status === 404)) setHidden(true);
        else setError(err instanceof ApiError ? err.message : 'Could not load retention status');
      });
  }, [childId]);

  useEffect(load, [load]);

  async function run(action: () => Promise<unknown>, failure: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setDepartDate('');
      setReason('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : failure);
    } finally {
      setBusy(false);
    }
  }

  if (hidden || !status) return error ? <ErrorBanner message={error} /> : null;

  function handleDepart(e: FormEvent) {
    e.preventDefault();
    run(() => api.post(`/children/${childId}/depart`, { date: departDate }), 'Could not record the departure');
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Records and retention</CardTitle>
        <div className="flex gap-2">
          {status.departedOn && <Badge tone="neutral">Departed {formatDate(status.departedOn)}</Badge>}
          {status.legalHold && <Badge tone="warning">Legal hold</Badge>}
          {status.anonymised && <Badge tone="neutral">Anonymised</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <ErrorBanner message={error} />}
        <p className="text-sm text-muted">
          Records are kept for at least seven years after a child leaves (incident records until age 25). Nothing is deleted from this screen.
        </p>

        {!status.departedOn && !status.anonymised && (
          <form onSubmit={handleDepart} className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="depart-date">Last day of attendance</Label>
              <Input id="depart-date" type="date" value={departDate} onChange={(e) => setDepartDate(e.target.value)} required />
            </div>
            <Button type="submit" variant="secondary" disabled={busy || !departDate}>
              <Archive size={16} /> Mark as departed
            </Button>
          </form>
        )}

        {status.departedOn && !status.anonymised && (
          <Button variant="secondary" disabled={busy} onClick={() => run(() => api.post(`/children/${childId}/reinstate`), 'Could not reinstate')}>
            Reinstate (child has not left)
          </Button>
        )}

        {status.legalHold ? (
          <div className="space-y-2">
            <p className="text-sm text-foreground">
              <Scale size={14} className="mr-1 inline" /> Held: {status.legalHoldReason}
            </p>
            <Button variant="secondary" disabled={busy} onClick={() => run(() => api.put(`/children/${childId}/legal-hold`, { hold: false }), 'Could not release the hold')}>
              Release legal hold
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-60 flex-1">
              <Label htmlFor="hold-reason">Legal hold reason (stops all purging)</Label>
              <Input id="hold-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: open complaint" />
            </div>
            <Button variant="secondary" disabled={busy || !reason.trim()} onClick={() => run(() => api.put(`/children/${childId}/legal-hold`, { hold: true, reason }), 'Could not place the hold')}>
              Place legal hold
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
