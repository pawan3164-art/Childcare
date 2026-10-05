'use client';

import { useEffect, useState } from 'react';
import { BedDouble, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatTime } from '@/lib/format';
import type { ChildListItem, SleepStatus } from '@/lib/types';

const REFRESH_MS = 30_000;

/**
 * Who is asleep in the room and when each child's next safe-sleep check is
 * due. Refreshes every 30s and whenever `refreshKey` changes (after a log).
 */
export function SleepChecksPanel({
  roomId,
  roster,
  refreshKey,
  onLogChecks,
}: {
  roomId: string;
  roster: ChildListItem[];
  refreshKey: number;
  onLogChecks: (sleepingChildIds: string[]) => void;
}) {
  const [status, setStatus] = useState<SleepStatus[] | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    const load = () =>
      api
        .get<SleepStatus[]>(`/rooms/${roomId}/sleep-status`)
        .then((s) => {
          if (!cancelled) {
            setStatus(s);
            setNow(Date.now());
          }
        })
        .catch(() => !cancelled && setStatus([]));
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [roomId, refreshKey]);

  if (!status || status.length === 0) return null;
  const name = (id: string) => roster.find((c) => c.id === id)?.firstName ?? 'Child';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BedDouble size={18} /> Sleeping now
        </CardTitle>
        <Button size="sm" variant="secondary" onClick={() => onLogChecks(status.map((s) => s.childId))}>
          Log sleep check for these {status.length}
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {status.map((s) => {
          const overdue = s.overdue || new Date(s.nextCheckDueAt).getTime() <= now;
          return (
            <div key={s.childId} className="flex flex-wrap items-center gap-3 text-sm">
              <span className="min-w-24 font-medium text-foreground">{name(s.childId)}</span>
              <span className="text-muted">
                asleep since {formatTime(s.sleepingSince)}
                {s.lastCheckAt ? ` · last check ${formatTime(s.lastCheckAt)}` : ' · no check yet'}
              </span>
              <Badge tone={overdue ? 'danger' : 'neutral'} className="ml-auto">
                {overdue && <AlertTriangle size={12} />}
                {overdue ? 'Check overdue' : `Next check ${formatTime(s.nextCheckDueAt)}`}
              </Badge>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
