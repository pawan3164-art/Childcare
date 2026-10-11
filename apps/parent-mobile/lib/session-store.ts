import { createSessionStore } from './session';
import { storage } from './storage';

/** The one place the signed-in token pair is persisted (keychain / keystore on phones). */
export const sessionStore = createSessionStore(storage);
