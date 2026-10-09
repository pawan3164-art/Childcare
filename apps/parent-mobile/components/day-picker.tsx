import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { upcomingDays } from '@/lib/requests';
import { colors, radius, spacing } from '@/lib/theme';

/** A scrolling row of day chips: easier than a native date picker and limited to days the centre will accept. */
export function DayPicker({ today, count, value, onChange }: { today: string; count: number; value: string | null; onChange: (date: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
      {upcomingDays(today, count).map((d) => {
        const active = d.date === value;
        return (
          <Pressable
            key={d.date}
            onPress={() => onChange(d.date)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${d.weekday} ${d.day} ${d.month}`}
            style={[styles.chip, active && styles.chipActive]}
          >
            <Text style={[styles.weekday, active && styles.activeText]}>{d.date === today ? 'Today' : d.weekday}</Text>
            <Text style={[styles.day, active && styles.activeText]}>{d.day}</Text>
            <Text style={[styles.month, active && styles.activeText]}>{d.month}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chip: {
    width: 64,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  weekday: { fontSize: 12, color: colors.muted, fontWeight: '600' },
  day: { fontSize: 20, fontWeight: '800', color: colors.foreground },
  month: { fontSize: 12, color: colors.muted },
  activeText: { color: colors.primaryForeground },
});
