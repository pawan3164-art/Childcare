import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/lib/auth-context';
import { colors, spacing } from '@/lib/theme';
import { Badge, Button, Card, Screen } from '@/components/ui';

const COMING_SOON = [
  { icon: 'calendar-clear-outline', label: 'Report an absence' },
  { icon: 'add-circle-outline', label: 'Request a casual day' },
  { icon: 'people-outline', label: 'Pickup and authorised people' },
] as const;

export default function MoreScreen() {
  const { user, logout } = useAuth();
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }}>
        <Card style={{ gap: 2 }}>
          <Text style={styles.name}>
            {user?.firstName} {user?.lastName}
          </Text>
          <Text style={styles.muted}>{user?.email}</Text>
          {user?.centreName && <Text style={styles.muted}>{user.centreName}</Text>}
        </Card>

        <Card style={{ gap: spacing.md }}>
          <Text style={styles.section}>Coming soon</Text>
          {COMING_SOON.map((item) => (
            <View key={item.label} style={styles.soon}>
              <Ionicons name={item.icon} size={20} color={colors.muted} />
              <Text style={[styles.soonLabel]}>{item.label}</Text>
              <Badge label="Soon" />
            </View>
          ))}
        </Card>

        <Button title="Sign out" variant="secondary" onPress={logout} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  name: { fontSize: 17, fontWeight: '700', color: colors.foreground },
  muted: { fontSize: 13, color: colors.muted },
  section: { fontSize: 15, fontWeight: '700', color: colors.foreground },
  soon: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  soonLabel: { flex: 1, fontSize: 14, color: colors.muted },
});
