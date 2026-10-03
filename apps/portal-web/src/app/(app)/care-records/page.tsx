'use client';

import { useEffect, useMemo, useState } from 'react';
import { Utensils, Moon, Baby, Sparkles as ActivityIcon, Check } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { PageSpinner, ErrorBanner, Avatar } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Select, Label, Textarea } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { initials } from '@/lib/format';
import type { ChildListItem, Room, CareRecordType } from '@/lib/types';

const TYPE_OPTIONS: { value: CareRecordType; label: string; icon: typeof Utensils }[] = [
  { value: 'MEAL', label: 'Meal', icon: Utensils },
  { value: 'SLEEP', label: 'Sleep', icon: Moon },
  { value: 'TOILETING', label: 'Toileting', icon: Baby },
  { value: 'BOTTLE', label: 'Bottle', icon: Baby },
  { value: 'ACTIVITY', label: 'Activity', icon: ActivityIcon },
];

export default function CareRecordsPage() {
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [children, setChildren] = useState<ChildListItem[] | null>(null);
  const [roomId, setRoomId] = useState<string>('');
  const [type, setType] = useState<CareRecordType>('MEAL');
  const [defaultNote, setDefaultNote] = useState('');
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.get<Room[]>('/rooms').then((r) => {
      setRooms(r);
      if (r.length > 0) setRoomId(r[0].id);
    });
  }, []);

  useEffect(() => {
    if (!roomId) return;
    api.get<ChildListItem[]>(`/children?roomId=${roomId}`).then(setChildren);
    setExcluded(new Set());
    setOverrides({});
  }, [roomId]);

  const includedCount = useMemo(() => (children?.length ?? 0) - excluded.size, [children, excluded]);

  function toggleExcluded(childId: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(childId)) next.delete(childId);
      else next.add(childId);
      return next;
    });
  }

  async function handleSubmit() {
    if (!children) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await api.post<{ records: unknown[]; skipped: string[] }>('/care-records/group', {
        type,
        timestamp: new Date().toISOString(),
        defaultNote: defaultNote || undefined,
        childIds: children.map((c) => c.id),
        exceptions: children
          .filter((c) => excluded.has(c.id) || overrides[c.id])
          .map((c) => ({
            childId: c.id,
            skip: excluded.has(c.id) || undefined,
            note: overrides[c.id] || undefined,
          })),
      });
      setSuccess(`Logged ${type.toLowerCase()} for ${result.records.length} ${result.records.length === 1 ? 'child' : 'children'}.`);
      setDefaultNote('');
      setOverrides({});
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to log care record');
    } finally {
      setSubmitting(false);
    }
  }

  if (!rooms) return <PageSpinner />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Group care logging</h1>
        <p className="text-sm text-muted">Record one event for the whole room, then adjust only the exceptions.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>1. Choose room and activity</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="room">Room</Label>
            <Select id="room" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Activity type</Label>
            <div className="flex flex-wrap gap-2">
              {TYPE_OPTIONS.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setType(value)}
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                    type === value
                      ? 'border-primary bg-primary-muted text-primary'
                      : 'border-border bg-surface text-foreground hover:bg-muted-surface'
                  }`}
                >
                  <Icon size={14} />
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="defaultNote">Note for the group (optional)</Label>
            <Textarea
              id="defaultNote"
              value={defaultNote}
              onChange={(e) => setDefaultNote(e.target.value)}
              placeholder="e.g. Ate all of their lunch"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            2. Review children — {includedCount} of {children?.length ?? 0} included
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!children ? (
            <PageSpinner />
          ) : children.length === 0 ? (
            <p className="text-sm text-muted">No children in this room.</p>
          ) : (
            <div className="space-y-2">
              {children.map((child) => {
                const isExcluded = excluded.has(child.id);
                return (
                  <div
                    key={child.id}
                    className={`flex items-center gap-3 rounded-lg border p-3 ${isExcluded ? 'border-border bg-muted-surface opacity-60' : 'border-border bg-surface'}`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleExcluded(child.id)}
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors ${
                        isExcluded ? 'border-border bg-surface' : 'border-primary bg-primary text-primary-foreground'
                      }`}
                      aria-label={isExcluded ? 'Include child' : 'Exclude child'}
                    >
                      {!isExcluded && <Check size={14} />}
                    </button>
                    <Avatar initials={initials(child.firstName, child.lastName)} />
                    <span className="w-32 shrink-0 font-medium text-foreground">
                      {child.firstName} {child.lastName}
                    </span>
                    <input
                      type="text"
                      placeholder="Exception note (optional)"
                      disabled={isExcluded}
                      value={overrides[child.id] ?? ''}
                      onChange={(e) => setOverrides((prev) => ({ ...prev, [child.id]: e.target.value }))}
                      className="flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                    />
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {error && <ErrorBanner message={error} />}
      {success && <div className="rounded-lg border border-success/30 bg-success-surface px-4 py-3 text-sm text-success">{success}</div>}

      <Button onClick={handleSubmit} disabled={submitting || !children || children.length === 0}>
        {submitting ? 'Logging…' : `Log ${type.toLowerCase()} for ${includedCount} children`}
      </Button>
    </div>
  );
}
