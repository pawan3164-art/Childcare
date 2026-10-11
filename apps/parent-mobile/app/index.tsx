import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import { colors } from '@/lib/theme';
import { useBrand } from '@/lib/brand-context';

export default function Index() {
  const { user, ready } = useAuth();
  const brand = useBrand();
  // Wait for a saved sign-in to be restored so a returning parent doesn't flash the login screen.
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={brand.primary} />
      </View>
    );
  }
  return <Redirect href={user ? '/(tabs)' : '/login'} />;
}
