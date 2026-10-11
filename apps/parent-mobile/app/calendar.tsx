import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { dayHeading, eventTimeLabel, groupEventsByDay, isCancelled, type EventItem } from '@/lib/calendar';
import { colors, spacing } from '@/lib/theme';
import { Badge, Card, EmptyState, Screen } from '@/components/ui';
import { requestStyles as s } from '@/components/request-ui';
import { useBrand } from '@/lib/brand-context';

/** What is coming up at the centre: excursions, closures, events. Cancelled events stay listed so nobody is left guessing. */
export default function CalendarScreen() {
  const brand = useBrand();
  const events = useLoad(() => api.get<EventItem[]>('/calendar/events'), 'calendar', 'Could not load the calendar');

  if (events.error) {
    return (
      <Screen>
        <Text style={s.error}>{events.error}</Text>
      </Screen>
    );
  }
  if (!events.data) {
    return (
      <Screen>
        <ActivityIndicator color={brand.primary} />
      </Screen>
    );
  }
  const groups = groupEventsByDay(events.data);

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }}>
        {groups.length === 0 ? (
          <EmptyState title="Nothing coming up" description="Events at the centre in the next two months will show here." />
        ) : (
          groups.map((g) => (
            <Card key={g.date} style={{ gap: spacing.sm }}>
              <Text style={s.section}>{dayHeading(g.date)}</Text>
              {g.events.map((e) => (
                <View key={e.id} style={{ gap: 2 }}>
                  <View style={s.row}>
                    <Text style={[s.section, isCancelled(e) && { textDecorationLine: 'line-through', color: colors.muted }]}>{e.title}</Text>
                    {isCancelled(e) && <Badge label="Cancelled" tone="danger" />}
                  </View>
                  <Text style={s.muted}>{eventTimeLabel(e)}</Text>
                  {e.description && !isCancelled(e) && <Text style={s.muted}>{e.description}</Text>}
                  {isCancelled(e) && e.cancelReason && <Text style={s.muted}>{e.cancelReason}</Text>}
                </View>
              ))}
            </Card>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}
