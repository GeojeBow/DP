import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router/tabs';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';

import { useT } from '../../i18n';
import { shadow, usePalette } from '../../theme/tokens';

type IconName = ComponentProps<typeof Ionicons>['name'];

const ICONS: Record<string, [active: IconName, idle: IconName]> = {
  index: ['grid', 'grid-outline'],
  expenses: ['receipt', 'receipt-outline'],
  reports: ['document-text', 'document-text-outline'],
  settings: ['settings', 'settings-outline'],
};

export default function TabsLayout() {
  const palette = usePalette();
  const t = useT();
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: palette.brand,
        tabBarInactiveTintColor: palette.textMuted,
        tabBarStyle: { backgroundColor: palette.surface, borderTopColor: palette.border, height: 64, paddingTop: 6 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarIcon: ({ focused, color }) => {
          const pair = ICONS[route.name];
          return pair ? <Ionicons name={focused ? pair[0] : pair[1]} size={22} color={color} /> : null;
        },
      })}
    >
      <Tabs.Screen name="index" options={{ title: t('tab.home') }} />
      <Tabs.Screen name="expenses" options={{ title: t('tab.expenses') }} />
      <Tabs.Screen
        name="capture"
        options={{
          title: t('tab.capture'),
          // The main action: a raised round camera button in the middle of the bar.
          tabBarIcon: () => (
            <View style={[styles.capture, shadow, { backgroundColor: palette.brand, borderColor: palette.surface }]}>
              <Ionicons name="camera" size={26} color={palette.onBrand} />
            </View>
          ),
          tabBarLabelStyle: { fontSize: 11, fontWeight: '700', color: palette.brand },
        }}
      />
      <Tabs.Screen name="reports" options={{ title: t('tab.reports') }} />
      <Tabs.Screen name="settings" options={{ title: t('tab.settings') }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  capture: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -26,
  },
});
