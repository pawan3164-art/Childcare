import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, errorMessage } from './api';
import { useAuth } from './auth-context';
import { pickSelectedChild } from './children';
import { storage } from './storage';
import type { ChildListItem } from './types';

const SELECTED_KEY = 'family.selectedChild';

interface ChildrenContextValue {
  children: ChildListItem[];
  /** The child every screen is currently showing; null while loading or if the family has none. */
  selected: ChildListItem | null;
  loading: boolean;
  error: string | null;
  select: (childId: string) => void;
  reload: () => Promise<void>;
}

const ChildrenContext = createContext<ChildrenContextValue | null>(null);

/** Child-first navigation: the whole app follows whichever child is selected. */
export function ChildrenProvider({ children: nodes }: { children: ReactNode }) {
  const { user } = useAuth();
  const [list, setList] = useState<ChildListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setList(await api.get<ChildListItem[]>('/children'));
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Could not load your children'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) {
      setList([]);
      setSelectedId(null);
      setLoading(true);
      return;
    }
    storage.getItem(SELECTED_KEY).then((id) => setSelectedId(id)).catch(() => {});
    reload();
  }, [user, reload]);

  const select = useCallback((childId: string) => {
    setSelectedId(childId);
    storage.setItem(SELECTED_KEY, childId).catch(() => {});
  }, []);

  const selected = useMemo(() => pickSelectedChild(list, selectedId), [list, selectedId]);
  const value = useMemo(
    () => ({ children: list, selected, loading, error, select, reload }),
    [list, selected, loading, error, select, reload],
  );
  return <ChildrenContext.Provider value={value}>{nodes}</ChildrenContext.Provider>;
}

export function useChildren(): ChildrenContextValue {
  const ctx = useContext(ChildrenContext);
  if (!ctx) throw new Error('useChildren must be used within ChildrenProvider');
  return ctx;
}
