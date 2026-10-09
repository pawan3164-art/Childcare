import { useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api, ApiError } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { validatePickupForm } from '@/lib/requests';
import { dayLabel } from '@/lib/timeline';
import { colors, spacing } from '@/lib/theme';
import type { PickupNominationView } from '@/lib/types';
import { Badge, Button, Card, EmptyState, Screen } from '@/components/ui';
import { DayPicker } from '@/components/day-picker';
import { Field, RequestScreen, requestStyles as s } from '@/components/request-ui';

export default function PickupScreen() {
  return <RequestScreen>{(child, today) => <Pickup childId={child.id} firstName={child.firstName} today={today} />}</RequestScreen>;
}

function Pickup({ childId, firstName, today }: { childId: string; firstName: string; today: string }) {
  const [date, setDate] = useState<string | null>(null);
  const [personName, setPersonName] = useState('');
  const [personPhone, setPersonPhone] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<{ personName?: string; personPhone?: string }>({});
  const [sending, setSending] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = useLoad(() => api.get<PickupNominationView[]>(`/children/${childId}/pickup-nominations`), childId, 'Could not load pickups');
  const noRights = list.error !== null && /not authorized|forbidden/i.test(list.error);

  function friendly(err: unknown, fallback: string): string {
    if (err instanceof ApiError && err.status === 403) return `You don't have pickup permission for ${firstName}. Ask the centre if this should change.`;
    return err instanceof Error && err.message ? err.message : fallback;
  }

  async function submit() {
    if (!date) return;
    const found = validatePickupForm({ personName, personPhone });
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSending(true);
    setError(null);
    try {
      await api.post(`/children/${childId}/pickup-nominations`, {
        date,
        personName: personName.trim(),
        personPhone: personPhone.trim() || undefined,
        note: note.trim() || undefined,
      });
      setDate(null);
      setPersonName('');
      setPersonPhone('');
      setNote('');
      list.reload();
    } catch (err) {
      setError(friendly(err, 'Could not save the pickup'));
    } finally {
      setSending(false);
    }
  }

  async function cancel(id: string) {
    setCancelling(id);
    setError(null);
    try {
      await api.post(`/pickup-nominations/${id}/cancel`);
      list.reload();
    } catch (err) {
      setError(friendly(err, 'Could not cancel'));
    } finally {
      setCancelling(null);
    }
  }

  if (noRights) {
    return (
      <Screen>
        <EmptyState title="Pickup isn't set up for you" description={`You don't have pickup permission for ${firstName}. Ask the centre if this should change.`} />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }} keyboardShouldPersistTaps="handled">
        <Text style={s.section}>Someone else collecting {firstName}?</Text>
        <DayPicker today={today} count={14} value={date} onChange={setDate} />
        <Field label="Their full name" value={personName} onChangeText={setPersonName} maxLength={100} error={errors.personName} autoCapitalize="words" />
        <Field label="Their phone (optional)" value={personPhone} onChangeText={setPersonPhone} maxLength={20} keyboardType="phone-pad" error={errors.personPhone} />
        <Field label="Note (optional)" value={note} onChangeText={setNote} maxLength={300} />
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Ionicons name="shield-checkmark-outline" size={18} color={colors.primary} />
          <Text style={[s.muted, { flex: 1 }]}>Educators will ask this person for photo ID before {firstName} leaves.</Text>
        </View>
        {error && <Text style={s.error}>{error}</Text>}
        <Button title={sending ? 'Saving…' : 'Save pickup'} onPress={submit} loading={sending} disabled={!date} />

        <Text style={[s.section, { marginTop: spacing.md }]}>Upcoming pickups</Text>
        {!list.data && !list.error && <ActivityIndicator />}
        {list.data?.length === 0 && <EmptyState title="No pickups arranged" />}
        {list.data?.map((n) => (
          <Card key={n.id} style={{ gap: spacing.xs }}>
            <View style={s.row}>
              <Text style={s.section}>{dayLabel(n.date, today)}</Text>
              {n.verified && <Badge label="ID checked" tone="success" />}
            </View>
            <Text style={{ fontSize: 14, color: colors.foreground }}>{n.personName}</Text>
            {n.personPhone && <Text style={s.muted}>{n.personPhone}</Text>}
            {n.note && <Text style={s.muted}>{n.note}</Text>}
            {!n.verified && <Button size="sm" variant="secondary" title="Cancel pickup" onPress={() => cancel(n.id)} loading={cancelling === n.id} />}
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}
