import type { Expense, Trip } from './models';

/**
 * Finds expenses across every trip by what people remember: the shop, a memo
 * word, the date ("10-03", "2026-10"), the amount ("12000", "12,000") or the
 * category/trip name. All words must match.
 */
export function searchExpenses(
  expenses: readonly Expense[],
  trips: readonly Trip[],
  query: string,
  categoryLabel: (c: Expense['category']) => string,
): Expense[] {
  const words = query.toLowerCase().replace(/,/g, '').split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const tripTitle = new Map(trips.map((t) => [t.id, t.title.toLowerCase()]));
  return expenses
    .filter((e) => {
      const haystack = [
        e.merchantName, e.memo, e.localDate, e.total, e.totalBase, e.split?.fullTotal ?? '', e.currency,
        categoryLabel(e.category), (e.tripId && tripTitle.get(e.tripId)) || '', e.mileage?.route ?? '',
        ...Object.values(e.custom ?? {}),
      ].join(' ').toLowerCase();
      return words.every((w) => haystack.includes(w));
    })
    .sort((a, b) => b.localDate.localeCompare(a.localDate) || b.createdAt.localeCompare(a.createdAt));
}
