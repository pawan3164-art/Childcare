import { Redirect } from 'expo-router';
import { useAuth } from '@/lib/auth-context';

export default function Index() {
  const { user } = useAuth();
  return <Redirect href={user ? '/(tabs)' : '/login'} />;
}
