import { useState } from 'react';
import { Redirect } from 'expo-router';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui';
import { colors, radius, spacing } from '@/lib/theme';

export default function LoginScreen() {
  const { user, login } = useAuth();
  const [email, setEmail] = useState('educator.joeys@sunshine.test');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Redirect href="/(tabs)" />;

  async function handleLogin() {
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <View style={styles.logo}>
          <Text style={styles.logoText}>✦</Text>
        </View>
        <Text style={styles.title}>Childcare Educator</Text>
        <Text style={styles.subtitle}>Sign in to your room</Text>
      </View>

      <View style={styles.form}>
        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <Text style={styles.label}>Password</Text>
        <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry />

        {error && <Text style={styles.error}>{error}</Text>}

        <Button title={submitting ? 'Signing in…' : 'Sign in'} onPress={handleLogin} disabled={submitting} loading={submitting} />
      </View>

      <Text style={styles.hint}>
        Demo: educator.joeys@sunshine.test / educator.kangaroos@sunshine.test{'\n'}Password: Password123!
      </Text>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, justifyContent: 'center', padding: spacing.xl },
  header: { alignItems: 'center', marginBottom: spacing.xl },
  logo: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  logoText: { color: colors.primaryForeground, fontSize: 24 },
  title: { fontSize: 20, fontWeight: '700', color: colors.foreground },
  subtitle: { fontSize: 14, color: colors.muted, marginTop: 4 },
  form: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  label: { fontSize: 13, fontWeight: '600', color: colors.foreground, marginTop: spacing.sm },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    fontSize: 15,
    backgroundColor: colors.surface,
    color: colors.foreground,
    marginBottom: spacing.sm,
  },
  error: { color: colors.danger, fontSize: 13, marginBottom: spacing.sm },
  hint: { textAlign: 'center', color: colors.muted, fontSize: 12, marginTop: spacing.xl, lineHeight: 18 },
});
