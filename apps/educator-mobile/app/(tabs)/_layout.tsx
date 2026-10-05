import { useEffect } from 'react';
import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/lib/auth-context';
import { colors } from '@/lib/theme';
import { flush } from '@/lib/outbox';

export default function TabsLayout() {
  const { user } = useAuth();

  // Keep retrying anything completed offline while the app is open.
  useEffect(() => {
    if (!user) return;
    const timer = setInterval(() => flush().catch(() => {}), 30_000);
    return () => clearInterval(timer);
  }, [user]);

  if (!user) return <Redirect href="/login" />;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        headerStyle: { backgroundColor: colors.surface },
        headerTitleStyle: { color: colors.foreground },
        // The default 49px bar clips the label under the icon on web; give both room.
        tabBarStyle: { height: 62 },
        tabBarItemStyle: { paddingVertical: 4 },
        tabBarLabelStyle: { fontSize: 11, lineHeight: 14 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Roster',
          headerTitle: user.centreName ?? 'Roster',
          tabBarIcon: ({ color, size }) => <Ionicons name="people-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="care-log"
        options={{
          title: 'Log Care',
          tabBarIcon: ({ color, size }) => <Ionicons name="create-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="checks"
        options={{
          title: 'Checks',
          headerTitle: 'Sleep & room checks',
          tabBarIcon: ({ color, size }) => <Ionicons name="checkmark-done-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="photos"
        options={{
          title: 'Photos',
          headerTitle: 'Share photos',
          tabBarIcon: ({ color, size }) => <Ionicons name="camera-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: 'Messages',
          tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => <Ionicons name="person-circle-outline" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
