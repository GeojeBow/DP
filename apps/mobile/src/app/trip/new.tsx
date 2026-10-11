import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';

import { DateField } from '../../components/DateField';
import { Button, Chips, TextField } from '../../components/Form';
import { QUICK_CURRENCIES } from '../../constants';
import { BUDGET_KINDS, type BudgetKind, type BudgetRule } from '../../domain/budget';
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
  const addTrip = useAppStore((s) => s.addTrip);
  const today = localToday();
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(addDays(today, 3));
  const [baseCurrency, setBaseCurrency] = useState<(typeof QUICK_CURRENCIES)[number]>('KRW');
  const [budgetKind, setBudgetKind] = useState<BudgetKind>('total');
  const [amount, setAmount] = useState('');
  const [poolDays, setPoolDays] = useState('7');
  const [submitted, setSubmitted] = useState(false);

  const amountClean = amount.replace(/,/g, '').trim();
  const errors = {
    title: title.trim() ? null : t('trip.err.name'),
    endDate: endDate < startDate ? t('trip.err.endBeforeStart') : null,
    amount: budgetKind === 'none' || (DECIMAL.test(amountClean) && Number(amountClean) > 0) ? null : t('trip.err.amount'),
    poolDays: budgetKind !== 'daily_pooled' || (/^\d+$/.test(poolDays) && Number(poolDays) >= 2) ? null : t('trip.err.poolDays'),
  };
  const valid = Object.values(errors).every((e) => e === null);
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
    addTrip({ id: uuidv7(), title: title.trim(), startDate, endDate, baseCurrency, budget, createdAt: new Date().toISOString() });
    router.back();
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TextField label={t('trip.name')} value={title} onChangeText={setTitle} placeholder={t('trip.namePlaceholder')} error={show(errors.title)} />
        <DateField label={t('trip.start')} value={startDate} onChange={setStartDate} />
        <DateField label={t('trip.end')} value={endDate} onChange={setEndDate} error={show(errors.endDate)} />
        <Chips label={t('trip.baseCurrency')} options={QUICK_CURRENCIES} value={baseCurrency} labelOf={(c) => c} onChange={setBaseCurrency} />
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
        <Button title={t('trip.create')} onPress={save} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg },
});
