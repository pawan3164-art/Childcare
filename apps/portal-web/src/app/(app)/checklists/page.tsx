'use client';

import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, ClipboardList, Plus, Archive } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError } from '@/lib/api-client';
import { PageSpinner, ErrorBanner, EmptyState } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDateTime, formatTime } from '@/lib/format';
import type { ChecklistResult, ChecklistTemplate, ChecklistCompletion, Room, RoomChecklist } from '@/lib/types';

const ADMIN_ROLES = ['CENTRE_ADMIN', 'ORG_ADMIN', 'PLATFORM_ADMIN'];

export default function ChecklistsPage() {
  const { user } = useAuth();
  const isAdmin = !!user && ADMIN_ROLES.includes(user.role);
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [roomId, setRoomId] = useState('');
  const [checklists, setChecklists] = useState<RoomChecklist[] | null>(null);
  const [history, setHistory] = useState<ChecklistCompletion[] | null>(null);
  const [open, setOpen] = useState<ChecklistTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Room[]>('/rooms')
      .then((r) => {
        setRooms(r);
        if (r.length > 0) setRoomId(r[0].id);
      })
      .catch((err) => setError(err.message));
  }, []);

  const load = useCallback(async () => {
    if (!roomId) return;
    try {
      const [c, h] = await Promise.all([
        api.get<RoomChecklist[]>(`/rooms/${roomId}/checklists`),
        api.get<ChecklistCompletion[]>(`/rooms/${roomId}/checklist-completions`),
      ]);
      setChecklists(c);
      setHistory(h);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load checklists');
    }
  }, [roomId]);

  useEffect(() => {
    setChecklists(null);
    setHistory(null);
    setOpen(null);
    load();
  }, [load]);

  if (error) return <ErrorBanner message={error} />;
  if (!rooms) return <PageSpinner />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Room checklists</h1>
          <p className="text-sm text-muted">Daily safety checks. A failed item alerts the centre admins straight away.</p>
        </div>
        <div className="w-56">
          <Label htmlFor="room">Room</Label>
          <Select id="room" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {open ? (
        <CompleteForm
          template={open}
          roomId={roomId}
          onCancel={() => setOpen(null)}
          onDone={() => {
            setOpen(null);
            load();
          }}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Today</CardTitle>
          </CardHeader>
          <CardContent>
            {!checklists ? (
              <PageSpinner />
            ) : checklists.length === 0 ? (
              <EmptyState icon={<ClipboardList size={28} />} title="No checklists for this room" description={isAdmin ? 'Add one below.' : 'Ask a centre admin to set them up.'} />
            ) : (
              <div className="divide-y divide-border">
                {checklists.map(({ template, lastCompletion }) => (
                  <div key={template.id} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground">{template.name}</p>
                      <p className="text-xs text-muted">
                        {template.items.length} items · {template.roomId ? 'This room' : 'Every room'}
                      </p>
                    </div>
                    {lastCompletion ? (
                      <Badge tone={lastCompletion.failedCount > 0 ? 'danger' : 'success'}>
                        {lastCompletion.failedCount > 0 ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />}
                        {lastCompletion.failedCount > 0 ? `${lastCompletion.failedCount} failed` : 'Done'} · {lastCompletion.completedBy.firstName} {formatTime(lastCompletion.completedAt)}
                      </Badge>
                    ) : (
                      <Badge tone="warning">Not done today</Badge>
                    )}
                    <Button size="sm" variant={lastCompletion ? 'secondary' : 'primary'} onClick={() => setOpen(template)}>
                      {lastCompletion ? 'Do again' : 'Start'}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recent completions</CardTitle>
        </CardHeader>
        <CardContent>
          {!history ? (
            <PageSpinner />
          ) : history.length === 0 ? (
            <p className="text-sm text-muted">Nothing completed in this room yet.</p>
          ) : (
            <div className="divide-y divide-border">
              {history.slice(0, 20).map((h) => (
                <div key={h.id} className="space-y-1 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{h.templateName}</span>
                    <span className="text-xs text-muted">
                      {h.completedBy.firstName} · {formatDateTime(h.completedAt)}
                    </span>
                    {h.failedCount > 0 && <Badge tone="danger">{h.failedCount} failed</Badge>}
                  </div>
                  {h.results
                    .filter((r) => r.result === 'FAIL')
                    .map((r) => (
                      <p key={r.itemId} className="text-sm text-danger">
                        ✗ {r.label}
                        {r.note && <span className="text-muted"> — {r.note}</span>}
                      </p>
                    ))}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {isAdmin && <ManageTemplates rooms={rooms} onChanged={load} />}
    </div>
  );
}

const RESULT_OPTIONS: { value: ChecklistResult; label: string }[] = [
  { value: 'PASS', label: 'OK' },
  { value: 'FAIL', label: 'Problem' },
  { value: 'NA', label: 'N/A' },
];

function CompleteForm({ template, roomId, onCancel, onDone }: { template: ChecklistTemplate; roomId: string; onCancel: () => void; onDone: () => void }) {
  const [results, setResults] = useState<Record<string, ChecklistResult>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  // One id per attempt, so a double-click or retry is stored once.
  const [completionId] = useState(() => crypto.randomUUID());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const answered = template.items.filter((i) => results[i.id]).length;
  const missingNote = template.items.some((i) => results[i.id] === 'FAIL' && !notes[i.id]?.trim());
  const failures = template.items.filter((i) => results[i.id] === 'FAIL').length;

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      await api.post('/checklists/completions', {
        id: completionId,
        templateId: template.id,
        roomId,
        results: template.items.map((i) => ({ itemId: i.id, result: results[i.id], note: notes[i.id]?.trim() || undefined })),
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Checklist not saved');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{template.name}</CardTitle>
        <span className="text-sm text-muted">
          {answered} of {template.items.length} answered
        </span>
      </CardHeader>
      <CardContent className="space-y-3">
        {template.items.map((item) => (
          <div key={item.id} className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center gap-3">
              <p className="min-w-0 flex-1 text-sm font-medium text-foreground">{item.label}</p>
              <div className="flex gap-1" role="radiogroup" aria-label={item.label}>
                {RESULT_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={results[item.id] === o.value}
                    onClick={() => setResults((prev) => ({ ...prev, [item.id]: o.value }))}
                    className={clsx(
                      'rounded-lg border px-3 py-1 text-sm font-medium transition-colors',
                      results[item.id] === o.value
                        ? o.value === 'FAIL'
                          ? 'border-danger bg-danger-surface text-danger'
                          : 'border-primary bg-primary-muted text-primary'
                        : 'border-border bg-surface text-foreground hover:bg-muted-surface',
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            {results[item.id] === 'FAIL' && (
              <Input
                aria-label={`What was wrong with ${item.label}`}
                placeholder="What was wrong, and what did you do about it?"
                value={notes[item.id] ?? ''}
                onChange={(e) => setNotes((prev) => ({ ...prev, [item.id]: e.target.value }))}
                maxLength={1000}
              />
            )}
          </div>
        ))}
        {failures > 0 && (
          <div className="flex items-center gap-2 rounded-lg bg-warning-surface px-3 py-2 text-sm text-warning">
            <AlertTriangle size={16} /> {failures === 1 ? 'This problem' : `These ${failures} problems`} will be sent to the centre admins when you submit.
          </div>
        )}
        {error && <ErrorBanner message={error} />}
        <div className="flex gap-2">
          <Button onClick={submit} disabled={submitting || answered < template.items.length || missingNote}>
            {submitting ? 'Saving…' : 'Submit checklist'}
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ManageTemplates({ rooms, onChanged }: { rooms: Room[]; onChanged: () => void }) {
  const [templates, setTemplates] = useState<ChecklistTemplate[] | null>(null);
  const [name, setName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [items, setItems] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => api.get<ChecklistTemplate[]>('/checklists/templates').then(setTemplates), []);
  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [load]);

  const itemList = items.split('\n').map((l) => l.trim()).filter(Boolean);
  const roomName = (id: string | null) => (id ? rooms.find((r) => r.id === id)?.name ?? 'One room' : 'Every room');

  async function create() {
    setSaving(true);
    setError(null);
    try {
      await api.post('/checklists/templates', { name: name.trim(), roomId: roomId || undefined, items: itemList });
      setName('');
      setItems('');
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Checklist not saved');
    } finally {
      setSaving(false);
    }
  }

  async function archive(id: string) {
    try {
      await api.post(`/checklists/templates/${id}/archive`);
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not archive');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Manage checklists</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {templates && templates.length > 0 && (
          <div className="divide-y divide-border">
            {templates.map((t) => (
              <div key={t.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{t.name}</p>
                  <p className="text-xs text-muted">
                    {roomName(t.roomId)} · {t.items.length} items
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => archive(t.id)} aria-label={`Archive ${t.name}`}>
                  <Archive size={14} /> Archive
                </Button>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-muted">Checklists can&apos;t be edited once created, so past completions always match what was asked. To change one, add a new version and archive the old one.</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="tname">Name</Label>
            <Input id="tname" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Outdoor safety check" maxLength={200} />
          </div>
          <div>
            <Label htmlFor="troom">Applies to</Label>
            <Select id="troom" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              <option value="">Every room</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="titems">Items, one per line</Label>
            <Textarea id="titems" value={items} onChange={(e) => setItems(e.target.value)} placeholder={'Sandpit covered overnight\nFences intact\nNo hazards in garden beds'} className="min-h-28" />
          </div>
        </div>
        {error && <ErrorBanner message={error} />}
        <Button onClick={create} disabled={saving || !name.trim() || itemList.length === 0}>
          <Plus size={14} /> {saving ? 'Saving…' : `Add checklist (${itemList.length} items)`}
        </Button>
      </CardContent>
    </Card>
  );
}
