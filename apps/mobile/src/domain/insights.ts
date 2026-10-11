import { currencyExponent, type MinorUnits, sumMinor, toCurrencyCode, toMinor } from './money';
import type { Expense } from './models';

export interface CurrencyUse {
  currency: string;
  count: number;
  /** In `currency` */
  local: MinorUnits;
  /** In the trip's base currency */
  base: MinorUnits;
  /** Effective rate over all entries: base ÷ local, rounded for display */
  avgRate: number;
  minRate: number;
  maxRate: number;
}

/** Spending per foreign currency, with the spread of rates used. Base-currency spending is left out. */
export function currencyBreakdown(expenses: readonly Expense[], baseCurrency: string): CurrencyUse[] {
  const groups = new Map<string, Expense[]>();
  for (const e of expenses) if (e.currency !== baseCurrency) groups.set(e.currency, [...(groups.get(e.currency) ?? []), e]);
  const base = toCurrencyCode(baseCurrency);
  return [...groups.entries()]
    .map(([currency, list]) => {
      const code = toCurrencyCode(currency);
      const local = sumMinor(list.map((e) => toMinor(e.total, code)));
      const baseTotal = sumMinor(list.map((e) => toMinor(e.totalBase, base)));
      const rates = list.map((e) => Number(e.fxRate));
      const scale = 10 ** (currencyExponent(code) - currencyExponent(base));
      const avg = local > 0n ? (Number(baseTotal) / Number(local)) * scale : 0;
      return {
        currency,
        count: list.length,
        local,
        base: baseTotal,
        avgRate: Math.round(avg * 10000) / 10000,
        minRate: Math.min(...rates),
        maxRate: Math.max(...rates),
      };
    })
    .sort((a, b) => (b.base > a.base ? 1 : b.base < a.base ? -1 : 0));
}

export interface SubmissionChecks {
  ruleBroken: number;
  noReceipt: number;
  noMerchant: number;
}

/** Things worth fixing before the report goes to the company. */
export function submissionChecks(expenses: readonly Expense[], flagged: ReadonlySet<string> | { has: (id: string) => boolean }): SubmissionChecks {
  return {
    ruleBroken: expenses.filter((e) => flagged.has(e.id)).length,
    noReceipt: expenses.filter((e) => !e.receiptId).length,
    noMerchant: expenses.filter((e) => !e.merchantName.trim()).length,
  };
}
