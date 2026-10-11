/** Reads the `exp` claim (seconds since epoch) from a JWT without verifying it; the server does that. */
export function decodeJwtExpiry(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '=')));
    return typeof payload?.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

/** Treats malformed tokens as expired; `skewSeconds` retires a token slightly early so a request never races expiry. */
export function isTokenExpired(token: string, nowMs: number, skewSeconds = 30): boolean {
  const exp = decodeJwtExpiry(token);
  return exp === null || exp - skewSeconds <= nowMs / 1000;
}

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const KEY = 'family.session';

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/**
 * Remembers the sign-in across app restarts as a token pair. An expired access
 * token is still returned: the refresh token renews it on first use. Corrupt or
 * partial data is removed. Storage failures degrade to "signed out", never to a crash.
 */
export function createSessionStore(storage: KeyValueStorage) {
  return {
    async save(session: StoredSession): Promise<void> {
      try {
        await storage.setItem(KEY, JSON.stringify({ accessToken: session.accessToken, refreshToken: session.refreshToken }));
      } catch {
        /* the user simply signs in again next launch */
      }
    },
    async load(_nowMs: number): Promise<StoredSession | null> {
      try {
        const raw = await storage.getItem(KEY);
        if (!raw) return null;
        let parsed: { accessToken?: unknown; refreshToken?: unknown } | null = null;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = null;
        }
        if (parsed && isText(parsed.accessToken) && isText(parsed.refreshToken)) {
          return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken };
        }
        await storage.removeItem(KEY).catch(() => {});
        return null;
      } catch {
        return null;
      }
    },
    async clear(): Promise<void> {
      try {
        await storage.removeItem(KEY);
      } catch {
        /* nothing to do */
      }
    },
  };
}
