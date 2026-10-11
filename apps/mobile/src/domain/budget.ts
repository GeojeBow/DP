import { type CurrencyCode, type MinorUnits, sumMinor, toMinor } from './money';
import type { Expense } from './models';

/**
 * How a trip's money is limited.
 * - total: one amount for the whole trip.
 * - daily: a fixed amount per day; unspent money does not carry over.
 * - daily_pooled: a daily amount that accrues inside fixed windows of
 *   `poolDays` days counted from the trip start, and resets when a new window
 *   begins (e.g. 70 USD/day, 7-day windows: up to 490 USD in one go on day 7).
 */
export type BudgetRule =
  | { kind: 'none' }
  | { kind: 'total'; amount: string }
  | { kind: 'daily'; amount: string }
  | { kind: 'daily_pooled'; amount: string; poolDays: number };

export type BudgetKind = BudgetRule['kind'];
export const BUDGET_KINDS: readonly BudgetKind[] = ['none', 'total', 'daily', 'daily_pooled'];

export interface BudgetStatus {
  kind: BudgetKind;
  /** Whole-trip limit, for the progress bar; null without a budget */
  tripLimit: MinorUnits | null;
  /** The period the "available now" figure covers (inclusive ISO dates) */
  periodStart: string;
  periodEnd: string;
  /** Allowance accrued in the period so far */
  periodLimit: MinorUnits | null;
  periodSpent: MinorUnits;
  /** What can still be spent now; negative when over */
  available: MinorUnits | null;
  /** daily_pooled: days until the pool resets (0 on the last day of a window) */
  resetsInDays: number | null;
}

const DAY_MS = 86_400_000;
const toDay = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
const fromDay = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

export function budgetStatus(
  rule: BudgetRule,
  trip: { startDate: string; endDate: string },
  expenses: readonly Expense[],
  base: CurrencyCode,
  today: string,
): BudgetStatus {
  const start = toDay(trip.startDate);
  const end = toDay(trip.endDate);
  // Before the trip, show day one; after it, the last day.
  const now = Math.min(Math.max(toDay(today), start), end);
  const totalDays = end - start + 1;
  const spentBetween = (from: number, to: number) =>
    sumMinor(expenses.filter((e) => {
      const d = toDay(e.localDate);
      return d >= from && d <= to;
    }).map((e) => toMinor(e.totalBase, base)));
  const allSpent = sumMinor(expenses.map((e) => toMinor(e.totalBase, base)));

  switch (rule.kind) {
    case 'none':
      return {
        kind: 'none', tripLimit: null, periodStart: trip.startDate, periodEnd: trip.endDate,
        periodLimit: null, periodSpent: allSpent, available: null, resetsInDays: null,
      };
    case 'total': {
      const limit = toMinor(rule.amount, base);
      return {
        kind: 'total', tripLimit: limit, periodStart: trip.startDate, periodEnd: trip.endDate,
        periodLimit: limit, periodSpent: allSpent, available: limit - allSpent, resetsInDays: null,
      };
    }
    case 'daily': {
      const perDay = toMinor(rule.amount, base);
      const spentToday = spentBetween(now, now);
      return {
        kind: 'daily', tripLimit: perDay * BigInt(totalDays), periodStart: fromDay(now), periodEnd: fromDay(now),
        periodLimit: perDay, periodSpent: spentToday, available: perDay - spentToday, resetsInDays: 0,
      };
    }
    case 'daily_pooled': {
      const perDay = toMinor(rule.amount, base);
      const window = Math.max(1, Math.floor(rule.poolDays));
      const windowStart = start + Math.floor((now - start) / window) * window;
      const windowEnd = Math.min(windowStart + window - 1, end);
      const accrued = perDay * BigInt(now - windowStart + 1);
      const spent = spentBetween(windowStart, now);
      return {
        kind: 'daily_pooled', tripLimit: perDay * BigInt(totalDays),
        periodStart: fromDay(windowStart), periodEnd: fromDay(windowEnd),
        periodLimit: accrued, periodSpent: spent, available: accrued - spent, resetsInDays: windowEnd - now,
      };
    }
  }
}
