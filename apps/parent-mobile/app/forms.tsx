import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { useChildren } from '@/lib/children-context';
import { dueLabel, statusTone, type FormRequestItem } from '@/lib/forms';
import { colors, spacing } from '@/lib/theme';
import { Badge, Card, EmptyState, Screen } from '@/components/ui';
import { requestStyles as s } from '@/components/request-ui';
import { useBrand } from '@/lib/brand-context';

const todayLocal = () => new Intl.DateTimeFormat('en-CA').format(new Date());

/** Forms the centre has asked you to fill in and sign, and the ones you have already signed. */
export default function FormsScreen() {
  const brand = useBrand();
  const router = useRouter();
  const { children } = useChildren();
  const forms = useLoad(() => api.get<FormRequestItem[]>('/forms/my-requests'), 'forms', 'Could not load your forms');
  const nameOf = (id: string) => children.find((c) => c.id === id)?.firstName ?? 'Your child';

  if (forms.error) {
    return (
      <Screen>
        <Text style={s.error}>{forms.error}</Text>
      </Screen>
    );
  }
  if (!forms.data) {
    return (
      <Screen>
        <ActivityIndicator color={brand.primary} />
      </Screen>
    );
  }
  const visible = forms.data.filter((f) => f.status !== 'CANCELLED');
  const pending = visible.filter((f) => f.status === 'PENDING');
  const signed = visible.filter((f) => f.status === 'SIGNED');
  const today = todayLocal();

  const row = (f: FormRequestItem) => {
    const due = f.status === 'PENDING' ? dueLabel(f.dueDate, today) : null;
    return (
      <Pressable key={f.id} onPress={() => router.push({ pathname: '/form', params: { id: f.id } })} accessibilityRole="button" accessibilityLabel={`${f.title} for ${nameOf(f.childId)}`}>
        <Card style={{ gap: spacing.xs }}>
          <View style={s.row}>
            <Text style={s.section}>{f.title}</Text>
            <Badge label={f.status === 'PENDING' ? 'To sign' : 'Signed'} tone={statusTone(f.status)} />
          </View>
          <Text style={s.muted}>For {nameOf(f.childId)}</Text>
          {due && <Text style={[s.muted, due === 'Overdue' && { color: colors.danger }]}>{due}</Text>}
        </Card>
      </Pressable>
    );
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }} refreshControl={<RefreshControl refreshing={forms.refreshing} onRefresh={forms.refresh} />}>
        {visible.length === 0 && <EmptyState title="No forms" description="When the centre sends you a form to sign, it will show here." />}
        {pending.length > 0 && <Text style={s.section}>To fill in</Text>}
        {pending.map(row)}
        {signed.length > 0 && <Text style={s.section}>Signed</Text>}
        {signed.map(row)}
      </ScrollView>
    </Screen>
  );
}
