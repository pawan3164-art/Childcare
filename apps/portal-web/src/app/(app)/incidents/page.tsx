'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle, Check } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError } from '@/lib/api-client';
import { PageSpinner, ErrorBanner, EmptyState } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Select, Label, Textarea, Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/format';
import type { ChildListItem, IncidentListItem, IncidentSeverity } from '@/lib/types';

const SEVERITY_TONE = { MINOR: 'neutral', MODERATE: 'warning', SERIOUS: 'danger' } as const;
const ADMIN_ROLES = ['CENTRE_ADMIN', 'ORG_ADMIN', 'PLATFORM_ADMIN'];
const STAFF_ROLES = ['CENTRE_ADMIN', 'ORG_ADMIN', 'PLATFORM_ADMIN', 'EDUCATOR'];

export default function IncidentsPage() {
  const { user } = useAuth();
  const isStaff = user ? STAFF_ROLES.includes(user.role) : false;
  const isAdmin = user ? ADMIN_ROLES.includes(user.role) : false;

  const [incidents, setIncidents] = useState<IncidentListItem[] | null>(null);
  const [children, setChildren] = useState<ChildListItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [childId, setChildId] = useState('');
  const [severity, setSeverity] = useState<IncidentSeverity>('MINOR');
  const [description, setDescription] = useState('');
  const [occurredAt, setOccurredAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);

  function load() {
    api.get<ChildListItem[]>('/children').then((list) => {
      setChildren(list);
      if (list.length > 0) setChildId(list[0].id);
    });
    if (isStaff) {
      api.get<IncidentListItem[]>('/incidents').then(setIncidents).catch((err) => setError(err.message));
    } else {
      setIncidents([]);
    }
  }

  useEffect(load, [isStaff]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post('/incidents', { childId, severity, description, occurredAt: new Date(occurredAt).toISOString() });
      setDescription('');
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create incident');
    } finally {
      setSubmitting(false);
    }
  }

  if (!incidents) return <PageSpinner />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Incidents</h1>
          <p className="text-sm text-muted">Report and track child-safety incidents.</p>
        </div>
        {isStaff && (
          <Button onClick={() => setShowForm((s) => !s)}>{showForm ? 'Cancel' : 'Report incident'}</Button>
        )}
      </div>

      {error && <ErrorBanner message={error} />}

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>New incident report</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <Label htmlFor="child">Child</Label>
                  <Select id="child" value={childId} onChange={(e) => setChildId(e.target.value)}>
                    {children.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.firstName} {c.lastName}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="severity">Severity</Label>
                  <Select id="severity" value={severity} onChange={(e) => setSeverity(e.target.value as IncidentSeverity)}>
                    <option value="MINOR">Minor</option>
                    <option value="MODERATE">Moderate</option>
                    <option value="SERIOUS">Serious</option>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="occurredAt">When it happened</Label>
                  <Input id="occurredAt" type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} required />
                </div>
              </div>
              <div>
                <Label htmlFor="description">What happened</Label>
                <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} required />
              </div>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Submitting…' : 'Submit report'}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {incidents.length === 0 ? (
        <EmptyState icon={<AlertTriangle size={32} />} title="No incidents" description="Nothing has been reported." />
      ) : (
        <div className="space-y-3">
          {incidents.map((incident) => (
            <IncidentRow key={incident.id} incident={incident} isAdmin={isAdmin} onChange={load} />
          ))}
        </div>
      )}
    </div>
  );
}

function IncidentRow({ incident, isAdmin, onChange }: { incident: IncidentListItem; isAdmin: boolean; onChange: () => void }) {
  const [acting, setActing] = useState(false);

  async function acknowledge() {
    setActing(true);
    try {
      await api.post(`/incidents/${incident.id}/acknowledge`);
      onChange();
    } finally {
      setActing(false);
    }
  }

  async function review() {
    setActing(true);
    try {
      await api.post(`/incidents/${incident.id}/review`, {});
      onChange();
    } finally {
      setActing(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4 p-4">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <p className="font-medium text-foreground">
              {incident.child.firstName} {incident.child.lastName}
            </p>
            <Badge tone={SEVERITY_TONE[incident.severity]}>{incident.severity}</Badge>
            <Badge tone={incident.reviewStatus === 'REVIEWED' ? 'success' : 'neutral'}>{incident.reviewStatus}</Badge>
          </div>
          <p className="text-sm text-foreground">{incident.description}</p>
          <p className="mt-1 text-xs text-muted">{formatDateTime(incident.occurredAt)}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="secondary" disabled={acting} onClick={acknowledge}>
            <Check size={14} /> Acknowledge
          </Button>
          {isAdmin && incident.reviewStatus !== 'REVIEWED' && (
            <Button size="sm" disabled={acting} onClick={review}>
              Mark reviewed
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
