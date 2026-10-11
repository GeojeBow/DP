import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Card } from '../../components/Card';
import { ExpenseRow } from '../../components/ExpenseRow';
import { Button, ProgressBar } from '../../components/Form';
import { Screen } from '../../components/Screen';
import { CATEGORY_LABELS } from '../../domain/models';
import { formatMoney, toCurrencyCode } from '../../domain/money';
import { localToday, summarizeTrip } from '../../domain/trip';
import { useActiveTrip, useAppStore } from '../../store/useAppStore';
import { spacing, type, usePalette } from '../../theme/tokens';

export default function HomeScreen() {
  const palette = usePalette();
  const trip = useActiveTrip();
  const expenses = useAppStore((s) => s.expenses);

  if (!trip) {
    return (
      <Screen title="홈" subtitle="출장을 만들면 예산과 지출을 한눈에 볼 수 있어요.">
        <Card title="시작하기">
          <Button title="출장 만들기" onPress={() => router.push('/trip/new')} />
          <Button title="출장 없이 영수증 찍기" variant="secondary" onPress={() => router.push('/capture')} />
        </Card>
      </Screen>
    );
  }

  const base = toCurrencyCode(trip.baseCurrency);
  const summary = summarizeTrip(trip, expenses, localToday());
  const recent = expenses
    .filter((e) => e.tripId === trip.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);

  return (
    <Screen title={trip.title} subtitle={`${trip.startDate} ~ ${trip.endDate} · ${summary.dayOfTrip}/${summary.totalDays}일차`}>
      <Card title="사용액 / 예산">
        <Text style={[type.title, type.numeric, { color: palette.text }]}>
          {formatMoney(summary.spent, base)}
          {summary.budget !== null ? (
            <Text style={{ color: palette.textMuted }}> / {formatMoney(summary.budget, base)}</Text>
          ) : null}
        </Text>
        {summary.burnRatio !== null ? <ProgressBar ratio={summary.burnRatio} /> : null}
      </Card>

      <View style={styles.row}>
        <View style={styles.half}>
          <Card title="남은 일일 가용액">
            <Text style={[type.label, type.numeric, { color: summary.remainingPerDay !== null && summary.remainingPerDay < 0n ? palette.block : palette.text }]}>
              {summary.remainingPerDay === null ? '—' : formatMoney(summary.remainingPerDay, base)}
            </Text>
          </Card>
        </View>
        <View style={styles.half}>
          <Card title="남은 일수">
            <Text style={[type.label, { color: palette.text }]}>{summary.daysRemaining}일</Text>
          </Card>
        </View>
      </View>

      {summary.byCategory.length > 0 ? (
        <Card title="분류별 지출">
          {summary.byCategory.map((c) => (
            <View key={c.category} style={styles.catRow}>
              <Text style={[type.body, { color: palette.text }]}>{CATEGORY_LABELS[c.category]}</Text>
              <Text style={[type.body, type.numeric, { color: palette.text }]}>{formatMoney(c.amount, base)}</Text>
            </View>
          ))}
        </Card>
      ) : null}

      <Card title="최근 지출">
        {recent.length === 0 ? (
          <Text style={[type.body, { color: palette.textMuted }]}>아직 지출이 없습니다.</Text>
        ) : (
          recent.map((e) => <ExpenseRow key={e.id} expense={e} />)
        )}
        <Button title="영수증 추가" onPress={() => router.push('/capture')} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md },
  half: { flex: 1 },
  catRow: { flexDirection: 'row', justifyContent: 'space-between' },
});
