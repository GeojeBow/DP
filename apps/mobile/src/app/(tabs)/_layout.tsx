import { Tabs } from 'expo-router/tabs';

import { usePalette } from '../../theme/tokens';

export default function TabsLayout() {
  const palette = usePalette();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.brand,
        tabBarInactiveTintColor: palette.textMuted,
        tabBarStyle: { backgroundColor: palette.surface, borderTopColor: palette.border },
      }}
    >
      <Tabs.Screen name="index" options={{ title: '홈' }} />
      <Tabs.Screen name="expenses" options={{ title: '지출' }} />
      <Tabs.Screen name="capture" options={{ title: '캡처' }} />
      <Tabs.Screen name="reports" options={{ title: '리포트' }} />
      <Tabs.Screen name="settings" options={{ title: '설정' }} />
    </Tabs>
  );
}
