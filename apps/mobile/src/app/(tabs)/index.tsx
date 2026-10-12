import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card } from '../../components/Card';
import { CategoryIcon, useCategoryColor } from '../../components/CategoryIcon';
import { ExpenseRow } from '../../components/ExpenseRow';
import { Button } from '../../components/Form';
import { Screen } from '../../components/Screen';
import { currencyBreakdown, submissionChecks } from '../../domain/insights';
import { divide, formatQuote } from '../../domain/fx';
import { formatMoney, fromMinor, toCurrencyCode } from '../../domain/money';
import { ClaimCard } from '../../features/claim/ClaimCard';
import { dailySpend, localToday, summarizeTrip } from '../../domain/trip';
import { usePolicyFlags } from '../../features/policy/usePolicy';
import { useT } from '../../i18n';
import { useActiveTrip, useAppStore } from '../../store/useAppStore';
import { radius, spacing, type, usePalette } from '../../theme/tokens';

type IconName = ComponentProps<typeof Ionicons>['name'];

export default function HomeScreen() {
  const palette = usePalette();
  const t = useT();
  const trip = useActiveTrip();
  const expenses = useAppStore((s) => s.expenses);
  const trips = useAppStore((s) => s.trips);
  const setActiveTrip = useAppStore((s) => s.setActiveTrip);
  const categoryColor = useCategoryColor();
  const flags = usePolicyFlags();

  if (!trip) {
    return (
      <Screen brand title={t('tab.home')} subtitle={t('home.empty.subtitle')}>
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
  const heroLabel = t(`home.available.${status.kind === 'daily_pooled' ? 'pooled' : 'daily'}`);
  const remaining = summary.budget !== null ? summary.budget - summary.spent : null;

  const checks = submissionChecks(own, flags);
  const checkRows: Array<{ icon: IconName; key: keyof typeof checks; color: string }> = [
    { icon: 'alert-circle', key: 'ruleBroken', color: palette.warn },
    { icon: 'receipt-outline', key: 'noReceipt', color: palette.warn },
    { icon: 'help-circle-outline', key: 'noMerchant', color: palette.textMuted },
  ];
  const currencies = currencyBreakdown(own, trip.baseCurrency);

  const stats: Array<{ icon: IconName; label: string; value: string }> = [
    { icon: 'today-outline', label: t('home.stat.today'), value: money(spentToday) },
    { icon: 'hourglass-outline', label: t('home.daysLeft'), value: t('home.days', { n: summary.daysRemaining }) },
  ];

  return (
    <Screen
      brand
      title={trip.title}
      action={
        <Pressable
          onPress={() => router.push({ pathname: '/trip/settings', params: { id: trip.id } })}
          accessibilityRole="button"
          accessibilityLabel={t('home.tripSettings')}
          style={[styles.tripSettings, { backgroundColor: palette.brandSoft, borderColor: palette.brand }]}
        >
          <Ionicons name="briefcase-outline" size={18} color={palette.brand} />
          <Text style={[type.caption, { color: palette.brand, fontWeight: '700' }]}>{t('home.tripSettings')}</Text>
        </Pressable>
      }
      subtitle={`${trip.startDate} ~ ${trip.endDate} · ${t('home.dayOfTrip', { day: summary.dayOfTrip, total: summary.totalDays })}`}
    >
      {/* Always shown, even with one trip: the + chip is how a new trip is added from home. */}
      {trips.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tripRow}>
          {[...trips].sort((a, b) => b.startDate.localeCompare(a.startDate)).map((x) => {
            const selected = x.id === trip.id;
            return (
              <Pressable
                key={x.id}
                onPress={() => setActiveTrip(x.id)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={[styles.tripChip, {
                  backgroundColor: selected ? palette.brand : `${palette.surface}E6`,
                  borderColor: selected ? palette.brand : palette.border,
                }]}
              >
                <Text style={[type.label, { color: selected ? palette.onBrand : palette.text, fontWeight: '700' }]} numberOfLines={1}>{x.title}</Text>
                <Text style={[type.caption, { color: selected ? palette.onBrand : palette.textMuted }]}>
                  {x.startDate.slice(5).replace('-', '/')} ~ {x.endDate.slice(5).replace('-', '/')}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            onPress={() => router.push('/trip/new')}
            accessibilityRole="button"
            accessibilityLabel={t('home.createTrip')}
            style={[styles.tripChip, styles.tripAdd, { borderColor: palette.border }]}
          >
            <Ionicons name="add" size={20} color={palette.brand} />
            <Text style={[type.caption, { color: palette.brand, fontWeight: '700' }]} numberOfLines={1}>{t('home.newTripChip')}</Text>
          </Pressable>
        </ScrollView>
      ) : null}
      {/* What matters most first: how much has gone out, then how much is left. */}
      <View style={[styles.hero, { backgroundColor: palette.brand }]}>
        <View style={[styles.glow, { backgroundColor: palette.accent, top: -60, right: -70 }]} />
        <Text style={[type.label, styles.heroMuted, { color: palette.onBrand }]}>{t('home.spentTotal')}</Text>
        <Text style={[styles.heroAmount, type.numeric, { color: palette.onBrand }]} adjustsFontSizeToFit numberOfLines={1}>
          {money(summary.spent)}
        </Text>
        <Text style={[type.caption, type.numeric, styles.heroMuted, { color: palette.onBrand }]}>
          {t('home.spentSub', { n: own.length, avg: money(avgPerDay) })}
        </Text>
        {summary.budget !== null && ratio !== null ? (
          <View style={styles.heroBudget}>
            <View style={[styles.track, { backgroundColor: 'rgba(255,255,255,0.25)' }]}>
              <View style={[styles.fill, { width: `${Math.min(ratio, 1) * 100}%`, backgroundColor: barColor }]} />
            </View>
            <View style={styles.between}>
              <View>
                <Text style={[type.caption, styles.heroMuted, { color: palette.onBrand }]}>{t('home.available.total')}</Text>
                <Text
                  style={[type.display, type.numeric, { color: remaining !== null && remaining < 0n ? '#FFB4B4' : palette.onBrand }]}
                  adjustsFontSizeToFit
                  numberOfLines={1}
                >
                  {money(remaining ?? 0n)}
                </Text>
              </View>
              <Text style={[type.caption, type.numeric, styles.heroMuted, styles.budgetNote, { color: palette.onBrand }]}>
                {t('home.budgetLine', { budget: money(summary.budget), pct: Math.round(ratio * 100) })}
              </Text>
            </View>
          </View>
        ) : null}
        {status.kind === 'daily' || status.kind === 'daily_pooled' ? (
          <View style={[styles.heroNow, { borderColor: 'rgba(255,255,255,0.3)' }]}>
            <Text style={[type.label, styles.heroMuted, { color: palette.onBrand, flex: 1 }]}>{heroLabel}</Text>
            <Text style={[type.title, type.numeric, { color: status.available !== null && status.available < 0n ? '#FFB4B4' : palette.onBrand }]}>
              {money(status.available ?? 0n)}
            </Text>
          </View>
        ) : null}
        {status.kind === 'daily_pooled' ? (
          <Text style={[type.caption, styles.heroMuted, { color: palette.onBrand }]}>
            {t(status.resetsInDays === 0 ? 'home.pooled.lastDay' : 'home.pooled.period', {
              start: status.periodStart.slice(5),
              end: status.periodEnd.slice(5),
              days: status.resetsInDays ?? 0,
            })}
          </Text>
        ) : null}
      </View>

      <View style={styles.actions}>
        <QuickAction icon="camera-outline" label={t('home.addReceipt')} onPress={() => router.push('/capture')} />
        <QuickAction icon="create-outline" label={t('home.addManual')} onPress={() => router.push({ pathname: '/expense/[id]', params: { id: 'new' } })} />
        <QuickAction icon="document-text-outline" label={t('home.makeReport')} onPress={() => router.push('/reports')} />
      </View>

      <View style={styles.grid}>
        {stats.map((s) => (
          <View key={s.label} style={[styles.stat, { backgroundColor: `${palette.surface}E6`, borderColor: palette.border }]}>
            <Ionicons name={s.icon} size={18} color={palette.brand} />
            <Text style={[type.caption, { color: palette.textMuted }]}>{s.label}</Text>
            <Text style={[type.body, type.numeric, { color: palette.text, fontWeight: '700' }]} numberOfLines={1} adjustsFontSizeToFit>
              {s.value}
            </Text>
          </View>
        ))}
      </View>

      {own.length > 0 ? (
        <Card title={t('home.checks')}>
          {checkRows.every((c) => checks[c.key] === 0) ? (
            <View style={styles.checkRow}>
              <Ionicons name="checkmark-circle" size={20} color={palette.ok} />
              <Text style={[type.body, { color: palette.text }]}>{t('home.checksOk')}</Text>
            </View>
          ) : (
            checkRows
              .filter((c) => checks[c.key] > 0)
              .map((c) => (
                <Pressable key={c.key} onPress={() => router.push('/expenses')} accessibilityRole="link" style={styles.checkRow}>
                  <Ionicons name={c.icon} size={20} color={c.color} />
                  <Text style={[type.body, styles.catName, { color: palette.text }]}>{t(`home.check.${c.key}`)}</Text>
                  <Text style={[type.body, type.numeric, { color: c.color, fontWeight: '700' }]}>{t('home.count', { n: checks[c.key] })}</Text>
                  <Ionicons name="chevron-forward" size={16} color={palette.textMuted} />
                </Pressable>
              ))
          )}
        </Card>
      ) : null}

      <ClaimCard trip={trip} />

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

      {currencies.length > 0 ? (
        <Card title={t('home.currencies')}>
          {currencies.map((c) => {
            const code = toCurrencyCode(c.currency);
            return (
              <View key={c.currency} style={styles.catRow}>
                <View style={[styles.ccy, { backgroundColor: palette.brandSoft }]}>
                  <Text style={[type.caption, { color: palette.brand, fontWeight: '800' }]}>{c.currency}</Text>
                </View>
                <View style={styles.catName}>
                  <Text style={[type.body, type.numeric, { color: palette.text }]}>
                    {t('home.currencyLine', { amount: formatMoney(c.local, code), n: c.count })}
                  </Text>
                  <Text style={[type.caption, type.numeric, { color: palette.textMuted }]}>
                    {t('home.rateLine', { avg: formatQuote(divide(fromMinor(c.base, base), fromMinor(c.local, code)) ?? '1', c.currency, base) })}
                  </Text>
                </View>
                <Text style={[type.body, type.numeric, styles.catAmount, { color: palette.text }]}>{money(c.base)}</Text>
              </View>
            );
          })}
        </Card>
      ) : null}

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
        { backgroundColor: `${palette.surface}E6`, borderColor: palette.border, opacity: pressed ? 0.7 : 1 },
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
  tripSettings: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  tripRow: { gap: spacing.sm, paddingVertical: 2 },
  tripChip: { borderWidth: 1, borderRadius: radius.control, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, maxWidth: 180 },
  tripAdd: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 4, borderStyle: 'dashed', maxWidth: undefined },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
  ccy: { width: 44, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  hero: { borderRadius: radius.card + 4, padding: spacing.xl, gap: spacing.sm, overflow: 'hidden' },
  glow: { position: 'absolute', width: 220, height: 220, borderRadius: 110, opacity: 0.75 },
  glowSmall: { width: 160, height: 160, borderRadius: 80, opacity: 0.45 },
  heroAmount: { fontSize: 44, fontWeight: '800', lineHeight: 52, letterSpacing: -1 },
  heroNow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.sm, marginTop: spacing.xs },
  budgetNote: { alignSelf: 'flex-end', textAlign: 'right', flexShrink: 1 },
  heroMuted: { opacity: 0.85 },
  heroBudget: { gap: spacing.sm, marginTop: spacing.sm },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: spacing.sm },
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
