import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { api, ApiError } from '@/lib/api';
import { useChildren } from '@/lib/children-context';
import { isCompleteCode, nextSignAction, normaliseCode, selfSignInErrorMessage, signInResultMessage } from '@/lib/self-sign-in';
import { colors, radius, spacing } from '@/lib/theme';
import type { ChildListItem } from '@/lib/types';
import { Button, Card } from './ui';

interface SignResult {
  eventType: 'SIGN_IN' | 'SIGN_OUT';
  timestamp: string;
}

/** Sign the child in or out by typing the code shown on the centre's screen. Only shown when the centre allows it. */
export function SignInCard({ child }: { child: ChildListItem }) {
  const { reload } = useChildren();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (!child.canSelfSignIn) return null;
  const action = nextSignAction(child.attendanceStatus);

  async function submit() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const result = await api.post<SignResult>(`/children/${child.id}/attendance/self`, { eventType: action.eventType, code: normaliseCode(code) });
      setDone(signInResultMessage(result.eventType, child.firstName, result.timestamp));
      setCode('');
      await reload();
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      setError(selfSignInErrorMessage(status, err instanceof Error ? err.message : '', child.firstName));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ gap: spacing.sm }}>
      <Text style={styles.title}>{action.label}</Text>
      <Text style={styles.hint}>Type the 6-digit code shown on the screen at the centre. It changes every minute.</Text>
      <TextInput
        accessibilityLabel="Centre check-in code"
        value={code}
        onChangeText={(t) => setCode(normaliseCode(t))}
        keyboardType="number-pad"
        maxLength={6}
        placeholder="000000"
        placeholderTextColor={colors.muted}
        style={styles.input}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      {done && <Text style={styles.done}>{done}</Text>}
      <Button title={`${action.label} ${child.firstName}`} onPress={submit} disabled={!isCompleteCode(code)} loading={busy} />
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 16, fontWeight: '600', color: colors.foreground },
  hint: { fontSize: 13, color: colors.muted },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 24,
    letterSpacing: 6,
    textAlign: 'center',
    color: colors.foreground,
  },
  error: { fontSize: 13, color: colors.danger },
  done: { fontSize: 13, color: colors.success },
});
