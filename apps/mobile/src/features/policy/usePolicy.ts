import { useMemo } from 'react';

import type { Expense } from '../../domain/models';
import { formatMoney, toCurrencyCode, toMinor } from '../../domain/money';
import type { PolicyFlag } from '../../domain/policy';
import { useT } from '../../i18n';
import { useAppStore } from '../../store/useAppStore';
import { checkExpenses, type CompanyRule, ruleNeedsAmount } from './rules';

// Every row asks for the same answer; compute it once per change of expenses or rules.
let cache: { expenses: readonly Expense[]; rules: readonly CompanyRule[]; flags: Map<string, PolicyFlag[]> } | null = null;

/** Company-rule flags for every saved expense, by expense id. */
export function usePolicyFlags(): Map<string, PolicyFlag[]> {
  const expenses = useAppStore((s) => s.expenses);
  const rules = useAppStore((s) => s.companyRules);
  if (cache?.expenses !== expenses || cache.rules !== rules) cache = { expenses, rules, flags: checkExpenses(expenses, rules) };
  return cache.flags;
}

/** One line in plain words, e.g. "식비 1건당 ₩50,000까지". */
export function useDescribeRule(): (rule: CompanyRule) => string {
  const t = useT();
  return (rule) =>
    t(`policy.desc.${rule.type}`, {
      cat: rule.category ? t(`category.${rule.category}`) : t('policy.allCats'),
      amount: ruleNeedsAmount(rule.type) ? formatMoney(toMinor(rule.amount, toCurrencyCode(rule.currency)), toCurrencyCode(rule.currency)) : '',
    });
}

/** The rules a set of flags points at, described; duplicates dropped. */
export function useFlagMessages(flags: readonly PolicyFlag[] | undefined): string[] {
  const rules = useAppStore((s) => s.companyRules);
  const describe = useDescribeRule();
  return useMemo(() => {
    const ids = Array.from(new Set((flags ?? []).map((f) => f.ruleId)));
    return ids.flatMap((id) => {
      const rule = rules.find((r) => r.id === id);
      return rule ? [describe(rule)] : [];
    });
  }, [flags, rules]); // eslint-disable-line react-hooks/exhaustive-deps
}
