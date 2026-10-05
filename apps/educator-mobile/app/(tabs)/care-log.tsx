import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { api, ApiError } from '@/lib/api-client';
import { logGroupCare } from '@/lib/care-offline';
import { Avatar, Badge, Button, Screen } from '@/components/ui';
import { colors, radius, spacing } from '@/lib/theme';
import type { ChildListItem, Room, CareRecordType } from '@/lib/types';

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

const TYPES: { value: CareRecordType; label: string; icon: IconName }[] = [
  { value: 'MEAL', label: 'Meal', icon: 'silverware-fork-knife' },
  { value: 'SLEEP', label: 'Sleep', icon: 'sleep' },
  { value: 'TOILETING', label: 'Toilet', icon: 'human-baby-changing-table' },
  { value: 'BOTTLE', label: 'Bottle', icon: 'baby-bottle-outline' },
  { value: 'ACTIVITY', label: 'Activity', icon: 'palette-outline' },
  { value: 'NAPPY', label: 'Nappy', icon: 'baby-face-outline' },
  { value: 'SUNSCREEN', label: 'Sunscreen', icon: 'white-balance-sunny' },
  { value: 'SLEEP_CHECK', label: 'Sleep check', icon: 'bed-outline' },
];

type Details = Record<string, string>;

/** Structured fields per routine type; validated server-side in care-details.ts. */
const DETAIL_FIELDS: Partial<Record<CareRecordType, { key: string; label: string; options: { value: string; label: string }[] }[]>> = {
  NAPPY: [{ key: 'condition', label: 'Condition', options: [{ value: 'WET', label: 'Wet' }, { value: 'SOILED', label: 'Soiled' }, { value: 'DRY', label: 'Dry' }] }],
  SLEEP: [{ key: 'phase', label: 'Sleep', options: [{ value: '', label: 'Not specified' }, { value: 'START', label: 'Fell asleep' }, { value: 'END', label: 'Woke up' }] }],
  SLEEP_CHECK: [
    { key: 'position', label: 'Position', options: [{ value: 'BACK', label: 'On back' }, { value: 'SIDE', label: 'On side' }, { value: 'FRONT', label: 'On front' }] },
    { key: 'breathingOk', label: 'Breathing', options: [{ value: 'true', label: 'Normal' }, { value: 'false', label: 'Concern' }] },
  ],
};

function defaultDetailsFor(type: CareRecordType): Details {
  return Object.fromEntries((DETAIL_FIELDS[type] ?? []).map((f) => [f.key, f.options[0].value]));
}

/** Option values are strings; the API wants booleans for breathingOk and no empty fields. */
function toApiDetails(d: Details | undefined): Record<string, unknown> | undefined {
  if (!d) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) {
    if (v === '') continue;
    out[k] = v === 'true' ? true : v === 'false' ? false : v;
  }
  return Object.keys(out).length ? out : undefined;
}

export default function CareLogScreen() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [children, setChildren] = useState<ChildListItem[] | null>(null);
  const [type, setType] = useState<CareRecordType>('MEAL');
  const [note, setNote] = useState('');
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [groupDetails, setGroupDetails] = useState<Details>({});
  const [childDetails, setChildDetails] = useState<Record<string, Details>>({});
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
    setChildDetails({});
  }, [roomId]);

  useEffect(() => {
    setGroupDetails(defaultDetailsFor(type));
    setChildDetails({});
  }, [type]);

  const includedCount = useMemo(() => (children?.length ?? 0) - excluded.size, [children, excluded]);
  const fields = DETAIL_FIELDS[type] ?? [];
  const firstField = fields[0];
  const flagged = type === 'SLEEP_CHECK' && (groupDetails.position === 'FRONT' || groupDetails.breathingOk === 'false');
  const typeLabel = TYPES.find((t) => t.value === type)?.label.toLowerCase();

  function toggle(childId: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(childId)) next.delete(childId);
      else next.add(childId);
      return next;
    });
  }

  /** Tapping a child's chip cycles their value for the first field; returning to the group value drops the exception. */
  function cycleChildDetail(childId: string) {
    if (!firstField) return;
    const opts = firstField.options.map((o) => o.value);
    const current = childDetails[childId]?.[firstField.key] ?? groupDetails[firstField.key];
    const nextValue = opts[(opts.indexOf(current) + 1) % opts.length];
    setChildDetails((prev) => {
      const next = { ...prev };
      if (nextValue === groupDetails[firstField.key]) delete next[childId];
      else next[childId] = { [firstField.key]: nextValue };
      return next;
    });
  }

  async function submit() {
    if (!children) return;
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const result = await logGroupCare({
        type,
        timestamp: new Date().toISOString(),
        defaultNote: note || undefined,
        defaultDetails: toApiDetails(groupDetails),
        childIds: children.map((c) => c.id),
        exceptions: children
          .filter((c) => excluded.has(c.id) || childDetails[c.id])
          .map((c) =>
            excluded.has(c.id)
              ? { childId: c.id, skip: true }
              : { childId: c.id, details: toApiDetails({ ...groupDetails, ...childDetails[c.id] }) },
          ),
      });
      const who = `${result.count} ${result.count === 1 ? 'child' : 'children'}`;
      setMessage(result.offline ? `You're offline. Saved for ${who}; it will upload automatically.` : `Logged for ${who}.`);
      setNote('');
      setChildDetails({});
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
              <Pressable
                key={room.id}
                onPress={() => setRoomId(room.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected: roomId === room.id }}
              >
                <Badge label={room.name} tone={roomId === room.id ? 'success' : 'neutral'} />
              </Pressable>
            ))}
          </View>
        )}

        <View>
          <Text style={styles.sectionTitle}>Activity</Text>
          <View style={styles.chipRow}>
            {TYPES.map((t) => (
              <Pressable
                key={t.value}
                style={[styles.typeChip, type === t.value && styles.typeChipActive]}
                onPress={() => setType(t.value)}
                accessibilityRole="radio"
                accessibilityState={{ selected: type === t.value }}
              >
                <MaterialCommunityIcons name={t.icon} size={18} color={type === t.value ? colors.primary : colors.muted} />
                <Text style={[styles.typeLabel, type === t.value && styles.typeLabelActive]}>{t.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {fields.map((f) => (
          <View key={f.key}>
            <Text style={styles.sectionTitle}>{f.label} (for the group)</Text>
            <View style={styles.chipRow}>
              {f.options.map((o) => {
                const on = groupDetails[f.key] === o.value;
                return (
                  <Pressable
                    key={o.value}
                    style={[styles.typeChip, on && styles.typeChipActive]}
                    onPress={() => setGroupDetails((prev) => ({ ...prev, [f.key]: o.value }))}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.typeLabel, on && styles.typeLabelActive]}>{o.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
        {flagged && (
          <Text style={styles.warning}>Safe-sleep guidance: babies sleep on their back. This check will be flagged for follow-up.</Text>
        )}

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
                  <Pressable
                    key={child.id}
                    style={[styles.childRow, isExcluded && styles.childRowExcluded]}
                    onPress={() => toggle(child.id)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: !isExcluded }}
                    accessibilityLabel={`Include ${child.firstName} ${child.lastName}`}
                  >
                    <Avatar initials={`${child.firstName[0]}${child.lastName[0]}`} />
                    <Text style={styles.childName}>
                      {child.firstName} {child.lastName}
                    </Text>
                    {firstField && !isExcluded && (
                      <Pressable
                        onPress={() => cycleChildDetail(child.id)}
                        style={[styles.detailChip, childDetails[child.id] && styles.typeChipActive]}
                        accessibilityLabel={`${firstField.label} for ${child.firstName}, tap to change`}
                      >
                        <Text style={styles.typeLabel}>
                          {firstField.options.find((o) => o.value === (childDetails[child.id]?.[firstField.key] ?? groupDetails[firstField.key]))?.label}
                        </Text>
                      </Pressable>
                    )}
                    <MaterialCommunityIcons
                      name={isExcluded ? 'checkbox-blank-outline' : 'checkbox-marked'}
                      size={24}
                      color={isExcluded ? colors.muted : colors.primary}
                    />
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        {error && <Text style={styles.error}>{error}</Text>}
        {message && <Text style={styles.success}>{message}</Text>}

        <Button
          title={submitting ? 'Logging…' : `Log ${typeLabel} for ${includedCount}`}
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
  detailChip: {
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.mutedSurface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  warning: { color: colors.warning, backgroundColor: colors.warningSurface, padding: spacing.md, borderRadius: radius.md },
  error: { color: colors.danger },
  success: { color: colors.success },
});
