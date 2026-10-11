import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';

import { DateField } from '../../components/DateField';
import { Button, Chips, TextField } from '../../components/Form';
import { QUICK_CURRENCIES } from '../../constants';
import { BUDGET_KINDS, type BudgetKind, type BudgetRule } from '../../domain/budget';
import { tripDays } from '../../domain/claim';
import { uuidv7 } from '../../domain/id';
import { localToday } from '../../domain/trip';
import { useT } from '../../i18n';
import { useAppStore } from '../../store/useAppStore';
import { spacing } from '../../theme/tokens';

const DECIMAL = /^\d+(\.\d{1,2})?$/;

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function NewTripScreen() {
  const t = useT();
  // Opened with ?id= to edit an existing trip.
  const { id } = useLocalSearchParams<{ id?: string }>();
  const existing = useAppStore((s) => s.trips.find((x) => x.id === id));
  const addTrip = useAppStore((s) => s.addTrip);
  const updateTrip = useAppStore((s) => s.updateTrip);
  const today = localToday();
  const budget0 = existing?.budget;
  const [title, setTitle] = useState(existing?.title ?? '');
  const [startDate, setStartDate] = useState(existing?.startDate ?? today);
  const [endDate, setEndDate] = useState(existing?.endDate ?? addDays(today, 3));
  const [baseCurrency, setBaseCurrency] = useState<string>(existing?.baseCurrency ?? 'KRW');
  const [budgetKind, setBudgetKind] = useState<BudgetKind>(budget0?.kind ?? 'total');
  const [amount, setAmount] = useState(budget0 && budget0.kind !== 'none' ? budget0.amount : '');
  const [poolDays, setPoolDays] = useState(budget0?.kind === 'daily_pooled' ? String(budget0.poolDays) : '7');
  const [perDiem, setPerDiem] = useState(existing?.perDiem?.amount ?? '');
  const [perDiemDays, setPerDiemDays] = useState(existing?.perDiem?.days !== undefined ? String(existing.perDiem.days) : '');
  const [submitted, setSubmitted] = useState(false);

  const amountClean = amount.replace(/,/g, '').trim();
  const errors = {
    title: title.trim() ? null : t('trip.err.name'),
    endDate: endDate < startDate ? t('trip.err.endBeforeStart') : null,
    amount: budgetKind === 'none' || (DECIMAL.test(amountClean) && Number(amountClean) > 0) ? null : t('trip.err.amount'),
    poolDays: budgetKind !== 'daily_pooled' || (/^\d+$/.test(poolDays) && Number(poolDays) >= 2) ? null : t('trip.err.poolDays'),
  };
  const perDiemClean = perDiem.replace(/,/g, '').trim();
  const perDiemErrors = {
    perDiem: !perDiemClean || DECIMAL.test(perDiemClean) ? null : t('trip.err.perDiem'),
    perDiemDays: !perDiemDays.trim() || /^\d+$/.test(perDiemDays.trim()) ? null : t('trip.err.perDiem'),
  };
  const valid = [...Object.values(errors), ...Object.values(perDiemErrors)].every((e) => e === null);
  const show = (e: string | null) => (submitted ? e : null);

  const save = () => {
    setSubmitted(true);
    if (!valid) return;
    const budget: BudgetRule =
      budgetKind === 'none'
        ? { kind: 'none' }
        : budgetKind === 'daily_pooled'
          ? { kind: 'daily_pooled', amount: amountClean, poolDays: Number(poolDays) }
          : { kind: budgetKind, amount: amountClean };
    const trip = {
      ...existing,
      id: existing?.id ?? uuidv7(),
      title: title.trim(),
      startDate,
      endDate,
      baseCurrency,
      budget,
      perDiem: perDiemClean && Number(perDiemClean) > 0
        ? { amount: perDiemClean, ...(perDiemDays.trim() ? { days: Number(perDiemDays.trim()) } : {}) }
        : undefined,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    if (existing) updateTrip(trip);
    else addTrip(trip);
    router.back();
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {existing ? <Stack.Screen options={{ title: t('screen.editTrip') }} /> : null}
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TextField label={t('trip.name')} value={title} onChangeText={setTitle} placeholder={t('trip.namePlaceholder')} error={show(errors.title)} />
        <DateField label={t('trip.start')} value={startDate} onChange={setStartDate} />
        <DateField label={t('trip.end')} value={endDate} onChange={setEndDate} error={show(errors.endDate)} />
        <Chips
          label={t('trip.baseCurrency')}
          options={Array.from(new Set<string>([...QUICK_CURRENCIES, baseCurrency]))}
          value={baseCurrency}
          labelOf={(c) => c}
          onChange={setBaseCurrency}
        />
        <Chips label={t('trip.budgetKind')} options={BUDGET_KINDS} value={budgetKind} labelOf={(k) => t(`budget.${k}`)} onChange={setBudgetKind} />
        {budgetKind !== 'none' ? (
          <TextField
            label={t(budgetKind === 'total' ? 'trip.budgetAmount.total' : 'trip.budgetAmount.daily', { currency: baseCurrency })}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholder={budgetKind === 'total' ? '1500000' : '70'}
            error={show(errors.amount)}
          />
        ) : null}
        {budgetKind === 'daily_pooled' ? (
          <TextField
            label={t('trip.poolDays')}
            value={poolDays}
            onChangeText={setPoolDays}
            keyboardType="number-pad"
            hint={t('trip.poolDaysHint')}
            error={show(errors.poolDays)}
          />
        ) : null}
        <TextField
          label={t('trip.perDiem', { currency: baseCurrency })}
          value={perDiem}
          onChangeText={setPerDiem}
          keyboardType="decimal-pad"
          placeholder="0"
          hint={t('trip.perDiemHint')}
          error={show(perDiemErrors.perDiem)}
        />
        {perDiemClean ? (
          <TextField
            label={t('trip.perDiemDays')}
            value={perDiemDays}
            onChangeText={setPerDiemDays}
            keyboardType="number-pad"
            placeholder={String(tripDays({ startDate, endDate }))}
            hint={t('trip.perDiemDaysHint', { n: tripDays({ startDate, endDate }) })}
            error={show(perDiemErrors.perDiemDays)}
          />
        ) : null}
        <Button title={existing ? t('trip.save') : t('trip.create')} onPress={save} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg },
});
