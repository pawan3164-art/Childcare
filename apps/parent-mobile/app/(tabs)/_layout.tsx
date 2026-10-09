import type { ColorValue } from 'react-native';
import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/lib/auth-context';
import { colors } from '@/lib/theme';
import { ChildHeader } from '@/components/child-header';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
const icon = (name: IconName) => ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={name} size={size} color={color} />;

export default function TabsLayout() {
  const { user } = useAuth();
  if (!user) return <Redirect href="/login" />;

  return (
    <Tabs
      screenOptions={{
        // Child-first: every tab shows whose day this is, with a switcher for siblings.
        header: () => <ChildHeader />,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { height: 62 },
        tabBarItemStyle: { paddingVertical: 4 },
        tabBarLabelStyle: { fontSize: 11, lineHeight: 14 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Today', tabBarIcon: icon('sunny-outline') }} />
      <Tabs.Screen name="learning" options={{ title: 'Learning', tabBarIcon: icon('sparkles-outline') }} />
      <Tabs.Screen name="messages" options={{ title: 'Messages', tabBarIcon: icon('chatbubbles-outline') }} />
      <Tabs.Screen name="bills" options={{ title: 'Bills', tabBarIcon: icon('card-outline') }} />
      <Tabs.Screen
        name="more"
        options={{ title: 'More', headerShown: true, header: undefined, headerTitle: 'More', tabBarIcon: icon('ellipsis-horizontal-circle-outline') }}
      />
    </Tabs>
  );
}
