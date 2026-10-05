'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, Sparkles } from 'lucide-react';
import { useAuth, ApiError } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { ErrorBanner } from '@/components/ui/misc';

export default function LoginPage() {
  const { login, verifyMfa } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState('admin@sunshine.test');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await login(email, password);
      if (result.mfaRequired && result.mfaToken) {
        setMfaToken(result.mfaToken);
      } else {
        router.push('/dashboard');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to sign in');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerifyMfa(e: FormEvent) {
    e.preventDefault();
    if (!mfaToken) return;
    setError(null);
    setSubmitting(true);
    try {
      await verifyMfa(mfaToken, code);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Invalid code');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Sparkles size={22} />
          </div>
          <h1 className="text-xl font-semibold text-foreground">Next-Gen Childcare</h1>
          <p className="text-sm text-muted">Centre administration portal</p>
        </div>

        <div className="rounded-xl border border-border bg-surface p-6 shadow-elevated">
          {!mfaToken ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
              </div>
              <div>
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
              {error && <ErrorBanner message={error} />}
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleVerifyMfa} className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-muted">
                <ShieldCheck size={16} />
                Enter the 6-digit code from your authenticator app
              </div>
              <div>
                <Label htmlFor="code">Verification code</Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              {error && <ErrorBanner message={error} />}
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? 'Verifying…' : 'Verify'}
              </Button>
            </form>
          )}
        </div>

        {process.env.NODE_ENV !== 'production' && (
          <p className="mt-6 text-center text-xs text-muted">
            Demo accounts: admin@sunshine.test · educator.joeys@sunshine.test · parent.chen@example.test
            <br />
            Password for all: Password123!
          </p>
        )}
      </div>
    </div>
  );
}
