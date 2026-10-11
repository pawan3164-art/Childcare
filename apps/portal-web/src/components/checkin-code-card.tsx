'use client';

import { useCallback, useEffect, useState } from 'react';
import { QrCode } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ErrorBanner } from '@/components/ui/misc';

interface CodeView {
  code: string;
  validForSeconds: number;
}

const ADMIN_ROLES = ['CENTRE_ADMIN', 'ORG_ADMIN', 'PLATFORM_ADMIN'];

/**
 * Parents can sign their child in or out from the app by typing the code shown here (PAR-015). It changes every
 * minute, so it proves the parent is at the centre. Keep this open on the front-desk screen.
 */
export function CheckInCodeCard() {
  const { user } = useAuth();
  const canToggle = !!user && ADMIN_ROLES.includes(user.role);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [view, setView] = useState<CodeView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCode = useCallback(() => {
    api
      .get<CodeView>('/centre/checkin-code')
      .then(setView)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the code'));
  }, []);

  useEffect(() => {
    api
      .get<{ enabled: boolean }>('/centre/self-sign-in')
      .then((r) => setEnabled(r.enabled))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the setting'));
  }, []);

  // Refresh when the shown code runs out, so it never goes stale on the front-desk screen.
  useEffect(() => {
    if (!enabled) return;
    if (!view) {
      loadCode();
      return;
    }
    const timer = setTimeout(loadCode, Math.max(1, view.validForSeconds) * 1000 + 300);
    return () => clearTimeout(timer);
  }, [enabled, view, loadCode]);

  async function toggle() {
    if (enabled === null) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.put<{ enabled: boolean }>('/centre/self-sign-in', { enabled: !enabled });
      setEnabled(r.enabled);
      setView(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change the setting');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <QrCode size={16} className="mr-2 inline" />
          Parent sign-in from the app
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted">
          Let parents with pickup rights sign their child in and out from the parent app. They type the code below, which changes every minute, so they must be at the centre. Every sign-in is recorded with the parent&rsquo;s name in the audit log.
        </p>
        {error && <ErrorBanner message={error} />}
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={enabled ? 'success' : 'neutral'}>{enabled ? 'On' : 'Off'}</Badge>
          {canToggle && enabled !== null && (
            <Button size="sm" variant="secondary" onClick={toggle} disabled={busy}>
              {enabled ? 'Switch off' : 'Switch on'}
            </Button>
          )}
        </div>
        {enabled && (
          <div className="rounded-lg bg-muted-surface p-4 text-center" aria-live="off">
            <p className="text-xs text-muted">Today&rsquo;s code</p>
            <p className="font-mono text-5xl font-semibold tracking-[0.3em] text-foreground">{view?.code ?? '······'}</p>
            <p className="text-xs text-muted">Changes every minute</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
