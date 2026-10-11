import type { ColorValue } from 'react-native';
import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/lib/auth-context';
import { colors } from '@/lib/theme';
import { ChildHeader } from '@/components/child-header';
import { useBrand } from '@/lib/brand-context';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
const icon = (name: IconName) => ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={name} size={size} color={color} />;

export default function TabsLayout() {
  const { user } = useAuth();
  const brand = useBrand();
  if (!user) return <Redirect href="/login" />;
  // Optional modules this centre has switched off (or its plan leaves out) disappear. An older server sends none: show all.
  const has = (key: string) => !user.enabledModules || user.enabledModules.includes(key);

  return (
    <Tabs
      screenOptions={{
        // Child-first: every tab shows whose day this is, with a switcher for siblings.
        header: () => <ChildHeader />,
        tabBarActiveTintColor: brand.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { height: 62 },
        tabBarItemStyle: { paddingVertical: 4 },
        tabBarLabelStyle: { fontSize: 11, lineHeight: 14 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Today', tabBarIcon: icon('sunny-outline') }} />
      <Tabs.Screen name="learning" options={{ title: 'Learning', tabBarIcon: icon('sparkles-outline'), href: has('learning') ? undefined : null }} />
      <Tabs.Screen name="messages" options={{ title: 'Messages', tabBarIcon: icon('chatbubbles-outline') }} />
      <Tabs.Screen name="bills" options={{ title: 'Bills', tabBarIcon: icon('card-outline'), href: has('billing') ? undefined : null }} />
      <Tabs.Screen
        name="more"
        options={{ title: 'More', headerShown: true, header: undefined, headerTitle: 'More', tabBarIcon: icon('ellipsis-horizontal-circle-outline') }}
      />
    </Tabs>
  );
}
