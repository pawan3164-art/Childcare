'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { FileSignature } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import type { ChildListItem } from '@/lib/types';
import { PageSpinner, ErrorBanner, EmptyState } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

type FieldType = 'text' | 'date' | 'yes_no' | 'choice' | 'child_select' | 'signature';

interface FieldDraft {
  key: string;
  type: FieldType;
  label: string;
  required: boolean;
  /** One option per line, for choice fields. */
  options: string;
}

interface TemplateRow {
  id: string;
  title: string;
  description: string | null;
  status: 'DRAFT' | 'PUBLISHED';
  latestVersion: number | null;
  fields: unknown[];
}

interface RequestRow {
  id: string;
  title: string;
  childId: string;
  status: 'PENDING' | 'SIGNED' | 'CANCELLED';
  dueDate: string | null;
  signedAt: string | null;
}

interface SignedDetail {
  id: string;
  title: string;
  templateVersion: number;
  fields: { key: string; type: FieldType; label: string }[];
  childId: string;
  answers: Record<string, unknown>;
  valid: boolean;
  signedAt: string;
  signerTypedName: string | null;
  signature: { strokes: number[][][] } | null;
}

function answerText(type: FieldType, value: unknown, children: ChildListItem[]): string {
  if (value === undefined || value === null || value === '') return 'No answer';
  if (type === 'yes_no') return value === true ? 'Yes' : 'No';
  if (type === 'child_select') return children.find((c) => c.id === value)?.firstName ?? 'A child';
  return String(value);
}

/** The signed form as the family left it: answers, who signed, the drawn signature and whether the record is intact. */
function SignedView({ detail, kids, onClose }: { detail: SignedDetail; kids: ChildListItem[]; onClose: () => void }) {
  const kid = kids.find((c) => c.id === detail.childId);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{detail.title} · version {detail.templateVersion}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted">
          For {kid ? `${kid.firstName} ${kid.lastName}` : 'a child'} · signed by {detail.signerTypedName ?? 'unknown'} on {new Date(detail.signedAt).toLocaleString('en-AU')}
        </p>
        <Badge tone={detail.valid ? 'success' : 'danger'}>{detail.valid ? 'Record intact' : 'Record does not match its checksum'}</Badge>
        <dl className="space-y-1 text-sm">
          {detail.fields.filter((f) => f.type !== 'signature').map((f) => (
            <div key={f.key}>
              <dt className="text-muted">{f.label}</dt>
              <dd className="text-foreground">{answerText(f.type, detail.answers[f.key], kids)}</dd>
            </div>
          ))}
        </dl>
        {detail.signature && (
          <svg viewBox="0 0 300 100" className="h-24 w-72 rounded-md border border-border bg-white" role="img" aria-label="Drawn signature">
            {detail.signature.strokes.map((s, i) => (
              <polyline key={i} fill="none" stroke="black" strokeWidth="1.5" points={s.map(([x, y]) => `${x * 300},${y * 100}`).join(' ')} />
            ))}
          </svg>
        )}
        <Button size="sm" variant="secondary" onClick={onClose}>Close</Button>
      </CardContent>
    </Card>
  );
}

const ADMIN_ROLES = ['CENTRE_ADMIN', 'ORG_ADMIN', 'PLATFORM_ADMIN'];
const TYPE_LABELS: Record<FieldType, string> = {
  text: 'Text',
  date: 'Date',
  yes_no: 'Yes / no',
  choice: 'Choose one',
  child_select: 'Which child',
  signature: 'Signature',
};

/** Letters and digits only, so the key is always valid; the label stays what the family sees. */
function keyFor(label: string, index: number): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return `${base || 'field'}_${index + 1}`;
}

function toFields(drafts: FieldDraft[]) {
  return drafts.map((d, i) => ({
    key: keyFor(d.label, i),
    type: d.type,
    label: d.label.trim(),
    required: d.type === 'signature' ? true : d.required,
    ...(d.type === 'choice' ? { options: d.options.split('\n').map((o) => o.trim()).filter(Boolean) } : {}),
  }));
}

const blankField = (): FieldDraft => ({ key: '', type: 'text', label: '', required: false, options: '' });

/** Digital forms (ADR 0005): build a form, publish it, send it to families, and see who has signed. */
export default function FormsPage() {
  const { user } = useAuth();
  const canEdit = !!user && ADMIN_ROLES.includes(user.role);
  const [templates, setTemplates] = useState<TemplateRow[] | null>(null);
  const [requests, setRequests] = useState<RequestRow[] | null>(null);
  const [children, setChildren] = useState<ChildListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signed, setSigned] = useState<{ id: string; requestId: string }[]>([]);
  const [detail, setDetail] = useState<SignedDetail | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [fields, setFields] = useState<FieldDraft[]>([{ ...blankField(), label: 'Your signature', type: 'signature', required: true }]);

  const [sendTemplate, setSendTemplate] = useState('');
  const [sendChildren, setSendChildren] = useState<string[]>([]);
  const [due, setDue] = useState('');

  const load = useCallback(() => {
    if (!canEdit) return;
    Promise.all([api.get<TemplateRow[]>('/forms/templates'), api.get<RequestRow[]>('/forms/requests'), api.get<ChildListItem[]>('/children'), api.get<{ id: string; requestId: string }[]>('/forms/submissions')])
      .then(([t, r, c, sg]) => {
        setSigned(sg);
        setTemplates(t);
        setRequests(r);
        setChildren(c);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load forms'));
  }, [canEdit]);
  useEffect(load, [load]);

  async function run(action: () => Promise<unknown>, failure: string, done?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (done) setNotice(done);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : failure);
    } finally {
      setBusy(false);
    }
  }

  function create(e: FormEvent) {
    e.preventDefault();
    return run(
      async () => {
        await api.post('/forms/templates', { title, description: description || undefined, fields: toFields(fields) });
        setTitle('');
        setDescription('');
        setFields([{ ...blankField(), label: 'Your signature', type: 'signature', required: true }]);
      },
      'Could not save the form',
      'Saved as a draft. Publish it when it is ready to send.',
    );
  }

  const nameOf = (id: string) => children.find((c) => c.id === id)?.firstName ?? 'Child';
  const setField = (i: number, patch: Partial<FieldDraft>) => setFields((list) => list.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const published = (templates ?? []).filter((t) => t.latestVersion !== null);

  if (!canEdit) {
    return <EmptyState icon={<FileSignature size={32} />} title="Forms are managed by centre administrators" description="Families fill in and sign their forms in the app." />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Forms</h1>
        <p className="text-sm text-muted">Build a form, publish it, and send it to families to fill in and sign in the app. A signed form cannot be changed.</p>
      </div>
      {error && <ErrorBanner message={error} />}
      {notice && <p className="text-sm text-success">{notice}</p>}

      <Card>
        <CardHeader>
          <CardTitle>New form</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={create} className="space-y-3">
            <div><Label htmlFor="f-title">Title</Label><Input id="f-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required placeholder="Excursion permission" /></div>
            <div><Label htmlFor="f-desc">Explanation for families (optional)</Label><Textarea id="f-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} rows={2} /></div>
            <div className="space-y-2">
              {fields.map((f, i) => (
                <div key={i} className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[1fr_10rem_auto]">
                  <div><Label htmlFor={`fl-${i}`}>Question</Label><Input id={`fl-${i}`} value={f.label} onChange={(e) => setField(i, { label: e.target.value })} maxLength={200} required /></div>
                  <div>
                    <Label htmlFor={`ft-${i}`}>Answer type</Label>
                    <Select id={`ft-${i}`} value={f.type} onChange={(e) => setField(i, { type: e.target.value as FieldType })}>
                      {(Object.keys(TYPE_LABELS) as FieldType[]).map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                    </Select>
                  </div>
                  <div className="flex items-end gap-2">
                    {f.type !== 'signature' && <label className="flex items-center gap-1 text-sm text-foreground"><input type="checkbox" checked={f.required} onChange={(e) => setField(i, { required: e.target.checked })} /> Required</label>}
                    <Button type="button" size="sm" variant="ghost" onClick={() => setFields((l) => l.filter((_, j) => j !== i))}>Remove</Button>
                  </div>
                  {f.type === 'choice' && (
                    <div className="sm:col-span-3"><Label htmlFor={`fo-${i}`}>Options (one per line, at least two)</Label><Textarea id={`fo-${i}`} value={f.options} onChange={(e) => setField(i, { options: e.target.value })} rows={3} /></div>
                  )}
                </div>
              ))}
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="secondary" onClick={() => setFields((l) => [...l.filter((x) => x.type !== 'signature'), blankField(), ...l.filter((x) => x.type === 'signature')])} disabled={fields.length >= 50}>Add a question</Button>
                {!fields.some((f) => f.type === 'signature') && <Button type="button" size="sm" variant="secondary" onClick={() => setFields((l) => [...l, { ...blankField(), label: 'Your signature', type: 'signature', required: true }])}>Add a signature</Button>}
              </div>
            </div>
            <Button type="submit" disabled={busy || !title.trim() || fields.length === 0 || fields.some((f) => !f.label.trim())}>Save draft</Button>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-foreground">Your forms</h2>
        {!templates ? (
          <PageSpinner />
        ) : templates.length === 0 ? (
          <EmptyState icon={<FileSignature size={32} />} title="No forms yet" description="Create one above, then publish it to send it." />
        ) : (
          templates.map((t) => (
            <Card key={t.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium text-foreground">{t.title}</p>
                  <p className="text-xs text-muted">{t.fields.length} fields{t.latestVersion ? ` · version ${t.latestVersion} published` : ''}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={t.status === 'PUBLISHED' ? 'success' : 'warning'}>{t.status === 'PUBLISHED' ? 'Published' : t.latestVersion ? 'Edited, not published' : 'Draft'}</Badge>
                  {t.status === 'DRAFT' && <Button size="sm" disabled={busy} onClick={() => run(() => api.post(`/forms/templates/${t.id}/publish`), 'Could not publish', 'Published. You can now send it to families.')}>Publish</Button>}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {published.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Send to families</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                const t = published.find((p) => p.id === sendTemplate);
                if (!t || !t.latestVersion) return;
                return run(
                  async () => {
                    await api.post('/forms/requests', { templateId: t.id, version: t.latestVersion, childIds: sendChildren, dueDate: due || undefined });
                    setSendChildren([]);
                    setDue('');
                  },
                  'Could not send the form',
                  'Sent. Each parent or guardian of the chosen children gets a notification.',
                );
              }}
            >
              <div>
                <Label htmlFor="s-form">Form</Label>
                <Select id="s-form" value={sendTemplate} onChange={(e) => setSendTemplate(e.target.value)} required>
                  <option value="">Choose a form</option>
                  {published.map((t) => <option key={t.id} value={t.id}>{t.title} (version {t.latestVersion})</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="s-due">Due date (optional)</Label>
                <Input id="s-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
              </div>
              <fieldset>
                <legend className="text-sm font-medium text-foreground">Children (each parent and guardian is asked)</legend>
                <div className="mt-1 grid max-h-56 gap-1 overflow-auto sm:grid-cols-2">
                  {children.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-sm text-foreground">
                      <input type="checkbox" checked={sendChildren.includes(c.id)} onChange={(e) => setSendChildren((l) => (e.target.checked ? [...l, c.id] : l.filter((x) => x !== c.id)))} />
                      {c.firstName} {c.lastName}{c.roomName ? ` · ${c.roomName}` : ''}
                    </label>
                  ))}
                </div>
                <Button type="button" size="sm" variant="ghost" onClick={() => setSendChildren(sendChildren.length === children.length ? [] : children.map((c) => c.id))}>
                  {sendChildren.length === children.length ? 'Clear all' : 'Select all'}
                </Button>
              </fieldset>
              <Button type="submit" disabled={busy || !sendTemplate || sendChildren.length === 0}>Send to {sendChildren.length} {sendChildren.length === 1 ? 'child' : 'children'}</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {detail && <SignedView detail={detail} kids={children} onClose={() => setDetail(null)} />}

      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-foreground">Sent forms</h2>
        {!requests ? (
          <PageSpinner />
        ) : requests.length === 0 ? (
          <p className="text-sm text-muted">Nothing sent yet.</p>
        ) : (
          requests.map((r) => (
            <Card key={r.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium text-foreground">{r.title}</p>
                  <p className="text-xs text-muted">For {nameOf(r.childId)}{r.dueDate ? ` · due ${r.dueDate}` : ''}{r.signedAt ? ` · signed ${new Date(r.signedAt).toLocaleDateString('en-AU')}` : ''}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={r.status === 'SIGNED' ? 'success' : r.status === 'PENDING' ? 'warning' : 'neutral'}>{r.status === 'PENDING' ? 'Waiting' : r.status === 'SIGNED' ? 'Signed' : 'Cancelled'}</Badge>
                  {r.status === 'SIGNED' && signed.find((x) => x.requestId === r.id) && (
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(async () => setDetail(await api.get<SignedDetail>(`/forms/submissions/${signed.find((x) => x.requestId === r.id)!.id}`)), 'Could not open the signed form')}>View</Button>
                  )}
                  {r.status === 'PENDING' && <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => api.post(`/forms/requests/${r.id}/cancel`), 'Could not cancel')}>Cancel</Button>}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
