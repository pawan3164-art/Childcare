'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError, loadStoredToken, setAuthToken, setTokens } from './api-client';
import { clearAllDrafts, setDraftOwner } from './drafts';
import type { UserProfile } from './types';

type TokenResponse = { accessToken: string; refreshToken: string };

export type LoginOutcome =
  | { kind: 'signed-in' }
  | { kind: 'mfa'; mfaToken: string }
  /** The account must set up two-step sign-in before it gets a session (admin accounts when enforcement is on). */
  | { kind: 'mfa-setup'; setupToken: string };

interface AuthContextValue {
  user: UserProfile | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<LoginOutcome>;
  verifyMfa: (mfaToken: string, code: string) => Promise<void>;
  startMfaSetup: (setupToken: string) => Promise<{ secret: string; otpauthUrl: string }>;
  /** Confirms the first code, signs in, and returns the one-time recovery codes to show the person. */
  finishMfaSetup: (setupToken: string, code: string) => Promise<string[]>;
  /** Re-reads the profile after something about the account changed (for example MFA was switched on). */
  reloadProfile: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const loadProfile = useCallback(async () => {
    try {
      const profile = await api.get<UserProfile>('/auth/me');
      setDraftOwner(profile.userId);
      setUser(profile);
    } catch {
      setDraftOwner(null);
      setAuthToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const token = loadStoredToken();
    if (token) {
      loadProfile();
    } else {
      setLoading(false);
    }
  }, [loadProfile]);

  const login = useCallback(
    async (email: string, password: string): Promise<LoginOutcome> => {
      const result = await api.post<
        { mfaRequired: true; mfaToken: string } | { mfaRequired: false; mfaSetupRequired: true; setupToken: string } | (TokenResponse & { mfaRequired: false })
      >('/auth/login', { email, password });
      if (result.mfaRequired) return { kind: 'mfa', mfaToken: result.mfaToken };
      if ('mfaSetupRequired' in result) return { kind: 'mfa-setup', setupToken: result.setupToken };
      setTokens({ accessToken: result.accessToken, refreshToken: result.refreshToken });
      await loadProfile();
      return { kind: 'signed-in' };
    },
    [loadProfile],
  );

  const verifyMfa = useCallback(
    async (mfaToken: string, code: string) => {
      const result = await api.post<TokenResponse>('/auth/mfa/verify', { mfaToken, code });
      setTokens(result);
      await loadProfile();
    },
    [loadProfile],
  );

  const startMfaSetup = useCallback((setupToken: string) => api.post<{ secret: string; otpauthUrl: string }>('/auth/mfa/setup/start', { setupToken }), []);

  const finishMfaSetup = useCallback(
    async (setupToken: string, code: string) => {
      const result = await api.post<TokenResponse & { recoveryCodes: string[] }>('/auth/mfa/setup/finish', { setupToken, code });
      setTokens({ accessToken: result.accessToken, refreshToken: result.refreshToken });
      await loadProfile();
      return result.recoveryCodes;
    },
    [loadProfile],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // already-invalid session — still proceed to clear local state
    }
    clearAllDrafts();
    setDraftOwner(null);
    setTokens(null);
    setUser(null);
    router.push('/login');
  }, [router]);

  return (
    <AuthContext.Provider value={{ user, loading, login, verifyMfa, startMfaSetup, finishMfaSetup, reloadProfile: loadProfile, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export { ApiError };
