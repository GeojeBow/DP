import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { shadow, spacing, type, usePalette } from '../theme/tokens';

interface CardProps {
  title?: string;
  /** Small control on the right of the title, e.g. a "see all" link. */
  action?: ReactNode;
  children?: ReactNode;
}

export function Card({ title, action, children }: CardProps) {
  const palette = usePalette();
  return (
    <View
      style={[
        styles.card,
        shadow,
        palette.glow ? { shadowColor: palette.glow, shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 0 } } : null,
        { backgroundColor: `${palette.surface}EB`, borderColor: palette.glow ? `${palette.glow}55` : palette.border },
        { borderRadius: palette.cardRadius, borderWidth: palette.cardBorder },
      ]}
    >
      {title ? (
        <View style={styles.head}>
          <Text style={[type.label, styles.title, { color: palette.text }]}>{title}</Text>
          {action}
        </View>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontWeight: '700' },
});
