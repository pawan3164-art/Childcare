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
  /** Called when a signed-in request is rejected with 401 (expired or revoked session). */
  onUnauthorized?: () => void;
}

export function createApiClient(opts: ApiClientOptions) {
  const doFetch = opts.fetchImpl ?? fetch;

  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = opts.getToken();
    const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData;
    const res = await doFetch(`${opts.baseUrl}${path}`, {
      ...options,
      headers: {
        // Multipart bodies need fetch to set Content-Type (with its boundary).
        ...(isForm ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

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
