import { Tabs } from 'expo-router/tabs';

import { useT } from '../../i18n';
import { usePalette } from '../../theme/tokens';

export default function TabsLayout() {
  const palette = usePalette();
  const t = useT();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.brand,
        tabBarInactiveTintColor: palette.textMuted,
        tabBarStyle: { backgroundColor: palette.surface, borderTopColor: palette.border, height: 56 },
        // Text-only tabs until the icon set is chosen; avoids placeholder glyphs.
        tabBarIcon: () => null,
        tabBarIconStyle: { display: 'none' },
        tabBarLabelStyle: { fontSize: 14, fontWeight: '600' },
        tabBarItemStyle: { justifyContent: 'center' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('tab.home') }} />
      <Tabs.Screen name="expenses" options={{ title: t('tab.expenses') }} />
      <Tabs.Screen name="capture" options={{ title: t('tab.capture') }} />
      <Tabs.Screen name="reports" options={{ title: t('tab.reports') }} />
      <Tabs.Screen name="settings" options={{ title: t('tab.settings') }} />
    </Tabs>
  );
}
