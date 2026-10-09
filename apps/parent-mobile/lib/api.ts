import { createApiClient } from './api-client';

// Set EXPO_PUBLIC_API_URL when building (see eas.json). On a physical device
// "localhost" is the phone itself, so local testing needs your PC's LAN IP.
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

let authToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

/** The auth context registers what happens when the server rejects our token (sign out). */
export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

export const api = createApiClient({
  baseUrl: API_BASE_URL,
  getToken: () => authToken,
  onUnauthorized: () => unauthorizedHandler?.(),
});

export { ApiError } from './api-client';

export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}
