'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, LogIn, LogOut, NotebookPen, Camera, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageSpinner, ErrorBanner } from '@/components/ui/misc';
import { formatTime } from '@/lib/format';
import { describeCareRecord } from '@/lib/care-labels';
import type { TimelineEntry } from '@/lib/types';

function shiftDay(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** U1 parent daily timeline: sign-in/out, care records and photos for one day, oldest first. */
export function ChildTimeline({ childId }: { childId: string }) {
  // `requested` is the day the user navigated to; undefined means the centre's today.
  const [requested, setRequested] = useState<string | undefined>(undefined);
  const [today, setToday] = useState<string | null>(null);
  const [entries, setEntries] = useState<TimelineEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const date = requested ?? today;

  useEffect(() => {
    setEntries(null);
    api
      .get<{ date: string; entries: TimelineEntry[] }>(`/children/${childId}/timeline${requested ? `?date=${requested}` : ''}`)
      .then((r) => {
        setEntries(r.entries);
        if (!requested) setToday(r.date);
      })
      .catch((err) => setError(err.message));
  }, [childId, requested]);

  const setDate = (d: string) => setRequested(d === today ? undefined : d);

  const label =
    date === today
      ? 'Today'
      : date
        ? new Date(`${date}T12:00:00Z`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
        : '';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Daily timeline</CardTitle>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => date && setDate(shiftDay(date, -1))} aria-label="Previous day" disabled={!date}>
            <ChevronLeft size={16} />
          </Button>
          <span className="min-w-24 text-center text-sm font-medium text-foreground">{label}</span>
          <Button variant="ghost" size="sm" onClick={() => date && setDate(shiftDay(date, 1))} aria-label="Next day" disabled={!date || date === today}>
            <ChevronRight size={16} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error && <ErrorBanner message={error} />}
        {!error && !entries && <PageSpinner />}
        {entries?.length === 0 && <p className="text-sm text-muted">Nothing recorded for this day yet.</p>}
        {entries && entries.length > 0 && (
          <ol className="relative ml-3 space-y-4 border-l border-border pl-6">
            {entries.map((e) => (
              <li key={`${e.kind}-${e.id}`} className="relative">
                <span className="absolute -left-[2.25rem] flex h-6 w-6 items-center justify-center rounded-full border border-border bg-surface text-muted">
                  <EntryIcon entry={e} />
                </span>
                <p className="text-xs text-muted">{formatTime(e.at)}</p>
                <EntryBody entry={e} />
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function EntryIcon({ entry }: { entry: TimelineEntry }) {
  if (entry.kind === 'ATTENDANCE') return entry.eventType === 'SIGN_IN' ? <LogIn size={12} /> : <LogOut size={12} />;
  if (entry.kind === 'PHOTO_POST') return <Camera size={12} />;
  if (entry.details?.flagged) return <AlertTriangle size={12} className="text-warning" />;
  return <NotebookPen size={12} />;
}

function EntryBody({ entry }: { entry: TimelineEntry }) {
  if (entry.kind === 'ATTENDANCE') {
    return <p className="text-sm font-medium text-foreground">{entry.eventType === 'SIGN_IN' ? 'Signed in' : 'Signed out'}</p>;
  }
  if (entry.kind === 'CARE_RECORD') {
    return (
      <div>
        <p className="text-sm font-medium text-foreground">{describeCareRecord(entry.type, entry.details)}</p>
        {entry.note && <p className="text-sm text-muted">{entry.note}</p>}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {entry.caption && <p className="text-sm text-foreground">{entry.caption}</p>}
      <PhotoGrid media={entry.media} />
    </div>
  );
}

export function PhotoGrid({ media }: { media: { id: string; url: string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {media.map((m, i) => (
        <a key={m.id} href={m.url} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded-lg bg-muted-surface">
          {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not optimisable */}
          <img src={m.url} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" loading="lazy" />
        </a>
      ))}
    </div>
  );
}
