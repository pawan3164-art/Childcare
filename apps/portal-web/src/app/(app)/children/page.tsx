'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api-client';
import { PageSpinner, ErrorBanner, EmptyState, Avatar } from '@/components/ui/misc';
import { Badge } from '@/components/ui/badge';
import { initials, formatDate } from '@/lib/format';
import type { ChildListItem } from '@/lib/types';
import { Users } from 'lucide-react';

const STATUS_TONE = {
  SIGNED_IN: 'success',
  SIGNED_OUT: 'neutral',
  NO_EVENTS_TODAY: 'neutral',
} as const;

const STATUS_LABEL = {
  SIGNED_IN: 'Signed in',
  SIGNED_OUT: 'Signed out',
  NO_EVENTS_TODAY: 'Not yet today',
} as const;

export default function ChildrenPage() {
  const { user } = useAuth();
  const [children, setChildren] = useState<ChildListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<ChildListItem[]>('/children').then(setChildren).catch((err) => setError(err.message));
  }, []);

  if (error) return <ErrorBanner message={error} />;
  if (!children) return <PageSpinner />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">
          {user?.role === 'PARENT' ? 'My Children' : 'Children'}
        </h1>
        <p className="text-sm text-muted">
          {user?.role === 'PARENT' ? 'Children linked to your account' : `${children.length} enrolled at ${user?.centreName}`}
        </p>
      </div>

      {children.length === 0 ? (
        <EmptyState icon={<Users size={32} />} title="No children yet" />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted-surface text-xs uppercase text-muted">
              <tr>
                <th className="px-5 py-3 font-medium">Child</th>
                <th className="px-5 py-3 font-medium">Room</th>
                <th className="px-5 py-3 font-medium">Date of birth</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {children.map((child) => (
                <tr key={child.id} className="border-b border-border last:border-0 hover:bg-muted-surface/50">
                  <td className="px-5 py-3">
                    <Link href={`/children/${child.id}`} className="flex items-center gap-3">
                      <Avatar initials={initials(child.firstName, child.lastName)} />
                      <span className="font-medium text-foreground">
                        {child.firstName} {child.lastName}
                      </span>
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-muted">{child.roomName ?? '—'}</td>
                  <td className="px-5 py-3 text-muted">{formatDate(child.dateOfBirth)}</td>
                  <td className="px-5 py-3">
                    <Badge tone={STATUS_TONE[child.attendanceStatus]}>{STATUS_LABEL[child.attendanceStatus]}</Badge>
                    {child.previousDayNotSignedOut && (
                      <Badge tone="warning" className="ml-1">
                        Not signed out yesterday
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
