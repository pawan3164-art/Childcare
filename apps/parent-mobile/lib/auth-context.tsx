import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, setTokens, setUnauthorizedHandler } from './api';
import { sessionStore } from './session-store';
import type { UserProfile } from './types';

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
    setTokens(null);
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
        const saved = await sessionStore.load(Date.now());
        if (saved) {
          setTokens(saved);
          // An expired access token is renewed here by the client; only a refused renewal ends the session.
          const profile = await api.get<UserProfile>('/auth/me');
          if (profile.role === 'PARENT') setUser(profile);
          else endSession();
        }
      } catch (err) {
        // No connection at launch is not a sign-out: keep the saved session for next time.
        if (!(err instanceof ApiError && err.status === 0)) endSession();
        else setTokens(null);
      } finally {
        setReady(true);
      }
    })();
  }, [endSession]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.post<{ mfaRequired: boolean; accessToken?: string; refreshToken?: string }>('/auth/login', {
      email: email.trim(),
      password,
    });
    if (result.mfaRequired || !result.accessToken || !result.refreshToken) {
      throw new Error('Two-step sign-in is not supported in this app yet.');
    }
    setTokens({ accessToken: result.accessToken, refreshToken: result.refreshToken });
    const profile = await api.get<UserProfile>('/auth/me');
    if (profile.role !== 'PARENT') {
      api.post('/auth/logout').catch(() => {});
      setTokens(null);
      throw new Error('This app is for families. Centre staff should use the Educator app or the web portal.');
    }
    await sessionStore.save({ accessToken: result.accessToken, refreshToken: result.refreshToken });
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
