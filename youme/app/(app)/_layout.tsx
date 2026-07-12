/**
 * Layout Application — écrans authentifiés
 */
import { Stack } from 'expo-router';
import { useYoumeColors } from '../../src/shared/constants/theme';

export default function AppLayout() {
  const colors = useYoumeColors();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="chat/[id]" options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="ai-insights/[id]" options={{ headerShown: false, animation: 'slide_from_bottom' }} />
      <Stack.Screen name="analysis/[id]" options={{ headerShown: false, animation: 'slide_from_bottom' }} />
      <Stack.Screen name="flags/[id]" options={{ headerShown: false, animation: 'slide_from_bottom' }} />
    </Stack>
  );
}
