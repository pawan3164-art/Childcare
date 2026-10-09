import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { colors, radius, spacing } from '@/lib/theme';
import { useChildren } from '@/lib/children-context';
import { useCentreToday } from '@/lib/use-centre-today';
import type { ChildListItem } from '@/lib/types';
import { Screen } from './ui';
import { ChildHeader } from './child-header';

/** Shared frame for the request screens: child header, then the form for the selected child once the centre's date is known. */
export function RequestScreen({ children }: { children: (child: ChildListItem, today: string) => ReactNode }) {
  const { selected } = useChildren();
  if (!selected) {
    return (
      <Screen>
        <Text style={styles.muted}>Choose a child from the Today tab first.</Text>
      </Screen>
    );
  }
  return <WithToday child={selected}>{children}</WithToday>;
}

function WithToday({ child, children }: { child: ChildListItem; children: (child: ChildListItem, today: string) => ReactNode }) {
  const { today, error } = useCentreToday(child.id);
  return (
    <View style={{ flex: 1 }}>
      <ChildHeader topInset={false} />
      {today ? (
        children(child, today)
      ) : (
        <Screen>{error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.primary} />}</Screen>
      )}
    </View>
  );
}

export function Field({ label, error, ...input }: TextInputProps & { label: string; error?: string }) {
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={[styles.input, !!error && { borderColor: colors.danger }]} accessibilityLabel={label} {...input} />
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

export const requestStyles = StyleSheet.create({
  section: { fontSize: 15, fontWeight: '700', color: colors.foreground },
  muted: { fontSize: 13, color: colors.muted },
  error: { color: colors.danger, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
});

const styles = StyleSheet.create({
  muted: { fontSize: 13, color: colors.muted },
  error: { color: colors.danger, fontSize: 13 },
  label: { fontSize: 13, fontWeight: '600', color: colors.foreground },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    fontSize: 15,
    backgroundColor: colors.surface,
    color: colors.foreground,
  },
});
