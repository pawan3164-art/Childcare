'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Users, UserCheck, AlertTriangle, Pill, ArrowRight } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api-client';
import { StatTile, PageSpinner, ErrorBanner } from '@/components/ui/misc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ChildGlanceCard } from '@/components/child-glance-card';
import type { ChildListItem, IncidentListItem, MedicationAdministrationListItem } from '@/lib/types';

export default function DashboardPage() {
  const { user } = useAuth();
  const [children, setChildren] = useState<ChildListItem[] | null>(null);
  const [incidents, setIncidents] = useState<IncidentListItem[] | null>(null);
  const [pendingMeds, setPendingMeds] = useState<MedicationAdministrationListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isStaff = user?.role !== 'PARENT';

  useEffect(() => {
    if (!user) return;
    Promise.all([
      api.get<ChildListItem[]>('/children'),
      isStaff ? api.get<IncidentListItem[]>('/incidents') : Promise.resolve([]),
      isStaff ? api.get<MedicationAdministrationListItem[]>('/medication/administrations?status=PENDING_REVIEW') : Promise.resolve([]),
    ])
      .then(([childrenRes, incidentsRes, medsRes]) => {
        setChildren(childrenRes);
        setIncidents(incidentsRes);
        setPendingMeds(medsRes);
      })
      .catch((err) => setError(err.message));
  }, [user, isStaff]);

  if (error) return <ErrorBanner message={error} />;
  if (!children) return <PageSpinner />;

  if (!isStaff) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Good to see you, {user?.firstName}</h1>
          <p className="text-sm text-muted">Here&apos;s what&apos;s happening with your family today.</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {children.map((child) => (
            <ChildGlanceCard key={child.id} childId={child.id} />
          ))}
          {children.length === 0 && (
            <p className="text-sm text-muted">No children linked to your account yet.</p>
          )}
        </div>
      </div>
    );
  }

  const signedInCount = children.filter((c) => c.attendanceStatus === 'SIGNED_IN').length;
  const openIncidents = (incidents ?? []).filter((i) => i.reviewStatus !== 'REVIEWED');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{user?.centreName}</h1>
        <p className="text-sm text-muted">Today&apos;s overview</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Children enrolled" value={children.length} icon={<Users size={18} />} tone="primary" />
        <StatTile label="Signed in today" value={signedInCount} icon={<UserCheck size={18} />} tone="primary" />
        <StatTile
          label="Open incidents"
          value={openIncidents.length}
          icon={<AlertTriangle size={18} />}
          tone={openIncidents.length > 0 ? 'danger' : 'neutral'}
        />
        <StatTile
          label="Medication reviews pending"
          value={pendingMeds?.length ?? 0}
          icon={<Pill size={18} />}
          tone={(pendingMeds?.length ?? 0) > 0 ? 'warning' : 'neutral'}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent incidents</CardTitle>
            <Link href="/incidents" className="flex items-center gap-1 text-sm text-primary hover:underline">
              View all <ArrowRight size={14} />
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {(incidents ?? []).slice(0, 5).map((incident) => (
              <div key={incident.id} className="flex items-center justify-between gap-3 text-sm">
                <div>
                  <p className="font-medium text-foreground">
                    {incident.child.firstName} {incident.child.lastName}
                  </p>
                  <p className="text-muted">{incident.description}</p>
                </div>
                <Badge tone={incident.severity === 'SERIOUS' ? 'danger' : incident.severity === 'MODERATE' ? 'warning' : 'neutral'}>
                  {incident.severity}
                </Badge>
              </div>
            ))}
            {(incidents ?? []).length === 0 && <p className="text-sm text-muted">No incidents recorded.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Medication awaiting review</CardTitle>
            <Link href="/medication" className="flex items-center gap-1 text-sm text-primary hover:underline">
              View all <ArrowRight size={14} />
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {(pendingMeds ?? []).slice(0, 5).map((med) => (
              <div key={med.id} className="flex items-center justify-between gap-3 text-sm">
                <div>
                  <p className="font-medium text-foreground">
                    {med.authorization.child.firstName} {med.authorization.child.lastName}
                  </p>
                  <p className="text-muted">{med.authorization.medicationName}</p>
                </div>
                <Badge tone="warning">Needs review</Badge>
              </div>
            ))}
            {(pendingMeds ?? []).length === 0 && <p className="text-sm text-muted">Nothing pending review.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
