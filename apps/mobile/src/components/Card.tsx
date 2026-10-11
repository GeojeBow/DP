import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { radius, spacing, type, usePalette } from '../theme/tokens';

interface CardProps {
  title: string;
  children?: ReactNode;
}

export function Card({ title, children }: CardProps) {
  const palette = usePalette();
  return (
    <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <Text style={[type.label, { color: palette.textMuted }]}>{title}</Text>
      {children}
    </View>
  );
}

/** Placeholder body for screens that are scheduled but not built yet. */
export function PlannedNote({ children }: { children: string }) {
  const palette = usePalette();
  return <Text style={[type.body, { color: palette.textMuted }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.sm,
  },
});
