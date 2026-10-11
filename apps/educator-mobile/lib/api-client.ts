// For `expo start --web` this runs in a real browser, so http://localhost:3000
// works exactly like it does for the portal. Testing on a physical device
// or emulator instead needs this pointed at your machine's LAN IP (localhost
// on a device means the device itself, not your dev machine): set
// EXPO_PUBLIC_API_URL in .env accordingly.
//
// The request logic (single-flight token refresh and one retry on 401) lives in
// api-core.ts and auth-refresh.ts, copied from the parent app where it is unit tested.
import { createApiClient, ApiError } from './api-core';
import { createRefresher, type Tokens } from './auth-refresh';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

// In memory only for now: the app asks for a sign-in again after a restart.
// Persistent storage (expo-secure-store) comes with OI-22 (on-device storage).
let authToken: string | null = null;
let refreshToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function setTokens(tokens: Tokens | null) {
  authToken = tokens?.accessToken ?? null;
  refreshToken = tokens?.refreshToken ?? null;
}

export function getAuthToken(): string | null {
  return authToken;
}

/** The auth context registers what happens when the session is over (sign out). */
export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

export { ApiError };

const refresh = createRefresher({
  baseUrl: API_BASE_URL,
  getRefreshToken: () => refreshToken,
  onTokens: (tokens) => setTokens(tokens),
});

export const api = createApiClient({
  baseUrl: API_BASE_URL,
  getToken: () => authToken,
  onUnauthorized: () => unauthorizedHandler?.(),
  refresh,
});
