import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { api, setAuthToken } from './api-client';
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

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.post<{ mfaRequired: boolean; accessToken?: string }>('/auth/login', {
      email,
      password,
    });
    if (result.mfaRequired || !result.accessToken) {
      throw new Error('MFA is not supported in this app yet — use a demo account without MFA enabled.');
    }
    setAuthToken(result.accessToken);
    const profile = await api.get<UserProfile>('/auth/me');
    setDraftOwner(profile.userId);
    setOutboxOwner(profile.userId);
    setUser(profile);
    // Anything this educator queued before their last session ended can go now.
    flush().catch(() => {});
  }, []);

  const logout = useCallback(() => {
    api.post('/auth/logout').catch(() => {});
    clearAllDrafts();
    clearOutbox();
    setDraftOwner(null);
    setOutboxOwner(null);
    setAuthToken(null);
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
