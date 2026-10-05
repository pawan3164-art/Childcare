'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * U1 auto-saved drafts. Unsent text is kept in this browser only (never sent
 * to the API) and cleared on send and on sign-out, since it can name children.
 */
const PREFIX = 'childcare_draft:';
const SAVE_DELAY_MS = 400;

function read(key: string): string {
  try {
    return window.localStorage.getItem(PREFIX + key) ?? '';
  } catch {
    return '';
  }
}

function write(key: string, value: string) {
  try {
    if (value) window.localStorage.setItem(PREFIX + key, value);
    else window.localStorage.removeItem(PREFIX + key);
  } catch {
    // Storage full or blocked: the draft just isn't kept.
  }
}

export function clearAllDrafts() {
  try {
    for (const k of Object.keys(window.localStorage)) {
      if (k.startsWith(PREFIX)) window.localStorage.removeItem(k);
    }
  } catch {
    // nothing to clear
  }
}

/** Like useState<string>, but the value survives reloads until clear() is called. */
export function useDraft(key: string): { value: string; setValue: (v: string) => void; clear: () => void; restored: boolean } {
  const [value, setValueState] = useState('');
  const [restored, setRestored] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const saved = read(key);
    setValueState(saved);
    setRestored(saved.length > 0);
  }, [key]);

  const setValue = useCallback(
    (v: string) => {
      setValueState(v);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => write(key, v), SAVE_DELAY_MS);
    },
    [key],
  );

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    write(key, '');
    setValueState('');
    setRestored(false);
  }, [key]);

  return { value, setValue, clear, restored };
}
