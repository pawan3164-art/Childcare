import type { ReactNode } from 'react';
import { ActivityIndicator, Text } from 'react-native';
import { useChildren } from '@/lib/children-context';
import { colors } from '@/lib/theme';
import type { ChildListItem } from '@/lib/types';
import { EmptyState, Screen } from './ui';

/** Renders a tab for the selected child, or the right placeholder while there isn't one. */
export function WithChild({ children }: { children: (child: ChildListItem) => ReactNode }) {
  const { selected, loading, error } = useChildren();
  if (selected) return <>{children(selected)}</>;
  return (
    <Screen>
      {loading && <ActivityIndicator color={colors.primary} />}
      {!loading && error && <Text style={{ color: colors.danger }}>{error}</Text>}
      {!loading && !error && (
        <EmptyState
          title="No children linked yet"
          description="Ask your centre to link your child to this account, then pull down to refresh."
        />
      )}
    </Screen>
  );
}
