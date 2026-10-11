import { createApiClient } from './api-client';
import { createRefresher, type Tokens } from './auth-refresh';
import { sessionStore } from './session-store';

// Set EXPO_PUBLIC_API_URL when building (see eas.json). On a physical device
// "localhost" is the phone itself, so local testing needs your PC's LAN IP.
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

let accessToken: string | null = null;
let refreshToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

/** Holds the pair in memory for requests; pass null on sign-out. Persisting is the caller's job (sessionStore). */
export function setTokens(tokens: Tokens | null) {
  accessToken = tokens?.accessToken ?? null;
  refreshToken = tokens?.refreshToken ?? null;
}

/** The auth context registers what happens when the session is over (sign out). */
export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

// Access tokens last 15 minutes. On a 401 the client swaps the refresh token for a new pair,
// saves it, and retries; only a refused refresh signs the parent out.
const refresh = createRefresher({
  baseUrl: API_BASE_URL,
  getRefreshToken: () => refreshToken,
  onTokens: async (tokens) => {
    setTokens(tokens);
    await sessionStore.save(tokens);
  },
});

export const api = createApiClient({
  baseUrl: API_BASE_URL,
  getToken: () => accessToken,
  onUnauthorized: () => unauthorizedHandler?.(),
  refresh,
});

export { ApiError } from './api-client';

export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}
