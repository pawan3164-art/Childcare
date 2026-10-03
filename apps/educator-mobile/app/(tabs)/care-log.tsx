import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, ApiError } from '@/lib/api-client';
import { Avatar, Badge, Button, Screen } from '@/components/ui';
import { colors, radius, spacing } from '@/lib/theme';
import type { ChildListItem, Room, CareRecordType } from '@/lib/types';

const TYPES: { value: CareRecordType; label: string; emoji: string }[] = [
  { value: 'MEAL', label: 'Meal', emoji: '🍽️' },
  { value: 'SLEEP', label: 'Sleep', emoji: '🌙' },
  { value: 'TOILETING', label: 'Toilet', emoji: '🧷' },
  { value: 'BOTTLE', label: 'Bottle', emoji: '🍼' },
  { value: 'ACTIVITY', label: 'Activity', emoji: '🎨' },
];

export default function CareLogScreen() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [children, setChildren] = useState<ChildListItem[] | null>(null);
  const [type, setType] = useState<CareRecordType>('MEAL');
  const [note, setNote] = useState('');
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Room[]>('/rooms').then((r) => {
      setRooms(r);
      if (r.length > 0) setRoomId(r[0].id);
    });
  }, []);

  useEffect(() => {
    if (!roomId) return;
    api.get<ChildListItem[]>(`/children?roomId=${roomId}`).then(setChildren);
    setExcluded(new Set());
  }, [roomId]);

  const includedCount = useMemo(() => (children?.length ?? 0) - excluded.size, [children, excluded]);

  function toggle(childId: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(childId)) next.delete(childId);
      else next.add(childId);
      return next;
    });
  }

  async function submit() {
    if (!children) return;
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.post<{ records: unknown[] }>('/care-records/group', {
        type,
        timestamp: new Date().toISOString(),
        defaultNote: note || undefined,
        childIds: children.map((c) => c.id),
        exceptions: children.filter((c) => excluded.has(c.id)).map((c) => ({ childId: c.id, skip: true })),
      });
      setMessage(`Logged for ${result.records.length} ${result.records.length === 1 ? 'child' : 'children'}.`);
      setNote('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to log');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: spacing.lg }}>
        {rooms.length > 1 && (
          <View style={styles.chipRow}>
            {rooms.map((room) => (
              <Badge key={room.id} label={room.name} tone={roomId === room.id ? 'success' : 'neutral'} />
            ))}
          </View>
        )}

        <View>
          <Text style={styles.sectionTitle}>Activity</Text>
          <View style={styles.chipRow}>
            {TYPES.map((t) => (
              <View
                key={t.value}
                style={[styles.typeChip, type === t.value && styles.typeChipActive]}
                onTouchEnd={() => setType(t.value)}
              >
                <Text style={styles.typeEmoji}>{t.emoji}</Text>
                <Text style={[styles.typeLabel, type === t.value && styles.typeLabelActive]}>{t.label}</Text>
              </View>
            ))}
          </View>
        </View>

        <View>
          <Text style={styles.sectionTitle}>Note for the group (optional)</Text>
          <TextInput
            style={styles.textarea}
            value={note}
            onChangeText={setNote}
            placeholder="e.g. Ate all of their lunch"
            multiline
          />
        </View>

        <View>
          <Text style={styles.sectionTitle}>
            Children — {includedCount} of {children?.length ?? 0} included
          </Text>
          {!children ? (
            <ActivityIndicator />
          ) : (
            <View style={{ gap: spacing.sm }}>
              {children.map((child) => {
                const isExcluded = excluded.has(child.id);
                return (
                  <View key={child.id} style={[styles.childRow, isExcluded && styles.childRowExcluded]} onTouchEnd={() => toggle(child.id)}>
                    <Avatar initials={`${child.firstName[0]}${child.lastName[0]}`} />
                    <Text style={styles.childName}>
                      {child.firstName} {child.lastName}
                    </Text>
                    <Text style={styles.checkbox}>{isExcluded ? '☐' : '☑️'}</Text>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {error && <Text style={styles.error}>{error}</Text>}
        {message && <Text style={styles.success}>{message}</Text>}

        <Button
          title={submitting ? 'Logging…' : `Log ${type.toLowerCase()} for ${includedCount}`}
          onPress={submit}
          loading={submitting}
          disabled={submitting || !children || children.length === 0}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.foreground, marginBottom: spacing.sm, textTransform: 'uppercase' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.mutedSurface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  typeChipActive: { backgroundColor: colors.primaryMuted, borderColor: colors.primary },
  typeEmoji: { fontSize: 16 },
  typeLabel: { fontSize: 13, fontWeight: '600', color: colors.foreground },
  typeLabelActive: { color: colors.primary },
  textarea: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 60,
    backgroundColor: colors.surface,
    color: colors.foreground,
  },
  childRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  childRowExcluded: { opacity: 0.5 },
  childName: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.foreground },
  checkbox: { fontSize: 18 },
  error: { color: colors.danger },
  success: { color: colors.success },
});
