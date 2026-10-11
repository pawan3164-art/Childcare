'use client';

import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { ImageUp, Palette } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { useBrand } from '@/lib/brand-context';
import { contrastRatio, isHexColor, readableTextOn } from '@/lib/brand';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea } from '@/components/ui/input';
import { ErrorBanner } from '@/components/ui/misc';
import type { BrandView } from '@/lib/types';

const MAX_LOGO_BYTES = 512 * 1024;

/** Organisation administrators set the name, colour, logo and wording every centre and family sees (white label level 1). */
export function BrandingCard() {
  const { user, reloadProfile } = useAuth();
  const live = useBrand();
  const canEdit = user?.role === 'ORG_ADMIN' || user?.role === 'PLATFORM_ADMIN';

  const [brand, setBrand] = useState<BrandView | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [color, setColor] = useState('#0f766e');
  const [welcome, setWelcome] = useState('');
  const [philosophy, setPhilosophy] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<BrandView>('/branding')
      .then((b) => {
        setBrand(b);
        setDisplayName(b.displayName);
        setColor(b.primaryColor);
        setWelcome(b.welcomeMessage ?? '');
        setPhilosophy(b.philosophy ?? '');
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load branding'));
  }, []);

  const validColor = isHexColor(color);
  const contrast = validColor ? contrastRatio(color, '#ffffff') : 0;
  const readable = validColor && contrast >= 4.5;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      setBrand(await api.put<BrandView>('/branding', { displayName, primaryColor: color, welcomeMessage: welcome, philosophy }));
      await reloadProfile();
      setMessage('Branding saved. Families see it the next time they open the app.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save branding');
    } finally {
      setBusy(false);
    }
  }

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) {
      setError('The logo must be 512 KB or smaller.');
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const form = new FormData();
      form.append('file', file);
      setBrand(await api.upload<BrandView>('/branding/logo', form));
      await reloadProfile();
      setMessage('Logo updated.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not upload the logo');
    } finally {
      setBusy(false);
    }
  }

  async function removeLogo() {
    setBusy(true);
    setError(null);
    try {
      setBrand(await api.delete<BrandView>('/branding/logo'));
      await reloadProfile();
      setMessage('Logo removed.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove the logo');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Palette size={16} className="mr-2 inline" />
          Branding
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted">
          Your name, colour and logo appear in the portal, the parent app and the educator app for every centre in your organisation.
        </p>
        {error && <ErrorBanner message={error} />}
        {message && <p className="text-sm text-success">{message}</p>}
        {!canEdit && <p className="text-sm text-muted">Only an organisation administrator can change branding. Current brand: {brand?.displayName ?? '…'}.</p>}

        {canEdit && (
          <form onSubmit={save} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="brand-name">Display name</Label>
                <Input id="brand-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} minLength={2} maxLength={60} required />
              </div>
              <div>
                <Label htmlFor="brand-color">Brand colour</Label>
                <div className="flex items-center gap-2">
                  <input
                    aria-label="Pick a colour"
                    type="color"
                    value={validColor ? color : '#0f766e'}
                    onChange={(e) => setColor(e.target.value)}
                    className="h-10 w-12 cursor-pointer rounded-lg border border-border bg-transparent"
                  />
                  <Input id="brand-color" value={color} onChange={(e) => setColor(e.target.value)} maxLength={7} className="font-mono" required />
                </div>
                <p className={`mt-1 text-xs ${readable ? 'text-success' : 'text-danger'}`}>
                  {!validColor
                    ? 'Use a colour like #0f766e.'
                    : readable
                      ? `Readable: white text has a contrast ratio of ${contrast.toFixed(1)}:1.`
                      : `Too light: white text has a contrast ratio of ${contrast.toFixed(1)}:1 and needs 4.5:1. Choose a darker colour.`}
                </p>
              </div>
            </div>
            <div>
              <Label htmlFor="brand-welcome">Welcome message (sign-in screen, up to 300 characters)</Label>
              <Input id="brand-welcome" value={welcome} onChange={(e) => setWelcome(e.target.value)} maxLength={300} />
            </div>
            <div>
              <Label htmlFor="brand-philosophy">Philosophy statement (shown to signed-in families, up to 2000 characters)</Label>
              <Textarea id="brand-philosophy" value={philosophy} onChange={(e) => setPhilosophy(e.target.value)} maxLength={2000} rows={4} />
            </div>

            <div className="flex flex-wrap items-center gap-4 rounded-lg bg-muted-surface p-3" aria-label="Preview">
              {validColor && (
                <span className="rounded-lg px-3 py-2 text-sm font-medium" style={{ backgroundColor: color, color: readableTextOn(color) }}>
                  {displayName || live.name}
                </span>
              )}
              <span className="text-xs text-muted">Preview of a button in your colour</span>
            </div>

            <Button type="submit" disabled={busy || !readable}>
              {busy ? 'Saving…' : 'Save branding'}
            </Button>
          </form>
        )}

        {canEdit && (
          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-sm font-medium text-foreground">Logo</p>
            {brand?.logoUrl && live.logoUri && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={live.logoUri} alt={`${brand.displayName} logo`} className="h-16 max-w-xs object-contain" />
            )}
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-muted-surface px-3 py-2 text-sm font-medium hover:bg-border/60">
                <ImageUp size={16} /> {brand?.logoUrl ? 'Replace logo' : 'Upload logo'}
                <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={upload} disabled={busy} />
              </label>
              {brand?.logoUrl && (
                <Button variant="ghost" onClick={removeLogo} disabled={busy}>
                  Remove
                </Button>
              )}
            </div>
            <p className="text-xs text-muted">PNG, JPEG or WebP up to 512 KB. It is resized to fit 600 by 300 pixels.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
