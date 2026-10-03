'use client';

import { useEffect, useState } from 'react';
import { UserCheck, UserX } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { PageSpinner, ErrorBanner, Avatar } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { initials } from '@/lib/format';
import type { ChildListItem } from '@/lib/types';

export default function AttendancePage() {
  const [children, setChildren] = useState<ChildListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);

  function load() {
    api.get<ChildListItem[]>('/children').then(setChildren).catch((err) => setError(err.message));
  }

  useEffect(load, []);

  async function toggleAttendance(child: ChildListItem) {
    setActioningId(child.id);
    setError(null);
    const eventType = child.attendanceStatus === 'SIGNED_IN' ? 'SIGN_OUT' : 'SIGN_IN';
    try {
      await api.post('/attendance/events', {
        childId: child.id,
        eventType,
        method: 'EDUCATOR',
        timestamp: new Date().toISOString(),
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to record attendance');
    } finally {
      setActioningId(null);
    }
  }

  if (error) return <ErrorBanner message={error} />;
  if (!children) return <PageSpinner />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Attendance</h1>
        <p className="text-sm text-muted">Sign children in and out for today.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {children.map((child) => {
          const signedIn = child.attendanceStatus === 'SIGNED_IN';
          return (
            <div
              key={child.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4 shadow-card"
            >
              <div className="flex items-center gap-3">
                <Avatar initials={initials(child.firstName, child.lastName)} />
                <div>
                  <p className="font-medium text-foreground">
                    {child.firstName} {child.lastName}
                  </p>
                  <p className="text-xs text-muted">{child.roomName}</p>
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Badge tone={signedIn ? 'success' : 'neutral'}>{signedIn ? 'Signed in' : 'Not signed in'}</Badge>
                <Button
                  size="sm"
                  variant={signedIn ? 'secondary' : 'primary'}
                  disabled={actioningId === child.id}
                  onClick={() => toggleAttendance(child)}
                >
                  {signedIn ? <UserX size={14} /> : <UserCheck size={14} />}
                  {signedIn ? 'Sign out' : 'Sign in'}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
