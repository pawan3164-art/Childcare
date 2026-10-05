'use client';

import { useEffect, useMemo, useState } from 'react';
import { Utensils, Moon, Baby, Sparkles as ActivityIcon, Check, Sun, BedDouble, AlertTriangle } from 'lucide-react';
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
  { value: 'NAPPY', label: 'Nappy', icon: Baby },
  { value: 'SUNSCREEN', label: 'Sunscreen', icon: Sun },
  { value: 'SLEEP_CHECK', label: 'Sleep check', icon: BedDouble },
];

type Details = Record<string, string | boolean>;

/** The structured fields each routine type records (validated server-side in care-details.ts). */
const DETAIL_FIELDS: Partial<Record<CareRecordType, { key: string; label: string; options: { value: string; label: string }[] }[]>> = {
  NAPPY: [{ key: 'condition', label: 'Condition', options: [{ value: 'WET', label: 'Wet' }, { value: 'SOILED', label: 'Soiled' }, { value: 'DRY', label: 'Dry' }] }],
  SLEEP: [{ key: 'phase', label: 'Sleep', options: [{ value: '', label: 'Not specified' }, { value: 'START', label: 'Fell asleep' }, { value: 'END', label: 'Woke up' }] }],
  SLEEP_CHECK: [
    { key: 'position', label: 'Position', options: [{ value: 'BACK', label: 'On back' }, { value: 'SIDE', label: 'On side' }, { value: 'FRONT', label: 'On front' }] },
    { key: 'breathingOk', label: 'Breathing', options: [{ value: 'true', label: 'Normal' }, { value: 'false', label: 'Concern' }] },
  ],
};

function defaultDetailsFor(type: CareRecordType): Details {
  const fields = DETAIL_FIELDS[type] ?? [];
  return Object.fromEntries(fields.map((f) => [f.key, f.options[0].value]));
}

/** Form values are strings; the API wants booleans for breathingOk and no empty fields. */
function toApiDetails(d: Details | undefined): Record<string, unknown> | undefined {
  if (!d) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) {
    if (v === '') continue;
    out[k] = v === 'true' ? true : v === 'false' ? false : v;
  }
  return Object.keys(out).length ? out : undefined;
}

function isFlagged(d: Details): boolean {
  return d.position === 'FRONT' || d.breathingOk === 'false';
}

export default function CareRecordsPage() {
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [children, setChildren] = useState<ChildListItem[] | null>(null);
  const [roomId, setRoomId] = useState<string>('');
  const [type, setType] = useState<CareRecordType>('MEAL');
  const [defaultNote, setDefaultNote] = useState('');
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [groupDetails, setGroupDetails] = useState<Details>({});
  const [childDetails, setChildDetails] = useState<Record<string, Details>>({});
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
    setChildDetails({});
  }, [roomId]);

  useEffect(() => {
    setGroupDetails(defaultDetailsFor(type));
    setChildDetails({});
  }, [type]);

  const fields = DETAIL_FIELDS[type] ?? [];

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
        defaultDetails: toApiDetails(groupDetails),
        childIds: children.map((c) => c.id),
        exceptions: children
          .filter((c) => excluded.has(c.id) || overrides[c.id] || childDetails[c.id])
          .map((c) => ({
            childId: c.id,
            skip: excluded.has(c.id) || undefined,
            note: overrides[c.id] || undefined,
            details: childDetails[c.id] ? toApiDetails({ ...groupDetails, ...childDetails[c.id] }) : undefined,
          })),
      });
      setSuccess(`Logged ${TYPE_OPTIONS.find((t) => t.value === type)?.label.toLowerCase()} for ${result.records.length} ${result.records.length === 1 ? 'child' : 'children'}.`);
      setDefaultNote('');
      setOverrides({});
      setChildDetails({});
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
          {fields.map((f) => (
            <div key={f.key}>
              <Label htmlFor={`group-${f.key}`}>{f.label} (for the group)</Label>
              <Select
                id={`group-${f.key}`}
                value={String(groupDetails[f.key] ?? '')}
                onChange={(e) => setGroupDetails((prev) => ({ ...prev, [f.key]: e.target.value }))}
              >
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
          ))}
          {type === 'SLEEP_CHECK' && isFlagged(groupDetails) && (
            <div className="flex items-center gap-2 rounded-lg bg-warning-surface px-3 py-2 text-sm text-warning sm:col-span-2">
              <AlertTriangle size={16} /> Safe-sleep guidance: babies sleep on their back. This check will be flagged for follow-up.
            </div>
          )}
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
                    className={`flex flex-wrap items-center gap-3 rounded-lg border p-3 ${isExcluded ? 'border-border bg-muted-surface opacity-60' : 'border-border bg-surface'}`}
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
                    <span className="min-w-0 flex-1 font-medium text-foreground sm:w-32 sm:flex-none sm:shrink-0">
                      {child.firstName} {child.lastName}
                    </span>
                    <input
                      type="text"
                      placeholder="Exception note (optional)"
                      disabled={isExcluded}
                      value={overrides[child.id] ?? ''}
                      onChange={(e) => setOverrides((prev) => ({ ...prev, [child.id]: e.target.value }))}
                      className="w-full min-w-0 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm sm:w-auto sm:flex-1 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                    />
                    {fields.slice(0, 1).map((f) => (
                      <select
                        key={f.key}
                        aria-label={`${f.label} for ${child.firstName}`}
                        disabled={isExcluded}
                        value={String(childDetails[child.id]?.[f.key] ?? groupDetails[f.key] ?? '')}
                        onChange={(e) =>
                          setChildDetails((prev) => {
                            const next = { ...prev };
                            if (e.target.value === groupDetails[f.key]) delete next[child.id];
                            else next[child.id] = { ...prev[child.id], [f.key]: e.target.value };
                            return next;
                          })
                        }
                        className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm disabled:opacity-50"
                      >
                        {f.options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ))}
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
        {submitting ? 'Logging…' : `Log ${TYPE_OPTIONS.find((t) => t.value === type)?.label.toLowerCase()} for ${includedCount} children`}
      </Button>
    </div>
  );
}
