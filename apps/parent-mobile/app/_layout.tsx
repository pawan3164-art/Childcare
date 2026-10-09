import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '@/lib/auth-context';
import { ChildrenProvider } from '@/lib/children-context';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <ChildrenProvider>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="login" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="absence" options={{ headerShown: true, title: 'Report an absence', headerBackTitle: 'More' }} />
            <Stack.Screen name="casual-day" options={{ headerShown: true, title: 'Request a casual day', headerBackTitle: 'More' }} />
            <Stack.Screen name="pickup" options={{ headerShown: true, title: 'Pickup', headerBackTitle: 'More' }} />
          </Stack>
        </ChildrenProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
