// For `expo start --web` this runs in a real browser, so http://localhost:3000
// works exactly like it does for the portal. Testing on a physical device or
// emulator instead needs this pointed at your machine's LAN IP (localhost on
// a device means the device itself, not your dev machine) — set
// EXPO_PUBLIC_API_URL in .env accordingly.
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

// In-memory only for now — the app re-prompts for login on restart. Fine for
// local testing; persistent storage (expo-secure-store) is a follow-up, not
// a Stage-0-style tenant/RLS concern.
let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...options.headers,
    },
  });

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
};
