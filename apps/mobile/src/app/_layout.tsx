import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Platform, Pressable, Text } from 'react-native';

import { useT } from '../i18n';
import { spacing, type, usePalette } from '../theme/tokens';

export default function RootLayout() {
  const palette = usePalette();
  const t = useT();
  return (
    <>
      <StatusBar style={palette.dark ? 'light' : 'dark'} />
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
                    <Text style={[type.body, { color: palette.brand }]}>{t('common.back')}</Text>
                  </Pressable>
                ),
              }
            : {}),
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="trip/new" options={{ title: t('screen.newTrip') }} />
        <Stack.Screen name="expense/[id]" options={{ title: t('screen.expense') }} />
        <Stack.Screen name="report/[id]" options={{ title: t('screen.preset') }} />
        <Stack.Screen name="template/[id]" options={{ title: t('screen.template') }} />
        <Stack.Screen name="rules" options={{ title: t('screen.rules') }} />
        <Stack.Screen name="fields" options={{ title: t('screen.fields') }} />
      </Stack>
    </>
  );
}
