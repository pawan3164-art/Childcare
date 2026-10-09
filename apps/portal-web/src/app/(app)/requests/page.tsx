'use client';

import { useEffect, useState } from 'react';
import { CalendarPlus, CalendarX } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { PageSpinner, ErrorBanner, EmptyState } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { AbsenceView, CasualDayRequestView } from '@/lib/types';

type ChildRef = { id: string; firstName: string; lastName: string };
type PendingRequest = CasualDayRequestView & { child: ChildRef; roomName: string | null };
type AbsenceRow = AbsenceView & { child: ChildRef };

function longDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** Admin inbox for what families have asked for: extra days to approve, absences to confirm. */
export default function RequestsPage() {
  const [pending, setPending] = useState<PendingRequest[] | null>(null);
  const [absences, setAbsences] = useState<AbsenceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  function load() {
    api.get<PendingRequest[]>('/casual-day-requests').then(setPending).catch((e) => setError(e.message));
    api.get<AbsenceRow[]>('/absences').then(setAbsences).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function run(id: string, action: () => Promise<unknown>, failure: string) {
    setBusy(id);
    setError(null);
    try {
      await action();
      setDeclining(null);
      setReason('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : failure);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Family requests</h1>
        <p className="text-sm text-muted">Extra days families have asked for, and absences they have reported.</p>
      </div>

      {error && <ErrorBanner message={error} />}

      <Card>
        <CardHeader>
          <CardTitle>Extra days waiting for a decision</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!pending && <PageSpinner />}
          {pending?.length === 0 && <EmptyState icon={<CalendarPlus size={28} />} title="No requests waiting" />}
          {pending?.map((r) => (
            <div key={r.id} className="rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-foreground">
                    {r.child.firstName} {r.child.lastName} · {longDate(r.date)}
                    {r.roomName && <span className="ml-2 text-sm font-normal text-muted">{r.roomName}</span>}
                  </p>
                  {r.note && <p className="text-sm text-muted">{r.note}</p>}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={busy === r.id}
                    onClick={() => run(r.id, () => api.post(`/casual-day-requests/${r.id}/approve`, {}), 'Could not approve')}
                  >
                    Approve
                  </Button>
                  <Button size="sm" variant="secondary" disabled={busy === r.id} onClick={() => setDeclining(declining === r.id ? null : r.id)}>
                    Decline
                  </Button>
                </div>
              </div>
              {declining === r.id && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Input
                    className="flex-1"
                    placeholder="Reason shown to the family (optional)"
                    maxLength={500}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={busy === r.id}
                    onClick={() => run(r.id, () => api.post(`/casual-day-requests/${r.id}/decline`, { reason }), 'Could not decline')}
                  >
                    Confirm decline
                  </Button>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Absences, next 30 days</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!absences && <PageSpinner />}
          {absences?.length === 0 && <EmptyState icon={<CalendarX size={28} />} title="No absences reported" />}
          {absences?.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4">
              <div>
                <p className="font-medium text-foreground">
                  {a.child.firstName} {a.child.lastName} · {longDate(a.date)}
                </p>
                <p className="text-sm text-muted">{a.reason ?? 'No reason given'}</p>
              </div>
              <div className="flex items-center gap-3">
                {a.isAllowable ? <Badge tone="success">No fee</Badge> : <Badge tone="warning">Fee applies</Badge>}
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy === a.id}
                  onClick={() => run(a.id, () => api.patch(`/absences/${a.id}`, { isAllowable: !a.isAllowable }), 'Could not update the absence')}
                >
                  {a.isAllowable ? 'Charge fee' : 'Confirm, no fee'}
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
