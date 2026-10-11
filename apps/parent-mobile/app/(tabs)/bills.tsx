import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRef, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { formatCents } from '@/lib/format';
import { explainLedger, summariseBalance } from '@/lib/ledger';
import { newIdempotencyKey, payOption, resultMessage, type CardPaymentResult, type PaymentConfig } from '@/lib/pay';
import { colors, spacing } from '@/lib/theme';
import type { LedgerBreakdown } from '@/lib/types';
import { Button, Card, EmptyState, Screen } from '@/components/ui';
import { WithChild } from '@/components/with-child';
import { useBrand } from '@/lib/brand-context';

export default function BillsScreen() {
  return <WithChild>{(child) => <Bills childId={child.id} firstName={child.firstName} />}</WithChild>;
}

function Bills({ childId, firstName }: { childId: string; firstName: string }) {
  const brand = useBrand();
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
        {!ledger.data && !ledger.error && <ActivityIndicator color={brand.primary} />}
        {ledger.data && <Balance ledger={ledger.data} childId={childId} onPaid={ledger.reload} />}
      </ScrollView>
    </Screen>
  );
}

function Balance({ ledger, childId, onPaid }: { ledger: LedgerBreakdown; childId: string; onPaid: () => void }) {
  const summary = summariseBalance(ledger);
  const config = useLoad(() => api.get<PaymentConfig>('/billing/payments/config'), 'pay-config', 'Could not load payment options');
  const option = payOption(config.data, ledger.balanceCents);
  // One key per attempt: tapping again after a dropped connection retries the same payment instead of paying twice.
  const attemptKey = useRef<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    if (!option) return;
    attemptKey.current ??= newIdempotencyKey();
    setPaying(true);
    setMessage(null);
    setError(null);
    try {
      const result = await api.post<CardPaymentResult>('/billing/payments/card', { childId, amountCents: option.amountCents, cardToken: 'tok_demo', idempotencyKey: attemptKey.current });
      setMessage(resultMessage(result));
      attemptKey.current = null;
      onPaid();
    } catch (err) {
      setError(errorMessage(err, 'Could not take the payment. Nothing was charged.'));
    } finally {
      setPaying(false);
    }
  }

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
      {option && (
        <Card style={{ gap: spacing.sm }}>
          <Button title={option.label} onPress={pay} loading={paying} />
          {message && <Text style={styles.ok}>{message}</Text>}
          {error && <Text style={styles.error}>{error}</Text>}
        </Card>
      )}
      <Text style={styles.note}>
        {option ? 'This is a demo payment so you can see how paying will work. No money moves.' : 'Payments are recorded by the centre. Paying by card in the app is coming later.'}
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  error: { color: colors.danger, fontSize: 13 },
  ok: { color: colors.success, fontSize: 13 },
  headline: { fontSize: 13, fontWeight: '600', color: colors.muted, textTransform: 'uppercase' },
  amount: { fontSize: 36, fontWeight: '800' },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.foreground },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  rowLabel: { fontSize: 14, color: colors.foreground },
  rowValue: { fontSize: 14, fontWeight: '600', color: colors.foreground },
  total: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, marginTop: spacing.xs },
  note: { fontSize: 12, color: colors.muted, textAlign: 'center' },
});
