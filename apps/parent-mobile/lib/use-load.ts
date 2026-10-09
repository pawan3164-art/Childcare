import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from './api';

/**
 * Load data for a screen and expose pull-to-refresh. Reloads when `key`
 * changes (e.g. a different child or day). Ignores a slow response that
 * arrives after the key has already moved on.
 */
export function useLoad<T>(fetcher: () => Promise<T>, key: string | null, fallbackError = 'Could not load') {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef(0);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;

  const load = useCallback(async () => {
    const id = ++latest.current;
    try {
      const result = await fetchRef.current();
      if (id === latest.current) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (id === latest.current) setError(errorMessage(err, fallbackError));
    }
  }, [fallbackError]);

  useEffect(() => {
    if (key === null) return;
    setData(null);
    setError(null);
    load();
  }, [key, load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return { data, error, refreshing, refresh, reload: load, setData };
}
