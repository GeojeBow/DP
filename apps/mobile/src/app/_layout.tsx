import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform, Pressable, Text } from 'react-native';

import { useReminders } from '../features/reminders/useReminders';
import { startSync } from '../features/sync/engine';
import { useT } from '../i18n';
import { spacing, type, usePalette } from '../theme/tokens';

export default function RootLayout() {
  const palette = usePalette();
  const t = useT();
  useReminders();
  useEffect(() => startSync(), []);
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
        <Stack.Screen name="trip/settings" options={{ title: t('screen.tripSettings') }} />
        <Stack.Screen name="expense/[id]" options={{ title: t('screen.expense') }} />
        <Stack.Screen name="report/[id]" options={{ title: t('screen.preset') }} />
        <Stack.Screen name="template/[id]" options={{ title: t('screen.template') }} />
        <Stack.Screen name="rules" options={{ title: t('screen.rules') }} />
        <Stack.Screen name="theme" options={{ title: t('settings.theme') }} />
        <Stack.Screen name="fields" options={{ title: t('screen.fields') }} />
        <Stack.Screen name="account" options={{ title: t('screen.account') }} />
        <Stack.Screen name="company/index" options={{ title: t('screen.company') }} />
        <Stack.Screen name="company/approvals" options={{ title: t('screen.approvals') }} />
        <Stack.Screen name="company/submission/[id]" options={{ title: t('screen.submission') }} />
      </Stack>
    </>
  );
}
