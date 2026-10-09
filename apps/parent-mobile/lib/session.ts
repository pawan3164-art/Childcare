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

/** Remembers the sign-in across app restarts. Storage failures degrade to "signed out", never to a crash. */
export function createSessionStore(storage: KeyValueStorage) {
  return {
    async save(token: string): Promise<void> {
      try {
        await storage.setItem(KEY, token);
      } catch {
        /* the user simply signs in again next launch */
      }
    },
    async load(nowMs: number): Promise<string | null> {
      try {
        const token = await storage.getItem(KEY);
        if (!token) return null;
        if (isTokenExpired(token, nowMs)) {
          await storage.removeItem(KEY).catch(() => {});
          return null;
        }
        return token;
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
