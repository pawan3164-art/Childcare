import { useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { api, errorMessage } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { absenceStatus } from '@/lib/requests';
import { dayLabel } from '@/lib/timeline';
import { spacing } from '@/lib/theme';
import type { AbsenceView } from '@/lib/types';
import { Badge, Button, Card, EmptyState, Screen } from '@/components/ui';
import { DayPicker } from '@/components/day-picker';
import { Field, RequestScreen, requestStyles as s } from '@/components/request-ui';

export default function AbsenceScreen() {
  return <RequestScreen>{(child, today) => <Absence childId={child.id} firstName={child.firstName} today={today} />}</RequestScreen>;
}

function Absence({ childId, firstName, today }: { childId: string; firstName: string; today: string }) {
  const [date, setDate] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const list = useLoad(() => api.get<AbsenceView[]>(`/children/${childId}/absences`), childId, 'Could not load absences');

  async function submit() {
    if (!date) return;
    setSending(true);
    setError(null);
    setDone(null);
    try {
      await api.post(`/children/${childId}/absences`, { date, reason: reason.trim() || undefined });
      setDone(`${firstName} is marked absent on ${dayLabel(date, today)}.`);
      setDate(null);
      setReason('');
      list.reload();
    } catch (err) {
      setError(errorMessage(err, 'Could not report the absence'));
    } finally {
      setSending(false);
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }} keyboardShouldPersistTaps="handled">
        <Text style={s.section}>Which day will {firstName} be away?</Text>
        <DayPicker today={today} count={14} value={date} onChange={setDate} />
        <Field label="Reason (optional)" value={reason} onChangeText={setReason} maxLength={500} placeholder="For example: fever, family trip" />
        <Text style={s.muted}>The centre confirms whether a fee applies. Until then the day is recorded but may still be charged.</Text>
        {error && <Text style={s.error}>{error}</Text>}
        {done && <Text style={{ color: '#15803d', fontSize: 13 }}>{done}</Text>}
        <Button title={sending ? 'Sending…' : 'Report absence'} onPress={submit} loading={sending} disabled={!date} />

        <Text style={[s.section, { marginTop: spacing.md }]}>Reported absences</Text>
        {!list.data && !list.error && <ActivityIndicator />}
        {list.error && <Text style={s.error}>{list.error}</Text>}
        {list.data?.length === 0 && <EmptyState title="No absences reported" />}
        {list.data?.map((a) => {
          const status = absenceStatus(a);
          return (
            <Card key={a.id} style={{ gap: spacing.xs }}>
              <View style={s.row}>
                <Text style={s.section}>{dayLabel(a.date, today)}</Text>
                <Badge label={a.isAllowable ? 'No fee' : 'Fee may apply'} tone={status.tone} />
              </View>
              <Text style={s.muted}>{status.text}</Text>
              {a.reason && <Text style={s.muted}>{a.reason}</Text>}
            </Card>
          );
        })}
      </ScrollView>
    </Screen>
  );
}
