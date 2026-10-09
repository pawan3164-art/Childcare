import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useChildren } from '@/lib/children-context';
import { attendanceLabel } from '@/lib/children';
import { ageLabel, initials } from '@/lib/format';
import { colors, radius, spacing } from '@/lib/theme';
import { Avatar, Badge } from './ui';

/** Child-first header shared by the family tabs: who we're looking at, how they're doing, and a switcher for siblings. */
export function ChildHeader({ topInset = true }: { topInset?: boolean }) {
  const { children, selected, select } = useChildren();
  const insets = useSafeAreaInsets();

  if (!selected) {
    return <View style={[styles.wrap, { paddingTop: (topInset ? insets.top : 0) + spacing.md }]} />;
  }

  const status = attendanceLabel(selected.attendanceStatus, selected.previousDayNotSignedOut);

  return (
    <View style={[styles.wrap, { paddingTop: (topInset ? insets.top : 0) + spacing.md }]}>
      <View style={styles.row}>
        <Avatar initials={initials(selected.firstName, selected.lastName)} />
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>
            {selected.firstName} {selected.lastName}
          </Text>
          <Text style={styles.sub} numberOfLines={1}>
            {ageLabel(selected.dateOfBirth, new Date())}
            {selected.roomName ? ` · ${selected.roomName}` : ''}
          </Text>
        </View>
        <Badge label={status.text.length > 24 ? 'Check with centre' : status.text} tone={status.tone === 'neutral' ? 'neutral' : status.tone} />
      </View>
      {children.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {children.map((c) => {
            const active = c.id === selected.id;
            return (
              <Pressable
                key={c.id}
                onPress={() => select(c.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Show ${c.firstName}`}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{c.firstName}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  name: { fontSize: 17, fontWeight: '700', color: colors.foreground },
  sub: { fontSize: 13, color: colors.muted },
  chips: { gap: spacing.sm },
  chip: {
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.mutedSurface,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.foreground },
  chipTextActive: { color: colors.primaryForeground },
});
