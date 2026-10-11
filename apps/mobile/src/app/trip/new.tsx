import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';

import { Button, Chips, TextField } from '../../components/Form';
import { uuidv7 } from '../../domain/id';
import { isValidIsoDate, localToday } from '../../domain/trip';
import { QUICK_CURRENCIES } from '../../constants';
import { useAppStore } from '../../store/useAppStore';
import { spacing } from '../../theme/tokens';

const DECIMAL = /^\d+(\.\d{1,2})?$/;

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function NewTripScreen() {
  const addTrip = useAppStore((s) => s.addTrip);
  const today = localToday();
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(addDays(today, 3));
  const [baseCurrency, setBaseCurrency] = useState<(typeof QUICK_CURRENCIES)[number]>('KRW');
  const [budget, setBudget] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const budgetClean = budget.replace(/,/g, '').trim();
  const errors = {
    title: title.trim() ? null : '출장 이름을 입력해 주세요.',
    startDate: isValidIsoDate(startDate) ? null : 'YYYY-MM-DD 형식으로 입력해 주세요.',
    endDate: !isValidIsoDate(endDate)
      ? 'YYYY-MM-DD 형식으로 입력해 주세요.'
      : isValidIsoDate(startDate) && endDate < startDate
        ? '종료일이 시작일보다 빠릅니다.'
        : null,
    budget: budgetClean === '' || DECIMAL.test(budgetClean) ? null : '숫자만 입력해 주세요.',
  };
  const valid = Object.values(errors).every((e) => e === null);
  const show = (e: string | null) => (submitted ? e : null);

  const save = () => {
    setSubmitted(true);
    if (!valid) return;
    addTrip({
      id: uuidv7(),
      title: title.trim(),
      startDate,
      endDate,
      baseCurrency,
      budgetTotal: budgetClean === '' ? null : budgetClean,
      createdAt: new Date().toISOString(),
    });
    router.back();
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TextField label="출장 이름" value={title} onChangeText={setTitle} placeholder="예: 도쿄 파트너 미팅" error={show(errors.title)} />
        <TextField label="시작일" value={startDate} onChangeText={setStartDate} placeholder="YYYY-MM-DD" error={show(errors.startDate)} />
        <TextField label="종료일" value={endDate} onChangeText={setEndDate} placeholder="YYYY-MM-DD" error={show(errors.endDate)} />
        <Chips label="기준 통화 (리포트에 쓰는 통화)" options={QUICK_CURRENCIES} value={baseCurrency} labelOf={(c) => c} onChange={setBaseCurrency} />
        <TextField
          label={`예산 (${baseCurrency}, 선택)`}
          value={budget}
          onChangeText={setBudget}
          keyboardType="decimal-pad"
          placeholder="예: 1500000"
          error={show(errors.budget)}
        />
        <Button title="출장 만들기" onPress={save} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg },
});
