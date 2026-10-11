const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

let authToken: string | null = null;
let refreshToken: string | null = null;

function persist(key: string, value: string | null) {
  if (typeof window === 'undefined') return;
  if (value) window.localStorage.setItem(key, value);
  else window.localStorage.removeItem(key);
}

/** Stores the access/refresh pair (or clears both on null). Browser storage keeps the session across reloads. */
export function setTokens(tokens: { accessToken: string; refreshToken: string } | null) {
  authToken = tokens?.accessToken ?? null;
  refreshToken = tokens?.refreshToken ?? null;
  persist('childcare_token', authToken);
  persist('childcare_refresh', refreshToken);
}

/** Kept for callers that only clear the session. */
export function setAuthToken(token: string | null) {
  if (token === null) setTokens(null);
  else {
    authToken = token;
    persist('childcare_token', token);
  }
}

export function loadStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  authToken = window.localStorage.getItem('childcare_token');
  refreshToken = window.localStorage.getItem('childcare_refresh');
  // An expired access token is fine: the refresh token renews it on the first request.
  return authToken ?? refreshToken;
}

type RefreshOutcome = 'ok' | 'rejected' | 'unavailable';
let refreshing: Promise<RefreshOutcome> | null = null;

/** Several requests can fail together; they share one renewal because each refresh token works once. */
function refreshOnce(): Promise<RefreshOutcome> {
  if (!refreshing) {
    refreshing = renew().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

async function renew(): Promise<RefreshOutcome> {
  if (!refreshToken) return 'rejected';
  try {
    const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (res.status === 400 || res.status === 401) return 'rejected';
    if (!res.ok) return 'unavailable';
    const body = await res.json();
    if (typeof body?.accessToken !== 'string' || typeof body?.refreshToken !== 'string') return 'rejected';
    setTokens({ accessToken: body.accessToken, refreshToken: body.refreshToken });
    return 'ok';
  } catch {
    return 'unavailable';
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

function send(path: string, options: RequestInit): Promise<Response> {
  const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData;
  return fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      // Multipart bodies need the browser to set Content-Type (with its boundary).
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...options.headers,
    },
  });
}

const NO_REFRESH = (path: string) => path.startsWith('/auth/login') || path.startsWith('/auth/refresh') || path.startsWith('/auth/mfa');

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let res = await send(path, options);

  // Access tokens are short-lived: on 401 renew once and retry; only a refused renewal ends the session.
  if (res.status === 401 && !NO_REFRESH(path)) {
    const outcome = await refreshOnce();
    if (outcome === 'unavailable') throw new ApiError('Could not reach the server, try again', 0);
    if (outcome === 'ok') res = await send(path, options);
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;

  if (!res.ok) {
    const message = body?.message ?? res.statusText ?? 'Request failed';
    throw new ApiError(Array.isArray(message) ? message.join(', ') : message, res.status);
  }

  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'POST', body: data ? JSON.stringify(data) : undefined }),
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', body: form }),
  put: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PUT', body: data ? JSON.stringify(data) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  patch: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PATCH', body: data ? JSON.stringify(data) : undefined }),
};
