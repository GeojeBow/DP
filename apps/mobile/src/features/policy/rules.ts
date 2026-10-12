import type { BudgetRule } from '../../domain/budget';
import type { Expense, PerDiem, Trip } from '../../domain/models';
import { toCurrencyCode, toMinor } from '../../domain/money';
import { evaluatePolicies, type ExpenseForPolicy, type PolicyFlag, type PolicyRule } from '../../domain/policy';
import type { ExpenseCategory, PaymentMethod } from '../../domain/schemas';

/** The rule kinds a person can set up themselves in the app. */
export const COMPANY_RULE_TYPES = [
  'per_item_cap', 'daily_cap', 'trip_cap', 'nightly_cap', 'receipt_required_over', 'payment_required',
  'prohibited_category', 'prohibited_keyword', 'weekend_flag',
] as const;
export type CompanyRuleType = (typeof COMPANY_RULE_TYPES)[number];

export const ruleNeedsAmount = (type: CompanyRuleType) =>
  type === 'per_item_cap' || type === 'daily_cap' || type === 'trip_cap' || type === 'nightly_cap' || type === 'receipt_required_over';

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
  /**
   * daily_cap only: unspent daily allowance carries over. 0 = across the whole trip;
   * n = within n-day blocks counted from the trip start. Absent = each day on its own.
   */
  poolDays?: number;
  /** payment_required: the only way to pay that is allowed */
  payment?: PaymentMethod;
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

const toPolicyRule = (r: CompanyRule & { type: PolicyRule['ruleType'] }): PolicyRule => ({
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
export function checkExpenses(
  expenses: readonly Expense[],
  rules: readonly CompanyRule[],
  /** First day of the trip, where pooled daily limits start counting; else the earliest expense */
  tripStart?: string,
): Map<string, PolicyFlag[]> {
  const out = new Map<string, PolicyFlag[]>();
  if (rules.length === 0) return out;
  const add = (id: string, flag: PolicyFlag) => out.set(id, [...(out.get(id) ?? []), flag]);
  const groups = new Map<string, Expense[]>();
  for (const e of expenses) {
    const key = `${e.tripId ?? ''}|${e.baseCurrency}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  for (const group of groups.values()) {
    const currency = group[0]!.baseCurrency;
    const usable = rules.filter((r) =>
      (!ruleNeedsAmount(r.type) || r.currency === currency) && (r.type !== 'prohibited_keyword' || (r.keywords ?? []).length > 0));
    const shared = usable.filter((r) => !isAppRule(r)).map((r) => toPolicyRule(r as CompanyRule & { type: PolicyRule['ruleType'] }));
    for (const [id, flags] of evaluatePolicies(group.map(toPolicyInput), shared, toCurrencyCode(currency))) {
      for (const f of flags) add(id, f);
    }
    for (const rule of usable.filter(isAppRule)) {
      for (const id of checkAppRule(group, rule, tripStart)) {
        add(id, { ruleId: rule.id, ruleType: APP_RULE_TYPE[rule.type as AppRuleType], action: rule.action ?? 'warn', message: '' });
      }
    }
  }
  return out;
}

/** Rules checked here rather than by the shared policy engine. */
type AppRuleType = 'trip_cap' | 'payment_required' | 'daily_cap';
const isAppRule = (r: CompanyRule) => r.type === 'trip_cap' || r.type === 'payment_required' || (r.type === 'daily_cap' && r.poolDays !== undefined);
/** The nearest shared rule kind, for the flag's label */
const APP_RULE_TYPE: Record<AppRuleType, PolicyFlag['ruleType']> = {
  trip_cap: 'daily_cap', daily_cap: 'daily_cap', payment_required: 'prohibited_category',
};

const DAY_MS = 86_400_000;
const dayNo = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);

/** Ids of the expenses that break one app-checked rule, in spending order. */
function checkAppRule(expenses: readonly Expense[], rule: CompanyRule, tripStart?: string): string[] {
  const scoped = expenses
    .filter((e) => rule.category === null || e.category === rule.category)
    .sort((a, b) => a.localDate.localeCompare(b.localDate) || a.createdAt.localeCompare(b.createdAt));
  if (rule.type === 'payment_required') return scoped.filter((e) => e.paymentMethod !== rule.payment).map((e) => e.id);
  const base = toCurrencyCode(scoped[0]?.baseCurrency ?? rule.currency);
  const cap = toMinor(rule.amount, base);
  const out: string[] = [];
  if (rule.type === 'trip_cap') {
    // Flag the expense that crosses the trip total and every later one.
    let running = 0n;
    for (const e of scoped) {
      running += toMinor(e.totalBase, base);
      if (running > cap) out.push(e.id);
    }
    return out;
  }
  // Pooled daily limit: by day n of a block, n days' worth may have been spent in that block.
  const start = dayNo(tripStart ?? scoped[0]?.localDate ?? '1970-01-01');
  const block = rule.poolDays && rule.poolDays > 0 ? rule.poolDays : Infinity;
  const spent = new Map<number, bigint>();
  for (const e of scoped) {
    const day = Math.max(dayNo(e.localDate) - start, 0);
    const blockNo = block === Infinity ? 0 : Math.floor(day / block);
    const dayInBlock = block === Infinity ? day : day - blockNo * block;
    const total = (spent.get(blockNo) ?? 0n) + toMinor(e.totalBase, base);
    spent.set(blockNo, total);
    if (total > cap * BigInt(dayInBlock + 1)) out.push(e.id);
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
    const trip = trips.find((t) => t.id === tripId);
    for (const [id, flags] of checkExpenses(list, rules, trip?.startDate)) out.set(id, flags);
  }
  return out;
}

/** One-tap starting points shown on the policy screen (amounts in KRW). */
export const RULE_EXAMPLES: ReadonlyArray<Omit<CompanyRule, 'id' | 'currency'>> = [
  { type: 'daily_cap', category: 'meals', amount: '50000', poolDays: 0 },
  { type: 'nightly_cap', category: 'lodging', amount: '150000' },
  { type: 'receipt_required_over', category: null, amount: '30000' },
  { type: 'payment_required', category: null, amount: '', payment: 'corporate_card' },
  { type: 'trip_cap', category: 'ground_transport', amount: '300000' },
];
