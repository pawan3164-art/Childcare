'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { BookOpen, Eye, NotebookPen, Plus } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { PageSpinner, ErrorBanner, EmptyState } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Label, Select } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/format';
import type { ChildListItem, EylfOutcome, LearningStatus, LearningSummary, Room } from '@/lib/types';

const TABS: { status: LearningStatus; label: string }[] = [
  { status: 'DRAFT', label: 'My drafts' },
  { status: 'IN_REVIEW', label: 'Waiting for review' },
  { status: 'PUBLISHED', label: 'Published' },
];

export default function LearningPage() {
  const router = useRouter();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [children, setChildren] = useState<ChildListItem[]>([]);
  const [outcomes, setOutcomes] = useState<EylfOutcome[]>([]);
  const [status, setStatus] = useState<LearningStatus>('IN_REVIEW');
  const [roomId, setRoomId] = useState('');
  const [outcome, setOutcome] = useState('');
  const [records, setRecords] = useState<LearningSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.get<Room[]>('/rooms'), api.get<ChildListItem[]>('/children'), api.get<EylfOutcome[]>('/learning/outcomes')])
      .then(([r, c, o]) => {
        setRooms(r);
        setChildren(c);
        setOutcomes(o);
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    setRecords(null);
    const q = new URLSearchParams({ status });
    if (roomId) q.set('roomId', roomId);
    if (outcome) q.set('outcome', outcome);
    api
      .get<LearningSummary[]>(`/learning/records?${q}`)
      .then(setRecords)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load learning records'));
  }, [status, roomId, outcome]);

  const childName = useMemo(() => new Map(children.map((c) => [c.id, c.firstName])), [children]);

  function start(kind: 'OBSERVATION' | 'LEARNING_STORY') {
    router.push(`/learning/${crypto.randomUUID()}?new=${kind}`);
  }

  if (error) return <ErrorBanner message={error} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Learning</h1>
          <p className="text-sm text-muted">Observations and learning stories, linked to EYLF V2.0. Published records appear in each child&apos;s family feed and portfolio.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => start('OBSERVATION')}>
            <Eye size={14} /> New observation
          </Button>
          <Button onClick={() => start('LEARNING_STORY')}>
            <Plus size={14} /> New learning story
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex gap-2" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.status}
              role="tab"
              aria-selected={status === t.status}
              onClick={() => setStatus(t.status)}
              className={clsx(
                'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                status === t.status ? 'border-primary bg-primary-muted text-primary' : 'border-border bg-surface text-foreground hover:bg-muted-surface',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="w-48">
          <Label htmlFor="room">Room</Label>
          <Select id="room" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            <option value="">All rooms</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-72">
          <Label htmlFor="outcome">Learning outcome</Label>
          <Select id="outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="">Any outcome</option>
            {outcomes.map((o) => (
              <option key={o.code} value={o.code}>
                {o.code} {o.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <Card>
        <CardContent className="pt-5">
          {!records ? (
            <PageSpinner />
          ) : records.length === 0 ? (
            <EmptyState
              icon={<BookOpen size={28} />}
              title={status === 'DRAFT' ? 'No drafts' : status === 'IN_REVIEW' ? 'Nothing waiting for review' : 'Nothing published yet'}
              description={status === 'IN_REVIEW' ? 'Records submitted by other educators appear here for you to review.' : undefined}
            />
          ) : (
            <div className="divide-y divide-border">
              {records.map((r) => (
                <Link key={r.id} href={`/learning/${r.id}`} className="flex flex-wrap items-center gap-3 py-3 hover:bg-muted-surface/50">
                  <NotebookPen size={18} className="text-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-foreground">{r.title || 'Untitled'}</p>
                    <p className="truncate text-xs text-muted">
                      {r.childIds.map((id) => childName.get(id) ?? 'Child').join(', ') || 'No children tagged'} · {formatDateTime(r.publishedAt ?? r.createdAt)}
                    </p>
                  </div>
                  <Badge tone="info">{r.kind === 'LEARNING_STORY' ? 'Learning story' : 'Observation'}</Badge>
                  {r.outcomes.slice(0, 4).map((o) => (
                    <Badge key={o} tone="primary">
                      {o}
                    </Badge>
                  ))}
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
