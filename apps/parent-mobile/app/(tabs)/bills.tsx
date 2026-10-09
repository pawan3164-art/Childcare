import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, ApiError } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { formatCents } from '@/lib/format';
import { explainLedger, summariseBalance } from '@/lib/ledger';
import { colors, spacing } from '@/lib/theme';
import type { LedgerBreakdown } from '@/lib/types';
import { Card, EmptyState, Screen } from '@/components/ui';
import { WithChild } from '@/components/with-child';

export default function BillsScreen() {
  return <WithChild>{(child) => <Bills childId={child.id} firstName={child.firstName} />}</WithChild>;
}

function Bills({ childId, firstName }: { childId: string; firstName: string }) {
  const ledger = useLoad(() => api.get<LedgerBreakdown>(`/children/${childId}/ledger`), childId, 'Could not load bills');
  const noAccess = ledger.error !== null && /forbidden|access|permission/i.test(ledger.error);

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }}
        refreshControl={<RefreshControl refreshing={ledger.refreshing} onRefresh={ledger.refresh} />}
      >
        {noAccess && (
          <EmptyState
            title="Billing isn't shared with you"
            description={`You don't have billing access for ${firstName}. Ask the centre if you need it.`}
          />
        )}
        {ledger.error && !noAccess && <Text style={styles.error}>{ledger.error}</Text>}
        {!ledger.data && !ledger.error && <ActivityIndicator color={colors.primary} />}
        {ledger.data && <Balance ledger={ledger.data} />}
      </ScrollView>
    </Screen>
  );
}

function Balance({ ledger }: { ledger: LedgerBreakdown }) {
  const summary = summariseBalance(ledger);
  const tone = { danger: colors.danger, success: colors.success, neutral: colors.foreground }[summary.tone];
  return (
    <>
      <Card style={{ alignItems: 'center', gap: spacing.xs }}>
        <Text style={styles.headline}>{summary.headline}</Text>
        <Text style={[styles.amount, { color: tone }]}>{formatCents(summary.amountCents)}</Text>
      </Card>
      <Card style={{ gap: spacing.sm }}>
        <Text style={styles.sectionTitle}>How this adds up</Text>
        {explainLedger(ledger).map((row) => (
          <View key={row.key} style={styles.row}>
            <Text style={styles.rowLabel}>{row.label}</Text>
            <Text style={styles.rowValue}>{row.text}</Text>
          </View>
        ))}
        <View style={[styles.row, styles.total]}>
          <Text style={[styles.rowLabel, { fontWeight: '700' }]}>Balance</Text>
          <Text style={[styles.rowValue, { color: tone }]}>{formatCents(ledger.balanceCents)}</Text>
        </View>
      </Card>
      <Text style={styles.note}>Payments are recorded by the centre. Online payment in the app is coming later.</Text>
    </>
  );
}

const styles = StyleSheet.create({
  error: { color: colors.danger, fontSize: 13 },
  headline: { fontSize: 13, fontWeight: '600', color: colors.muted, textTransform: 'uppercase' },
  amount: { fontSize: 36, fontWeight: '800' },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.foreground },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  rowLabel: { fontSize: 14, color: colors.foreground },
  rowValue: { fontSize: 14, fontWeight: '600', color: colors.foreground },
  total: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, marginTop: spacing.xs },
  note: { fontSize: 12, color: colors.muted, textAlign: 'center' },
});
