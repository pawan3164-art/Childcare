'use client';

import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { Camera, Check, ImagePlus, Users, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { useDraft } from '@/lib/drafts';
import { PageSpinner, ErrorBanner, Avatar } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Select, Label, Textarea } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { initials } from '@/lib/format';
import type { ChildListItem, Room } from '@/lib/types';

const MAX_PHOTOS = 10;

export default function PhotosPage() {
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [roomId, setRoomId] = useState('');
  const [children, setChildren] = useState<ChildListItem[] | null>(null);
  const [tagged, setTagged] = useState<Set<string>>(new Set());
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const caption = useDraft('photo-caption');

  useEffect(() => {
    api.get<Room[]>('/rooms').then((r) => {
      setRooms(r);
      if (r.length > 0) setRoomId(r[0].id);
    });
  }, []);

  useEffect(() => {
    if (!roomId) return;
    setChildren(null);
    setTagged(new Set());
    api.get<ChildListItem[]>(`/children?roomId=${roomId}`).then(setChildren);
  }, [roomId]);

  const previews = useMemo(() => files.map((f) => ({ file: f, url: URL.createObjectURL(f) })), [files]);
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews]);

  const taggedNames = (children ?? []).filter((c) => tagged.has(c.id)).map((c) => c.firstName);

  function toggle(childId: string) {
    setTagged((prev) => {
      const next = new Set(prev);
      if (next.has(childId)) next.delete(childId);
      else next.add(childId);
      return next;
    });
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list).filter((f) => f.type.startsWith('image/'))].slice(0, MAX_PHOTOS));
  }

  async function share() {
    setError(null);
    setSuccess(null);
    const childIds = [...tagged];
    try {
      const mediaAssetIds: string[] = [];
      for (const [i, file] of files.entries()) {
        setProgress(`Uploading photo ${i + 1} of ${files.length}…`);
        const form = new FormData();
        form.append('file', file);
        form.append('childIds', JSON.stringify(childIds));
        form.append('roomId', roomId);
        const asset = await api.upload<{ id: string }>('/media/upload', form);
        mediaAssetIds.push(asset.id);
      }
      setProgress('Posting…');
      await api.post('/feed/posts', { caption: caption.value.trim() || undefined, mediaAssetIds });
      setSuccess(`Shared ${files.length} ${files.length === 1 ? 'photo' : 'photos'} with the families of ${listNames(taggedNames)}.`);
      setFiles([]);
      setTagged(new Set());
      caption.clear();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Photos not shared');
    } finally {
      setProgress(null);
    }
  }

  if (!rooms) return <PageSpinner />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Share photos</h1>
        <p className="text-sm text-muted">Photos go to the family feed of every child you tag, and only to them.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>1. Who is in the photos?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-xs">
            <Label htmlFor="room">Room</Label>
            <Select id="room" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </div>
          {!children ? (
            <PageSpinner />
          ) : children.length === 0 ? (
            <p className="text-sm text-muted">No children in this room.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {children.map((c) => {
                const on = tagged.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggle(c.id)}
                    aria-pressed={on}
                    className={clsx(
                      'flex items-center gap-2 rounded-lg border p-2 text-left text-sm transition-colors',
                      on ? 'border-primary bg-primary-muted' : 'border-border bg-surface hover:bg-muted-surface',
                    )}
                  >
                    <Avatar initials={initials(c.firstName, c.lastName)} />
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground">{c.firstName}</span>
                    {on && <Check size={16} className="text-primary" />}
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Photos and caption</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            {previews.map((p, i) => (
              <div key={p.url} className="relative h-28 w-28 overflow-hidden rounded-lg border border-border">
                {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
                <img src={p.url} alt={`Selected photo ${i + 1}`} className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                  className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white"
                  aria-label={`Remove photo ${i + 1}`}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            {files.length < MAX_PHOTOS && (
              <label className="flex h-28 w-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-sm text-muted hover:bg-muted-surface">
                <ImagePlus size={20} />
                Add photos
                <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => addFiles(e.target.files)} />
              </label>
            )}
          </div>
          <div>
            <Label htmlFor="caption">Caption (optional)</Label>
            <Textarea id="caption" value={caption.value} onChange={(e) => caption.setValue(e.target.value)} maxLength={2000} placeholder="e.g. Painting with leaves this morning" />
            <p className="mt-1 text-xs text-muted">{caption.restored ? 'Draft restored' : caption.value ? 'Draft saved on this device' : ''}</p>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-2 rounded-lg bg-info-surface px-3 py-2 text-sm text-info">
        <Users size={16} />
        <span>
          <span className="font-medium">Who will see this:</span>{' '}
          {taggedNames.length === 0 ? 'tag at least one child' : `the families of ${listNames(taggedNames)}`}
        </span>
      </div>

      {error && <ErrorBanner message={error} />}
      {success && <div className="rounded-lg border border-success/30 bg-success-surface px-4 py-3 text-sm text-success">{success}</div>}

      <Button onClick={share} disabled={progress !== null || files.length === 0 || tagged.size === 0}>
        <Camera size={14} /> {progress ?? `Share ${files.length || ''} ${files.length === 1 ? 'photo' : 'photos'}`}
      </Button>
    </div>
  );
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
