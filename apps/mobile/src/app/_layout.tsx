import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Platform, Pressable, Text } from 'react-native';

import { spacing, type, usePalette } from '../theme/tokens';

export default function RootLayout() {
  const palette = usePalette();
  return (
    <>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: palette.surface },
          headerTintColor: palette.text,
          contentStyle: { backgroundColor: palette.background },
          // On web the default back arrow is an image asset; a text button works everywhere, including embedded previews.
          ...(Platform.OS === 'web'
            ? {
                headerLeft: () => (
                  <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} accessibilityRole="button" style={{ paddingHorizontal: spacing.md }}>
                    <Text style={[type.body, { color: palette.brand }]}>← 뒤로</Text>
                  </Pressable>
                ),
              }
            : {}),
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="trip/new" options={{ title: '새 출장' }} />
        <Stack.Screen name="expense/[id]" options={{ title: '지출 확인' }} />
      </Stack>
    </>
  );
}
