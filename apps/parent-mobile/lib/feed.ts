import type { FeedItem } from './types';

export function feedItemKey(item: FeedItem): string {
  return `${item.kind}-${item.id}`;
}

/** Add a freshly loaded page to what is on screen: no duplicates (incoming wins), newest first. */
export function mergeFeedPages(existing: FeedItem[], incoming: FeedItem[]): FeedItem[] {
  const byKey = new Map<string, FeedItem>();
  for (const item of existing) byKey.set(feedItemKey(item), item);
  for (const item of incoming) byKey.set(feedItemKey(item), item);
  return [...byKey.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
