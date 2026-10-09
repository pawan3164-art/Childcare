import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setAuthToken, setUnauthorizedHandler } from './api';
import { createSessionStore } from './session';
import { storage } from './storage';
import type { UserProfile } from './types';

const sessionStore = createSessionStore(storage);

interface AuthContextValue {
  user: UserProfile | null;
  /** False while a saved sign-in is being restored at launch. */
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [ready, setReady] = useState(false);

  const endSession = useCallback(() => {
    sessionStore.clear();
    setAuthToken(null);
    setUser(null);
  }, []);

  // Expired or revoked token mid-use: drop back to the sign-in screen.
  useEffect(() => {
    setUnauthorizedHandler(endSession);
    return () => setUnauthorizedHandler(null);
  }, [endSession]);

  // Restore a saved sign-in so parents are not asked for a password on every launch.
  useEffect(() => {
    (async () => {
      try {
        const token = await sessionStore.load(Date.now());
        if (token) {
          setAuthToken(token);
          const profile = await api.get<UserProfile>('/auth/me');
          if (profile.role === 'PARENT') setUser(profile);
          else endSession();
        }
      } catch {
        endSession();
      } finally {
        setReady(true);
      }
    })();
  }, [endSession]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.post<{ mfaRequired: boolean; accessToken?: string }>('/auth/login', {
      email: email.trim(),
      password,
    });
    if (result.mfaRequired || !result.accessToken) {
      throw new Error('Two-step sign-in is not supported in this app yet.');
    }
    setAuthToken(result.accessToken);
    const profile = await api.get<UserProfile>('/auth/me');
    if (profile.role !== 'PARENT') {
      api.post('/auth/logout').catch(() => {});
      setAuthToken(null);
      throw new Error('This app is for families. Centre staff should use the Educator app or the web portal.');
    }
    await sessionStore.save(result.accessToken);
    setUser(profile);
  }, []);

  const logout = useCallback(() => {
    api.post('/auth/logout').catch(() => {});
    endSession();
  }, [endSession]);

  const value = useMemo(() => ({ user, ready, login, logout }), [user, ready, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
