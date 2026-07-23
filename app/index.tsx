import { Redirect } from 'expo-router';
import { View } from 'react-native';
import { useAppStore } from '../src/store/useAppStore';
import { color } from '../src/theme/tokens';

export default function Index() {
  const hydrated = useAppStore((s) => s.hydrated);
  const profile = useAppStore((s) => s.profile);

  if (!hydrated) return <View style={{ flex: 1, backgroundColor: color.paper }} />;
  return profile ? <Redirect href="/(tabs)/today" /> : <Redirect href="/onboarding" />;
}
