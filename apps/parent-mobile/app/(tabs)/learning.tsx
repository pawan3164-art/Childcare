import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { formatDate } from '@/lib/format';
import { colors, spacing } from '@/lib/theme';
import type { LearningRecordView } from '@/lib/types';
import { Badge, Card, EmptyState, Screen } from '@/components/ui';
import { PhotoGrid } from '@/components/photo-grid';
import { WithChild } from '@/components/with-child';

interface Portfolio {
  child: { id: string; firstName: string; lastName: string };
  items: LearningRecordView[];
}

export default function LearningScreen() {
  return <WithChild>{(child) => <Learning childId={child.id} firstName={child.firstName} />}</WithChild>;
}

/** The child's published observations and learning stories (EYLF V2.0), newest first. */
function Learning({ childId, firstName }: { childId: string; firstName: string }) {
  const portfolio = useLoad(() => api.get<Portfolio>(`/children/${childId}/portfolio`), childId, 'Could not load learning');

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }}
        refreshControl={<RefreshControl refreshing={portfolio.refreshing} onRefresh={portfolio.refresh} />}
      >
        {portfolio.error && <Text style={styles.error}>{portfolio.error}</Text>}
        {!portfolio.data && !portfolio.error && <ActivityIndicator color={colors.primary} />}
        {portfolio.data?.items.length === 0 && (
          <EmptyState
            title={`No learning stories for ${firstName} yet`}
            description="When educators share an observation or learning story, it appears here."
          />
        )}
        {portfolio.data?.items.map((r) => (
          <Card key={r.id} style={{ gap: spacing.sm }}>
            <View style={styles.head}>
              <Badge label={r.kind === 'LEARNING_STORY' ? 'Learning story' : 'Observation'} tone="success" />
              {r.publishedAt && <Text style={styles.date}>{formatDate(r.publishedAt)}</Text>}
            </View>
            <Text style={styles.title}>{r.title}</Text>
            <Text style={styles.body}>{r.observation}</Text>
            {r.interpretation && (
              <View>
                <Text style={styles.label}>What this tells us</Text>
                <Text style={styles.body}>{r.interpretation}</Text>
              </View>
            )}
            {r.nextSteps && (
              <View>
                <Text style={styles.label}>Next steps</Text>
                <Text style={styles.body}>{r.nextSteps}</Text>
              </View>
            )}
            {r.outcomes.length > 0 && (
              <View style={styles.outcomes}>
                {r.outcomes.map((o) => (
                  <Badge key={o.code} label={o.label} />
                ))}
              </View>
            )}
            <PhotoGrid media={r.media} />
            <Text style={styles.by}>Shared by {r.author.firstName}</Text>
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  error: { color: colors.danger, fontSize: 13 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  date: { fontSize: 12, color: colors.muted },
  title: { fontSize: 17, fontWeight: '700', color: colors.foreground },
  body: { fontSize: 14, color: colors.foreground, lineHeight: 20 },
  label: { fontSize: 12, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', marginBottom: 2 },
  outcomes: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  by: { fontSize: 12, color: colors.muted },
});
