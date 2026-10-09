import { feedItemKey, mergeFeedPages } from '@/lib/feed';
import type { FeedItem } from '@/lib/types';

const photo = (id: string, createdAt: string, caption: string | null = null): FeedItem => ({
  kind: 'PHOTO_POST', id, createdAt, caption, author: { firstName: 'A' }, media: [],
});
const ann = (id: string, createdAt: string): FeedItem => ({
  kind: 'ANNOUNCEMENT', id, createdAt, scope: 'CENTRE', body: 'b', author: { firstName: 'A' }, acknowledged: false,
});

describe('feedItemKey', () => {
  it('is kind-id', () => expect(feedItemKey(photo('1', 'x'))).toBe('PHOTO_POST-1'));
  it('differs across kinds with the same id', () => expect(feedItemKey(ann('1', 'x'))).not.toBe(feedItemKey(photo('1', 'x'))));
});

describe('mergeFeedPages', () => {
  it('returns empty for empty inputs', () => expect(mergeFeedPages([], [])).toEqual([]));
  it('sorts by createdAt descending', () => {
    const out = mergeFeedPages([photo('1', '2026-10-01T00:00:00Z')], [photo('2', '2026-10-03T00:00:00Z'), ann('3', '2026-10-02T00:00:00Z')]);
    expect(out.map(feedItemKey)).toEqual(['PHOTO_POST-2', 'ANNOUNCEMENT-3', 'PHOTO_POST-1']);
  });
  it('deduplicates with incoming winning', () => {
    const out = mergeFeedPages([photo('1', '2026-10-01T00:00:00Z', 'old')], [photo('1', '2026-10-01T00:00:00Z', 'new')]);
    expect(out).toHaveLength(1);
    expect((out[0] as { caption: string | null }).caption).toBe('new');
  });
  it('keeps same id with different kind as separate items', () => {
    expect(mergeFeedPages([photo('1', '2026-10-01T00:00:00Z')], [ann('1', '2026-10-02T00:00:00Z')])).toHaveLength(2);
  });
  it('does not mutate inputs', () => {
    const a = [photo('1', '2026-10-01T00:00:00Z'), photo('2', '2026-10-02T00:00:00Z')];
    const b = [photo('3', '2026-10-03T00:00:00Z')];
    const aCopy = JSON.parse(JSON.stringify(a));
    const bCopy = JSON.parse(JSON.stringify(b));
    const out = mergeFeedPages(a, b);
    expect(a).toEqual(aCopy);
    expect(b).toEqual(bCopy);
    expect(out).not.toBe(a);
    expect(out).not.toBe(b);
  });
  it('handles existing empty (first page)', () => {
    expect(mergeFeedPages([], [photo('1', '2026-10-01T00:00:00Z')]).map(feedItemKey)).toEqual(['PHOTO_POST-1']);
  });
});
