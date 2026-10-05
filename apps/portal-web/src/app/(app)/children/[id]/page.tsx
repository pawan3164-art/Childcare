'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Receipt } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { PageSpinner, ErrorBanner, Avatar } from '@/components/ui/misc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ChildGlanceCard } from '@/components/child-glance-card';
import { ChildTimeline } from '@/components/child-timeline';
import { ChildFeed } from '@/components/child-feed';
import type { LedgerBreakdown } from '@/lib/types';
import { formatCents, formatDateTime, formatDeduction, initials } from '@/lib/format';

interface AttendanceEvent {
  id: string;
  eventType: 'SIGN_IN' | 'SIGN_OUT';
  timestamp: string;
  method: string;
  isCorrection: boolean;
}

export default function ChildDetailPage() {
  const params = useParams<{ id: string }>();
  const childId = params.id;

  const [attendance, setAttendance] = useState<AttendanceEvent[] | null>(null);
  const [ledger, setLedger] = useState<LedgerBreakdown | null>(null);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<AttendanceEvent[]>(`/children/${childId}/attendance`)
      .then(setAttendance)
      .catch((err) => setError(err.message));

    api
      .get<LedgerBreakdown>(`/children/${childId}/ledger`)
      .then(setLedger)
      .catch((err) => setLedgerError(err instanceof ApiError ? err.message : 'Unable to load billing'));
  }, [childId]);

  if (error) return <ErrorBanner message={error} />;

  return (
    <div className="space-y-6">
      <Link href="/children" className="flex items-center gap-1.5 text-sm text-muted hover:text-foreground">
        <ArrowLeft size={14} /> Back to children
      </Link>
      <div className="flex justify-end">
        <Link href={`/children/${childId}/portfolio`} className="text-sm font-medium text-primary hover:underline">
          Learning portfolio →
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChildGlanceCard childId={childId} />

        <Card>
          <CardHeader>
            <CardTitle>Billing</CardTitle>
            <Link href={`/billing/${childId}`} className="flex items-center gap-1 text-sm text-primary hover:underline">
              <Receipt size={14} /> Full ledger
            </Link>
          </CardHeader>
          <CardContent>
            {ledgerError && <p className="text-sm text-muted">{ledgerError}</p>}
            {!ledgerError && !ledger && <p className="text-sm text-muted">Loading…</p>}
            {ledger && (
              <div className="space-y-2 text-sm">
                <Row label="Gross fees" value={formatCents(ledger.grossCents)} />
                <Row label="Subsidy" value={formatDeduction(ledger.subsidyCents)} muted />
                <Row label="Payments" value={formatDeduction(ledger.paymentsCents)} muted />
                <div className="border-t border-border pt-2">
                  <Row
                    label="Balance"
                    value={formatCents(ledger.balanceCents)}
                    strong
                    tone={ledger.balanceCents > 0 ? 'danger' : 'success'}
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChildTimeline childId={childId} />
        <ChildFeed childId={childId} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Attendance history</CardTitle>
        </CardHeader>
        <CardContent>
          {!attendance ? (
            <PageSpinner />
          ) : attendance.length === 0 ? (
            <p className="text-sm text-muted">No attendance events recorded yet.</p>
          ) : (
            <div className="space-y-2">
              {[...attendance].reverse().map((event) => (
                <div key={event.id} className="flex items-center gap-3 border-b border-border py-2 text-sm last:border-0">
                  <Avatar initials={event.eventType === 'SIGN_IN' ? 'IN' : 'OUT'} />
                  <div className="flex-1">
                    <p className="font-medium text-foreground">
                      {event.eventType === 'SIGN_IN' ? 'Signed in' : 'Signed out'} via {event.method.toLowerCase()}
                    </p>
                    <p className="text-xs text-muted">{formatDateTime(event.timestamp)}</p>
                  </div>
                  {event.isCorrection && <Badge tone="info">Correction</Badge>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({
  label,
  value,
  muted,
  strong,
  tone,
}: {
  label: string;
  value: string;
  muted?: boolean;
  strong?: boolean;
  tone?: 'danger' | 'success';
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={muted ? 'text-muted' : 'text-foreground'}>{label}</span>
      <span
        className={
          strong
            ? `font-semibold ${tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-success' : 'text-foreground'}`
            : muted
              ? 'text-muted'
              : 'text-foreground'
        }
      >
        {value}
      </span>
    </div>
  );
}
