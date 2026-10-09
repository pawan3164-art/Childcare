import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import { useChildren } from '@/lib/children-context';
import { colors, spacing } from '@/lib/theme';
import { Button, Card, Screen } from '@/components/ui';

const ACTIONS = [
  { icon: 'calendar-clear-outline', label: 'Report an absence', hint: 'Let the centre know your child will be away', href: '/absence' },
  { icon: 'add-circle-outline', label: 'Request a casual day', hint: 'Ask for an extra day', href: '/casual-day' },
  { icon: 'people-outline', label: 'Pickup', hint: 'Someone else collecting?', href: '/pickup' },
] as const;

export default function MoreScreen() {
  const { user, logout } = useAuth();
  const { selected } = useChildren();
  const router = useRouter();
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

        <Card style={{ gap: spacing.xs }}>
          <Text style={styles.section}>{selected ? `For ${selected.firstName}` : 'Requests'}</Text>
          {ACTIONS.map((a) => (
            <Pressable
              key={a.href}
              onPress={() => router.push(a.href)}
              disabled={!selected}
              accessibilityRole="button"
              style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }, !selected && { opacity: 0.4 }]}
            >
              <Ionicons name={a.icon} size={22} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.actionLabel}>{a.label}</Text>
                <Text style={styles.muted}>{a.hint}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </Pressable>
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
  section: { fontSize: 15, fontWeight: '700', color: colors.foreground, marginBottom: spacing.xs },
  action: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  actionLabel: { fontSize: 15, fontWeight: '600', color: colors.foreground },
});
