'use client';

import { useCallback, useEffect, useState } from 'react';
import { ToggleLeft } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ErrorBanner } from '@/components/ui/misc';
import type { ModuleEntry } from '@/lib/types';

/**
 * Centre admins choose which optional modules their centre uses. Switching one off hides it for everyone and the
 * server refuses its requests, but nothing is deleted. Safety functions are always on and cannot be switched off.
 */
export function ModulesCard() {
  const { reloadProfile } = useAuth();
  const [modules, setModules] = useState<ModuleEntry[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<ModuleEntry[]>('/modules')
      .then(setModules)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load modules'));
  }, []);

  useEffect(load, [load]);

  async function toggle(m: ModuleEntry) {
    setBusy(m.key);
    setError(null);
    try {
      await api.put(`/modules/${m.key}`, { enabled: !m.enabled });
      await reloadProfile();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change the module');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <ToggleLeft size={16} className="mr-2 inline" />
          Modules
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted">Switch off what your centre does not use. Its data is kept, and you can switch it back on at any time.</p>
        {error && <ErrorBanner message={error} />}
        {modules?.map((m) => (
          <div key={m.key} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
            <div>
              <p className="font-medium text-foreground">{m.label}</p>
              {m.critical && <p className="text-xs text-muted">Always on: this protects children and cannot be switched off.</p>}
              {!m.critical && !m.includedInPlan && <p className="text-xs text-muted">Not included in your current plan.</p>}
            </div>
            <div className="flex items-center gap-3">
              <Badge tone={m.enabled ? 'success' : 'neutral'}>{m.enabled ? 'On' : 'Off'}</Badge>
              {!m.critical && (
                <Button size="sm" variant="secondary" disabled={busy === m.key || !m.includedInPlan} onClick={() => toggle(m)}>
                  {m.enabled ? 'Switch off' : 'Switch on'}
                </Button>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
