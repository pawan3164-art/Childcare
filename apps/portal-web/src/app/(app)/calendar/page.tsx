'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CalendarDays } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { PageSpinner, ErrorBanner, EmptyState } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface EventRow {
  id: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  cancelledAt: string | null;
  cancelReason: string | null;
}

const ADMIN_ROLES = ['CENTRE_ADMIN', 'ORG_ADMIN', 'PLATFORM_ADMIN'];

function when(e: EventRow): string {
  const day = new Date(e.startsAt).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
  if (e.allDay) return `${day} · All day`;
  const time = (iso: string) => new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
  return `${day} · ${time(e.startsAt)}${e.endsAt ? ` – ${time(e.endsAt)}` : ''}`;
}

/** The centre calendar: administrators add and cancel events; everyone at the centre can read it. Cancelled events stay listed. */
export default function CalendarPage() {
  const { user } = useAuth();
  const canEdit = !!user && ADMIN_ROLES.includes(user.role);
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [allDay, setAllDay] = useState(false);
  const [starts, setStarts] = useState('');
  const [ends, setEnds] = useState('');

  const load = useCallback(() => {
    api
      .get<EventRow[]>('/calendar/events')
      .then(setEvents)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the calendar'));
  }, []);
  useEffect(load, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/calendar/events', {
        title,
        description: description || undefined,
        allDay,
        startsAt: new Date(allDay ? `${starts.slice(0, 10)}T00:00` : starts).toISOString(),
        endsAt: ends && !allDay ? new Date(ends).toISOString() : undefined,
      });
      setTitle('');
      setDescription('');
      setStarts('');
      setEnds('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add the event');
    } finally {
      setBusy(false);
    }
  }

  async function cancel(ev: EventRow) {
    const reason = window.prompt(`Why is "${ev.title}" being cancelled? Families will see this.`);
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/calendar/events/${ev.id}/cancel`, { reason });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not cancel the event');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Calendar</h1>
        <p className="text-sm text-muted">The next two months at the centre. Families see these in their app.</p>
      </div>
      {error && <ErrorBanner message={error} />}

      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle>Add an event</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={add} className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2"><Label htmlFor="ev-title">Title</Label><Input id="ev-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required /></div>
              <div>
                <Label htmlFor="ev-start">{allDay ? 'Date' : 'Starts'}</Label>
                <Input id="ev-start" type={allDay ? 'date' : 'datetime-local'} value={allDay ? starts.slice(0, 10) : starts} onChange={(e) => setStarts(e.target.value)} required />
              </div>
              {!allDay && <div><Label htmlFor="ev-end">Ends (optional)</Label><Input id="ev-end" type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} /></div>}
              <div className="sm:col-span-2"><Label htmlFor="ev-desc">Details (optional)</Label><Input id="ev-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} /></div>
              <label className="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" checked={allDay} onChange={(e) => { setAllDay(e.target.checked); setStarts(''); }} /> All day</label>
              <div className="sm:col-span-2"><Button type="submit" disabled={busy || !title.trim() || !starts}>Add event</Button></div>
            </form>
          </CardContent>
        </Card>
      )}

      {!events ? (
        <PageSpinner />
      ) : events.length === 0 ? (
        <EmptyState icon={<CalendarDays size={32} />} title="Nothing coming up" description="Events you add will appear here and in the family app." />
      ) : (
        <div className="space-y-2">
          {events.map((ev) => (
            <Card key={ev.id}>
              <CardContent className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div>
                  <p className={ev.cancelledAt ? 'font-medium text-muted line-through' : 'font-medium text-foreground'}>{ev.title}</p>
                  <p className="text-xs text-muted">{when(ev)}</p>
                  {ev.description && !ev.cancelledAt && <p className="text-sm text-muted">{ev.description}</p>}
                  {ev.cancelledAt && ev.cancelReason && <p className="text-sm text-muted">Cancelled: {ev.cancelReason}</p>}
                </div>
                <div className="flex items-center gap-2">
                  {ev.cancelledAt && <Badge tone="danger">Cancelled</Badge>}
                  {canEdit && !ev.cancelledAt && <Button size="sm" variant="ghost" disabled={busy} onClick={() => cancel(ev)}>Cancel event</Button>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
