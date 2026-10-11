import { useState } from 'react';
import { Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api, errorMessage } from '@/lib/api';
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
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  /** APP 12: everything the platform holds about you and your children, as a JSON file you can keep or share. */
  async function downloadMyData() {
    setExporting(true);
    setExportError(null);
    try {
      const data = await api.get<unknown>('/privacy/export');
      const text = JSON.stringify(data, null, 2);
      if (Platform.OS === 'web') {
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'my-childcare-data.json';
        link.click();
        URL.revokeObjectURL(url);
      } else {
        await Share.share({ title: 'My childcare data', message: text });
      }
    } catch (err) {
      setExportError(errorMessage(err, 'Could not prepare your data'));
    } finally {
      setExporting(false);
    }
  }

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

        <Card style={{ gap: spacing.sm }}>
          <Text style={styles.section}>Your data</Text>
          <Text style={styles.muted}>Download a copy of the information the centre holds about you and your children.</Text>
          {exportError && <Text style={{ color: colors.danger, fontSize: 13 }}>{exportError}</Text>}
          <Button title={exporting ? 'Preparing…' : 'Download my data'} variant="secondary" onPress={downloadMyData} loading={exporting} />
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
