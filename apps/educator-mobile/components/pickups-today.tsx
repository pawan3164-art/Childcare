import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, ApiError } from '@/lib/api-client';
import { colors, radius, spacing } from '@/lib/theme';
import { Badge, Button } from './ui';

interface Pickup {
  id: string;
  personName: string;
  personPhone: string | null;
  note: string | null;
  verified: boolean;
  child: { id: string; firstName: string; lastName: string };
  roomName: string | null;
}

/**
 * Today's nominated pickups for the educator's rooms: someone other than the usual guardians
 * is collecting. The educator checks photo ID at the door and records it here. Shows nothing
 * when there are none, so it costs no space on a normal day.
 */
export function PickupsToday() {
  const [pickups, setPickups] = useState<Pickup[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<Pickup[]>('/pickup-nominations')
      .then(setPickups)
      .catch(() => {
        /* the roster still works without this panel */
      });
  }, []);

  useFocusEffect(load);

  async function verify(id: string) {
    setBusy(id);
    setError(null);
    try {
      await api.post(`/pickup-nominations/${id}/verify`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record the check');
    } finally {
      setBusy(null);
    }
  }

  if (pickups.length === 0) return null;

  return (
    <View style={styles.wrap} accessibilityRole="summary">
      <View style={styles.head}>
        <Ionicons name="shield-checkmark-outline" size={18} color={colors.warning} />
        <Text style={styles.title}>Nominated pickups today</Text>
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
      {pickups.map((p) => (
        <View key={p.id} style={styles.row}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.child}>
              {p.child.firstName} {p.child.lastName}
              {p.roomName ? <Text style={styles.muted}>  {p.roomName}</Text> : null}
            </Text>
            <Text style={styles.person}>
              Collected by {p.personName}
              {p.personPhone ? <Text style={styles.muted}> · {p.personPhone}</Text> : null}
            </Text>
            {p.note && <Text style={styles.muted}>{p.note}</Text>}
          </View>
          {p.verified ? <Badge label="ID checked" tone="success" /> : <Button size="sm" title="Checked ID" onPress={() => verify(p.id)} loading={busy === p.id} />}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: colors.warningSurface, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm, marginBottom: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { fontSize: 14, fontWeight: '700', color: colors.warning },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.sm, padding: spacing.md },
  child: { fontSize: 15, fontWeight: '600', color: colors.foreground },
  person: { fontSize: 14, color: colors.foreground },
  muted: { fontSize: 12, color: colors.muted, fontWeight: '400' },
  error: { color: colors.danger, fontSize: 13 },
});
