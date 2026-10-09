import { useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { api, errorMessage } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { casualDayStatus } from '@/lib/requests';
import { dayLabel } from '@/lib/timeline';
import { spacing } from '@/lib/theme';
import type { CasualDayRequestView } from '@/lib/types';
import { Badge, Button, Card, EmptyState, Screen } from '@/components/ui';
import { DayPicker } from '@/components/day-picker';
import { Field, RequestScreen, requestStyles as s } from '@/components/request-ui';

export default function CasualDayScreen() {
  return <RequestScreen>{(child, today) => <CasualDay childId={child.id} firstName={child.firstName} today={today} />}</RequestScreen>;
}

function CasualDay({ childId, firstName, today }: { childId: string; firstName: string; today: string }) {
  const [date, setDate] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = useLoad(() => api.get<CasualDayRequestView[]>(`/children/${childId}/casual-day-requests`), childId, 'Could not load requests');

  async function submit() {
    if (!date) return;
    setSending(true);
    setError(null);
    try {
      await api.post(`/children/${childId}/casual-day-requests`, { date, note: note.trim() || undefined });
      setDate(null);
      setNote('');
      list.reload();
    } catch (err) {
      setError(errorMessage(err, 'Could not send the request'));
    } finally {
      setSending(false);
    }
  }

  async function cancel(id: string) {
    setCancelling(id);
    setError(null);
    try {
      await api.post(`/casual-day-requests/${id}/cancel`);
      list.reload();
    } catch (err) {
      setError(errorMessage(err, 'Could not cancel the request'));
    } finally {
      setCancelling(null);
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }} keyboardShouldPersistTaps="handled">
        <Text style={s.section}>Which extra day does {firstName} need?</Text>
        <DayPicker today={today} count={28} value={date} onChange={setDate} />
        <Field label="Note for the centre (optional)" value={note} onChangeText={setNote} maxLength={500} />
        <Text style={s.muted}>The centre will approve or decline. If approved, the day is booked and billed at the normal rate.</Text>
        {error && <Text style={s.error}>{error}</Text>}
        <Button title={sending ? 'Sending…' : 'Request this day'} onPress={submit} loading={sending} disabled={!date} />

        <Text style={[s.section, { marginTop: spacing.md }]}>Your requests</Text>
        {!list.data && !list.error && <ActivityIndicator />}
        {list.error && <Text style={s.error}>{list.error}</Text>}
        {list.data?.length === 0 && <EmptyState title="No requests yet" />}
        {list.data?.map((r) => {
          const status = casualDayStatus(r.status, r.declineReason);
          return (
            <Card key={r.id} style={{ gap: spacing.xs }}>
              <View style={s.row}>
                <Text style={s.section}>{dayLabel(r.date, today)}</Text>
                <Badge label={status.text.length > 22 ? status.text.split(':')[0] : status.text} tone={status.tone} />
              </View>
              {status.text.includes(':') && <Text style={s.muted}>{status.text}</Text>}
              {r.note && <Text style={s.muted}>{r.note}</Text>}
              {r.status === 'PENDING' && (
                <Button size="sm" variant="secondary" title="Cancel request" onPress={() => cancel(r.id)} loading={cancelling === r.id} />
              )}
            </Card>
          );
        })}
      </ScrollView>
    </Screen>
  );
}
