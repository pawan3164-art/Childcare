import type { RefreshOutcome } from './auth-refresh';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  getToken: () => string | null;
  /** Called when a signed-in request is rejected with 401 and could not be recovered (session over). */
  onUnauthorized?: () => void;
  /** Renews the access token. When present, a 401 is retried once after a successful renewal. */
  refresh?: () => Promise<RefreshOutcome>;
}

export function createApiClient(opts: ApiClientOptions) {
  const doFetch = opts.fetchImpl ?? fetch;
  let refreshing: Promise<RefreshOutcome> | null = null;

  /** Several requests can hit 401 at once; they share one renewal so the single-use refresh token is spent once. */
  function refreshOnce(): Promise<RefreshOutcome> {
    if (!refreshing) {
      refreshing = opts.refresh!().finally(() => {
        refreshing = null;
      });
    }
    return refreshing;
  }

  function send(path: string, options: RequestInit): Promise<Response> {
    const token = opts.getToken();
    const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData;
    return doFetch(`${opts.baseUrl}${path}`, {
      ...options,
      headers: {
        // Multipart bodies need fetch to set Content-Type (with its boundary).
        ...(isForm ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  }

  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    let res = await send(path, options);

    if (res.status === 401 && opts.refresh && path !== '/auth/login' && path !== '/auth/refresh') {
      const outcome = await refreshOnce();
      if (outcome === 'unavailable') throw new ApiError('Could not reach the server, try again', 0);
      // 'ok': try again with the new token. 'rejected': fall through and report the original 401.
      if (outcome === 'ok') res = await send(path, options);
    }

    if (res.status === 204) return undefined as T;

    const text = await res.text();
    let body: any;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }

    if (!res.ok) {
      // A wrong password is also a 401, but the user is not signed in yet: just show the error.
      if (res.status === 401 && path !== '/auth/login') opts.onUnauthorized?.();
      const message = body?.message ?? res.statusText ?? 'Request failed';
      throw new ApiError(Array.isArray(message) ? message.join(', ') : message, res.status);
    }

    return body as T;
  }

  return {
    get: <T>(path: string) => request<T>(path, { method: 'GET' }),
    post: <T>(path: string, data?: unknown) =>
      request<T>(path, { method: 'POST', body: data === undefined ? undefined : JSON.stringify(data) }),
    upload: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', body: form }),
  };
}
