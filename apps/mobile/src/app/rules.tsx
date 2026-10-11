import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card } from '../components/Card';
import { Button, Chips, TextField } from '../components/Form';
import { QUICK_CURRENCIES } from '../constants';
import { BUDGET_KINDS, type BudgetKind, type BudgetRule } from '../domain/budget';
import { tripDays } from '../domain/claim';
import { uuidv7 } from '../domain/id';
import type { PerDiem, Trip } from '../domain/models';
import { EXPENSE_CATEGORIES, type ExpenseCategory } from '../domain/schemas';
import {
  COMPANY_RULE_TYPES, type CompanyRule, type CompanyRuleType, companyPolicyOf, policyFits, policyMode,
  RULE_ACTIONS, type RuleAction, ruleNeedsAmount,
} from '../features/policy/rules';
import { useDescribeRule } from '../features/policy/usePolicy';
import { useT } from '../i18n';
import { useActiveTrip, useAppStore } from '../store/useAppStore';
import { spacing, type, usePalette } from '../theme/tokens';

const ALL = 'all' as const;
const AMOUNT = /^\d+(\.\d{1,2})?$/;
const TRAVEL_PERCENTS = ['100', '50', '0'] as const;
const clean = (v: string) => v.replace(/,/g, '').trim();
const positive = (v: string) => AMOUNT.test(v) && Number(v) > 0;

/**
 * Company policy in one place: budget, daily allowance and the detailed rules.
 * Opened for the active trip (follow the company or keep its own), or with
 * ?scope=company from the app settings to edit the company defaults.
 */
export default function PolicyScreen() {
  const palette = usePalette();
  const t = useT();
  const { scope } = useLocalSearchParams<{ scope?: string }>();
  const activeTrip = useActiveTrip();
  const trip = scope === 'company' ? null : activeTrip;
  const policy = useAppStore((s) => companyPolicyOf(s.policies));
  const setCompanyPolicy = useAppStore((s) => s.setCompanyPolicy);
  const defaults = useAppStore((s) => s.companyRules);
  const addDefault = useAppStore((s) => s.addRule);
  const deleteDefault = useAppStore((s) => s.deleteRule);
  const updateTrip = useAppStore((s) => s.updateTrip);

  const own = !!trip && policyMode(trip) === 'trip';
  const rules = own ? trip.rules ?? [] : defaults;
  const currency = own ? trip.baseCurrency : policy.currency;
  const setMode = (mode: 'company' | 'trip') => {
    if (!trip || mode === policyMode(trip)) return;
    // Start the trip's own set from what it follows now, so only the differences need changing.
    const ownRules = trip.rules ?? defaults.map((r) => ({ ...r, id: uuidv7() }));
    updateTrip({ ...trip, ruleMode: mode, rules: ownRules });
  };
  const addRule = (rule: CompanyRule) => (own ? updateTrip({ ...trip, rules: [...(trip.rules ?? []), rule] }) : addDefault(rule));
  const deleteRule = (id: string) => (own ? updateTrip({ ...trip, rules: (trip.rules ?? []).filter((r) => r.id !== id) }) : deleteDefault(id));
  const saveMoney = (budget: BudgetRule, perDiem: PerDiem | undefined, cur: string) =>
    own ? updateTrip({ ...trip, budget, perDiem }) : setCompanyPolicy({ ...policy, currency: cur, budget, perDiem });

  return (
    <ScrollView style={{ backgroundColor: palette.background }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {trip ? null : <Stack.Screen options={{ title: t('policy.defaultTitle') }} />}
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
          {!own && !policyFits(trip, policy) ? (
            <Text style={[type.caption, { color: palette.warn }]}>{t('policy.currencyMismatch', { policy: policy.currency, trip: trip.baseCurrency })}</Text>
          ) : null}
        </Card>
      ) : (
        <Text style={[type.caption, { color: palette.textMuted }]}>{t('policy.defaultHint')}</Text>
      )}

      <MoneyCard
        key={own ? `trip-${trip.id}` : 'company'}
        trip={own ? trip : null}
        currency={currency}
        budget={own ? trip.budget : policy.budget}
        perDiem={own ? trip.perDiem : policy.perDiem}
        onSave={saveMoney}
      />

      <Card title={own ? t('policy.tripRules', { trip: trip.title }) : t('policy.defaultRules')}>
        {rules.length === 0 ? <Text style={[type.body, { color: palette.textMuted }]}>{t('policy.empty')}</Text> : null}
        {rules.map((rule) => <RuleRow key={rule.id} rule={rule} onDelete={() => deleteRule(rule.id)} />)}
      </Card>

      <AddRuleCard currency={currency} onAdd={addRule} />
    </ScrollView>
  );
}

function MoneyCard({ trip, currency: currency0, budget: budget0, perDiem: perDiem0, onSave }: {
  /** Set when editing the trip's own values (then the currency is the trip's and days can be overridden) */
  trip: Trip | null;
  currency: string;
  budget: BudgetRule;
  perDiem: PerDiem | undefined;
  onSave: (budget: BudgetRule, perDiem: PerDiem | undefined, currency: string) => void;
}) {
  const palette = usePalette();
  const t = useT();
  const [currency, setCurrency] = useState(currency0);
  const [kind, setKind] = useState<BudgetKind>(budget0.kind);
  const [amount, setAmount] = useState(budget0.kind !== 'none' ? budget0.amount : '');
  const [poolDays, setPoolDays] = useState(budget0.kind === 'daily_pooled' ? String(budget0.poolDays) : '7');
  const [perDay, setPerDay] = useState(perDiem0?.amount ?? '');
  const [travelPct, setTravelPct] = useState<(typeof TRAVEL_PERCENTS)[number]>(
    String(perDiem0?.travelDayPercent ?? 100) as (typeof TRAVEL_PERCENTS)[number],
  );
  const [days, setDays] = useState(perDiem0?.days !== undefined ? String(perDiem0.days) : '');
  const [submitted, setSubmitted] = useState(false);
  const [saved, setSaved] = useState(false);

  const amountClean = clean(amount);
  const perDayClean = clean(perDay);
  const errors = {
    amount: kind === 'none' || positive(amountClean) ? null : t('trip.err.amount'),
    poolDays: kind !== 'daily_pooled' || (/^\d+$/.test(poolDays) && Number(poolDays) >= 2) ? null : t('trip.err.poolDays'),
    perDay: !perDayClean || AMOUNT.test(perDayClean) ? null : t('trip.err.perDiem'),
    days: !days.trim() || /^\d+$/.test(days.trim()) ? null : t('trip.err.perDiem'),
  };
  const show = (e: string | null) => (submitted ? e : null);

  const save = () => {
    setSubmitted(true);
    if (Object.values(errors).some((e) => e !== null)) return;
    const budget: BudgetRule =
      kind === 'none'
        ? { kind: 'none' }
        : kind === 'daily_pooled'
          ? { kind: 'daily_pooled', amount: amountClean, poolDays: Number(poolDays) }
          : { kind, amount: amountClean };
    const perDiem: PerDiem | undefined = perDayClean && Number(perDayClean) > 0
      ? {
        amount: perDayClean,
        ...(travelPct !== '100' ? { travelDayPercent: Number(travelPct) } : {}),
        ...(trip && days.trim() ? { days: Number(days.trim()) } : {}),
      }
      : undefined;
    onSave(budget, perDiem, currency);
    setSaved(true);
  };
  const touch = <T,>(fn: (v: T) => void) => (v: T) => {
    setSaved(false);
    fn(v);
  };

  return (
    <Card title={t('policy.money')}>
      {trip ? null : (
        <Chips
          label={t('policy.currency')}
          options={Array.from(new Set<string>([...QUICK_CURRENCIES, currency]))}
          value={currency}
          labelOf={(c) => c}
          onChange={touch(setCurrency)}
        />
      )}
      <Chips label={t('trip.budgetKind')} options={BUDGET_KINDS} value={kind} labelOf={(k) => t(`budget.${k}`)} onChange={touch(setKind)} />
      {kind !== 'none' ? (
        <TextField
          label={t(kind === 'total' ? 'trip.budgetAmount.total' : 'trip.budgetAmount.daily', { currency })}
          value={amount}
          onChangeText={touch(setAmount)}
          keyboardType="decimal-pad"
          placeholder={kind === 'total' ? '1500000' : '70'}
          error={show(errors.amount)}
        />
      ) : null}
      {kind === 'daily_pooled' ? (
        <TextField
          label={t('trip.poolDays')}
          value={poolDays}
          onChangeText={touch(setPoolDays)}
          keyboardType="number-pad"
          hint={t('trip.poolDaysHint')}
          error={show(errors.poolDays)}
        />
      ) : null}
      <View style={[styles.divider, { backgroundColor: palette.border }]} />
      <TextField
        label={t('trip.perDiem', { currency })}
        value={perDay}
        onChangeText={touch(setPerDay)}
        keyboardType="decimal-pad"
        placeholder="0"
        hint={t('trip.perDiemHint')}
        error={show(errors.perDay)}
      />
      {perDayClean ? (
        <>
          <Chips
            label={t('policy.travelDay')}
            options={TRAVEL_PERCENTS}
            value={travelPct}
            labelOf={(p) => t(`policy.travelDay.${p}`)}
            onChange={touch(setTravelPct)}
          />
          {trip ? (
            <TextField
              label={t('trip.perDiemDays')}
              value={days}
              onChangeText={touch(setDays)}
              keyboardType="number-pad"
              placeholder={String(tripDays(trip))}
              hint={t('trip.perDiemDaysHint', { n: tripDays(trip) })}
              error={show(errors.days)}
            />
          ) : null}
        </>
      ) : null}
      <Button title={saved ? t('policy.saved') : t('policy.saveMoney')} variant={saved ? 'secondary' : 'primary'} onPress={save} />
    </Card>
  );
}

function RuleRow({ rule, onDelete }: { rule: CompanyRule; onDelete: () => void }) {
  const palette = usePalette();
  const t = useT();
  const describe = useDescribeRule();
  const block = rule.action === 'block';
  return (
    <View style={[styles.rule, { borderColor: palette.border }]}>
      <Ionicons name={block ? 'close-circle' : 'shield-checkmark'} size={18} color={block ? palette.block : palette.brand} />
      <View style={styles.flex}>
        <Text style={[type.label, { color: palette.textMuted }]}>
          {t(`policy.type.${rule.type}`)} · <Text style={{ color: block ? palette.block : palette.warn }}>{t(`policy.action.${rule.action ?? 'warn'}`)}</Text>
        </Text>
        <Text style={[type.body, { color: palette.text, fontWeight: '600' }]}>{describe(rule)}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={t('policy.remove')} onPress={onDelete} hitSlop={8}>
        <Ionicons name="trash-outline" size={20} color={palette.textMuted} />
      </Pressable>
    </View>
  );
}

function AddRuleCard({ currency, onAdd }: { currency: string; onAdd: (rule: CompanyRule) => void }) {
  const palette = usePalette();
  const t = useT();
  const [kind, setKindState] = useState<CompanyRuleType>('per_item_cap');
  const [category, setCategory] = useState<ExpenseCategory | typeof ALL>('meals');
  const [amount, setAmount] = useState('');
  const [words, setWords] = useState('');
  const [action, setAction] = useState<RuleAction>('warn');
  const [submitted, setSubmitted] = useState(false);
  const setKind = (k: CompanyRuleType) => {
    setKindState(k);
    if (k === 'nightly_cap') setCategory('lodging');
  };

  const amountClean = clean(amount);
  const needsAmount = ruleNeedsAmount(kind);
  const keywords = words.split(/[,，、]/).map((w) => w.trim()).filter(Boolean);
  const error = needsAmount && !positive(amountClean)
    ? t('policy.err.amount')
    : kind === 'prohibited_keyword' && keywords.length === 0 ? t('policy.err.keywords') : null;

  const add = () => {
    setSubmitted(true);
    if (error) return;
    onAdd({
      id: uuidv7(),
      type: kind,
      category: category === ALL ? null : category,
      amount: needsAmount ? amountClean : '',
      currency,
      ...(kind === 'prohibited_keyword' ? { keywords } : {}),
      ...(action !== 'warn' ? { action } : {}),
    });
    setAmount('');
    setWords('');
    setSubmitted(false);
  };

  return (
    <Card title={t('policy.add')}>
      <Chips label={t('policy.kind')} options={COMPANY_RULE_TYPES} value={kind} labelOf={(k) => t(`policy.type.${k}`)} onChange={setKind} />
      <Text style={[type.caption, { color: palette.textMuted }]}>{t(`policy.typeHint.${kind}`)}</Text>
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
          error={submitted ? error : null}
          hint={t('policy.currencyNote', { currency })}
        />
      ) : null}
      {kind === 'prohibited_keyword' ? (
        <TextField
          label={t('policy.keywords')}
          value={words}
          onChangeText={setWords}
          placeholder={t('policy.keywordsPlaceholder')}
          error={submitted ? error : null}
          hint={t('policy.keywordsHint')}
        />
      ) : null}
      <Chips label={t('policy.actionLabel')} options={RULE_ACTIONS} value={action} labelOf={(a) => t(`policy.actionChoice.${a}`)} onChange={setAction} />
      <Button title={t('policy.save')} onPress={add} />
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl * 2 },
  rule: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  flex: { flex: 1, gap: 2 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: spacing.xs },
});
