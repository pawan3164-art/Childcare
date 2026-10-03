'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Receipt } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api-client';
import { PageSpinner, ErrorBanner, Avatar } from '@/components/ui/misc';
import { initials } from '@/lib/format';
import type { ChildListItem } from '@/lib/types';

export default function BillingPage() {
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
        <h1 className="text-2xl font-semibold text-foreground">Billing</h1>
        <p className="text-sm text-muted">
          {user?.role === 'PARENT' ? 'Invoices and balance for your family' : 'Generate invoices and view family ledgers'}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {children.map((child) => (
          <Link
            key={child.id}
            href={`/billing/${child.id}`}
            className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4 shadow-card transition-colors hover:bg-muted-surface"
          >
            <Avatar initials={initials(child.firstName, child.lastName)} />
            <div className="flex-1">
              <p className="font-medium text-foreground">
                {child.firstName} {child.lastName}
              </p>
              <p className="text-xs text-muted">{child.roomName}</p>
            </div>
            <Receipt size={16} className="text-muted" />
          </Link>
        ))}
      </div>
    </div>
  );
}
