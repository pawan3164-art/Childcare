'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Printer, Sprout } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { PageSpinner, ErrorBanner, EmptyState } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { LearningCard } from '@/components/learning-card';
import { formatDate } from '@/lib/format';
import type { LearningRecordView } from '@/lib/types';

interface Portfolio {
  child: { id: string; firstName: string; lastName: string };
  items: LearningRecordView[];
}

/**
 * BRD §10 child portfolio: the child's published learning, newest first.
 * "Save as PDF" uses the browser's print-to-PDF with a print stylesheet;
 * a server-rendered PDF is a later improvement (see OI-27).
 */
export default function PortfolioPage() {
  const { id } = useParams<{ id: string }>();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<Portfolio | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    api
      .get<Portfolio>(`/children/${id}/portfolio${q.size ? `?${q}` : ''}`)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the portfolio'));
  }, [id, from, to]);

  if (error) return <ErrorBanner message={error} />;
  if (!data) return <PageSpinner />;

  return (
    <div className="space-y-6">
      <Link href={`/children/${id}`} className="flex items-center gap-1.5 text-sm text-muted hover:text-foreground print:hidden">
        <ArrowLeft size={14} /> Back to {data.child.firstName}
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            {data.child.firstName} {data.child.lastName}: learning portfolio
          </h1>
          <p className="text-sm text-muted">
            {data.items.length} {data.items.length === 1 ? 'entry' : 'entries'}
            {from || to ? ` · ${from ? formatDate(from) : 'start'} to ${to ? formatDate(to) : 'today'}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3 print:hidden">
          <div>
            <Label htmlFor="from">From</Label>
            <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="to">To</Label>
            <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer size={14} /> Save as PDF
          </Button>
        </div>
      </div>

      {data.items.length === 0 ? (
        <Card>
          <CardContent className="pt-5">
            <EmptyState icon={<Sprout size={28} />} title="No published learning yet" description="Learning stories and observations appear here once educators publish them." />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {data.items.map((r) => (
            <Card key={r.id} className="break-inside-avoid">
              <CardContent className="space-y-2 pt-5">
                <p className="text-xs text-muted">
                  {r.kind === 'LEARNING_STORY' ? 'Learning story' : 'Observation'} · {r.publishedAt ? formatDate(r.publishedAt) : ''} · {r.author.firstName}
                </p>
                <LearningCard record={r} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
