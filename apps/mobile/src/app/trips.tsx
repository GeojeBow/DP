import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card } from '../components/Card';
import { summarizeClaim } from '../domain/claim';
import type { Trip } from '../domain/models';
import { formatMoney, toCurrencyCode } from '../domain/money';
import { localToday } from '../domain/trip';
import { useT } from '../i18n';
import { useAppStore } from '../store/useAppStore';
import { spacing, type, usePalette } from '../theme/tokens';

/** Every trip, ongoing first, then the history of past ones with what was spent and whether it was paid back. */
export default function TripHistoryScreen() {
  const palette = usePalette();
  const t = useT();
  const trips = useAppStore((s) => s.trips);
  const today = localToday();
  const byStart = [...trips].sort((a, b) => b.startDate.localeCompare(a.startDate));
  const current = byStart.filter((x) => x.endDate >= today);
  const past = byStart.filter((x) => x.endDate < today);

  return (
    <ScrollView style={{ backgroundColor: palette.background }} contentContainerStyle={styles.content}>
      <Text style={[type.caption, { color: palette.textMuted }]}>{t('history.hint')}</Text>
      {trips.length === 0 ? <Text style={[type.body, { color: palette.textMuted }]}>{t('history.empty')}</Text> : null}
      {current.length ? (
        <Card title={t('history.current')}>
          {current.map((x) => <TripLine key={x.id} trip={x} />)}
        </Card>
      ) : null}
      {past.length ? (
        <Card title={t('history.past', { n: past.length })}>
          {past.map((x) => <TripLine key={x.id} trip={x} />)}
        </Card>
      ) : null}
    </ScrollView>
  );
}

function TripLine({ trip }: { trip: Trip }) {
  const palette = usePalette();
  const t = useT();
  const expenses = useAppStore((s) => s.expenses);
  const activeTripId = useAppStore((s) => s.activeTripId);
  const setActiveTrip = useAppStore((s) => s.setActiveTrip);
  const own = expenses.filter((e) => e.tripId === trip.id);
  const sum = summarizeClaim(trip, own);
  const base = toCurrencyCode(trip.baseCurrency);
  const status = trip.reimbursedAt
    ? { text: t('history.paid', { date: trip.reimbursedAt.slice(0, 10) }), color: palette.brand }
    : sum.claim > 0n
      ? { text: t('history.waiting', { amount: formatMoney(sum.claim, base) }), color: palette.warn }
      : null;
  const active = trip.id === activeTripId;
  const open = () => {
    setActiveTrip(trip.id);
    router.navigate('/');
  };

  return (
    <Pressable onPress={open} accessibilityRole="button" style={({ pressed }) => [styles.line, { borderColor: palette.border, opacity: pressed ? 0.6 : 1 }]}>
      <View style={styles.flex}>
        <Text style={[type.body, { color: palette.text, fontWeight: '700' }]}>
          {trip.title}
          {active ? <Text style={[type.caption, { color: palette.brand }]}>{t('settings.active')}</Text> : null}
        </Text>
        <Text style={[type.caption, { color: palette.textMuted }]}>
          {trip.startDate} ~ {trip.endDate} · {t('history.count', { n: own.length })} · {formatMoney(sum.spent, base)}
        </Text>
        {status ? <Text style={[type.caption, { color: status.color, fontWeight: '600' }]}>{status.text}</Text> : null}
      </View>
      <Pressable
        onPress={() => router.push({ pathname: '/trip/settings', params: { id: trip.id } })}
        accessibilityRole="button"
        accessibilityLabel={t('home.tripSettings')}
        hitSlop={10}
      >
        <Ionicons name="settings-outline" size={20} color={palette.textMuted} />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl * 2 },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  flex: { flex: 1, gap: 2 },
});
