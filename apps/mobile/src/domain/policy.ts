import type { z } from 'zod';

import { type CurrencyCode, type MinorUnits, toMinor } from './money';
import {
  type ExpenseCategory,
  type PolicyAction,
  POLICY_RULE_TYPES,
  policyParamsSchemas,
} from './schemas';

/**
 * Evaluates a trip's expenses against its policy rules. The same function runs
 * on the device (instant badges, offline) and in the policy-evaluate Edge
 * Function (authoritative verdict stored in expenses.policy_flags).
 */

export type PolicyRuleType = (typeof POLICY_RULE_TYPES)[number];

export interface PolicyRule {
  id: string;
  ruleType: PolicyRuleType;
  /** null = applies to every category */
  category: ExpenseCategory | null;
  /** null = worldwide; 'JP' or 'US-NY' match on the country part */
  region: string | null;
  params: unknown;
  action: PolicyAction;
  message: string;
}

export interface ExpenseForPolicy {
  id: string;
  /** ISO date at the merchant (expenses.local_date) */
  localDate: string;
  /** ISO timestamp, used to order expenses within a day */
  spentAt: string;
  category: ExpenseCategory;
  /** Total already converted into the policy currency */
  amountInPolicyCurrency: MinorUnits;
  merchantName: string | null;
  merchantCountry: string | null;
  lineItems: readonly string[];
  hasReceipt: boolean;
  /** Lodging only: nights covered by this expense */
  nights?: number;
  preApproved?: boolean;
}

export interface PolicyFlag {
  ruleId: string;
  ruleType: PolicyRuleType;
  action: PolicyAction;
  message: string;
}

export class PolicyRuleError extends Error {
  constructor(
    readonly ruleId: string,
    message: string,
  ) {
    super(`Policy rule ${ruleId}: ${message}`);
    this.name = 'PolicyRuleError';
  }
}

function appliesTo(rule: PolicyRule, expense: ExpenseForPolicy): boolean {
  if (rule.category !== null && rule.category !== expense.category) return false;
  if (rule.region !== null) {
    const country = rule.region.split('-')[0]?.toUpperCase();
    if (expense.merchantCountry?.toUpperCase() !== country) return false;
  }
  return true;
}

function parseParams<S extends z.ZodType>(schema: S, rule: PolicyRule): z.infer<S> {
  const result = schema.safeParse(rule.params);
  if (!result.success) {
    throw new PolicyRuleError(rule.id, `invalid params (${result.error.issues[0]?.message ?? 'unknown'})`);
  }
  return result.data;
}

function isWeekend(isoDate: string): boolean {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

function matchesKeyword(expense: ExpenseForPolicy, keywords: string[], lineItemMatch: boolean): boolean {
  const haystacks = [expense.merchantName ?? '', ...(lineItemMatch ? expense.lineItems : [])]
    .map((s) => s.toLocaleLowerCase());
  return keywords.some((k) => {
    const needle = k.toLocaleLowerCase();
    return haystacks.some((h) => h.includes(needle));
  });
}

/** Returns flags per expense id; expenses with no violations are absent from the map. */
export function evaluatePolicies(
  expenses: readonly ExpenseForPolicy[],
  rules: readonly PolicyRule[],
  policyCurrency: CurrencyCode,
): Map<string, PolicyFlag[]> {
  const flags = new Map<string, PolicyFlag[]>();
  const flag = (expense: ExpenseForPolicy, rule: PolicyRule) => {
    const list = flags.get(expense.id) ?? [];
    list.push({ ruleId: rule.id, ruleType: rule.ruleType, action: rule.action, message: rule.message });
    flags.set(expense.id, list);
  };

  for (const rule of rules) {
    const scoped = expenses.filter((e) => appliesTo(rule, e));

    switch (rule.ruleType) {
      case 'daily_cap': {
        const cap = toMinor(parseParams(policyParamsSchemas.daily_cap, rule).amount, policyCurrency);
        const byDay = new Map<string, ExpenseForPolicy[]>();
        for (const e of scoped) byDay.set(e.localDate, [...(byDay.get(e.localDate) ?? []), e]);
        for (const day of byDay.values()) {
          // Flag the expense that crosses the cap and every later one that day.
          let running = 0n;
          for (const e of [...day].sort((a, b) => a.spentAt.localeCompare(b.spentAt))) {
            running += e.amountInPolicyCurrency;
            if (running > cap) flag(e, rule);
          }
        }
        break;
      }
      case 'per_item_cap': {
        const cap = toMinor(parseParams(policyParamsSchemas.per_item_cap, rule).amount, policyCurrency);
        for (const e of scoped) if (e.amountInPolicyCurrency > cap) flag(e, rule);
        break;
      }
      case 'nightly_cap': {
        const cap = toMinor(parseParams(policyParamsSchemas.nightly_cap, rule).amount, policyCurrency);
        for (const e of scoped) {
          const nights = BigInt(Math.max(1, Math.floor(e.nights ?? 1)));
          if (e.amountInPolicyCurrency > cap * nights) flag(e, rule);
        }
        break;
      }
      case 'prohibited_category': {
        for (const e of scoped) flag(e, rule);
        break;
      }
      case 'prohibited_keyword': {
        const { keywords, line_item_match } = parseParams(policyParamsSchemas.prohibited_keyword, rule);
        for (const e of scoped) if (matchesKeyword(e, keywords, line_item_match)) flag(e, rule);
        break;
      }
      case 'receipt_required_over': {
        const limit = toMinor(parseParams(policyParamsSchemas.receipt_required_over, rule).amount, policyCurrency);
        for (const e of scoped) if (!e.hasReceipt && e.amountInPolicyCurrency > limit) flag(e, rule);
        break;
      }
      case 'pre_approval_over': {
        const limit = toMinor(parseParams(policyParamsSchemas.pre_approval_over, rule).amount, policyCurrency);
        for (const e of scoped) if (!e.preApproved && e.amountInPolicyCurrency > limit) flag(e, rule);
        break;
      }
      case 'weekend_flag': {
        for (const e of scoped) if (isWeekend(e.localDate)) flag(e, rule);
        break;
      }
      default: {
        const unknown: never = rule.ruleType;
        throw new PolicyRuleError(rule.id, `unsupported rule type ${String(unknown)}`);
      }
    }
  }
  return flags;
}

/** The most severe action among flags: block > require_justification > warn. */
export function worstAction(list: readonly PolicyFlag[] | undefined): PolicyAction | null {
  if (!list || list.length === 0) return null;
  if (list.some((f) => f.action === 'block')) return 'block';
  if (list.some((f) => f.action === 'require_justification')) return 'require_justification';
  return 'warn';
}
