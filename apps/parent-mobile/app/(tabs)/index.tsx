import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { formatTime } from '@/lib/format';
import { dayLabel, describeTimelineEntry, shiftDay } from '@/lib/timeline';
import { colors, radius, spacing } from '@/lib/theme';
import type { FeedResponse, TimelineResponse } from '@/lib/types';
import { Card, EmptyState, Screen } from '@/components/ui';
import { PhotoGrid } from '@/components/photo-grid';
import { WithChild } from '@/components/with-child';

export default function TodayScreen() {
  return <WithChild>{(child) => <Today childId={child.id} />}</WithChild>;
}

function Today({ childId }: { childId: string }) {
  const router = useRouter();
  // undefined = the centre's "today"; the server tells us which date that is.
  const [requested, setRequested] = useState<string | undefined>(undefined);
  const timeline = useLoad(
    () => api.get<TimelineResponse>(`/children/${childId}/timeline${requested ? `?date=${requested}` : ''}`),
    `${childId}:${requested ?? 'today'}`,
    'Could not load the timeline',
  );
  const feed = useLoad(() => api.get<FeedResponse>(`/children/${childId}/feed`), childId);

  const today = timeline.data?.date ?? null;
  const date = requested ?? today;
  const goTo = (d: string) => setRequested(d === today ? undefined : d);
  const waiting = (feed.data?.items ?? []).filter((i) => i.kind === 'ANNOUNCEMENT' && !i.acknowledged).length;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }}
        refreshControl={
          <RefreshControl
            refreshing={timeline.refreshing}
            onRefresh={() => {
              timeline.refresh();
              feed.reload();
            }}
          />
        }
      >
        {waiting > 0 && (
          <Pressable onPress={() => router.push('/messages')} accessibilityRole="button" style={styles.banner}>
            <Ionicons name="megaphone-outline" size={20} color={colors.warning} />
            <Text style={styles.bannerText}>
              {waiting === 1 ? '1 announcement needs' : `${waiting} announcements need`} your attention
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.warning} />
          </Pressable>
        )}

        <View style={styles.dayNav}>
          <Pressable
            onPress={() => date && goTo(shiftDay(date, -1))}
            disabled={!date}
            accessibilityRole="button"
            accessibilityLabel="Previous day"
            hitSlop={12}
          >
            <Ionicons name="chevron-back" size={22} color={colors.primary} />
          </Pressable>
          <Text style={styles.dayLabel}>{date && today ? dayLabel(date, today) : ' '}</Text>
          <Pressable
            onPress={() => date && goTo(shiftDay(date, 1))}
            disabled={!date || date === today}
            accessibilityRole="button"
            accessibilityLabel="Next day"
            hitSlop={12}
          >
            <Ionicons name="chevron-forward" size={22} color={date === today || !date ? colors.border : colors.primary} />
          </Pressable>
        </View>

        {timeline.error && <Text style={styles.error}>{timeline.error}</Text>}
        {!timeline.data && !timeline.error && <ActivityIndicator color={colors.primary} />}
        {timeline.data?.entries.length === 0 && (
          <EmptyState
            title={date === today ? 'Nothing recorded yet today' : 'Nothing recorded this day'}
            description="Updates from your child's educators appear here as the day goes on."
          />
        )}
        {timeline.data?.entries.map((entry) => {
          const line = describeTimelineEntry(entry);
          return (
            <Card key={`${entry.kind}-${entry.id}`} style={{ gap: spacing.sm }}>
              <View style={styles.entryHead}>
                <Ionicons name={line.icon as never} size={20} color={colors.primary} />
                <Text style={styles.entryTitle}>{line.title}</Text>
                <Text style={styles.entryTime}>{formatTime(entry.at)}</Text>
              </View>
              {line.detail && <Text style={styles.entryDetail}>{line.detail}</Text>}
              {entry.kind === 'PHOTO_POST' && <PhotoGrid media={entry.media} />}
            </Card>
          );
        })}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.warningSurface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  bannerText: { flex: 1, color: colors.warning, fontWeight: '600', fontSize: 14 },
  dayNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dayLabel: { fontSize: 16, fontWeight: '700', color: colors.foreground },
  error: { color: colors.danger, fontSize: 13 },
  entryHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  entryTitle: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.foreground },
  entryTime: { fontSize: 12, color: colors.muted },
  entryDetail: { fontSize: 14, color: colors.foreground },
});
