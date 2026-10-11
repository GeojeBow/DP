import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatMoney, toCurrencyCode, toMinor } from '../domain/money';
import type { Expense } from '../domain/models';
import { usePolicyFlags } from '../features/policy/usePolicy';
import { useT } from '../i18n';
import { CategoryIcon } from './CategoryIcon';
import { spacing, type, usePalette } from '../theme/tokens';

export function ExpenseRow({ expense }: { expense: Expense }) {
  const palette = usePalette();
  const t = useT();
  const local = toCurrencyCode(expense.currency);
  const base = toCurrencyCode(expense.baseCurrency);
  const flagged = usePolicyFlags().has(expense.id);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/expense/[id]', params: { id: expense.id } })}
      style={styles.row}
    >
        <CategoryIcon category={expense.category} />
        <View style={styles.left}>
          <View style={styles.title}>
            {flagged ? <Ionicons name="alert-circle" size={16} color={palette.warn} accessibilityLabel={t('policy.broken')} /> : null}
            <Text style={[type.body, styles.flex, { color: palette.text, fontWeight: '600' }]} numberOfLines={1}>
              {expense.merchantName || t('expense.noMerchant')}
            </Text>
          </View>
          <Text style={[type.caption, { color: palette.textMuted }]}>
            {t(`category.${expense.category}`)}
            {expense.receiptId ? t('expense.hasReceipt') : t('expense.noReceipt')}
          </Text>
        </View>
        <View style={styles.right}>
          <Text style={[type.body, type.numeric, { color: palette.text, fontWeight: '600' }]}>
            {formatMoney(toMinor(expense.totalBase, base), base)}
          </Text>
          {local !== base ? (
            <Text style={[type.caption, type.numeric, { color: palette.textMuted }]}>
              {formatMoney(toMinor(expense.total, local), local)}
            </Text>
          ) : null}
        </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  left: { flex: 1, gap: 2 },
  title: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  flex: { flexShrink: 1 },
  right: { alignItems: 'flex-end', gap: 2 },
});
