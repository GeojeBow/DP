import { type MinorUnits, sumMinor, toCurrencyCode, toMinor } from './money';
import type { Expense, Trip } from './models';
import type { ExpenseCategory } from './schemas';

const DAY_MS = 86_400_000;

function dayNumber(isoDate: string): number {
  const ms = Date.parse(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(ms)) throw new RangeError(`Invalid ISO date: "${isoDate}"`);
  return Math.floor(ms / DAY_MS);
}

/** Today's date as YYYY-MM-DD in the device's local time zone. */
export function localToday(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

export interface TripSummary {
  spent: MinorUnits;
  budget: MinorUnits | null;
  /** 0..1+, null without a budget */
  burnRatio: number | null;
  totalDays: number;
  /** 1-based day of the trip for `today`, clamped to the trip */
  dayOfTrip: number;
  /** Days left including today; the whole trip before it starts, 0 after it ends */
  daysRemaining: number;
  /** (budget - spent) / daysRemaining, null without a budget or with no days left */
  remainingPerDay: MinorUnits | null;
  byCategory: Array<{ category: ExpenseCategory; amount: MinorUnits }>;
}

export function summarizeTrip(trip: Trip, expenses: readonly Expense[], today: string): TripSummary {
  const base = toCurrencyCode(trip.baseCurrency);
  const own = expenses.filter((e) => e.tripId === trip.id);
  const spent = sumMinor(own.map((e) => toMinor(e.totalBase, base)));
  const budget = trip.budgetTotal ? toMinor(trip.budgetTotal, base) : null;

  const start = dayNumber(trip.startDate);
  const end = dayNumber(trip.endDate);
  const now = dayNumber(today);
  const totalDays = end - start + 1;
  const dayOfTrip = Math.min(Math.max(now - start + 1, 1), totalDays);
  const daysRemaining = now < start ? totalDays : Math.max(end - now + 1, 0);

  const remainingPerDay =
    budget !== null && daysRemaining > 0 ? (budget - spent) / BigInt(daysRemaining) : null;

  const totals = new Map<ExpenseCategory, MinorUnits>();
  for (const e of own) totals.set(e.category, (totals.get(e.category) ?? 0n) + toMinor(e.totalBase, base));
  const byCategory = [...totals.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));

  return {
    spent,
    budget,
    burnRatio: budget && budget > 0n ? Number((spent * 10_000n) / budget) / 10_000 : null,
    totalDays,
    dayOfTrip,
    daysRemaining,
    remainingPerDay,
    byCategory,
  };
}

/** Expenses grouped by local date, newest day first, each day newest first. */
export function groupByDate(expenses: readonly Expense[]): Array<{ date: string; items: Expense[] }> {
  const groups = new Map<string, Expense[]>();
  for (const e of expenses) groups.set(e.localDate, [...(groups.get(e.localDate) ?? []), e]);
  return [...groups.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, items]) => ({ date, items: items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }));
}
