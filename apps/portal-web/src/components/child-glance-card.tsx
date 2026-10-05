'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { UserCheck, UserX, Clock, Utensils, Moon, Baby, Sparkles as ActivityIcon, Sun, BedDouble } from 'lucide-react';
import { api } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/misc';
import { formatTime } from '@/lib/format';
import { CARE_TYPE_LABEL } from '@/lib/care-labels';
import type { ChildAtAGlance, CareRecordType } from '@/lib/types';

const CARE_RECORD_ICONS: Record<CareRecordType, typeof Utensils> = {
  MEAL: Utensils,
  SLEEP: Moon,
  TOILETING: Baby,
  BOTTLE: Baby,
  ACTIVITY: ActivityIcon,
  NAPPY: Baby,
  SUNSCREEN: Sun,
  SLEEP_CHECK: BedDouble,
};

export function ChildGlanceCard({ childId }: { childId: string }) {
  const [data, setData] = useState<ChildAtAGlance | null>(null);

  useEffect(() => {
    api.get<ChildAtAGlance>(`/children/${childId}/at-a-glance`).then(setData);
  }, [childId]);

  if (!data) {
    return (
      <Card>
        <CardContent className="flex h-40 items-center justify-center">
          <Spinner />
        </CardContent>
      </Card>
    );
  }

  const signedIn = data.attendance.status === 'SIGNED_IN';

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Link href={`/children/${childId}`} className="hover:underline">
            {data.child.firstName} {data.child.lastName}
          </Link>
        </CardTitle>
        <Badge tone={signedIn ? 'success' : 'neutral'}>
          {signedIn ? <UserCheck size={12} /> : <UserX size={12} />}
          {signedIn ? 'Signed in' : data.attendance.status === 'NO_EVENTS_TODAY' ? 'Not signed in yet' : 'Signed out'}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted">{data.child.roomName ?? 'No room assigned'}</p>

        {data.attendance.previousDayNotSignedOut && (
          <p className="rounded-lg bg-warning-surface px-3 py-2 text-xs text-warning">
            Yesterday’s sign-out wasn’t recorded.
          </p>
        )}

        {data.attendance.lastEventAt && (
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <Clock size={12} />
            Last update {formatTime(data.attendance.lastEventAt)}
          </div>
        )}

        <div className="space-y-2 border-t border-border pt-3">
          {data.todaysCareRecords.length === 0 && (
            <p className="text-sm text-muted">No care records logged yet today.</p>
          )}
          {data.todaysCareRecords.slice(0, 4).map((record, i) => {
            const Icon = CARE_RECORD_ICONS[record.type as CareRecordType] ?? ActivityIcon;
            return (
              <div key={i} className="flex items-start gap-2 text-sm">
                <Icon size={14} className="mt-0.5 shrink-0 text-primary" />
                <div>
                  <span className="font-medium text-foreground">{CARE_TYPE_LABEL[record.type as CareRecordType] ?? record.type}</span>
                  {record.note && <span className="text-muted"> — {record.note}</span>}
                  <span className="block text-xs text-muted">{formatTime(record.timestamp)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
