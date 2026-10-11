'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Globe } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ErrorBanner } from '@/components/ui/misc';
import type { DomainView } from '@/lib/types';

/** Serve the portal from the organisation's own web address (white label level 2). Active only after the DNS proof below. */
export function DomainsCard() {
  const { user } = useAuth();
  const canEdit = user?.role === 'ORG_ADMIN' || user?.role === 'PLATFORM_ADMIN';
  const [domains, setDomains] = useState<DomainView[] | null>(null);
  const [hostname, setHostname] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<DomainView[]>('/branding/domains')
      .then(setDomains)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load domains'));
  }, []);

  useEffect(() => {
    if (canEdit) load();
  }, [canEdit, load]);

  async function run(id: string, action: () => Promise<unknown>, failure: string) {
    setBusy(id);
    setError(null);
    try {
      await action();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : failure);
    } finally {
      setBusy(null);
    }
  }

  function add(e: FormEvent) {
    e.preventDefault();
    run('add', async () => {
      await api.post('/branding/domains', { hostname });
      setHostname('');
    }, 'Could not add the domain');
  }

  if (!canEdit) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Globe size={16} className="mr-2 inline" />
          Your own web address
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted">
          Let families and staff open the portal at an address like <strong>portal.yourcentre.com.au</strong>. Add the name, then publish two DNS records at your domain provider and press Verify.
        </p>
        {error && <ErrorBanner message={error} />}

        <form onSubmit={add} className="flex flex-wrap items-end gap-3">
          <div className="min-w-60 flex-1">
            <Label htmlFor="domain">Domain</Label>
            <Input id="domain" value={hostname} onChange={(e) => setHostname(e.target.value)} placeholder="portal.yourcentre.com.au" required />
          </div>
          <Button type="submit" disabled={busy === 'add' || !hostname.trim()}>
            Add domain
          </Button>
        </form>

        {domains?.length === 0 && <p className="text-sm text-muted">No domains yet.</p>}
        {domains?.map((d) => (
          <div key={d.id} className="space-y-2 rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium text-foreground">{d.hostname}</p>
              <div className="flex items-center gap-2">
                <Badge tone={d.status === 'ACTIVE' ? 'success' : 'warning'}>{d.status === 'ACTIVE' ? 'Active' : 'Waiting for DNS'}</Badge>
                {d.status === 'PENDING' && (
                  <Button size="sm" disabled={busy === d.id} onClick={() => run(d.id, () => api.post(`/branding/domains/${d.id}/verify`), 'Could not verify yet')}>
                    Verify
                  </Button>
                )}
                <Button size="sm" variant="ghost" disabled={busy === d.id} onClick={() => run(d.id, () => api.delete(`/branding/domains/${d.id}`), 'Could not remove the domain')}>
                  Remove
                </Button>
              </div>
            </div>
            {d.verification && (
              <div className="space-y-1 text-xs text-muted">
                <p>At your domain provider, add:</p>
                <p>
                  1. A <strong>CNAME</strong> record for <code className="font-mono">{d.hostname}</code> pointing to this portal&rsquo;s address (ask us for it).
                </p>
                <p>
                  2. A <strong>TXT</strong> record named <code className="break-all font-mono">{d.verification.recordName}</code> with the value{' '}
                  <code className="break-all font-mono">{d.verification.recordValue}</code>
                </p>
                <p>DNS changes can take a few minutes to an hour. Press Verify once they are saved.</p>
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
