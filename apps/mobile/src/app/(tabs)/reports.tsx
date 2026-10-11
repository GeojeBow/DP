import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '../../components/Card';
import { Button, Chips } from '../../components/Form';
import { Screen } from '../../components/Screen';
import { formatMoney, sumMinor, toCurrencyCode, toMinor } from '../../domain/money';
import { BUILTIN_PRESETS } from '../../domain/report';
import { runExport } from '../../features/report/runExport';
import { useT } from '../../i18n';
import { useAppStore } from '../../store/useAppStore';
import { radius, spacing, type, usePalette } from '../../theme/tokens';

export default function ReportsScreen() {
  const palette = usePalette();
  const t = useT();
  const trips = useAppStore((s) => s.trips);
  const activeTripId = useAppStore((s) => s.activeTripId);
  const allExpenses = useAppStore((s) => s.expenses);
  const custom = useAppStore((s) => s.reportPresets);
  const presets = [...BUILTIN_PRESETS, ...custom];

  const [tripId, setTripId] = useState(activeTripId ?? trips[0]?.id ?? '');
  const [presetId, setPresetId] = useState(presets[0]!.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trip = trips.find((x) => x.id === tripId) ?? trips[0];
  const preset = presets.find((p) => p.id === presetId) ?? presets[0]!;

  if (!trip) {
    return (
      <Screen title={t('tab.reports')} subtitle={t('reports.subtitle')}>
        <Card title={t('reports.trip')}>
          <Text style={[type.body, { color: palette.textMuted }]}>{t('reports.noTrips')}</Text>
          <Button title={t('home.createTrip')} onPress={() => router.push('/trip/new')} />
        </Card>
      </Screen>
    );
  }

  const expenses = allExpenses.filter((e) => e.tripId === trip.id);
  const base = toCurrencyCode(trip.baseCurrency);
  const total = sumMinor(expenses.map((e) => toMinor(e.totalBase, base)));

  const exportNow = async () => {
    setBusy(true);
    setError(null);
    try {
      await runExport(trip, expenses, preset, t);
    } catch (e) {
      setError(t('reports.failed', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={t('tab.reports')} subtitle={t('reports.subtitle')}>
      <Card title={t('reports.trip')}>
        <Chips label="" options={trips.map((x) => x.id)} value={trip.id} labelOf={(id) => trips.find((x) => x.id === id)?.title ?? id} onChange={setTripId} />
        <Text style={[type.caption, { color: palette.textMuted }]}>
          {t('reports.summary', { n: expenses.length, total: formatMoney(total, base) })}
        </Text>
      </Card>

      <Card title={t('reports.formats')}>
        {presets.map((p) => {
          const selected = p.id === preset.id;
          return (
            <Pressable
              key={p.id}
              onPress={() => setPresetId(p.id)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={[styles.preset, { borderColor: selected ? palette.brand : palette.border, borderWidth: selected ? 2 : 1 }]}
            >
              <View style={styles.presetText}>
                <Text style={[type.body, { color: palette.text, fontWeight: '600' }]}>
                  {p.name}
                  <Text style={[type.caption, { color: palette.textMuted }]}>
                    {'  '}{t(`format.${p.format}`)}{p.builtin ? ` · ${t('reports.builtin')}` : ''}
                  </Text>
                </Text>
                <Text style={[type.caption, { color: palette.textMuted }]} numberOfLines={1}>
                  {t('reports.columnsSummary', { n: p.columns.length, group: t(`group.${p.groupBy}`) })} · {p.columns.map((c) => t(`column.${c}`)).join(', ')}
                </Text>
              </View>
              <Pressable
                onPress={() => router.push({ pathname: '/report/[id]', params: { id: p.id } })}
                accessibilityRole="button"
                hitSlop={8}
              >
                <Text style={[type.label, { color: palette.brand }]}>{t('reports.edit')}</Text>
              </Pressable>
            </Pressable>
          );
        })}
        <Button title={t('reports.newPreset')} variant="secondary" onPress={() => router.push({ pathname: '/report/[id]', params: { id: 'new' } })} />
      </Card>

      {expenses.length === 0 ? (
        <Text style={[type.body, { color: palette.textMuted }]}>{t('reports.empty')}</Text>
      ) : null}
      <Button
        title={busy ? t('reports.exporting') : t('reports.export', { format: t(`format.${preset.format}`) })}
        onPress={exportNow}
        disabled={busy || expenses.length === 0}
      />
      {Platform.OS === 'web' && preset.format === 'pdf' ? (
        <Text style={[type.caption, { color: palette.textMuted }]}>{t('reports.webPdfHint')}</Text>
      ) : null}
      {error ? <Text style={[type.caption, { color: palette.block }]}>{error}</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  preset: { borderRadius: radius.card, padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  presetText: { flex: 1, gap: 2 },
});
