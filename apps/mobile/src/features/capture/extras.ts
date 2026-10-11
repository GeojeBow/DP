import { findDuplicate } from '../../domain/duplicates';
import { uuidv7 } from '../../domain/id';
import { convertMinor, fromMinor, toCurrencyCode, toMinor } from '../../domain/money';
import type { Expense } from '../../domain/models';
import type { PaymentMethod } from '../../domain/schemas';
import type { ReceiptPrefill } from './readReceipt';

export interface ExtrasContext {
  tripId: string | null;
  /** Used when a line has no date or currency of its own */
  fallbackDate: string;
  fallbackCurrency: string;
  baseCurrency: string;
  /** Rate for "1 currency = ? base", or undefined when unknown */
  rateFor: (currency: string) => string | undefined;
  payment: PaymentMethod;
  receiptId: string | null;
  existing: readonly Expense[];
  now: string;
}

export interface ExtrasResult {
  expenses: Expense[];
  /** Lines the AI read no amount for */
  noAmount: number;
  /** Lines in a currency with no known exchange rate */
  noRate: number;
  /** Lines that match an expense already recorded (e.g. its receipt was scanned earlier) */
  duplicates: number;
}

/** Turns the other lines of a card statement into expenses, skipping what can't or shouldn't be added. */
export function buildExtraExpenses(extras: readonly ReceiptPrefill[], ctx: ExtrasContext): ExtrasResult {
  const out: ExtrasResult = { expenses: [], noAmount: 0, noRate: 0, duplicates: 0 };
  const base = toCurrencyCode(ctx.baseCurrency);
  for (const p of extras) {
    if (!p.total || !(Number(p.total) > 0)) {
      out.noAmount += 1;
      continue;
    }
    const currency = p.currency ?? ctx.fallbackCurrency;
    const localDate = p.localDate ?? ctx.fallbackDate;
    const rate = currency === ctx.baseCurrency ? '1' : ctx.rateFor(currency);
    if (!rate || !(Number(rate) > 0)) {
      out.noRate += 1;
      continue;
    }
    const facts = { localDate, currency, total: p.total, merchantName: p.merchantName ?? '' };
    if (findDuplicate([...ctx.existing, ...out.expenses], facts)) {
      out.duplicates += 1;
      continue;
    }
    const local = toCurrencyCode(currency);
    const minor = toMinor(p.total, local);
    out.expenses.push({
      id: uuidv7(),
      tripId: ctx.tripId,
      localDate,
      merchantName: p.merchantName ?? '',
      category: p.category ?? 'other',
      paymentMethod: p.paymentMethod ?? ctx.payment,
      currency,
      total: fromMinor(minor, local),
      fxRate: rate,
      baseCurrency: ctx.baseCurrency,
      totalBase: fromMinor(convertMinor(minor, local, base, rate), base),
      receiptId: ctx.receiptId,
      memo: '',
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
  }
  return out;
}
