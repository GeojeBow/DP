import type { Expense } from './models';

const DAY_MS = 86_400_000;
const day = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
const words = (s: string) => new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2));

export interface PaymentFacts {
  localDate: string;
  currency: string;
  /** Plain decimal in `currency` */
  total: string;
  merchantName: string;
}

/**
 * Finds an expense that is probably the same payment: same amount and
 * currency within a day (card statements often post a day late), and no
 * conflicting merchant names.
 */
export function findDuplicate(existing: readonly Expense[], p: PaymentFacts, ignoreId?: string): Expense | null {
  const amount = Number(p.total);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const mine = words(p.merchantName);
  let best: { e: Expense; score: number } | null = null;
  for (const e of existing) {
    if (e.id === ignoreId || e.currency !== p.currency || Number(e.total) !== amount) continue;
    const gap = Math.abs(day(e.localDate) - day(p.localDate));
    if (!(gap <= 1)) continue;
    const theirs = words(e.merchantName);
    const shared = [...mine].some((w) => theirs.has(w));
    // Two different, known merchant names mean two payments of the same amount.
    if (mine.size && theirs.size && !shared) continue;
    const score = (gap === 0 ? 2 : 1) + (shared ? 2 : 0);
    if (score > (best?.score ?? 0)) best = { e, score };
  }
  return best?.e ?? null;
}
