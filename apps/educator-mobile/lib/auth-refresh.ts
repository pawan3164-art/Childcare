export type RefreshOutcome = 'ok' | 'rejected' | 'unavailable';

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Swaps the saved refresh token for a new pair at POST /auth/refresh.
 *
 * - 'rejected': the server says the session is over (expired, revoked, or the
 *   token was already used), so the parent must sign in again.
 * - 'unavailable': we could not find out (offline, server error, rate limit,
 *   or saving the new tokens failed). The parent stays signed in and the
 *   request can be tried again; a flaky connection must never sign anyone out.
 */
export function createRefresher(opts: {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  getRefreshToken: () => string | null;
  onTokens: (tokens: Tokens) => void | Promise<void>;
}): () => Promise<RefreshOutcome> {
  const doFetch = opts.fetchImpl ?? fetch;

  return async () => {
    const refreshToken = opts.getRefreshToken();
    if (!refreshToken) return 'rejected';

    let res: Response;
    try {
      res = await doFetch(`${opts.baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      return 'unavailable';
    }

    if (res.status === 400 || res.status === 401) return 'rejected';
    if (!res.ok) return 'unavailable';

    let body: { accessToken?: unknown; refreshToken?: unknown } | undefined;
    try {
      body = JSON.parse(await res.text());
    } catch {
      return 'rejected';
    }
    if (typeof body?.accessToken !== 'string' || !body.accessToken || typeof body?.refreshToken !== 'string' || !body.refreshToken) {
      return 'rejected';
    }

    try {
      await opts.onTokens({ accessToken: body.accessToken, refreshToken: body.refreshToken });
    } catch {
      return 'unavailable';
    }
    return 'ok';
  };
}
