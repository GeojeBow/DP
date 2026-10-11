import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { spacing, type, usePalette } from '../theme/tokens';

interface ScreenProps {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}

export function Screen({ title, subtitle, children }: ScreenProps) {
  const palette = usePalette();
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[type.display, { color: palette.text }]} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? <Text style={[type.body, { color: palette.textMuted }]}>{subtitle}</Text> : null}
        <View style={styles.body}>{children}</View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl * 2, gap: spacing.xs },
  body: { marginTop: spacing.lg, gap: spacing.md },
});
