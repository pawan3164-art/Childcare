import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/lib/api-client';
import { allergySummary, hasSeriousAllergy, severityLabel, sortAllergies, type AllergyItem, type Severity } from '@/lib/health';
import { colors, radius, spacing } from '@/lib/theme';

interface RegisterEntry {
  childId: string;
  firstName: string;
  lastName: string;
  roomName: string | null;
  allergies: { allergen: string; severity: Severity }[];
}

const asItems = (e: RegisterEntry): AllergyItem[] => e.allergies.map((a, i) => ({ id: `${e.childId}-${i}`, allergen: a.allergen, severity: a.severity, reaction: null, actionPlan: null }));

/** Children in the educator's rooms with an allergy on record, most serious first. Silent when there are none. */
export function AllergyRegister() {
  const [entries, setEntries] = useState<RegisterEntry[]>([]);

  const load = useCallback(() => {
    api
      .get<RegisterEntry[]>('/health/allergy-register')
      .then(setEntries)
      .catch(() => setEntries([]));
  }, []);
  useFocusEffect(load);

  if (entries.length === 0) return null;
  return (
    <View style={styles.box} accessibilityRole="summary">
      <View style={styles.header}>
        <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
        <Text style={styles.title}>Allergies in your rooms</Text>
      </View>
      {entries.map((e) => {
        const items = asItems(e);
        const worst = sortAllergies(items)[0];
        return (
          <Text key={e.childId} style={[styles.line, hasSeriousAllergy(items) && styles.serious]}>
            {e.firstName} {e.lastName}: {allergySummary(items)} ({severityLabel(worst.severity)})
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: '#fef2f2', borderRadius: radius.md, padding: spacing.md, gap: 4, marginBottom: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  title: { fontWeight: '700', color: colors.danger },
  line: { fontSize: 13, color: colors.foreground },
  serious: { fontWeight: '700' },
});
