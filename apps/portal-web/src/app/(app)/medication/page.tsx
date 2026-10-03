'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle, Check, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { PageSpinner, ErrorBanner } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Select, Label, Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/format';
import type { ChildListItem, MedicationAdministrationListItem, MedicationAuthorization } from '@/lib/types';

interface GuardianRelationship {
  guardianUserId: string;
}

const STATUS_TONE = { CONFIRMED: 'success', PENDING_REVIEW: 'warning', REJECTED: 'danger' } as const;

export default function MedicationPage() {
  const [children, setChildren] = useState<ChildListItem[] | null>(null);
  const [administrations, setAdministrations] = useState<MedicationAdministrationListItem[] | null>(null);
  const [authorizations, setAuthorizations] = useState<MedicationAuthorization[]>([]);
  const [selectedChildId, setSelectedChildId] = useState('');
  const [selectedAuthId, setSelectedAuthId] = useState('');
  const [dosageGiven, setDosageGiven] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showAddAuth, setShowAddAuth] = useState(false);
  const [newMedName, setNewMedName] = useState('');
  const [newMedDosage, setNewMedDosage] = useState('');
  const [addingAuth, setAddingAuth] = useState(false);

  function loadAdministrations() {
    api.get<MedicationAdministrationListItem[]>('/medication/administrations').then(setAdministrations);
  }

  useEffect(() => {
    api.get<ChildListItem[]>('/children').then((c) => {
      setChildren(c);
      if (c.length > 0) setSelectedChildId(c[0].id);
    });
    loadAdministrations();
  }, []);

  useEffect(() => {
    if (!selectedChildId) return;
    api.get<MedicationAuthorization[]>(`/medication/authorizations?childId=${selectedChildId}`).then((auths) => {
      setAuthorizations(auths);
      setSelectedAuthId(auths[0]?.id ?? '');
    });
  }, [selectedChildId]);

  async function handleRecord(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.post<{ status: string }>('/medication/administrations', {
        authorizationId: selectedAuthId,
        administeredAt: new Date().toISOString(),
        dosageGiven,
      });
      setNotice(
        result.status === 'PENDING_REVIEW'
          ? 'Recorded — flagged for admin review (another dose was logged recently for this authorisation).'
          : 'Administration recorded.',
      );
      setDosageGiven('');
      loadAdministrations();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to record administration');
    } finally {
      setSubmitting(false);
    }
  }

  async function reloadAuthorizations(childId: string) {
    const auths = await api.get<MedicationAuthorization[]>(`/medication/authorizations?childId=${childId}`);
    setAuthorizations(auths);
    setSelectedAuthId(auths[0]?.id ?? '');
  }

  async function handleAddAuthorization(e: FormEvent) {
    e.preventDefault();
    setAddingAuth(true);
    setError(null);
    try {
      const relationships = await api.get<GuardianRelationship[]>(`/guardian-relationships?childId=${selectedChildId}`);
      const authorizedByGuardianId = relationships[0]?.guardianUserId;
      if (!authorizedByGuardianId) {
        throw new ApiError('This child has no guardian on file to authorise the medication', 400);
      }
      await api.post('/medication/authorizations', {
        childId: selectedChildId,
        medicationName: newMedName,
        dosageInstructions: newMedDosage,
        authorizedByGuardianId,
      });
      setNewMedName('');
      setNewMedDosage('');
      setShowAddAuth(false);
      await reloadAuthorizations(selectedChildId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add authorisation');
    } finally {
      setAddingAuth(false);
    }
  }

  async function resolve(id: string, decision: 'CONFIRMED' | 'REJECTED') {
    setError(null);
    try {
      await api.post(`/medication/administrations/${id}/review`, { decision });
      loadAdministrations();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to resolve');
    }
  }

  if (!children || !administrations) return <PageSpinner />;

  const pending = administrations.filter((a) => a.status === 'PENDING_REVIEW');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Medication</h1>
        <p className="text-sm text-muted">Record administrations and resolve conflicts flagged for review.</p>
      </div>

      {error && <ErrorBanner message={error} />}

      {pending.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-warning">
              <AlertTriangle size={18} /> Needs review ({pending.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pending.map((admin) => (
              <div key={admin.id} className="flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning-surface p-3 text-sm">
                <div>
                  <p className="font-medium text-foreground">
                    {admin.authorization.child.firstName} {admin.authorization.child.lastName} — {admin.authorization.medicationName}
                  </p>
                  <p className="text-muted">
                    {admin.dosageGiven} at {formatDateTime(admin.administeredAt)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => resolve(admin.id, 'CONFIRMED')}>
                    <Check size={14} /> Confirm
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => resolve(admin.id, 'REJECTED')}>
                    <X size={14} /> Reject
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Record an administration</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleRecord} className="grid grid-cols-1 gap-3 sm:grid-cols-4 sm:items-end">
            <div>
              <Label htmlFor="child">Child</Label>
              <Select id="child" value={selectedChildId} onChange={(e) => setSelectedChildId(e.target.value)}>
                {children.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.firstName} {c.lastName}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="auth">Medication</Label>
              <Select id="auth" value={selectedAuthId} onChange={(e) => setSelectedAuthId(e.target.value)} disabled={authorizations.length === 0}>
                {authorizations.length === 0 && <option>No authorisations on file</option>}
                {authorizations.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.medicationName}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="dosage">Dosage given</Label>
              <Input id="dosage" value={dosageGiven} onChange={(e) => setDosageGiven(e.target.value)} placeholder="e.g. 5ml" required />
            </div>
            <Button type="submit" disabled={submitting || !selectedAuthId}>
              {submitting ? 'Recording…' : 'Record'}
            </Button>
          </form>
          {notice && <p className="mt-3 text-sm text-foreground">{notice}</p>}

          {!showAddAuth ? (
            <button
              type="button"
              onClick={() => setShowAddAuth(true)}
              className="mt-3 text-sm text-primary hover:underline"
            >
              + No authorisation listed? Add one for this child
            </button>
          ) : (
            <form onSubmit={handleAddAuthorization} className="mt-3 grid grid-cols-1 gap-3 rounded-lg border border-border bg-muted-surface p-3 sm:grid-cols-3 sm:items-end">
              <div>
                <Label htmlFor="newMedName">Medication name</Label>
                <Input id="newMedName" value={newMedName} onChange={(e) => setNewMedName(e.target.value)} required />
              </div>
              <div>
                <Label htmlFor="newMedDosage">Dosage instructions</Label>
                <Input id="newMedDosage" value={newMedDosage} onChange={(e) => setNewMedDosage(e.target.value)} placeholder="e.g. 5ml as needed" required />
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={addingAuth}>
                  {addingAuth ? 'Adding…' : 'Add'}
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => setShowAddAuth(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent administrations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {administrations.slice(0, 20).map((admin) => (
            <div key={admin.id} className="flex items-center justify-between gap-3 border-b border-border py-2 text-sm last:border-0">
              <div>
                <p className="font-medium text-foreground">
                  {admin.authorization.child.firstName} {admin.authorization.child.lastName} — {admin.authorization.medicationName}
                </p>
                <p className="text-muted">
                  {admin.dosageGiven} · {formatDateTime(admin.administeredAt)}
                </p>
              </div>
              <Badge tone={STATUS_TONE[admin.status]}>{admin.status.replace('_', ' ')}</Badge>
            </div>
          ))}
          {administrations.length === 0 && <p className="text-sm text-muted">No administrations recorded yet.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
