'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { HeartPulse } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ErrorBanner } from '@/components/ui/misc';

type Severity = 'MILD' | 'MODERATE' | 'SEVERE' | 'ANAPHYLAXIS';
type Source = 'CERTIFICATE' | 'AIR_STATEMENT' | 'PARENT_DECLARED';
type Status = 'UNKNOWN' | 'UP_TO_DATE' | 'CATCH_UP_PLAN' | 'MEDICAL_EXEMPTION';

interface Allergy { id: string; allergen: string; severity: Severity; reaction: string | null; actionPlan: string | null }
interface Dose { id: string; vaccine: string; doseDate: string; source: Source }
interface HealthView {
  allergies: Allergy[];
  immunisations: Dose[];
  immunisationStatus: { status: Status; statementDate: string | null; note: string | null; flag: 'OK' | 'CHECK' };
}

const SEVERITY_LABEL: Record<Severity, string> = { MILD: 'Mild', MODERATE: 'Moderate', SEVERE: 'Severe', ANAPHYLAXIS: 'Anaphylaxis risk' };
const SOURCE_LABEL: Record<Source, string> = { CERTIFICATE: 'Certificate', AIR_STATEMENT: 'AIR statement', PARENT_DECLARED: 'Declared by parent' };
const STATUS_LABEL: Record<Status, string> = { UNKNOWN: 'Not recorded', UP_TO_DATE: 'Up to date', CATCH_UP_PLAN: 'On a catch-up plan', MEDICAL_EXEMPTION: 'Medical exemption' };
const selectClass = 'h-10 w-full rounded-lg border border-border bg-transparent px-3 text-sm text-foreground';
const ADMIN_ROLES = ['CENTRE_ADMIN', 'ORG_ADMIN', 'PLATFORM_ADMIN'];

/** Allergies and immunisation for one child. Everyone with access can read; only administrators change it. History is kept. */
export function ChildHealthCard({ childId }: { childId: string }) {
  const { user } = useAuth();
  const canEdit = !!user && ADMIN_ROLES.includes(user.role);
  const [data, setData] = useState<HealthView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [allergen, setAllergen] = useState('');
  const [severity, setSeverity] = useState<Severity>('MODERATE');
  const [reaction, setReaction] = useState('');
  const [actionPlan, setActionPlan] = useState('');
  const [vaccine, setVaccine] = useState('');
  const [doseDate, setDoseDate] = useState('');
  const [source, setSource] = useState<Source>('CERTIFICATE');
  const [status, setStatus] = useState<Status>('UNKNOWN');
  const [statementDate, setStatementDate] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(() => {
    api
      .get<HealthView>(`/children/${childId}/health`)
      .then((h) => {
        setData(h);
        setStatus(h.immunisationStatus.status);
        setStatementDate(h.immunisationStatus.statementDate ?? '');
        setNote(h.immunisationStatus.note ?? '');
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load health records'));
  }, [childId]);

  useEffect(load, [load]);

  async function run(action: () => Promise<unknown>, failure: string, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await action();
      after?.();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : failure);
    } finally {
      setBusy(false);
    }
  }

  function addAllergy(e: FormEvent) {
    e.preventDefault();
    run(
      () => api.post(`/children/${childId}/allergies`, { allergen, severity, reaction: reaction || undefined, actionPlan: actionPlan || undefined }),
      'Could not add the allergy',
      () => { setAllergen(''); setReaction(''); setActionPlan(''); },
    );
  }

  // A reason is needed so the record explains itself later. window.prompt keeps this card small.
  function ended(a: Allergy) {
    const reason = window.prompt(`Why is the ${a.allergen} allergy being removed? (for example "Outgrown, doctor's letter")`);
    if (reason) run(() => api.post(`/children/${childId}/allergies/${a.id}/end`, { reason }), 'Could not end the allergy');
  }

  function voided(d: Dose) {
    const reason = window.prompt(`Why is this ${d.vaccine} record being voided? (for example "Entered against the wrong child")`);
    if (reason) run(() => api.post(`/children/${childId}/immunisations/${d.id}/void`, { reason }), 'Could not void the record');
  }

  function addDose(e: FormEvent) {
    e.preventDefault();
    run(() => api.post(`/children/${childId}/immunisations`, { vaccine, doseDate, source }), 'Could not add the dose', () => { setVaccine(''); setDoseDate(''); });
  }

  function saveStatus(e: FormEvent) {
    e.preventDefault();
    run(() => api.put(`/children/${childId}/immunisation-status`, { status, statementDate: statementDate || undefined, note: note || undefined }), 'Could not save the status');
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <HeartPulse size={16} className="mr-2 inline" />
          Health
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {error && <ErrorBanner message={error} />}

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Allergies</h3>
          {data?.allergies.length === 0 && <p className="text-sm text-muted">No allergies on record.</p>}
          {data?.allergies.map((a) => (
            <div key={a.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border p-3">
              <div>
                <p className="font-medium text-foreground">{a.allergen}</p>
                {a.reaction && <p className="text-xs text-muted">Reaction: {a.reaction}</p>}
                {a.actionPlan && <p className="text-xs text-muted">Action plan: {a.actionPlan}</p>}
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={a.severity === 'MILD' ? 'neutral' : a.severity === 'MODERATE' ? 'warning' : 'danger'}>{SEVERITY_LABEL[a.severity]}</Badge>
                {canEdit && <Button size="sm" variant="ghost" disabled={busy} onClick={() => ended(a)}>Remove</Button>}
              </div>
            </div>
          ))}
          {canEdit && (
            <form onSubmit={addAllergy} className="grid gap-3 sm:grid-cols-2">
              <div><Label htmlFor="allergen">Allergen</Label><Input id="allergen" value={allergen} onChange={(e) => setAllergen(e.target.value)} maxLength={100} required /></div>
              <div>
                <Label htmlFor="severity">Severity</Label>
                <select id="severity" className={selectClass} value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
                  {(Object.keys(SEVERITY_LABEL) as Severity[]).map((s) => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}
                </select>
              </div>
              <div><Label htmlFor="reaction">Reaction (optional)</Label><Input id="reaction" value={reaction} onChange={(e) => setReaction(e.target.value)} maxLength={1000} /></div>
              <div><Label htmlFor="plan">Action plan (optional)</Label><Input id="plan" value={actionPlan} onChange={(e) => setActionPlan(e.target.value)} maxLength={1000} /></div>
              <div className="sm:col-span-2"><Button type="submit" disabled={busy || !allergen.trim()}>Add allergy</Button></div>
            </form>
          )}
        </section>

        <section className="space-y-2 border-t border-border pt-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Immunisation</h3>
            {data && (
              <Badge tone={data.immunisationStatus.flag === 'OK' ? 'success' : 'warning'}>
                {STATUS_LABEL[data.immunisationStatus.status]}
                {data.immunisationStatus.flag === 'CHECK' ? ' · check' : ''}
              </Badge>
            )}
          </div>
          {data?.immunisations.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-foreground">{d.vaccine} <span className="text-muted">· {d.doseDate} · {SOURCE_LABEL[d.source]}</span></span>
              {canEdit && <Button size="sm" variant="ghost" disabled={busy} onClick={() => voided(d)}>Void</Button>}
            </div>
          ))}
          {canEdit && (
            <>
              <form onSubmit={addDose} className="grid gap-3 sm:grid-cols-3">
                <div><Label htmlFor="vaccine">Vaccine</Label><Input id="vaccine" value={vaccine} onChange={(e) => setVaccine(e.target.value)} maxLength={100} required /></div>
                <div><Label htmlFor="dose-date">Dose date</Label><Input id="dose-date" type="date" value={doseDate} onChange={(e) => setDoseDate(e.target.value)} required /></div>
                <div>
                  <Label htmlFor="source">Source</Label>
                  <select id="source" className={selectClass} value={source} onChange={(e) => setSource(e.target.value as Source)}>
                    {(Object.keys(SOURCE_LABEL) as Source[]).map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-3"><Button type="submit" disabled={busy || !vaccine.trim() || !doseDate}>Add dose</Button></div>
              </form>
              <form onSubmit={saveStatus} className="grid gap-3 sm:grid-cols-3">
                <div>
                  <Label htmlFor="status">Status</Label>
                  <select id="status" className={selectClass} value={status} onChange={(e) => setStatus(e.target.value as Status)}>
                    {(Object.keys(STATUS_LABEL) as Status[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </select>
                </div>
                <div><Label htmlFor="statement">Statement date</Label><Input id="statement" type="date" value={statementDate} onChange={(e) => setStatementDate(e.target.value)} /></div>
                <div><Label htmlFor="status-note">Note{status === 'MEDICAL_EXEMPTION' ? ' (required)' : ''}</Label><Input id="status-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></div>
                <div className="sm:col-span-3"><Button type="submit" variant="secondary" disabled={busy || (status === 'MEDICAL_EXEMPTION' && !note.trim())}>Save status</Button></div>
              </form>
            </>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
