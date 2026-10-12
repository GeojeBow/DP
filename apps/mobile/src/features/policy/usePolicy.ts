import { useMemo } from 'react';

import type { Expense } from '../../domain/models';
import { formatMoney, toCurrencyCode, toMinor } from '../../domain/money';
import type { PolicyFlag } from '../../domain/policy';
import { useT } from '../../i18n';
import { useAppStore } from '../../store/useAppStore';
import type { Trip } from '../../domain/models';
import { allRules, checkWithTrips, type CompanyRule, ruleNeedsAmount } from './rules';

// Every row asks for the same answer; compute it once per change of expenses or rules.
let cache: { expenses: readonly Expense[]; trips: readonly Trip[]; rules: readonly CompanyRule[]; flags: Map<string, PolicyFlag[]> } | null = null;

/** Company-rule flags for every saved expense, by expense id. */
export function usePolicyFlags(): Map<string, PolicyFlag[]> {
  const expenses = useAppStore((s) => s.expenses);
  const trips = useAppStore((s) => s.trips);
  const rules = useAppStore((s) => s.companyRules);
  if (cache?.expenses !== expenses || cache.trips !== trips || cache.rules !== rules) {
    cache = { expenses, trips, rules, flags: checkWithTrips(expenses, trips, rules) };
  }
  return cache.flags;
}

/** One line in plain words, e.g. "식비 1건당 ₩50,000까지". */
export function useDescribeRule(): (rule: CompanyRule) => string {
  const t = useT();
  return (rule) =>
    t(rule.type === 'daily_cap' && rule.poolDays !== undefined
      ? rule.poolDays > 0 ? 'policy.desc.daily_cap_block' : 'policy.desc.daily_cap_trip'
      : `policy.desc.${rule.type}`, {
      days: rule.poolDays ?? 0,
      pay: rule.payment ? t(`payment.${rule.payment}`) : '',
      cat: rule.category ? t(`category.${rule.category}`) : t('policy.allCats'),
      amount: ruleNeedsAmount(rule.type) ? formatMoney(toMinor(rule.amount, toCurrencyCode(rule.currency)), toCurrencyCode(rule.currency)) : '',
      words: (rule.keywords ?? []).join(', '),
    });
}

/** The rules a set of flags points at, described; duplicates dropped. */
export function useFlagMessages(flags: readonly PolicyFlag[] | undefined): string[] {
  const defaults = useAppStore((s) => s.companyRules);
  const trips = useAppStore((s) => s.trips);
  const rules = useMemo(() => allRules(trips, defaults), [trips, defaults]);
  const describe = useDescribeRule();
  return useMemo(() => {
    const ids = Array.from(new Set((flags ?? []).map((f) => f.ruleId)));
    return ids.flatMap((id) => {
      const rule = rules.find((r) => r.id === id);
      return rule ? [describe(rule)] : [];
    });
  }, [flags, rules]); // eslint-disable-line react-hooks/exhaustive-deps
}
