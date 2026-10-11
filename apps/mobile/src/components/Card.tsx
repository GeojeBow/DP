import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { radius, shadow, spacing, type, usePalette } from '../theme/tokens';

interface CardProps {
  title?: string;
  /** Small control on the right of the title, e.g. a "see all" link. */
  action?: ReactNode;
  children?: ReactNode;
}

export function Card({ title, action, children }: CardProps) {
  const palette = usePalette();
  return (
    <View style={[styles.card, shadow, { backgroundColor: `${palette.surface}EB`, borderColor: palette.border }]}>
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
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.md,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontWeight: '700' },
});
