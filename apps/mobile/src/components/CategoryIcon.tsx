import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';

import type { ExpenseCategory } from '../domain/schemas';
import { usePalette } from '../theme/tokens';

type IconName = ComponentProps<typeof Ionicons>['name'];

const ICON: Record<ExpenseCategory, IconName> = {
  airfare: 'airplane',
  lodging: 'bed',
  meals: 'restaurant',
  ground_transport: 'train',
  car_rental: 'car',
  fuel: 'speedometer',
  parking: 'location',
  communication: 'call',
  entertainment: 'wine',
  office_supplies: 'pencil',
  fees: 'card',
  other: 'ellipsis-horizontal',
};

export const CATEGORY_ORDER = Object.keys(ICON) as ExpenseCategory[];

/** The chart color for a category, stable across screens. */
export function useCategoryColor(): (category: ExpenseCategory) => string {
  const palette = usePalette();
  return (category) => palette.chart[CATEGORY_ORDER.indexOf(category) % palette.chart.length]!;
}

export function CategoryIcon({ category, size = 36 }: { category: ExpenseCategory; size?: number }) {
  const color = useCategoryColor()(category);
  return (
    <View style={[styles.bubble, { width: size, height: size, borderRadius: size / 2.6, backgroundColor: `${color}22` }]}>
      <Ionicons name={ICON[category]} size={size * 0.5} color={color} />
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: { alignItems: 'center', justifyContent: 'center' },
});
