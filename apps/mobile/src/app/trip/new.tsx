import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from 'react-native';

import { DateField } from '../../components/DateField';
import { Button, Chips, TextField } from '../../components/Form';
import { QUICK_CURRENCIES } from '../../constants';
import { uuidv7 } from '../../domain/id';
import type { Trip } from '../../domain/models';
import { localToday } from '../../domain/trip';
import { companyPolicyOf, type PolicyMode } from '../../features/policy/rules';
import { useT } from '../../i18n';
import { useAppStore } from '../../store/useAppStore';
import { spacing, type, usePalette } from '../../theme/tokens';

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function NewTripScreen() {
  const t = useT();
  const palette = usePalette();
  // Opened with ?id= to edit an existing trip.
  const { id } = useLocalSearchParams<{ id?: string }>();
  const existing = useAppStore((s) => s.trips.find((x) => x.id === id));
  const addTrip = useAppStore((s) => s.addTrip);
  const updateTrip = useAppStore((s) => s.updateTrip);
  const today = localToday();
  const [title, setTitle] = useState(existing?.title ?? '');
  const [startDate, setStartDate] = useState(existing?.startDate ?? today);
  const [endDate, setEndDate] = useState(existing?.endDate ?? addDays(today, 3));
  const [baseCurrency, setBaseCurrency] = useState<string>(existing?.baseCurrency ?? 'KRW');
  const [mode, setMode] = useState<PolicyMode>('company');
  const policy = useAppStore((s) => companyPolicyOf(s.policies));
  const defaultRules = useAppStore((s) => s.companyRules);
  const [submitted, setSubmitted] = useState(false);

  const errors = {
    title: title.trim() ? null : t('trip.err.name'),
    endDate: endDate < startDate ? t('trip.err.endBeforeStart') : null,
  };
  const valid = Object.values(errors).every((e) => e === null);
  const show = (e: string | null) => (submitted ? e : null);

  const save = () => {
    setSubmitted(true);
    if (!valid) return;
    if (existing) {
      // Budget, allowance and rules are edited on the company policy screen.
      updateTrip({ ...existing, title: title.trim(), startDate, endDate, baseCurrency });
      router.back();
      return;
    }
    const fits = baseCurrency === policy.currency;
    const trip: Trip = {
      id: uuidv7(),
      title: title.trim(),
      startDate,
      endDate,
      baseCurrency,
      // A trip with its own policy starts from the company's, ready to change.
      budget: mode === 'trip' && fits ? policy.budget : { kind: 'none' },
      perDiem: mode === 'trip' && fits && policy.perDiem ? { ...policy.perDiem } : undefined,
      ruleMode: mode,
      ...(mode === 'trip' ? { rules: defaultRules.map((r) => ({ ...r, id: uuidv7() })) } : {}),
      createdAt: new Date().toISOString(),
    };
    addTrip(trip);
    if (mode === 'trip') router.replace('/rules');
    else router.back();
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
        {existing ? (
          <Text style={[type.caption, { color: palette.textMuted }]}>{t('trip.policyElsewhere')}</Text>
        ) : (
          <>
            <Chips
              label={t('trip.policy')}
              options={['company', 'trip'] as const}
              value={mode}
              labelOf={(m) => t(`policy.mode.${m}`)}
              onChange={setMode}
            />
            <Text style={[type.caption, { color: mode === 'company' && baseCurrency !== policy.currency ? palette.warn : palette.textMuted }]}>
              {mode === 'trip'
                ? t('trip.policyTripHint')
                : baseCurrency !== policy.currency
                  ? t('policy.currencyMismatch', { policy: policy.currency, trip: baseCurrency })
                  : t('trip.policyCompanyHint')}
            </Text>
          </>
        )}
        <Button title={existing ? t('trip.save') : t('trip.create')} onPress={save} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg },
});
