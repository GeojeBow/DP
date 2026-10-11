import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card } from '../../components/Card';
import { Button, Chips, TextField } from '../../components/Form';
import { QUICK_CURRENCIES } from '../../constants';
import { uuidv7 } from '../../domain/id';
import { CATEGORY_LABELS, type Expense, PAYMENT_LABELS } from '../../domain/models';
import { convertMinor, formatMoney, fromMinor, toCurrencyCode, toMinor } from '../../domain/money';
import { EXPENSE_CATEGORIES, type ExpenseCategory, PAYMENT_METHODS, type PaymentMethod } from '../../domain/schemas';
import { isValidIsoDate, localToday } from '../../domain/trip';
import { readReceipt, type ReadReceiptOutcome } from '../../features/capture/readReceipt';
import { loadReceiptImage } from '../../store/receiptImages';
import { fxKey, useActiveTrip, useAppStore } from '../../store/useAppStore';
import { spacing, type, usePalette } from '../../theme/tokens';

const AMOUNT = /^\d+(\.\d+)?$/;
const AI_MESSAGES: Record<'reading' | ReadReceiptOutcome['kind'], string> = {
  reading: 'AI가 영수증을 읽는 중이에요…',
  read: 'AI가 읽은 내용으로 채웠어요. 맞는지 확인해 주세요.',
  not_receipt: '영수증으로 보이지 않아요. 직접 입력해 주세요.',
  quota_exceeded: '이번 달 무료 자동 읽기 30장을 모두 썼어요. 직접 입력해 주세요.',
  failed: '자동으로 읽지 못했어요. 직접 입력해 주세요.',
};
const RATE = /^\d+(\.\d+)?$/;

export default function ExpenseScreen() {
  const palette = usePalette();
  const params = useLocalSearchParams<{ id: string; receiptId?: string }>();
  const isNew = params.id === 'new';
  const existing = useAppStore((s) => s.expenses.find((e) => e.id === params.id));
  const activeTrip = useActiveTrip();
  const lastFxRates = useAppStore((s) => s.lastFxRates);
  const upsertExpense = useAppStore((s) => s.upsertExpense);
  const deleteExpense = useAppStore((s) => s.deleteExpense);

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
  const [extraTransactions, setExtraTransactions] = useState(0);
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
      setExtraTransactions(outcome.extraTransactions);
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
    amount: AMOUNT.test(amountClean) && Number(amountClean) > 0 ? null : '금액을 숫자로 입력해 주세요.',
    date: isValidIsoDate(date) ? null : 'YYYY-MM-DD 형식으로 입력해 주세요.',
    fxRate: !needsRate || (RATE.test(rateClean) && Number(rateClean) > 0) ? null : '환율을 입력해 주세요.',
  };
  const valid = Object.values(errors).every((e) => e === null);

  const totalBase = useMemo(() => {
    if (errors.amount || errors.fxRate) return null;
    const from = toCurrencyCode(currency);
    const to = toCurrencyCode(baseCurrency);
    return convertMinor(toMinor(amountClean, from), from, to, needsRate ? rateClean : '1');
  }, [amountClean, rateClean, currency, baseCurrency, needsRate, errors.amount, errors.fxRate]);

  if (!isNew && !existing) {
    return (
      <View style={styles.content}>
        <Text style={[type.body, { color: palette.textMuted }]}>지출을 찾을 수 없습니다.</Text>
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
          <Image source={{ uri: image }} style={[styles.receipt, { borderColor: palette.border }]} resizeMode="contain" accessibilityLabel="영수증 사진" />
        ) : null}
        {aiState !== 'idle' ? (
          <Text style={[type.label, { color: aiState === 'read' || aiState === 'reading' ? palette.textMuted : palette.warn }]}>
            {AI_MESSAGES[aiState]}
            {aiState === 'read' && extraTransactions > 0 ? ` 이 사진에 결제가 ${extraTransactions}건 더 있어요. 나머지는 따로 입력해 주세요.` : ''}
          </Text>
        ) : null}

        <Card title={activeTrip && !existing ? `출장: ${activeTrip.title}` : '금액'}>
          <Text style={[type.display, type.numeric, { color: palette.text }]}>
            {totalBase === null ? '—' : formatMoney(totalBase, toCurrencyCode(baseCurrency))}
          </Text>
          {needsRate && totalBase !== null ? (
            <Text style={[type.caption, { color: palette.textMuted }]}>
              {currency} {amountClean} × {rateClean} = {baseCurrency} 환산
            </Text>
          ) : null}
        </Card>

        <TextField label="가맹점" value={merchant} onChangeText={edit('merchant', setMerchant)} placeholder="예: Ichiran Shibuya" />
        <TextField
          label={`금액 (${currency})`}
          value={amount}
          onChangeText={edit('amount', setAmount)}
          keyboardType="decimal-pad"
          placeholder="0"
          error={show(errors.amount)}
        />
        <Chips label="통화" options={currencyOptions} value={currency} labelOf={(c) => c} onChange={edit('currency', setCurrency)} />
        {needsRate ? (
          <TextField
            label={`환율 (1 ${currency} = ? ${baseCurrency})`}
            value={fxRate}
            onChangeText={edit('fxRate', setFxRate)}
            keyboardType="decimal-pad"
            placeholder="카드 명세서의 환율을 입력하세요"
            hint="자동 환율은 서버 연결 후 채워집니다. 지금은 직접 입력해 주세요."
            error={show(errors.fxRate)}
          />
        ) : null}
        <TextField label="사용일" value={date} onChangeText={edit('date', setDate)} placeholder="YYYY-MM-DD" error={show(errors.date)} />
        <Chips label="분류" options={EXPENSE_CATEGORIES} value={category} labelOf={(c) => CATEGORY_LABELS[c]} onChange={edit('category', setCategory)} />
        <Chips label="결제 수단" options={PAYMENT_METHODS} value={payment} labelOf={(p) => PAYMENT_LABELS[p]} onChange={edit('payment', setPayment)} />
        <TextField label="메모 (선택)" value={memo} onChangeText={setMemo} placeholder="동석자, 목적 등" multiline />

        <Button title={isNew ? '확인하고 저장' : '수정 저장'} onPress={save} />
        {!isNew ? (
          <Button title={confirmDelete ? '한 번 더 누르면 삭제됩니다' : '삭제'} variant="danger" onPress={remove} />
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg },
  receipt: { width: '100%', height: 280, borderRadius: 12, borderWidth: 1 },
});
