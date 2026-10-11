import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import {
  formatDoseDate,
  immunisationStatusLabel,
  severityLabel,
  severityTone,
  sortAllergies,
  sourceLabel,
  type AllergyItem,
  type ImmunisationItem,
  type ImmunisationStatusKey,
} from '@/lib/health';
import { spacing } from '@/lib/theme';
import { Badge, Card, EmptyState, Screen } from '@/components/ui';
import { RequestScreen, requestStyles as s } from '@/components/request-ui';
import { useBrand } from '@/lib/brand-context';

interface HealthView {
  allergies: AllergyItem[];
  immunisations: ImmunisationItem[];
  immunisationStatus: { status: ImmunisationStatusKey; statementDate: string | null; note: string | null };
}

export default function HealthScreen() {
  return <RequestScreen>{(child) => <Health childId={child.id} firstName={child.firstName} />}</RequestScreen>;
}

/** What the centre has on record for the child. Parents can read it; changes go through the centre so there is one checked record. */
function Health({ childId, firstName }: { childId: string; firstName: string }) {
  const brand = useBrand();
  const health = useLoad(() => api.get<HealthView>(`/children/${childId}/health`), childId, 'Could not load health records');

  if (health.error) {
    return (
      <Screen>
        <Text style={s.error}>{health.error}</Text>
      </Screen>
    );
  }
  if (!health.data) {
    return (
      <Screen>
        <ActivityIndicator color={brand.primary} />
      </Screen>
    );
  }
  const { allergies, immunisations, immunisationStatus } = health.data;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }}>
        <Card style={{ gap: spacing.sm }}>
          <Text style={s.section}>Allergies</Text>
          {allergies.length === 0 ? (
            <Text style={s.muted}>No allergies on record for {firstName}.</Text>
          ) : (
            sortAllergies(allergies).map((a) => (
              <View key={a.id} style={{ gap: 2 }}>
                <View style={s.row}>
                  <Text style={s.section}>{a.allergen}</Text>
                  <Badge label={severityLabel(a.severity)} tone={severityTone(a.severity)} />
                </View>
                {a.reaction && <Text style={s.muted}>Reaction: {a.reaction}</Text>}
                {a.actionPlan && <Text style={s.muted}>Action plan: {a.actionPlan}</Text>}
              </View>
            ))
          )}
          <Text style={s.muted}>Something changed? Tell your centre so the record stays accurate for every educator.</Text>
        </Card>

        <Card style={{ gap: spacing.sm }}>
          <View style={s.row}>
            <Text style={s.section}>Immunisation</Text>
            <Badge label={immunisationStatusLabel(immunisationStatus.status)} tone={immunisationStatus.status === 'UNKNOWN' ? 'warning' : 'success'} />
          </View>
          {immunisationStatus.statementDate && <Text style={s.muted}>Statement dated {formatDoseDate(immunisationStatus.statementDate)}</Text>}
          {immunisations.length === 0 ? (
            <EmptyState title="No doses recorded" description="Bring or send your immunisation history statement to the centre." />
          ) : (
            immunisations.map((i) => (
              <View key={i.id} style={s.row}>
                <View style={{ flex: 1 }}>
                  <Text style={s.section}>{i.vaccine}</Text>
                  <Text style={s.muted}>
                    {formatDoseDate(i.doseDate)} · {sourceLabel(i.source)}
                  </Text>
                </View>
              </View>
            ))
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}
