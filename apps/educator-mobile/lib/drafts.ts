import { useCallback, useEffect, useState } from 'react';

/**
 * U1 auto-saved drafts. Kept on this device only, never sent to the API, and
 * cleared on send and on sign-out. On web (expo start --web) drafts persist in
 * localStorage; on native they live in memory, so they survive switching tabs
 * but not an app restart, until the app gets on-device storage (U3).
 */
const PREFIX = 'childcare_draft:';
const memory = new Map<string, string>();

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

function read(key: string): string {
  return storage()?.getItem(PREFIX + key) ?? memory.get(key) ?? '';
}

function write(key: string, value: string) {
  const s = storage();
  try {
    if (value) s?.setItem(PREFIX + key, value);
    else s?.removeItem(PREFIX + key);
  } catch {
    // storage full or blocked: memory copy below still holds it this session
  }
  if (value) memory.set(key, value);
  else memory.delete(key);
}

export function clearAllDrafts() {
  memory.clear();
  const s = storage();
  if (!s) return;
  try {
    for (const k of Object.keys(s)) if (k.startsWith(PREFIX)) s.removeItem(k);
  } catch {
    // nothing to clear
  }
}

export function useDraft(key: string) {
  const [value, setValueState] = useState(() => read(key));
  const [restored, setRestored] = useState(() => read(key).length > 0);

  useEffect(() => {
    const saved = read(key);
    setValueState(saved);
    setRestored(saved.length > 0);
  }, [key]);

  const setValue = useCallback(
    (v: string) => {
      setValueState(v);
      write(key, v);
    },
    [key],
  );

  const clear = useCallback(() => {
    write(key, '');
    setValueState('');
    setRestored(false);
  }, [key]);

  return { value, setValue, clear, restored };
}
