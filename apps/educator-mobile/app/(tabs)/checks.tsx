import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { api, ApiError } from '@/lib/api-client';
import { logGroupCare } from '@/lib/care-offline';
import { enqueue, flush, onPendingChange, pendingCount, uuid } from '@/lib/outbox';
import { Badge, Button, Card, EmptyState, Screen } from '@/components/ui';
import { colors, radius, spacing } from '@/lib/theme';
import type { ChecklistResult, ChecklistTemplate, ChildListItem, Room, RoomChecklist, SleepStatus } from '@/lib/types';

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
}

/** U1: safe-sleep checks due now, and the room's daily checklists (completable offline). */
export default function ChecksScreen() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [roster, setRoster] = useState<ChildListItem[]>([]);
  const [sleep, setSleep] = useState<SleepStatus[] | null>(null);
  const [checklists, setChecklists] = useState<RoomChecklist[] | null>(null);
  const [open, setOpen] = useState<ChecklistTemplate | null>(null);
  const [pending, setPending] = useState(pendingCount());
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => onPendingChange(setPending), []);

  useEffect(() => {
    api.get<Room[]>('/rooms').then((r) => {
      setRooms(r);
      if (r.length > 0) setRoomId(r[0].id);
    });
  }, []);

  const load = useCallback(async () => {
    if (!roomId) return;
    try {
      await flush();
      const [s, c, kids] = await Promise.all([
        api.get<SleepStatus[]>(`/rooms/${roomId}/sleep-status`),
        api.get<RoomChecklist[]>(`/rooms/${roomId}/checklists`),
        api.get<ChildListItem[]>(`/children?roomId=${roomId}`),
      ]);
      setSleep(s);
      setChecklists(c);
      setRoster(kids);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Can't reach the server. Checklists you complete will upload when you're back online.");
    }
  }, [roomId]);

  useEffect(() => {
    setOpen(null);
    load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, [load]);

  if (open && roomId) {
    return (
      <ChecklistForm
        template={open}
        roomId={roomId}
        onClose={() => {
          setOpen(null);
          load();
        }}
      />
    );
  }

  const name = (id: string) => roster.find((c) => c.id === id)?.firstName ?? 'Child';

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ gap: spacing.lg }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        {rooms.length > 1 && (
          <View style={styles.chipRow}>
            {rooms.map((room) => (
              <Pressable key={room.id} onPress={() => setRoomId(room.id)} accessibilityRole="radio" accessibilityState={{ selected: roomId === room.id }}>
                <Badge label={room.name} tone={roomId === room.id ? 'success' : 'neutral'} />
              </Pressable>
            ))}
          </View>
        )}

        {pending > 0 && <Text style={styles.pending}>{pending} completed {pending === 1 ? 'check is' : 'checks are'} waiting to upload.</Text>}
        {error && <Text style={styles.error}>{error}</Text>}

        <View>
          <Text style={styles.sectionTitle}>Sleeping now{sleep && sleep.length > 0 ? ` · checks every ${sleep[0].intervalMinutes} min` : ''}</Text>
          {!sleep ? (
            <ActivityIndicator />
          ) : sleep.length === 0 ? (
            <Text style={styles.muted}>No one is asleep. Log &quot;Fell asleep&quot; in Log Care to start sleep-check reminders.</Text>
          ) : (
            <SleepChecks sleep={sleep} name={name} onLogged={load} />
          )}
        </View>

        <View>
          <Text style={styles.sectionTitle}>Room checklists</Text>
          {!checklists ? (
            <ActivityIndicator />
          ) : checklists.length === 0 ? (
            <EmptyState title="No checklists for this room" description="A centre admin can set them up in the portal." />
          ) : (
            <View style={{ gap: spacing.sm }}>
              {checklists.map(({ template, lastCompletion }) => (
                <Pressable key={template.id} style={styles.row} onPress={() => setOpen(template)} accessibilityRole="button" accessibilityLabel={`Start ${template.name}`}>
                  <MaterialCommunityIcons
                    name={lastCompletion ? (lastCompletion.failedCount > 0 ? 'alert-circle' : 'check-circle') : 'checkbox-blank-circle-outline'}
                    size={24}
                    color={lastCompletion ? (lastCompletion.failedCount > 0 ? colors.danger : colors.success) : colors.muted}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{template.name}</Text>
                    <Text style={styles.muted}>
                      {lastCompletion
                        ? `${lastCompletion.failedCount > 0 ? `${lastCompletion.failedCount} failed` : 'Done'} · ${lastCompletion.completedBy.firstName} ${time(lastCompletion.completedAt)}`
                        : 'Not done today'}
                    </Text>
                  </View>
                  <MaterialCommunityIcons name="chevron-right" size={22} color={colors.muted} />
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

const POSITIONS = [
  { value: 'BACK', label: 'On back' },
  { value: 'SIDE', label: 'On side' },
  { value: 'FRONT', label: 'On front' },
];

/** One tap logs a check for every sleeping child; tap a child's position chip to record an exception. */
function SleepChecks({ sleep, name, onLogged }: { sleep: SleepStatus[]; name: (id: string) => string; onLogged: () => void }) {
  const [positions, setPositions] = useState<Record<string, string>>({});
  const [concern, setConcern] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = Date.now();

  const cycle = (id: string) =>
    setPositions((prev) => {
      const order = POSITIONS.map((p) => p.value);
      return { ...prev, [id]: order[(order.indexOf(prev[id] ?? 'BACK') + 1) % order.length] };
    });

  async function log() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const result = await logGroupCare({
        type: 'SLEEP_CHECK',
        timestamp: new Date().toISOString(),
        defaultDetails: { position: 'BACK', breathingOk: true },
        childIds: sleep.map((s) => s.childId),
        exceptions: sleep
          .filter((s) => (positions[s.childId] && positions[s.childId] !== 'BACK') || concern.has(s.childId))
          .map((s) => ({ childId: s.childId, details: { position: positions[s.childId] ?? 'BACK', breathingOk: !concern.has(s.childId) } })),
      });
      const flagged = sleep.filter((s) => positions[s.childId] === 'FRONT' || concern.has(s.childId)).length;
      const saved = result.offline ? "You're offline; saved and will upload automatically." : 'Logged.';
      setMessage(flagged ? `${saved} ${flagged} flagged for follow-up: check on them now.` : `${saved} Sleep check for ${result.count}.`);
      setPositions({});
      setConcern(new Set());
      onLogged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sleep check not saved');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={{ gap: spacing.sm }}>
      {sleep.map((s) => {
        const overdue = s.overdue || new Date(s.nextCheckDueAt).getTime() <= now;
        const pos = positions[s.childId] ?? 'BACK';
        const worry = concern.has(s.childId);
        return (
          <Card key={s.childId} style={[styles.sleepCard, overdue && styles.overdue]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{name(s.childId)}</Text>
              <Text style={[styles.muted, overdue && { color: colors.danger, fontWeight: '700' }]}>
                {overdue ? 'Check overdue' : `Next check ${time(s.nextCheckDueAt)}`}
                {s.lastCheckAt ? ` · last ${time(s.lastCheckAt)}` : ''}
              </Text>
            </View>
            <Pressable onPress={() => cycle(s.childId)} style={[styles.chip, pos === 'FRONT' && styles.chipWarn]} accessibilityLabel={`${name(s.childId)} position: ${pos.toLowerCase()}, tap to change`}>
              <Text style={styles.chipText}>{POSITIONS.find((p) => p.value === pos)?.label}</Text>
            </Pressable>
            <Pressable
              onPress={() =>
                setConcern((prev) => {
                  const next = new Set(prev);
                  if (next.has(s.childId)) next.delete(s.childId);
                  else next.add(s.childId);
                  return next;
                })
              }
              style={[styles.chip, worry && styles.chipWarn]}
              accessibilityLabel={`${name(s.childId)} breathing ${worry ? 'concern' : 'normal'}, tap to change`}
            >
              <Text style={styles.chipText}>{worry ? 'Breathing concern' : 'Breathing OK'}</Text>
            </Pressable>
          </Card>
        );
      })}
      {error && <Text style={styles.error}>{error}</Text>}
      {message && <Text style={styles.success}>{message}</Text>}
      <Button title={saving ? 'Saving…' : `Log sleep check for ${sleep.length}`} onPress={log} loading={saving} />
    </View>
  );
}

const RESULTS: { value: ChecklistResult; label: string }[] = [
  { value: 'PASS', label: 'OK' },
  { value: 'FAIL', label: 'Problem' },
  { value: 'NA', label: 'N/A' },
];

function ChecklistForm({ template, roomId, onClose }: { template: ChecklistTemplate; roomId: string; onClose: () => void }) {
  const [results, setResults] = useState<Record<string, ChecklistResult>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [entityId] = useState(uuid);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const answered = template.items.filter((i) => results[i.id]).length;
  const missingNote = template.items.some((i) => results[i.id] === 'FAIL' && !notes[i.id]?.trim());
  const failures = template.items.filter((i) => results[i.id] === 'FAIL').length;

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      // Through the sync outbox, so it's kept and retried if the device is offline.
      const sent = await enqueue({
        entityType: 'ChecklistCompletion',
        entityId,
        operationType: 'CREATE',
        payload: {
          templateId: template.id,
          roomId,
          completedAt: new Date().toISOString(),
          results: template.items.map((i) => ({ itemId: i.id, result: results[i.id], note: notes[i.id]?.trim() || undefined })),
        },
      });
      if (sent.status === 'rejected') {
        setError(sent.message);
        return;
      }
      // 'queued' means offline: it stays in the outbox and the Checks screen shows it as waiting.
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Checklist not saved');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: spacing.md }}>
        <Pressable onPress={onClose} style={styles.back} accessibilityRole="button" accessibilityLabel="Back to checks">
          <MaterialCommunityIcons name="chevron-left" size={20} color={colors.primary} />
          <Text style={{ color: colors.primary, fontWeight: '600' }}>Checks</Text>
        </Pressable>
        <Text style={styles.title}>{template.name}</Text>
        <Text style={styles.muted}>
          {answered} of {template.items.length} answered
        </Text>
        {template.items.map((item) => (
          <Card key={item.id} style={{ gap: spacing.sm }}>
            <Text style={styles.rowTitle}>{item.label}</Text>
            <View style={styles.chipRow}>
              {RESULTS.map((r) => {
                const on = results[item.id] === r.value;
                return (
                  <Pressable
                    key={r.value}
                    onPress={() => setResults((prev) => ({ ...prev, [item.id]: r.value }))}
                    style={[styles.result, on && (r.value === 'FAIL' ? styles.resultFail : styles.resultOn)]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`${item.label}: ${r.label}`}
                  >
                    <Text style={[styles.chipText, on && { color: r.value === 'FAIL' ? colors.danger : colors.primary }]}>{r.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            {results[item.id] === 'FAIL' && (
              <TextInput
                style={styles.input}
                value={notes[item.id] ?? ''}
                onChangeText={(t) => setNotes((prev) => ({ ...prev, [item.id]: t }))}
                placeholder="What was wrong, and what did you do?"
                maxLength={1000}
                multiline
              />
            )}
          </Card>
        ))}
        {failures > 0 && <Text style={styles.pending}>{failures === 1 ? 'This problem' : `These ${failures} problems`} will be sent to the centre admins.</Text>}
        {error && <Text style={styles.error}>{error}</Text>}
        <Button title={saving ? 'Saving…' : 'Submit checklist'} onPress={submit} loading={saving} disabled={answered < template.items.length || missingNote} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.foreground, marginBottom: spacing.sm, textTransform: 'uppercase' },
  title: { fontSize: 20, fontWeight: '700', color: colors.foreground },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  rowTitle: { fontSize: 15, fontWeight: '600', color: colors.foreground },
  muted: { fontSize: 13, color: colors.muted },
  sleepCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, flexWrap: 'wrap' },
  overdue: { borderColor: colors.danger, backgroundColor: colors.dangerSurface },
  chip: { paddingVertical: 6, paddingHorizontal: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.mutedSurface },
  chipWarn: { borderColor: colors.warning, backgroundColor: colors.warningSurface },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.foreground },
  result: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  resultOn: { borderColor: colors.primary, backgroundColor: colors.primaryMuted },
  resultFail: { borderColor: colors.danger, backgroundColor: colors.dangerSurface },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, minHeight: 50, backgroundColor: colors.surface, color: colors.foreground },
  back: { flexDirection: 'row', alignItems: 'center' },
  pending: { color: colors.warning, backgroundColor: colors.warningSurface, padding: spacing.md, borderRadius: radius.md },
  error: { color: colors.danger },
  success: { color: colors.success },
});
