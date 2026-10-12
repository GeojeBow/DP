import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card } from '../../components/Card';
import { ExpenseRow } from '../../components/ExpenseRow';
import { TextField } from '../../components/Form';
import { Screen } from '../../components/Screen';
import { formatMoney, sumMinor, toCurrencyCode, toMinor } from '../../domain/money';
import { searchExpenses } from '../../domain/search';
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
  const trips = useAppStore((s) => s.trips);
  const [query, setQuery] = useState('');
  // Searching looks through every trip, so old receipts stay easy to find.
  const found = query.trim() ? searchExpenses(all, trips, query, (c) => t(`category.${c}`)) : null;
  const tripTitle = (id: string | null) => trips.find((x) => x.id === id)?.title ?? t('expenses.unassigned');

  return (
    <Screen title={t('tab.expenses')} subtitle={trip ? trip.title : t('expenses.unassigned')}>
      <TextField label={t('search.label')} value={query} onChangeText={setQuery} placeholder={t('search.placeholder')} hint={t('search.hint')} />
      {found ? (
        <Card title={t('search.results', { n: found.length })}>
          {found.length === 0 ? <Text style={[type.body, { color: palette.textMuted }]}>{t('search.none')}</Text> : null}
          {found.slice(0, 100).map((e) => (
            <View key={e.id}>
              <Text style={[type.caption, { color: palette.textMuted }]}>{e.localDate} · {tripTitle(e.tripId)}</Text>
              <ExpenseRow expense={e} />
            </View>
          ))}
        </Card>
      ) : groups.length === 0 ? (
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
