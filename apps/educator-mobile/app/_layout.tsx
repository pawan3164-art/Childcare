import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from '@/lib/auth-context';
import { BrandProvider } from '@/lib/brand-context';

export default function RootLayout() {
  return (
    <AuthProvider>
      <BrandProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="login" />
        <Stack.Screen name="(tabs)" />
      </Stack>
      </BrandProvider>
    </AuthProvider>
  );
}
