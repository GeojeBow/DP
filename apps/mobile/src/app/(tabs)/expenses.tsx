import { StyleSheet, Text, View } from 'react-native';

import { Card } from '../../components/Card';
import { ExpenseRow } from '../../components/ExpenseRow';
import { Screen } from '../../components/Screen';
import { formatMoney, sumMinor, toCurrencyCode, toMinor } from '../../domain/money';
import { groupByDate } from '../../domain/trip';
import { useT } from '../../i18n';
import { useActiveTrip, useAppStore } from '../../store/useAppStore';
import { spacing, type, usePalette } from '../../theme/tokens';

export default function ExpensesScreen() {
  const palette = usePalette();
  const t = useT();
  const trip = useActiveTrip();
  const all = useAppStore((s) => s.expenses);
  const expenses = all.filter((e) => e.tripId === (trip?.id ?? null));
  const groups = groupByDate(expenses);

  return (
    <Screen title={t('tab.expenses')} subtitle={trip ? trip.title : t('expenses.unassigned')}>
      {groups.length === 0 ? (
        <Card title={t('expenses.list')}>
          <Text style={[type.body, { color: palette.textMuted }]}>{t('expenses.empty')}</Text>
        </Card>
      ) : (
        groups.map((group) => {
          const base = toCurrencyCode(group.items[0]?.baseCurrency ?? 'KRW');
          const dayTotal = sumMinor(group.items.map((e) => toMinor(e.totalBase, base)));
          return (
            <Card key={group.date} title={group.date}>
              <View style={styles.dayHeader}>
                <Text style={[type.caption, { color: palette.textMuted }]}>{t('expenses.count', { n: group.items.length })}</Text>
                <Text style={[type.label, type.numeric, { color: palette.text }]}>{formatMoney(dayTotal, base)}</Text>
              </View>
              {group.items.map((e) => (
                <ExpenseRow key={e.id} expense={e} />
              ))}
            </Card>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  dayHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs },
});
