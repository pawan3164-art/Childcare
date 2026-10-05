'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import clsx from 'clsx';
import { ArrowLeft, Check, ImagePlus, Send, Undo2, CheckCircle2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { useDraft } from '@/lib/drafts';
import { PageSpinner, ErrorBanner } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/format';
import type { ChildListItem, EylfOutcome, LearningKind, LearningRecordView, Room } from '@/lib/types';

interface Form {
  kind: LearningKind;
  roomId: string;
  title: string;
  observation: string;
  interpretation: string;
  outcomes: string[];
  nextSteps: string;
  reflection: string;
  childIds: string[];
  mediaAssetIds: string[];
}

const SAVE_DELAY_MS = 1200;

function formFrom(r: LearningRecordView): Form {
  return {
    kind: r.kind,
    roomId: r.roomId,
    title: r.title,
    observation: r.observation,
    interpretation: r.interpretation ?? '',
    outcomes: r.outcomes.map((o) => o.code),
    nextSteps: r.nextSteps ?? '',
    reflection: r.reflection ?? '',
    childIds: r.children.map((c) => c.id),
    mediaAssetIds: r.media.map((m) => m.id),
  };
}

// useSearchParams needs a Suspense boundary in the app router.
export default function LearningRecordPage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <LearningRecordEditor />
    </Suspense>
  );
}

function LearningRecordEditor() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const newKind = search.get('new') as LearningKind | null;

  const [record, setRecord] = useState<LearningRecordView | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [outcomes, setOutcomes] = useState<EylfOutcome[]>([]);
  const [roster, setRoster] = useState<ChildListItem[]>([]);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'offline'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [returnNote, setReturnNote] = useState('');
  const [amending, setAmending] = useState(false);
  const local = useDraft(`learning:${id}`);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get<LearningRecordView>(`/learning/records/${id}`);
      setRecord(r);
      setForm(formFrom(r));
      setPhotos(Object.fromEntries(r.media.map((m) => [m.id, m.url])));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404 && newKind) {
        setRecord(null);
        setForm((f) => f ?? { kind: newKind, roomId: '', title: '', observation: '', interpretation: '', outcomes: [], nextSteps: '', reflection: '', childIds: [], mediaAssetIds: [] });
      } else {
        setError(err instanceof ApiError ? err.message : 'Could not load this record');
      }
    }
  }, [id, newKind]);

  useEffect(() => {
    load();
    Promise.all([api.get<Room[]>('/rooms'), api.get<EylfOutcome[]>('/learning/outcomes')]).then(([r, o]) => {
      setRooms(r);
      setOutcomes(o);
    });
  }, [load]);

  // Default the room for a brand-new record once rooms arrive.
  useEffect(() => {
    if (form && !form.roomId && rooms.length) setForm({ ...form, roomId: rooms[0].id });
  }, [form, rooms]);

  useEffect(() => {
    if (!form?.roomId) return;
    api.get<ChildListItem[]>(`/children?roomId=${form.roomId}`).then(setRoster).catch(() => setRoster([]));
  }, [form?.roomId]);

  const editable = !record || record.permissions.edit;

  const save = useCallback(
    async (f: Form) => {
      setSaveState('saving');
      try {
        await api.put(`/learning/records/${id}`, f);
        setSaveState('saved');
        local.clear();
      } catch (err) {
        if (err instanceof ApiError) {
          setSaveState('idle');
          setError(err.message);
        } else {
          // No connection: keep the latest version on this device (BRD §10: drafts saved even while offline).
          local.setValue(JSON.stringify(f));
          setSaveState('offline');
        }
      }
    },
    [id, local],
  );

  function change(patch: Partial<Form>) {
    if (!form) return;
    const next = { ...form, ...patch };
    setForm(next);
    setError(null);
    if (!editable) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save(next), SAVE_DELAY_MS);
  }

  async function flushSave() {
    if (timer.current) clearTimeout(timer.current);
    if (form && editable) await save(form);
  }

  async function act(path: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/learning/records/${id}/${path}`, body);
      setAmending(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work; try again');
    } finally {
      setBusy(false);
    }
  }

  async function uploadPhotos(files: FileList | null) {
    if (!files || !form) return;
    setBusy(true);
    setError(null);
    try {
      const added: string[] = [];
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('childIds', JSON.stringify(form.childIds));
        fd.append('roomId', form.roomId);
        const asset = await api.upload<{ id: string }>('/media/upload', fd);
        added.push(asset.id);
        setPhotos((p) => ({ ...p, [asset.id]: URL.createObjectURL(file) }));
      }
      change({ mediaAssetIds: [...form.mediaAssetIds, ...added].slice(0, 10) });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Photo not uploaded');
    } finally {
      setBusy(false);
    }
  }

  const grouped = useMemo(() => {
    const m = new Map<number, EylfOutcome[]>();
    for (const o of outcomes) m.set(o.outcome, [...(m.get(o.outcome) ?? []), o]);
    return [...m.entries()];
  }, [outcomes]);

  if (error && !form) return <ErrorBanner message={error} />;
  if (!form) return <PageSpinner />;

  const fieldsLocked = !editable && !amending;
  const kindLabel = form.kind === 'LEARNING_STORY' ? 'Learning story' : 'Observation';

  return (
    <div className="space-y-6">
      <Link href="/learning" className="flex items-center gap-1.5 text-sm text-muted hover:text-foreground">
        <ArrowLeft size={14} /> Back to learning
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-foreground">{form.title || `New ${kindLabel.toLowerCase()}`}</h1>
        <Badge tone="info">{kindLabel}</Badge>
        {record && <Badge tone={record.status === 'PUBLISHED' ? 'success' : record.status === 'IN_REVIEW' ? 'warning' : 'neutral'}>{record.status === 'IN_REVIEW' ? 'Waiting for review' : record.status === 'PUBLISHED' ? `Published${record.version > 1 ? ` · v${record.version}` : ''}` : 'Draft'}</Badge>}
        {editable && (
          <span className="ml-auto text-xs text-muted" aria-live="polite">
            {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'All changes saved' : saveState === 'offline' ? "Offline: kept on this device, will save when you're back" : ''}
          </span>
        )}
      </div>

      {editable && local.restored && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-warning-surface px-3 py-2 text-sm text-warning">
          Unsaved changes from this device were found.
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              try {
                change(JSON.parse(local.value) as Form);
              } catch {
                local.clear();
              }
            }}
          >
            Restore them
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_22rem]">
        <Card>
          <CardContent className="space-y-4 pt-5">
            {editable && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="kind">Type</Label>
                  <Select id="kind" value={form.kind} onChange={(e) => change({ kind: e.target.value as LearningKind })}>
                    <option value="LEARNING_STORY">Learning story</option>
                    <option value="OBSERVATION">Observation</option>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="room">Room</Label>
                  <Select id="room" value={form.roomId} onChange={(e) => change({ roomId: e.target.value, childIds: [], mediaAssetIds: [] })}>
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            )}

            <div>
              <Label htmlFor="title">Title</Label>
              <Input id="title" value={form.title} onChange={(e) => change({ title: e.target.value })} disabled={fieldsLocked} maxLength={200} placeholder="e.g. Building a bridge" />
            </div>

            <div>
              <Label>Children</Label>
              {editable ? (
                <div className="flex flex-wrap gap-2">
                  {roster.map((c) => {
                    const on = form.childIds.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => change({ childIds: on ? form.childIds.filter((x) => x !== c.id) : [...form.childIds, c.id] })}
                        className={clsx('flex items-center gap-1 rounded-full border px-3 py-1 text-sm', on ? 'border-primary bg-primary-muted text-primary' : 'border-border bg-surface text-foreground hover:bg-muted-surface')}
                      >
                        {on && <Check size={12} />} {c.firstName}
                      </button>
                    );
                  })}
                  {roster.length === 0 && <p className="text-sm text-muted">No children in this room.</p>}
                </div>
              ) : (
                <p className="text-sm text-foreground">{record?.children.map((c) => c.firstName).join(', ')}</p>
              )}
              {editable && form.childIds.length > 1 && (
                <p className="mt-1 text-xs text-muted">Each tagged child&apos;s family sees this story, unless another tagged child&apos;s family hasn&apos;t given group consent.</p>
              )}
            </div>

            <TextField label="What happened (observation)" value={form.observation} onChange={(v) => change({ observation: v })} disabled={fieldsLocked} placeholder="Describe what you saw and heard." tall />
            <TextField label="What it tells us (interpretation)" value={form.interpretation} onChange={(v) => change({ interpretation: v })} disabled={fieldsLocked} placeholder="What learning is happening here?" />
            <TextField label="Next steps" value={form.nextSteps} onChange={(v) => change({ nextSteps: v })} disabled={fieldsLocked} placeholder="How will we extend this learning?" />
            <TextField
              label="Educator reflection (staff only, never shown to families)"
              value={form.reflection}
              onChange={(v) => change({ reflection: v })}
              disabled={fieldsLocked}
              placeholder="What did you learn about your own practice?"
            />

            <div>
              <Label>Photos</Label>
              <div className="flex flex-wrap gap-2">
                {form.mediaAssetIds.map((mid) => (
                  <div key={mid} className="relative h-24 w-24 overflow-hidden rounded-lg border border-border bg-muted-surface">
                    {/* eslint-disable-next-line @next/next/no-img-element -- signed or local blob URL */}
                    {photos[mid] && <img src={photos[mid]} alt="Attached photo" className="h-full w-full object-cover" />}
                    {editable && (
                      <button type="button" className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 text-xs text-white" onClick={() => change({ mediaAssetIds: form.mediaAssetIds.filter((x) => x !== mid) })} aria-label="Remove photo">
                        ×
                      </button>
                    )}
                  </div>
                ))}
                {editable && form.mediaAssetIds.length < 10 && (
                  <label className={clsx('flex h-24 w-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-xs text-muted hover:bg-muted-surface', form.childIds.length === 0 && 'pointer-events-none opacity-50')}>
                    <ImagePlus size={18} />
                    {form.childIds.length === 0 ? 'Tag a child first' : 'Add photos'}
                    <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => uploadPhotos(e.target.files)} disabled={form.childIds.length === 0} />
                  </label>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>EYLF V2.0 outcomes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {grouped.map(([n, list]) => (
                <div key={n}>
                  <p className="mb-1 text-xs font-semibold text-muted">
                    {n}. {list[0].outcomeTitle}
                  </p>
                  <div className="space-y-1">
                    {list.map((o) => {
                      const on = form.outcomes.includes(o.code);
                      return (
                        <label key={o.code} className={clsx('flex gap-2 rounded-md px-1 py-0.5 text-sm', fieldsLocked ? 'cursor-default' : 'cursor-pointer hover:bg-muted-surface')}>
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={fieldsLocked}
                            onChange={() => change({ outcomes: on ? form.outcomes.filter((x) => x !== o.code) : [...form.outcomes, o.code] })}
                          />
                          <span>
                            <span className="font-medium">{o.code}</span> {o.label}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 pt-5">
              {error && <ErrorBanner message={error} />}
              {editable && (
                <Button
                  className="w-full"
                  disabled={busy}
                  onClick={async () => {
                    await flushSave();
                    await act('submit');
                  }}
                >
                  <Send size={14} /> Submit for review
                </Button>
              )}
              {record?.permissions.review && (
                <>
                  <Button className="w-full" disabled={busy} onClick={() => act('publish')}>
                    <CheckCircle2 size={14} /> Publish to families
                  </Button>
                  <Textarea value={returnNote} onChange={(e) => setReturnNote(e.target.value)} placeholder="What should the author change?" maxLength={1000} aria-label="Note for the author" />
                  <Button className="w-full" variant="secondary" disabled={busy} onClick={() => act('return', { note: returnNote || undefined })}>
                    <Undo2 size={14} /> Return for changes
                  </Button>
                </>
              )}
              {record?.permissions.amend &&
                (amending ? (
                  <div className="flex gap-2">
                    <Button disabled={busy} onClick={() => act('amend', { title: form.title, observation: form.observation, interpretation: form.interpretation, nextSteps: form.nextSteps, reflection: form.reflection, outcomes: form.outcomes })}>
                      Save amendment
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setAmending(false);
                        if (record) setForm(formFrom(record));
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button className="w-full" variant="secondary" onClick={() => setAmending(true)}>
                    Amend (families see the corrected version)
                  </Button>
                ))}
              {record?.status === 'IN_REVIEW' && !record.permissions.review && <p className="text-sm text-muted">Waiting for the room leader to review.</p>}
              {record?.status === 'PUBLISHED' && record.publishedAt && <p className="text-sm text-muted">Published {formatDateTime(record.publishedAt)}.</p>}
            </CardContent>
          </Card>

          {record && record.history.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>History</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="space-y-2 text-sm">
                  {record.history.map((h, i) => (
                    <li key={i}>
                      <span className="font-medium text-foreground">{h.action.charAt(0) + h.action.slice(1).toLowerCase()}</span>{' '}
                      <span className="text-muted">
                        by {h.actor.firstName}, {formatDateTime(h.at)}
                      </span>
                      {h.note && <p className="text-muted">“{h.note}”</p>}
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function TextField({ label, value, onChange, disabled, placeholder, tall }: { label: string; value: string; onChange: (v: string) => void; disabled: boolean; placeholder: string; tall?: boolean }) {
  const id = label.replace(/\W+/g, '-').toLowerCase();
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} placeholder={placeholder} maxLength={10000} className={tall ? 'min-h-32' : undefined} />
    </div>
  );
}
