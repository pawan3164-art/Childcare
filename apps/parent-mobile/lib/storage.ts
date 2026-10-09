import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { KeyValueStorage } from './session';

/**
 * Keychain / Keystore on phones (the sign-in token is a credential);
 * localStorage when the app runs in a browser, where SecureStore does not exist.
 */
export const storage: KeyValueStorage =
  Platform.OS === 'web'
    ? {
        getItem: async (k) => globalThis.localStorage?.getItem(k) ?? null,
        setItem: async (k, v) => globalThis.localStorage?.setItem(k, v),
        removeItem: async (k) => globalThis.localStorage?.removeItem(k),
      }
    : {
        getItem: (k) => SecureStore.getItemAsync(k),
        setItem: (k, v) => SecureStore.setItemAsync(k, v),
        removeItem: (k) => SecureStore.deleteItemAsync(k),
      };
