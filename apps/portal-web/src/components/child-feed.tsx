'use client';

import { useCallback, useEffect, useState } from 'react';
import { Camera, Megaphone, Siren, CheckCircle2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageSpinner, ErrorBanner } from '@/components/ui/misc';
import { PhotoGrid } from '@/components/child-timeline';
import { formatDateTime } from '@/lib/format';
import type { FeedItem } from '@/lib/types';

/** U1 family feed: photo posts tagging this child plus centre/room announcements, newest first. */
export function ChildFeed({ childId }: { childId: string }) {
  const { user } = useAuth();
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(
    async (before?: string) => {
      const page = await api.get<{ items: FeedItem[]; nextBefore: string | null }>(
        `/children/${childId}/feed${before ? `?before=${encodeURIComponent(before)}` : ''}`,
      );
      setItems((prev) => (before && prev ? [...prev, ...page.items] : page.items));
      setNextBefore(page.nextBefore);
    },
    [childId],
  );

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [load]);

  async function acknowledge(id: string) {
    try {
      await api.post(`/messages/${id}/acknowledge`);
      setItems((prev) => prev?.map((i) => (i.kind === 'ANNOUNCEMENT' && i.id === id ? { ...i, acknowledged: true } : i)) ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not acknowledge');
    }
  }

  async function more() {
    if (!nextBefore) return;
    setLoadingMore(true);
    try {
      await load(nextBefore);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load older posts');
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Family feed</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <ErrorBanner message={error} />}
        {!error && !items && <PageSpinner />}
        {items?.length === 0 && <p className="text-sm text-muted">No photos or announcements yet.</p>}
        {items?.map((item) => (
          <article key={`${item.kind}-${item.id}`} className="space-y-2 border-b border-border pb-4 last:border-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              {item.kind === 'PHOTO_POST' ? (
                <Camera size={14} />
              ) : item.scope === 'EMERGENCY' ? (
                <Siren size={14} className="text-danger" />
              ) : (
                <Megaphone size={14} />
              )}
              <span className="font-medium text-foreground">{item.author.firstName}</span>
              <span>{formatDateTime(item.createdAt)}</span>
              {item.kind === 'ANNOUNCEMENT' && (
                <Badge tone={item.scope === 'EMERGENCY' ? 'danger' : 'info'}>
                  {item.scope === 'EMERGENCY' ? 'Emergency' : item.scope === 'ROOM' ? 'Room announcement' : 'Centre announcement'}
                </Badge>
              )}
            </div>
            {item.kind === 'PHOTO_POST' ? (
              <>
                {item.caption && <p className="text-sm text-foreground">{item.caption}</p>}
                <PhotoGrid media={item.media} />
              </>
            ) : (
              <>
                <p className="whitespace-pre-wrap text-sm text-foreground">{item.body}</p>
                {user?.role === 'PARENT' &&
                  (item.acknowledged ? (
                    <p className="flex items-center gap-1 text-xs text-success">
                      <CheckCircle2 size={14} /> Acknowledged
                    </p>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => acknowledge(item.id)}>
                      Got it
                    </Button>
                  ))}
              </>
            )}
          </article>
        ))}
        {nextBefore && (
          <Button variant="secondary" size="sm" onClick={more} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Show older'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
