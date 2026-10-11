import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '../../components/Card';
import { CategoryIcon, useCategoryColor } from '../../components/CategoryIcon';
import { ExpenseRow } from '../../components/ExpenseRow';
import { Button } from '../../components/Form';
import { Screen } from '../../components/Screen';
import { formatMoney, toCurrencyCode } from '../../domain/money';
import { dailySpend, localToday, summarizeTrip } from '../../domain/trip';
import { useT } from '../../i18n';
import { useActiveTrip, useAppStore } from '../../store/useAppStore';
import { radius, spacing, type, usePalette } from '../../theme/tokens';

type IconName = ComponentProps<typeof Ionicons>['name'];

export default function HomeScreen() {
  const palette = usePalette();
  const t = useT();
  const trip = useActiveTrip();
  const expenses = useAppStore((s) => s.expenses);
  const categoryColor = useCategoryColor();

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
  const today = localToday();
  const summary = summarizeTrip(trip, expenses, today);
  const status = summary.budgetStatus;
  const own = expenses.filter((e) => e.tripId === trip.id);
  const recent = [...own].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4);
  const series = dailySpend(trip, expenses, today);
  const money = (v: bigint) => formatMoney(v, base);

  const spentToday = series.find((d) => d.date === today)?.amount ?? 0n;
  const daysSoFar = BigInt(Math.max(summary.dayOfTrip, 1));
  const avgPerDay = summary.spent / daysSoFar;
  const maxDay = series.reduce((m, d) => (d.amount > m ? d.amount : m), 0n);
  const ratio = summary.burnRatio;
  const barColor = ratio === null ? palette.onBrand : ratio > 1 ? palette.block : ratio > 0.85 ? palette.warn : palette.onBrand;
  const heroLabel =
    status.available === null
      ? t('home.spent')
      : t(`home.available.${status.kind === 'daily_pooled' ? 'pooled' : status.kind === 'daily' ? 'daily' : 'total'}`);
  const heroAmount = status.available ?? summary.spent;

  const stats: Array<{ icon: IconName; label: string; value: string }> = [
    { icon: 'today-outline', label: t('home.stat.today'), value: money(spentToday) },
    { icon: 'trending-up-outline', label: t('home.stat.avg'), value: money(avgPerDay) },
    { icon: 'hourglass-outline', label: t('home.daysLeft'), value: t('home.days', { n: summary.daysRemaining }) },
    { icon: 'receipt-outline', label: t('home.stat.count'), value: t('home.count', { n: own.length }) },
  ];

  return (
    <Screen
      title={trip.title}
      subtitle={`${trip.startDate} ~ ${trip.endDate} · ${t('home.dayOfTrip', { day: summary.dayOfTrip, total: summary.totalDays })}`}
    >
      <View style={[styles.hero, { backgroundColor: palette.brand }]}>
        <Text style={[type.label, styles.heroMuted, { color: palette.onBrand }]}>{heroLabel}</Text>
        <Text
          style={[type.hero, type.numeric, { color: status.available !== null && status.available < 0n ? '#FFB4B4' : palette.onBrand }]}
          adjustsFontSizeToFit
          numberOfLines={1}
        >
          {money(heroAmount)}
        </Text>
        {status.kind === 'daily_pooled' ? (
          <Text style={[type.caption, styles.heroMuted, { color: palette.onBrand }]}>
            {t(status.resetsInDays === 0 ? 'home.pooled.lastDay' : 'home.pooled.period', {
              start: status.periodStart.slice(5),
              end: status.periodEnd.slice(5),
              days: status.resetsInDays ?? 0,
            })}
          </Text>
        ) : null}
        {summary.budget !== null && ratio !== null ? (
          <View style={styles.heroBudget}>
            <View style={[styles.track, { backgroundColor: 'rgba(255,255,255,0.25)' }]}>
              <View style={[styles.fill, { width: `${Math.min(ratio, 1) * 100}%`, backgroundColor: barColor }]} />
            </View>
            <View style={styles.between}>
              <Text style={[type.caption, type.numeric, styles.heroMuted, { color: palette.onBrand }]}>
                {t('home.spentLine', { spent: money(summary.spent) })}
              </Text>
              <Text style={[type.caption, type.numeric, styles.heroMuted, { color: palette.onBrand }]}>
                {t('home.budgetLine', { budget: money(summary.budget), pct: Math.round(ratio * 100) })}
              </Text>
            </View>
          </View>
        ) : null}
      </View>

      <View style={styles.actions}>
        <QuickAction icon="camera-outline" label={t('home.addReceipt')} onPress={() => router.push('/capture')} />
        <QuickAction icon="create-outline" label={t('home.addManual')} onPress={() => router.push({ pathname: '/expense/[id]', params: { id: 'new' } })} />
        <QuickAction icon="document-text-outline" label={t('home.makeReport')} onPress={() => router.push('/reports')} />
      </View>

      <View style={styles.grid}>
        {stats.map((s) => (
          <View key={s.label} style={[styles.stat, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <Ionicons name={s.icon} size={18} color={palette.brand} />
            <Text style={[type.caption, { color: palette.textMuted }]}>{s.label}</Text>
            <Text style={[type.body, type.numeric, { color: palette.text, fontWeight: '700' }]} numberOfLines={1} adjustsFontSizeToFit>
              {s.value}
            </Text>
          </View>
        ))}
      </View>

      <Card title={t('home.dailyChart')}>
        <View style={styles.chart}>
          {series.map((d) => {
            const h = maxDay > 0n ? Math.max(Number((d.amount * 100n) / maxDay), d.amount > 0n ? 4 : 0) : 0;
            const isToday = d.date === today;
            return (
              <View key={d.date} style={styles.barCol}>
                <View style={styles.barArea}>
                  <View
                    style={[
                      styles.bar,
                      { height: `${h}%`, backgroundColor: isToday ? palette.brand : palette.brandSoft },
                    ]}
                  />
                </View>
                <Text style={[type.caption, { color: isToday ? palette.brand : palette.textMuted, fontWeight: isToday ? '700' : '400' }]}>
                  {d.date.slice(5).replace('-', '/')}
                </Text>
              </View>
            );
          })}
        </View>
        <Text style={[type.caption, type.numeric, { color: palette.textMuted }]}>
          {t('home.chartMax', { amount: money(maxDay) })}
        </Text>
      </Card>

      {summary.byCategory.length > 0 ? (
        <Card title={t('home.byCategory')}>
          <View style={[styles.stack, { backgroundColor: palette.border }]}>
            {summary.byCategory.map((c) => (
              <View
                key={c.category}
                style={{ flex: Number((c.amount * 1000n) / (summary.spent || 1n)), backgroundColor: categoryColor(c.category) }}
              />
            ))}
          </View>
          {summary.byCategory.map((c) => (
            <View key={c.category} style={styles.catRow}>
              <CategoryIcon category={c.category} size={30} />
              <Text style={[type.body, styles.catName, { color: palette.text }]}>{t(`category.${c.category}`)}</Text>
              <Text style={[type.caption, type.numeric, { color: palette.textMuted }]}>
                {summary.spent > 0n ? `${Number((c.amount * 100n) / summary.spent)}%` : ''}
              </Text>
              <Text style={[type.body, type.numeric, styles.catAmount, { color: palette.text }]}>{money(c.amount)}</Text>
            </View>
          ))}
        </Card>
      ) : null}

      <Card
        title={t('home.recent')}
        action={
          own.length > recent.length ? (
            <Pressable onPress={() => router.push('/expenses')} accessibilityRole="link" hitSlop={8}>
              <Text style={[type.label, { color: palette.brand, fontWeight: '700' }]}>{t('home.seeAll')}</Text>
            </Pressable>
          ) : null
        }
      >
        {recent.length === 0 ? (
          <Text style={[type.body, { color: palette.textMuted }]}>{t('home.noExpenses')}</Text>
        ) : (
          recent.map((e) => <ExpenseRow key={e.id} expense={e} />)
        )}
      </Card>
    </Screen>
  );
}

function QuickAction({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const palette = usePalette();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.action,
        { backgroundColor: palette.surface, borderColor: palette.border, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <View style={[styles.actionIcon, { backgroundColor: palette.brandSoft }]}>
        <Ionicons name={icon} size={20} color={palette.brand} />
      </View>
      <Text style={[type.caption, { color: palette.text, fontWeight: '600', textAlign: 'center' }]} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: radius.card + 4, padding: spacing.xl, gap: spacing.sm },
  heroMuted: { opacity: 0.85 },
  heroBudget: { gap: spacing.sm, marginTop: spacing.sm },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  between: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.control + 2,
    borderWidth: StyleSheet.hairlineWidth,
  },
  actionIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stat: {
    flexBasis: '47%',
    flexGrow: 1,
    gap: 2,
    padding: spacing.md,
    borderRadius: radius.control + 2,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chart: { flexDirection: 'row', gap: spacing.sm, height: 140 },
  barCol: { flex: 1, alignItems: 'center', gap: spacing.xs },
  barArea: { flex: 1, width: '100%', maxWidth: 28, justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 6 },
  stack: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden' },
  catRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  catName: { flex: 1 },
  catAmount: { minWidth: 96, textAlign: 'right', fontWeight: '600' },
});
