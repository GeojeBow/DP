import { type CurrencyCode, formatMoney, fromMinor, type MinorUnits, sumMinor, toCurrencyCode, toMinor } from './money';
import type { Expense, ProofType, Trip } from './models';

/**
 * What the traveller claims back from the company: the expenses they paid
 * themselves plus the daily allowance, with the VAT the receipts carry.
 */

const DAY_MS = 86_400_000;

/** Days the trip spans, both ends included. */
export function tripDays(trip: Pick<Trip, 'startDate' | 'endDate'>): number {
  const start = Date.parse(`${trip.startDate}T00:00:00Z`);
  const end = Date.parse(`${trip.endDate}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(Math.round((end - start) / DAY_MS) + 1, 0);
}

/** Days the allowance is paid for: the user's override, else the whole trip. */
export function perDiemDays(trip: Trip): number {
  return trip.perDiem?.days ?? tripDays(trip);
}

export function perDiemTotal(trip: Trip): MinorUnits {
  if (!trip.perDiem) return 0n;
  return toMinor(trip.perDiem.amount, toCurrencyCode(trip.baseCurrency)) * BigInt(perDiemDays(trip));
}

/** Paid by the company card, so nothing comes back to the traveller. */
export const isReimbursable = (e: Pick<Expense, 'paymentMethod'>) => e.paymentMethod !== 'corporate_card';

/** Domestic proofs that let a Korean company deduct input VAT (적격증빙). */
const DEDUCTIBLE_PROOFS = new Set<ProofType>(['tax_invoice', 'card_slip', 'cash_receipt']);

/** A sensible proof type for a new expense; the user can change it. */
export function defaultProof(currency: string, payment: Expense['paymentMethod'], homeCurrency = 'KRW'): ProofType {
  if (currency !== homeCurrency) return 'foreign_receipt';
  if (payment === 'corporate_card' || payment === 'personal_card') return 'card_slip';
  return 'simple_receipt';
}

/** The expense's VAT in the trip's base currency, using the expense's own rate. */
function vatBase(e: Expense, base: CurrencyCode): MinorUnits {
  if (!e.vat) return 0n;
  const total = Number(e.total);
  // Scale the base amount by the VAT share so no second rounding path is needed.
  if (!(total > 0)) return 0n;
  const share = Number(e.vat) / total;
  return BigInt(Math.round(Number(toMinor(e.totalBase, base)) * share));
}

export interface ClaimSummary {
  /** Everything spent on the trip */
  spent: MinorUnits;
  /** Paid with the company card */
  companyPaid: MinorUnits;
  /** Paid by the traveller: cash, own card, mileage */
  personal: MinorUnits;
  perDiemDays: number;
  perDiem: MinorUnits;
  /** personal + perDiem: what the company owes the traveller */
  claim: MinorUnits;
  /** VAT on domestic qualifying proofs (deductible) */
  vatDeductible: MinorUnits;
  /** VAT on foreign receipts (may be refundable abroad) */
  vatForeign: MinorUnits;
  missingReceipts: number;
}

export function summarizeClaim(trip: Trip, expenses: readonly Expense[]): ClaimSummary {
  const base = toCurrencyCode(trip.baseCurrency);
  const own = expenses.filter((e) => e.tripId === trip.id);
  const amount = (e: Expense) => toMinor(e.totalBase, base);
  const personal = sumMinor(own.filter(isReimbursable).map(amount));
  const perDiem = perDiemTotal(trip);
  return {
    spent: sumMinor(own.map(amount)),
    companyPaid: sumMinor(own.filter((e) => !isReimbursable(e)).map(amount)),
    personal,
    perDiemDays: trip.perDiem ? perDiemDays(trip) : 0,
    perDiem,
    claim: personal + perDiem,
    vatDeductible: sumMinor(own.filter((e) => e.proof && DEDUCTIBLE_PROOFS.has(e.proof)).map((e) => vatBase(e, base))),
    vatForeign: sumMinor(own.filter((e) => e.proof === 'foreign_receipt').map((e) => vatBase(e, base))),
    missingReceipts: own.filter((e) => e.missingReceipt).length,
  };
}

export interface ClaimLabels {
  spent: string;
  companyPaid: string;
  personal: string;
  perDiem: (days: number, perDay: string) => string;
  claim: string;
  vatDeductible: string;
  vatForeign: string;
}

/** Label/amount lines for the report summary; zero lines that add nothing are left out. */
export function claimLines(trip: Trip, s: ClaimSummary, labels: ClaimLabels): Array<{ label: string; text: string; number: number; strong?: boolean }> {
  const base = toCurrencyCode(trip.baseCurrency);
  const line = (label: string, v: MinorUnits, strong?: boolean) => ({
    label, text: formatMoney(v, base), number: Number(fromMinor(v, base)), strong,
  });
  const out = [line(labels.spent, s.spent)];
  if (s.companyPaid > 0n) out.push(line(labels.companyPaid, s.companyPaid), line(labels.personal, s.personal));
  if (trip.perDiem) {
    out.push(line(labels.perDiem(s.perDiemDays, formatMoney(toMinor(trip.perDiem.amount, base), base)), s.perDiem));
  }
  if (s.companyPaid > 0n || trip.perDiem) out.push(line(labels.claim, s.claim, true));
  if (s.vatDeductible > 0n) out.push(line(labels.vatDeductible, s.vatDeductible));
  if (s.vatForeign > 0n) out.push(line(labels.vatForeign, s.vatForeign));
  return out;
}

/** km × rate, rounded to the currency's minor unit. */
export function mileageAmount(km: string, rate: string, currency: string): MinorUnits | null {
  const k = Number(km);
  const r = Number(rate);
  if (!(k > 0) || !(r > 0)) return null;
  const c = toCurrencyCode(currency);
  return toMinor((k * r).toFixed(2), c);
}
