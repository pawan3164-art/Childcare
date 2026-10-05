'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError, loadStoredToken, setAuthToken } from './api-client';
import { clearAllDrafts, setDraftOwner } from './drafts';
import type { UserProfile } from './types';

interface AuthContextValue {
  user: UserProfile | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ mfaRequired: boolean; mfaToken?: string }>;
  verifyMfa: (mfaToken: string, code: string) => Promise<void>;
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

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.post<{ mfaRequired: boolean; mfaToken?: string; accessToken?: string }>(
      '/auth/login',
      { email, password },
    );
    if (result.mfaRequired) {
      return { mfaRequired: true, mfaToken: result.mfaToken };
    }
    setAuthToken(result.accessToken ?? null);
    await loadProfile();
    return { mfaRequired: false };
  }, [loadProfile]);

  const verifyMfa = useCallback(async (mfaToken: string, code: string) => {
    const result = await api.post<{ accessToken: string }>('/auth/mfa/verify', { mfaToken, code });
    setAuthToken(result.accessToken);
    await loadProfile();
  }, [loadProfile]);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // already-invalid session — still proceed to clear local state
    }
    clearAllDrafts();
    setDraftOwner(null);
    setAuthToken(null);
    setUser(null);
    router.push('/login');
  }, [router]);

  return (
    <AuthContext.Provider value={{ user, loading, login, verifyMfa, logout }}>
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
