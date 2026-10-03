import { Redirect } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/lib/auth-context';
import { Avatar, Button, Card, Screen } from '@/components/ui';
import { colors, spacing } from '@/lib/theme';

export default function ProfileScreen() {
  const { user, logout } = useAuth();

  if (!user) return <Redirect href="/login" />;

  return (
    <Screen>
      <Card style={styles.card}>
        <Avatar initials={`${user.firstName[0]}${user.lastName[0]}`} />
        <Text style={styles.name}>
          {user.firstName} {user.lastName}
        </Text>
        <Text style={styles.email}>{user.email}</Text>
        <View style={styles.divider} />
        <Row label="Role" value={user.role} />
        <Row label="Centre" value={user.centreName ?? '—'} />
      </Card>

      <Button title="Sign out" variant="secondary" onPress={logout} style={{ marginTop: spacing.lg }} />
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { alignItems: 'center', gap: 4 },
  name: { fontSize: 18, fontWeight: '700', color: colors.foreground, marginTop: spacing.sm },
  email: { fontSize: 13, color: colors.muted, marginBottom: spacing.md },
  divider: { height: 1, backgroundColor: colors.border, width: '100%', marginVertical: spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', paddingVertical: 6 },
  rowLabel: { color: colors.muted, fontSize: 14 },
  rowValue: { color: colors.foreground, fontSize: 14, fontWeight: '600' },
});
