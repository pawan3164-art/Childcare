import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setTokens, setUnauthorizedHandler } from './api-client';
import { clearAllDrafts, setDraftOwner } from './drafts';
import { clearOutbox, flush, setOutboxOwner } from './outbox';
import type { UserProfile } from './types';

interface AuthContextValue {
  user: UserProfile | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);

  // The session is over (revoked, expired, or the refresh token was refused): clear local state and show sign-in.
  const endSession = useCallback(() => {
    clearAllDrafts();
    clearOutbox();
    setDraftOwner(null);
    setOutboxOwner(null);
    setTokens(null);
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(endSession);
    return () => setUnauthorizedHandler(null);
  }, [endSession]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.post<{ mfaRequired: boolean; mfaSetupRequired?: boolean; accessToken?: string; refreshToken?: string }>('/auth/login', {
      email,
      password,
    });
    if (result.mfaRequired || result.mfaSetupRequired || !result.accessToken || !result.refreshToken) {
      throw new Error('Two-step sign-in is not supported in this app yet. Use the web portal for accounts that need it.');
    }
    setTokens({ accessToken: result.accessToken, refreshToken: result.refreshToken });
    const profile = await api.get<UserProfile>('/auth/me');
    setDraftOwner(profile.userId);
    setOutboxOwner(profile.userId);
    setUser(profile);
    // Anything this educator queued before their last session ended can go now.
    flush().catch(() => {});
  }, []);

  const logout = useCallback(() => {
    api.post('/auth/logout').catch(() => {});
    endSession();
  }, [endSession]);

  return <AuthContext.Provider value={{ user, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
