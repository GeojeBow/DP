import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatMoney, toCurrencyCode, toMinor } from '../domain/money';
import type { Expense } from '../domain/models';
import { useT } from '../i18n';
import { spacing, type, usePalette } from '../theme/tokens';

export function ExpenseRow({ expense }: { expense: Expense }) {
  const palette = usePalette();
  const t = useT();
  const local = toCurrencyCode(expense.currency);
  const base = toCurrencyCode(expense.baseCurrency);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/expense/[id]', params: { id: expense.id } })}
      style={[styles.row, { borderColor: palette.border }]}
    >
        <View style={styles.left}>
          <Text style={[type.body, { color: palette.text }]} numberOfLines={1}>
            {expense.merchantName || t('expense.noMerchant')}
          </Text>
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
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth * 2,
  },
  left: { flex: 1, gap: 2 },
  right: { alignItems: 'flex-end', gap: 2 },
});
