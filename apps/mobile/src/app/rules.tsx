import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card } from '../components/Card';
import { Button, Chips, TextField } from '../components/Form';
import { uuidv7 } from '../domain/id';
import { EXPENSE_CATEGORIES, type ExpenseCategory } from '../domain/schemas';
import { COMPANY_RULE_TYPES, type CompanyRule, type CompanyRuleType, ruleNeedsAmount } from '../features/policy/rules';
import { useDescribeRule } from '../features/policy/usePolicy';
import { useT } from '../i18n';
import { useActiveTrip, useAppStore } from '../store/useAppStore';
import { spacing, type, usePalette } from '../theme/tokens';

const ALL = 'all' as const;
const AMOUNT = /^\d+(\.\d{1,2})?$/;

export default function RulesScreen() {
  const palette = usePalette();
  const t = useT();
  const describe = useDescribeRule();
  const defaults = useAppStore((s) => s.companyRules);
  const addDefault = useAppStore((s) => s.addRule);
  const deleteDefault = useAppStore((s) => s.deleteRule);
  const updateTrip = useAppStore((s) => s.updateTrip);
  const trip = useActiveTrip();
  const currency = trip?.baseCurrency ?? 'KRW';
  // The active trip either follows the company defaults or keeps its own set; edits go to whichever applies.
  const own = trip?.ruleMode === 'trip';
  const rules = own ? trip.rules ?? [] : defaults;
  const setMode = (mode: 'company' | 'trip') => {
    if (!trip || mode === (trip.ruleMode ?? 'company')) return;
    // Start the trip's own set from the defaults so only the differences need changing.
    const rulesForTrip = trip.rules ?? defaults.map((r) => ({ ...r, id: uuidv7() }));
    updateTrip({ ...trip, ruleMode: mode, rules: rulesForTrip });
  };
  const addRule = (rule: CompanyRule) => (own ? updateTrip({ ...trip, rules: [...(trip.rules ?? []), rule] }) : addDefault(rule));
  const deleteRule = (id: string) => (own ? updateTrip({ ...trip, rules: (trip.rules ?? []).filter((r) => r.id !== id) }) : deleteDefault(id));

  const [kind, setKind] = useState<CompanyRuleType>('per_item_cap');
  const [category, setCategory] = useState<ExpenseCategory | typeof ALL>('meals');
  const [amount, setAmount] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const amountClean = amount.replace(/,/g, '').trim();
  const needsAmount = ruleNeedsAmount(kind);
  const amountError = needsAmount && !(AMOUNT.test(amountClean) && Number(amountClean) > 0) ? t('policy.err.amount') : null;

  const add = () => {
    setSubmitted(true);
    if (amountError) return;
    addRule({ id: uuidv7(), type: kind, category: category === ALL ? null : category, amount: needsAmount ? amountClean : '', currency });
    setAmount('');
    setSubmitted(false);
  };

  return (
    <ScrollView style={{ backgroundColor: palette.background }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {trip ? (
        <Card title={t('policy.mode.title', { trip: trip.title })}>
          <Chips
            label=""
            options={['company', 'trip'] as const}
            value={own ? 'trip' : 'company'}
            labelOf={(m) => t(`policy.mode.${m}`)}
            onChange={setMode}
          />
          <Text style={[type.caption, { color: palette.textMuted }]}>{t(own ? 'policy.mode.tripHint' : 'policy.mode.companyHint')}</Text>
        </Card>
      ) : null}
      <Card title={own ? t('policy.tripRules', { trip: trip.title }) : t('policy.defaultRules')}>
        {rules.length === 0 ? <Text style={[type.body, { color: palette.textMuted }]}>{t('policy.empty')}</Text> : null}
        {rules.map((rule) => (
          <View key={rule.id} style={[styles.rule, { borderColor: palette.border }]}>
            <Ionicons name="shield-checkmark" size={18} color={palette.brand} />
            <View style={styles.flex}>
              <Text style={[type.label, { color: palette.textMuted }]}>{t(`policy.type.${rule.type}`)}</Text>
              <Text style={[type.body, { color: palette.text, fontWeight: '600' }]}>{describe(rule)}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={t('policy.remove')} onPress={() => deleteRule(rule.id)} hitSlop={8}>
              <Ionicons name="trash-outline" size={20} color={palette.textMuted} />
            </Pressable>
          </View>
        ))}
      </Card>

      <Card title={t('policy.add')}>
        <Chips label={t('policy.kind')} options={COMPANY_RULE_TYPES} value={kind} labelOf={(k) => t(`policy.type.${k}`)} onChange={setKind} />
        <Chips
          label={t('policy.category')}
          options={[ALL, ...EXPENSE_CATEGORIES] as const}
          value={category}
          labelOf={(c) => (c === ALL ? t('policy.allCats') : t(`category.${c}`))}
          onChange={setCategory}
        />
        {needsAmount ? (
          <TextField
            label={t('policy.amount', { currency })}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholder="50000"
            error={submitted ? amountError : null}
            hint={t('policy.currencyNote', { currency })}
          />
        ) : null}
        <Button title={t('policy.save')} onPress={add} />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl * 2 },
  rule: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  flex: { flex: 1, gap: 2 },
});
