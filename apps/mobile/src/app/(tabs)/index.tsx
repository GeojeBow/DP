import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Card } from '../../components/Card';
import { ExpenseRow } from '../../components/ExpenseRow';
import { Button, ProgressBar } from '../../components/Form';
import { Screen } from '../../components/Screen';
import { formatMoney, toCurrencyCode } from '../../domain/money';
import { localToday, summarizeTrip } from '../../domain/trip';
import { useT } from '../../i18n';
import { useActiveTrip, useAppStore } from '../../store/useAppStore';
import { spacing, type, usePalette } from '../../theme/tokens';

export default function HomeScreen() {
  const palette = usePalette();
  const t = useT();
  const trip = useActiveTrip();
  const expenses = useAppStore((s) => s.expenses);

  if (!trip) {
    return (
      <Screen title={t('tab.home')} subtitle={t('home.empty.subtitle')}>
        <Card title={t('home.start')}>
          <Button title={t('home.createTrip')} onPress={() => router.push('/trip/new')} />
          <Button title={t('home.captureWithoutTrip')} variant="secondary" onPress={() => router.push('/capture')} />
        </Card>
      </Screen>
    );
  }

  const base = toCurrencyCode(trip.baseCurrency);
  const summary = summarizeTrip(trip, expenses, localToday());
  const status = summary.budgetStatus;
  const recent = expenses
    .filter((e) => e.tripId === trip.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);
  const money = (v: bigint) => formatMoney(v, base);

  return (
    <Screen
      title={trip.title}
      subtitle={`${trip.startDate} ~ ${trip.endDate} · ${t('home.dayOfTrip', { day: summary.dayOfTrip, total: summary.totalDays })}`}
    >
      {status.available !== null ? (
        <Card title={t(`home.available.${status.kind === 'daily_pooled' ? 'pooled' : status.kind === 'daily' ? 'daily' : 'total'}`)}>
          <Text style={[type.display, type.numeric, { color: status.available < 0n ? palette.block : palette.text }]}>
            {money(status.available)}
          </Text>
          {status.kind === 'daily' ? (
            <Text style={[type.caption, { color: palette.textMuted }]}>{t('home.daily.spentToday', { amount: money(status.periodSpent) })}</Text>
          ) : null}
          {status.kind === 'daily_pooled' ? (
            <Text style={[type.caption, { color: palette.textMuted }]}>
              {t(status.resetsInDays === 0 ? 'home.pooled.lastDay' : 'home.pooled.period', {
                start: status.periodStart.slice(5),
                end: status.periodEnd.slice(5),
                days: status.resetsInDays ?? 0,
              })}
            </Text>
          ) : null}
        </Card>
      ) : null}

      <Card title={summary.budget !== null ? t('home.spentOfBudget') : t('home.spent')}>
        <Text style={[type.title, type.numeric, { color: palette.text }]}>
          {money(summary.spent)}
          {summary.budget !== null ? <Text style={{ color: palette.textMuted }}> / {money(summary.budget)}</Text> : null}
        </Text>
        {summary.burnRatio !== null ? <ProgressBar ratio={summary.burnRatio} /> : null}
      </Card>

      <View style={styles.row}>
        <View style={styles.half}>
          <Card title={t('home.daysLeft')}>
            <Text style={[type.label, { color: palette.text }]}>{t('home.days', { n: summary.daysRemaining })}</Text>
          </Card>
        </View>
      </View>

      {summary.byCategory.length > 0 ? (
        <Card title={t('home.byCategory')}>
          {summary.byCategory.map((c) => (
            <View key={c.category} style={styles.catRow}>
              <Text style={[type.body, { color: palette.text }]}>{t(`category.${c.category}`)}</Text>
              <Text style={[type.body, type.numeric, { color: palette.text }]}>{money(c.amount)}</Text>
            </View>
          ))}
        </Card>
      ) : null}

      <Card title={t('home.recent')}>
        {recent.length === 0 ? (
          <Text style={[type.body, { color: palette.textMuted }]}>{t('home.noExpenses')}</Text>
        ) : (
          recent.map((e) => <ExpenseRow key={e.id} expense={e} />)
        )}
        <Button title={t('home.addReceipt')} onPress={() => router.push('/capture')} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md },
  half: { flex: 1 },
  catRow: { flexDirection: 'row', justifyContent: 'space-between' },
});
