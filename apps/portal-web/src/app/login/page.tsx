'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, ShieldCheck, Sparkles } from 'lucide-react';
import { useAuth, ApiError } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { ErrorBanner } from '@/components/ui/misc';

type Step =
  | { name: 'password' }
  | { name: 'mfa'; mfaToken: string }
  | { name: 'setup'; setupToken: string; secret: string; otpauthUrl: string }
  | { name: 'recovery'; codes: string[] };

export default function LoginPage() {
  const { login, verifyMfa, startMfaSetup, finishMfaSetup } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState('admin@sunshine.test');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<Step>({ name: 'password' });
  const [code, setCode] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function run(action: () => Promise<void>, fallback: string) {
    setError(null);
    setSubmitting(true);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : fallback);
    } finally {
      setSubmitting(false);
    }
  }

  function handleLogin(e: FormEvent) {
    e.preventDefault();
    run(async () => {
      const outcome = await login(email, password);
      if (outcome.kind === 'mfa') setStep({ name: 'mfa', mfaToken: outcome.mfaToken });
      else if (outcome.kind === 'mfa-setup') {
        const { secret, otpauthUrl } = await startMfaSetup(outcome.setupToken);
        setStep({ name: 'setup', setupToken: outcome.setupToken, secret, otpauthUrl });
      } else router.push('/dashboard');
    }, 'Unable to sign in');
  }

  function handleVerifyMfa(e: FormEvent) {
    e.preventDefault();
    if (step.name !== 'mfa') return;
    run(async () => {
      await verifyMfa(step.mfaToken, code.trim());
      router.push('/dashboard');
    }, 'Invalid code');
  }

  function handleFinishSetup(e: FormEvent) {
    e.preventDefault();
    if (step.name !== 'setup') return;
    run(async () => {
      const codes = await finishMfaSetup(step.setupToken, code.trim());
      setCode('');
      setStep({ name: 'recovery', codes });
    }, 'Invalid code');
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
          {step.name === 'password' && (
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
          )}

          {step.name === 'mfa' && (
            <form onSubmit={handleVerifyMfa} className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-muted">
                <ShieldCheck size={16} />
                Enter the 6-digit code from your authenticator app, or a recovery code
              </div>
              <div>
                <Label htmlFor="code">Verification code</Label>
                <Input id="code" autoComplete="one-time-code" maxLength={11} value={code} onChange={(e) => setCode(e.target.value)} required autoFocus />
              </div>
              {error && <ErrorBanner message={error} />}
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? 'Verifying…' : 'Verify'}
              </Button>
            </form>
          )}

          {step.name === 'setup' && (
            <form onSubmit={handleFinishSetup} className="space-y-4">
              <div className="flex items-start gap-2 text-sm text-foreground">
                <KeyRound size={16} className="mt-0.5 shrink-0 text-muted" />
                <span>Your account needs two-step sign-in. Add this key to an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password), then enter the 6-digit code it shows.</span>
              </div>
              <div className="rounded-lg bg-muted-surface p-3">
                <p className="text-xs text-muted">Setup key</p>
                <p className="break-all font-mono text-sm text-foreground" data-testid="mfa-secret">
                  {step.secret}
                </p>
                <a href={step.otpauthUrl} className="mt-2 inline-block text-xs text-primary underline">
                  Open in an authenticator app on this device
                </a>
              </div>
              <div>
                <Label htmlFor="code">6-digit code</Label>
                <Input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} required autoFocus />
              </div>
              {error && <ErrorBanner message={error} />}
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? 'Checking…' : 'Turn on and sign in'}
              </Button>
            </form>
          )}

          {step.name === 'recovery' && (
            <div className="space-y-4">
              <p className="text-sm text-foreground">
                Two-step sign-in is on. Save these recovery codes somewhere safe. Each works once if you lose your phone. They will not be shown again.
              </p>
              <ul className="grid grid-cols-2 gap-2 rounded-lg bg-muted-surface p-3 font-mono text-sm text-foreground" data-testid="recovery-codes">
                {step.codes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
                I have saved these codes
              </label>
              <Button className="w-full" disabled={!saved} onClick={() => router.push('/dashboard')}>
                Continue
              </Button>
            </div>
          )}
        </div>

        {process.env.NODE_ENV !== 'production' && step.name === 'password' && (
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
