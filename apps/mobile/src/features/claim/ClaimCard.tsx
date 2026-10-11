import { StyleSheet, Text, View } from 'react-native';

import { Card } from '../../components/Card';
import { Button } from '../../components/Form';
import { summarizeClaim } from '../../domain/claim';
import type { Trip } from '../../domain/models';
import { formatMoney, toCurrencyCode } from '../../domain/money';
import { localToday } from '../../domain/trip';
import { useT } from '../../i18n';
import { useAppStore } from '../../store/useAppStore';
import { spacing, type, usePalette } from '../../theme/tokens';

/** What the company owes the traveller for this trip, and whether it has been paid. */
export function ClaimCard({ trip }: { trip: Trip }) {
  const palette = usePalette();
  const t = useT();
  const expenses = useAppStore((s) => s.expenses);
  const updateTrip = useAppStore((s) => s.updateTrip);
  const s = summarizeClaim(trip, expenses);
  if (s.claim <= 0n) return null;
  const base = toCurrencyCode(trip.baseCurrency);
  const money = (v: bigint) => formatMoney(v, base);
  const paid = !!trip.reimbursedAt;

  return (
    <Card title={t('home.claim')}>
      <View style={styles.row}>
        <Text style={[type.title, type.numeric, { color: paid ? palette.textMuted : palette.text, textDecorationLine: paid ? 'line-through' : 'none' }]}>
          {money(s.claim)}
        </Text>
      </View>
      {s.perDiem > 0n ? (
        <Text style={[type.caption, type.numeric, { color: palette.textMuted }]}>
          {t('home.claimLine', { personal: money(s.personal), perDiem: money(s.perDiem) })}
        </Text>
      ) : null}
      {paid ? (
        <View style={styles.row}>
          <Text style={[type.label, { color: palette.brand, flex: 1 }]}>{t('home.paid', { date: trip.reimbursedAt!.slice(0, 10) })}</Text>
          <Button title={t('home.undoPaid')} variant="secondary" onPress={() => updateTrip({ ...trip, reimbursedAt: undefined })} />
        </View>
      ) : (
        <Button title={t('home.markPaid')} variant="secondary" onPress={() => updateTrip({ ...trip, reimbursedAt: localToday() })} />
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
