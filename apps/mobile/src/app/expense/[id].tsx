import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card } from '../../components/Card';
import { DateField } from '../../components/DateField';
import { Button, Chips, TextField } from '../../components/Form';
import { QUICK_CURRENCIES } from '../../constants';
import { uuidv7 } from '../../domain/id';
import type { Expense } from '../../domain/models';
import { convertMinor, formatMoney, fromMinor, toCurrencyCode, toMinor } from '../../domain/money';
import { EXPENSE_CATEGORIES, type ExpenseCategory, PAYMENT_METHODS, type PaymentMethod } from '../../domain/schemas';
import { findDuplicate } from '../../domain/duplicates';
import { localToday } from '../../domain/trip';
import { buildExtraExpenses } from '../../features/capture/extras';
import { readReceipt, type ReadReceiptOutcome, type ReceiptPrefill } from '../../features/capture/readReceipt';
import { type MessageKey, useT } from '../../i18n';
import { loadReceiptImage } from '../../store/receiptImages';
import { fxKey, useActiveTrip, useAppStore } from '../../store/useAppStore';
import { spacing, type, usePalette } from '../../theme/tokens';

const AMOUNT = /^\d+(\.\d+)?$/;
const AI_MESSAGES: Record<'reading' | ReadReceiptOutcome['kind'], MessageKey> = {
  reading: 'ai.reading',
  read: 'ai.read',
  not_receipt: 'ai.not_receipt',
  quota_exceeded: 'ai.quota_exceeded',
  failed: 'ai.failed',
};
const RATE = /^\d+(\.\d+)?$/;

export default function ExpenseScreen() {
  const palette = usePalette();
  const t = useT();
  const params = useLocalSearchParams<{ id: string; receiptId?: string }>();
  const isNew = params.id === 'new';
  const existing = useAppStore((s) => s.expenses.find((e) => e.id === params.id));
  const activeTrip = useActiveTrip();
  const lastFxRates = useAppStore((s) => s.lastFxRates);
  const upsertExpense = useAppStore((s) => s.upsertExpense);
  const deleteExpense = useAppStore((s) => s.deleteExpense);
  const allExpenses = useAppStore((s) => s.expenses);

  const baseCurrency = existing?.baseCurrency ?? activeTrip?.baseCurrency ?? 'KRW';
  const receiptId = existing?.receiptId ?? params.receiptId ?? null;

  const [merchant, setMerchant] = useState(existing?.merchantName ?? '');
  const [amount, setAmount] = useState(existing?.total ?? '');
  const [currency, setCurrency] = useState(existing?.currency ?? baseCurrency);
  const [fxRate, setFxRate] = useState(existing?.fxRate ?? '');
  const [date, setDate] = useState(existing?.localDate ?? localToday());
  const [category, setCategory] = useState<ExpenseCategory>(existing?.category ?? 'meals');
  const [payment, setPayment] = useState<PaymentMethod>(existing?.paymentMethod ?? 'corporate_card');
  const [memo, setMemo] = useState(existing?.memo ?? '');
  const [image, setImage] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [aiState, setAiState] = useState<'idle' | 'reading' | ReadReceiptOutcome['kind']>('idle');
  const [extras, setExtras] = useState<ReceiptPrefill[]>([]);
  const [addExtras, setAddExtras] = useState(true);
  const [aiFailure, setAiFailure] = useState('');
  // Fields the user has typed into; AI results never overwrite them.
  const edited = useRef(new Set<string>());
  const edit = <T,>(field: string, set: (v: T) => void) => (v: T) => {
    edited.current.add(field);
    set(v);
  };

  useEffect(() => {
    if (!receiptId) return;
    let alive = true;
    loadReceiptImage(receiptId).then(async (uri) => {
      if (!alive) return;
      setImage(uri);
      if (!isNew || !uri) return;
      setAiState('reading');
      const outcome = await readReceipt(uri);
      if (!alive) return;
      setAiState(outcome.kind);
      if (outcome.kind === 'failed') setAiFailure(outcome.reason ?? '');
      if (outcome.kind !== 'read') return;
      const p = outcome.prefill;
      const fill = <T,>(field: string, value: T | undefined, set: (v: T) => void) => {
        if (value !== undefined && !edited.current.has(field)) set(value);
      };
      fill('merchant', p.merchantName, setMerchant);
      fill('amount', p.total, setAmount);
      fill('currency', p.currency, setCurrency);
      fill('date', p.localDate, setDate);
      fill('category', p.category, setCategory);
      fill('payment', p.paymentMethod, setPayment);
      setExtras(outcome.extras);
    });
    return () => {
      alive = false;
    };
  }, [receiptId]); // eslint-disable-line react-hooks/exhaustive-deps

  const needsRate = currency !== baseCurrency;
  // Offer the last rate used for this currency pair when switching currency on a new entry.
  useEffect(() => {
    if (needsRate && fxRate === '') setFxRate(lastFxRates[fxKey(currency, baseCurrency)] ?? '');
  }, [currency]); // eslint-disable-line react-hooks/exhaustive-deps

  const amountClean = amount.replace(/,/g, '').trim();
  const rateClean = fxRate.replace(/,/g, '').trim();
  const currencyOptions = useMemo(
    () => Array.from(new Set([baseCurrency, ...QUICK_CURRENCIES, currency])),
    [baseCurrency, currency],
  );

  const errors = {
    amount: AMOUNT.test(amountClean) && Number(amountClean) > 0 ? null : t('expense.err.amount'),
    fxRate: !needsRate || (RATE.test(rateClean) && Number(rateClean) > 0) ? null : t('expense.err.rate'),
  };
  const valid = Object.values(errors).every((e) => e === null);

  const totalBase = useMemo(() => {
    if (errors.amount || errors.fxRate) return null;
    const from = toCurrencyCode(currency);
    const to = toCurrencyCode(baseCurrency);
    return convertMinor(toMinor(amountClean, from), from, to, needsRate ? rateClean : '1');
  }, [amountClean, rateClean, currency, baseCurrency, needsRate, errors.amount, errors.fxRate]);

  // A new entry that matches one already recorded, e.g. a receipt for a card line entered earlier.
  const duplicate = isNew && amountClean
    ? findDuplicate(allExpenses, { localDate: date, currency, total: amountClean, merchantName: merchant })
    : null;

  const attachToDuplicate = () => {
    if (!duplicate || !receiptId) return;
    upsertExpense({ ...duplicate, receiptId, updatedAt: new Date().toISOString() });
    router.replace('/expenses');
  };

  if (!isNew && !existing) {
    return (
      <View style={styles.content}>
        <Text style={[type.body, { color: palette.textMuted }]}>{t('expense.notFound')}</Text>
      </View>
    );
  }

  const save = () => {
    setSubmitted(true);
    if (!valid || totalBase === null) return;
    const base = toCurrencyCode(baseCurrency);
    const local = toCurrencyCode(currency);
    const now = new Date().toISOString();
    const expense: Expense = {
      id: existing?.id ?? uuidv7(),
      tripId: existing?.tripId ?? activeTrip?.id ?? null,
      localDate: date,
      merchantName: merchant.trim(),
      category,
      paymentMethod: payment,
      currency,
      total: fromMinor(toMinor(amountClean, local), local),
      fxRate: needsRate ? rateClean : '1',
      baseCurrency,
      totalBase: fromMinor(totalBase, base),
      receiptId,
      memo: memo.trim(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    upsertExpense(expense);
    if (isNew && addExtras && extras.length) {
      const rest = buildExtraExpenses(extras, {
        tripId: expense.tripId,
        fallbackDate: date,
        fallbackCurrency: currency,
        baseCurrency,
        rateFor: (c) => (c === currency ? expense.fxRate : lastFxRates[fxKey(c, baseCurrency)]),
        payment,
        receiptId,
        existing: [...allExpenses, expense],
        now,
      });
      rest.expenses.forEach(upsertExpense);
    }
    if (isNew) router.replace('/expenses');
    else router.back();
  };

  const remove = async () => {
    if (!existing) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    await deleteExpense(existing.id);
    router.back();
  };

  const show = (e: string | null) => (submitted ? e : null);

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {image ? (
          <Image source={{ uri: image }} style={[styles.receipt, { borderColor: palette.border }]} resizeMode="contain" accessibilityLabel={t('expense.receiptPhoto')} />
        ) : null}
        {aiState !== 'idle' ? (
          <Text style={[type.label, { color: aiState === 'read' || aiState === 'reading' ? palette.textMuted : palette.warn }]}>
            {t(AI_MESSAGES[aiState])}
            {aiState === 'failed' && aiFailure ? ` (${aiFailure})` : ''}
          </Text>
        ) : null}
        {isNew && extras.length > 0 ? (
          <Chips
            label={t('extras.found', { n: extras.length })}
            options={['yes', 'no'] as const}
            value={addExtras ? 'yes' : 'no'}
            labelOf={(v) => t(v === 'yes' ? 'extras.add' : 'extras.skip', { n: extras.length })}
            onChange={(v) => setAddExtras(v === 'yes')}
          />
        ) : null}
        {duplicate ? (
          <View style={[styles.dup, { borderColor: palette.warn }]}>
            <Text style={[type.label, { color: palette.warn }]}>
              {t('dup.found', { merchant: duplicate.merchantName || t('expense.noMerchant'), date: duplicate.localDate })}
            </Text>
            {receiptId && !duplicate.receiptId ? <Button title={t('dup.attach')} variant="secondary" onPress={attachToDuplicate} /> : null}
          </View>
        ) : null}

        <Card title={activeTrip && !existing ? t('expense.trip', { trip: activeTrip.title }) : t('expense.amount')}>
          <Text style={[type.display, type.numeric, { color: palette.text }]}>
            {totalBase === null ? '—' : formatMoney(totalBase, toCurrencyCode(baseCurrency))}
          </Text>
          {needsRate && totalBase !== null ? (
            <Text style={[type.caption, { color: palette.textMuted }]}>
              {t('expense.converted', { currency, amount: amountClean, rate: rateClean, base: baseCurrency })}
            </Text>
          ) : null}
        </Card>

        <TextField label={t('expense.merchant')} value={merchant} onChangeText={edit('merchant', setMerchant)} placeholder={t('expense.merchantPlaceholder')} />
        <TextField
          label={t('expense.amountIn', { currency })}
          value={amount}
          onChangeText={edit('amount', setAmount)}
          keyboardType="decimal-pad"
          placeholder="0"
          error={show(errors.amount)}
        />
        <Chips label={t('expense.currency')} options={currencyOptions} value={currency} labelOf={(c) => c} onChange={edit('currency', setCurrency)} />
        {needsRate ? (
          <TextField
            label={t('expense.rate', { currency, base: baseCurrency })}
            value={fxRate}
            onChangeText={edit('fxRate', setFxRate)}
            keyboardType="decimal-pad"
            placeholder={t('expense.ratePlaceholder')}
            hint={t('expense.rateHint')}
            error={show(errors.fxRate)}
          />
        ) : null}
        <DateField label={t('expense.date')} value={date} onChange={edit('date', setDate)} />
        <Chips label={t('expense.category')} options={EXPENSE_CATEGORIES} value={category} labelOf={(c) => t(`category.${c}`)} onChange={edit('category', setCategory)} />
        <Chips label={t('expense.payment')} options={PAYMENT_METHODS} value={payment} labelOf={(p) => t(`payment.${p}`)} onChange={edit('payment', setPayment)} />
        <TextField label={t('expense.memo')} value={memo} onChangeText={setMemo} placeholder={t('expense.memoPlaceholder')} multiline />

        <Button title={isNew ? t('expense.saveNew') : t('expense.saveEdit')} onPress={save} />
        {!isNew ? (
          <Button title={confirmDelete ? t('expense.deleteConfirm') : t('expense.delete')} variant="danger" onPress={remove} />
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  dup: { borderWidth: 1, borderRadius: 12, padding: spacing.md, gap: spacing.sm },
  flex: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg },
  receipt: { width: '100%', height: 280, borderRadius: 12, borderWidth: 1 },
});
