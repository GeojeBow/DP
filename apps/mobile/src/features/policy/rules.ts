import type { BudgetRule } from '../../domain/budget';
import type { Expense, PerDiem, Trip } from '../../domain/models';
import { toCurrencyCode, toMinor } from '../../domain/money';
import { evaluatePolicies, type ExpenseForPolicy, type PolicyFlag, type PolicyRule } from '../../domain/policy';
import type { ExpenseCategory } from '../../domain/schemas';

/** The rule kinds a person can set up themselves in the app. */
export const COMPANY_RULE_TYPES = [
  'per_item_cap', 'daily_cap', 'nightly_cap', 'receipt_required_over', 'prohibited_category', 'prohibited_keyword', 'weekend_flag',
] as const;
export type CompanyRuleType = (typeof COMPANY_RULE_TYPES)[number];

export const ruleNeedsAmount = (type: CompanyRuleType) =>
  type === 'per_item_cap' || type === 'daily_cap' || type === 'nightly_cap' || type === 'receipt_required_over';

/** warn = just a heads-up; block = the company will not pay it */
export const RULE_ACTIONS = ['warn', 'block'] as const;
export type RuleAction = (typeof RULE_ACTIONS)[number];

/** A company rule saved on the device. Amounts are in `currency`. */
export interface CompanyRule {
  id: string;
  type: CompanyRuleType;
  /** null = every category */
  category: ExpenseCategory | null;
  /** Decimal string; empty for rules without an amount */
  amount: string;
  currency: string;
  /** prohibited_keyword: words that may not appear in the merchant name */
  keywords?: string[];
  /** Default 'warn' */
  action?: RuleAction;
}

/**
 * The company's default budget and daily allowance. Trips that follow the company
 * policy get these copied in; amounts apply only to trips in `currency`.
 */
export interface CompanyPolicy {
  id: 'company';
  currency: string;
  budget: BudgetRule;
  perDiem?: PerDiem;
}

export const DEFAULT_POLICY: CompanyPolicy = { id: 'company', currency: 'KRW', budget: { kind: 'none' } };
export const companyPolicyOf = (list: readonly CompanyPolicy[]): CompanyPolicy => list[0] ?? DEFAULT_POLICY;

export type PolicyMode = 'company' | 'trip';
export const policyMode = (trip: Pick<Trip, 'ruleMode'>): PolicyMode => trip.ruleMode ?? 'company';

/** True when the company amounts can be used for this trip. */
export const policyFits = (trip: Pick<Trip, 'baseCurrency'>, policy: CompanyPolicy) => trip.baseCurrency === policy.currency;

/** The trip with the company budget and allowance copied in; the same object when nothing changes. */
export function applyCompanyPolicy(trip: Trip, policy: CompanyPolicy): Trip {
  if (policyMode(trip) !== 'company') return trip;
  const fits = policyFits(trip, policy);
  const budget: BudgetRule = fits ? policy.budget : { kind: 'none' };
  const perDiem = fits && policy.perDiem ? { ...policy.perDiem } : undefined;
  if (JSON.stringify(budget) === JSON.stringify(trip.budget) && JSON.stringify(perDiem) === JSON.stringify(trip.perDiem)) return trip;
  return { ...trip, budget, perDiem };
}

const toPolicyInput = (e: Expense): ExpenseForPolicy => ({
  id: e.id,
  localDate: e.localDate,
  spentAt: e.createdAt,
  category: e.category,
  amountInPolicyCurrency: toMinor(e.totalBase, toCurrencyCode(e.baseCurrency)),
  merchantName: e.merchantName || null,
  merchantCountry: null,
  lineItems: [],
  // A signed lost-receipt statement stands in for the receipt.
  hasReceipt: e.receiptId !== null || !!e.missingReceipt,
});

const toPolicyRule = (r: CompanyRule): PolicyRule => ({
  id: r.id,
  ruleType: r.type,
  category: r.category,
  region: null,
  params: ruleNeedsAmount(r.type)
    ? { amount: r.amount }
    : r.type === 'prohibited_keyword' ? { keywords: r.keywords ?? [], line_item_match: false } : {},
  action: r.action ?? 'warn',
  message: '',
});

/**
 * Flags per expense id. Each trip (or loose expenses in one currency) is checked
 * on its own; amount rules apply only where the amounts share the rule's currency.
 */
export function checkExpenses(expenses: readonly Expense[], rules: readonly CompanyRule[]): Map<string, PolicyFlag[]> {
  const out = new Map<string, PolicyFlag[]>();
  if (rules.length === 0) return out;
  const groups = new Map<string, Expense[]>();
  for (const e of expenses) {
    const key = `${e.tripId ?? ''}|${e.baseCurrency}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  for (const group of groups.values()) {
    const currency = group[0]!.baseCurrency;
    const applicable = rules
      .filter((r) => (!ruleNeedsAmount(r.type) || r.currency === currency) && (r.type !== 'prohibited_keyword' || (r.keywords ?? []).length > 0))
      .map(toPolicyRule);
    for (const [id, flags] of evaluatePolicies(group.map(toPolicyInput), applicable, toCurrencyCode(currency))) out.set(id, flags);
  }
  return out;
}

/** The rules a trip is checked against: its own set when it has chosen one, else the company defaults. */
export function rulesForTrip(trip: Pick<Trip, 'ruleMode' | 'rules'> | null | undefined, defaults: readonly CompanyRule[]): readonly CompanyRule[] {
  return trip?.ruleMode === 'trip' ? trip.rules ?? [] : defaults;
}

/** Every rule that can raise a flag: the defaults plus each trip's own. */
export function allRules(trips: readonly Trip[], defaults: readonly CompanyRule[]): CompanyRule[] {
  return [...defaults, ...trips.flatMap((t) => t.rules ?? [])];
}

/** Flags per expense id, each trip checked against its own rule set. */
export function checkWithTrips(expenses: readonly Expense[], trips: readonly Trip[], defaults: readonly CompanyRule[]): Map<string, PolicyFlag[]> {
  const byTrip = new Map<string | null, Expense[]>();
  for (const e of expenses) byTrip.set(e.tripId, [...(byTrip.get(e.tripId) ?? []), e]);
  const out = new Map<string, PolicyFlag[]>();
  for (const [tripId, list] of byTrip) {
    const rules = rulesForTrip(trips.find((t) => t.id === tripId), defaults);
    for (const [id, flags] of checkExpenses(list, rules)) out.set(id, flags);
  }
  return out;
}
