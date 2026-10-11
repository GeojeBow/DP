import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import type { ComponentProps, ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card } from '../../components/Card';
import { perDiemDays, travelDayPercent } from '../../domain/claim';
import { formatMoney, toCurrencyCode, toMinor } from '../../domain/money';
import { companyPolicyOf, policyFits, rulesForTrip } from '../../features/policy/rules';
import { useT } from '../../i18n';
import { useAppStore } from '../../store/useAppStore';
import { spacing, type, usePalette } from '../../theme/tokens';

type IconName = ComponentProps<typeof Ionicons>['name'];

/**
 * Everything that applies to one trip, in one place, each with a way to change it.
 * App-wide settings (theme, language, reminders) stay in the Settings tab.
 */
export default function TripSettingsScreen() {
  const palette = usePalette();
  const t = useT();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const trip = useAppStore((s) => s.trips.find((x) => x.id === id) ?? s.trips.find((x) => x.id === s.activeTripId));
  const defaults = useAppStore((s) => s.companyRules);
  const rememberFx = useAppStore((s) => s.rememberFx);
  const policy = useAppStore((s) => companyPolicyOf(s.policies));
  const updateTrip = useAppStore((s) => s.updateTrip);
  const setActiveTrip = useAppStore((s) => s.setActiveTrip);

  if (!trip) return null;
  const base = toCurrencyCode(trip.baseCurrency);
  const money = (amount: string) => formatMoney(toMinor(amount, base), base);
  const edit = () => router.push({ pathname: '/trip/new', params: { id: trip.id } });
  const budget = trip.budget.kind === 'none'
    ? t('budget.none')
    : trip.budget.kind === 'daily_pooled'
      ? t('tripSettings.budgetPooled', { amount: money(trip.budget.amount), days: trip.budget.poolDays })
      : `${t(`budget.${trip.budget.kind}`)} · ${money(trip.budget.amount)}`;
  const ownRules = trip.ruleMode === 'trip';
  const ruleCount = rulesForTrip(trip, defaults).length;
  const rates = Object.entries(trip.fxRates ?? {});
  const forgetRate = (currency: string) => {
    const { [currency]: _, ...rest } = trip.fxRates ?? {};
    updateTrip({ ...trip, fxRates: rest });
  };

  return (
    <ScrollView style={{ backgroundColor: palette.background }} contentContainerStyle={styles.content}>
      <View style={[styles.banner, { backgroundColor: palette.brandSoft }]}>
        <Ionicons name="briefcase" size={20} color={palette.brand} />
        <Text style={[type.caption, { color: palette.text, flex: 1 }]}>{t('tripSettings.scope', { trip: trip.title })}</Text>
      </View>

      <Card title={t('tripSettings.basics')}>
        <Row icon="airplane-outline" label={t('trip.name')} value={trip.title} />
        <Row icon="calendar-outline" label={t('tripSettings.dates')} value={`${trip.startDate} ~ ${trip.endDate}`} />
        <Row icon="cash-outline" label={t('tripSettings.currency')} value={trip.baseCurrency} />
        <Change onPress={edit} />
      </Card>

      <Card title={t('tripSettings.rules')}>
        <Row
          icon="shield-checkmark-outline"
          label={t('tripSettings.ruleMode')}
          value={t(ownRules ? 'policy.mode.trip' : 'policy.mode.company')}
        />
        <Row icon="wallet-outline" label={t('trip.budgetKind')} value={budget} />
        <Row
          icon="gift-outline"
          label={t('tripSettings.perDiem')}
          value={trip.perDiem
            ? `${t('tripSettings.perDiemValue', { amount: money(trip.perDiem.amount), days: perDiemDays(trip) })}${
              travelDayPercent(trip) < 100 ? ` · ${t('tripSettings.travelDay', { pct: travelDayPercent(trip) })}` : ''}`
            : t('tripSettings.none')}
        />
        <Row icon="list-outline" label={t('tripSettings.detailRules')} value={t('tripSettings.ruleCount', { n: ruleCount })} />
        {!ownRules && !policyFits(trip, policy) ? (
          <Text style={[type.caption, { color: palette.warn }]}>{t('policy.currencyMismatch', { policy: policy.currency, trip: trip.baseCurrency })}</Text>
        ) : null}
        <Change
          onPress={() => {
            // The policy screen works on the active trip.
            setActiveTrip(trip.id);
            router.push('/rules');
          }}
        />
      </Card>

      <Card title={t('tripSettings.fx')}>
        {!rememberFx ? <Text style={[type.caption, { color: palette.warn }]}>{t('tripSettings.fxOff')}</Text> : null}
        {rates.length === 0 ? <Text style={[type.body, { color: palette.textMuted }]}>{t('tripSettings.fxEmpty')}</Text> : null}
        {rates.map(([currency, rate]) => (
          <Row
            key={currency}
            icon="swap-horizontal-outline"
            label={currency}
            value={`1 ${currency} = ${rate} ${trip.baseCurrency}`}
            action={
              <Pressable onPress={() => forgetRate(currency)} accessibilityRole="button" accessibilityLabel={t('tripSettings.fxForget')} hitSlop={8}>
                <Text style={[type.label, { color: palette.textMuted }]}>{t('tripSettings.fxForget')}</Text>
              </Pressable>
            }
          />
        ))}
        <Text style={[type.caption, { color: palette.textMuted }]}>{t('tripSettings.fxHint')}</Text>
      </Card>

      <Pressable onPress={() => router.push('/settings')} accessibilityRole="button" style={[styles.appLink, { borderColor: palette.border }]}>
        <Ionicons name="settings-outline" size={18} color={palette.textMuted} />
        <Text style={[type.caption, { color: palette.textMuted, flex: 1 }]}>{t('tripSettings.appSettings')}</Text>
        <Ionicons name="chevron-forward" size={16} color={palette.textMuted} />
      </Pressable>
    </ScrollView>
  );
}

function Row({ icon, label, value, action }: { icon: IconName; label: string; value: string; action?: ReactNode }) {
  const palette = usePalette();
  return (
    <View style={[styles.row, { borderColor: palette.border }]}>
      <Ionicons name={icon} size={18} color={palette.brand} />
      <View style={styles.flex}>
        <Text style={[type.caption, { color: palette.textMuted }]}>{label}</Text>
        <Text style={[type.body, { color: palette.text, fontWeight: '600' }]}>{value}</Text>
      </View>
      {action}
    </View>
  );
}

function Change({ onPress }: { onPress: () => void }) {
  const palette = usePalette();
  const t = useT();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={styles.change} hitSlop={8}>
      <Text style={[type.label, { color: palette.brand, fontWeight: '700' }]}>{t('tripSettings.change')}</Text>
      <Ionicons name="chevron-forward" size={16} color={palette.brand} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl * 2 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  flex: { flex: 1, gap: 2 },
  change: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: 2 },
  appLink: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderRadius: 16, borderStyle: 'dashed' },
});
