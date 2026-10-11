import type { CompanyRule } from '../features/policy/rules';
import type { BudgetRule } from './budget';
import type { ExpenseCategory, PaymentMethod } from './schemas';

/** Local (on-device) shapes. They map 1:1 onto the Supabase rows once sync lands in Phase 2. */

/** Daily allowance (일비). Amount is a decimal string in the trip's base currency. */
export interface PerDiem {
  amount: string;
  /** Overrides the number of days paid (default: the whole trip) */
  days?: number;
  /** Share of the allowance paid on the departure and return days, in percent (default 100) */
  travelDayPercent?: number;
}

export interface Trip {
  id: string;
  title: string;
  /** ISO dates, inclusive */
  startDate: string;
  endDate: string;
  baseCurrency: string;
  /** Amounts are decimal strings in baseCurrency */
  budget: BudgetRule;
  /** Daily allowance (일비) in baseCurrency */
  perDiem?: PerDiem;
  /** Set when the company has paid the traveller back */
  reimbursedAt?: string;
  /** Exchange rates remembered for this trip: currency → units of baseCurrency */
  fxRates?: Record<string, string>;
  /**
   * 'company' = budget, allowance and rules follow the company policy (copied in when it changes);
   * 'trip' = this trip keeps its own.
   */
  ruleMode?: 'company' | 'trip';
  rules?: CompanyRule[];
  createdAt: string;
}

/** Kind of proof a receipt is, for the accounting team (적격증빙 구분). */
export const PROOF_TYPES = ['card_slip', 'tax_invoice', 'cash_receipt', 'simple_receipt', 'foreign_receipt', 'none'] as const;
export type ProofType = (typeof PROOF_TYPES)[number];

export interface Expense {
  id: string;
  tripId: string | null;
  localDate: string;
  merchantName: string;
  category: ExpenseCategory;
  paymentMethod: PaymentMethod;
  currency: string;
  /** Decimal string in `currency` */
  total: string;
  /** 1 `currency` = fxRate `baseCurrency` */
  fxRate: string;
  baseCurrency: string;
  /** Decimal string in `baseCurrency` */
  totalBase: string;
  receiptId: string | null;
  memo: string;
  /** VAT shown on the receipt, decimal string in `currency` */
  vat?: string;
  proof?: ProofType;
  /** Own-car travel: total = km × rate in baseCurrency */
  mileage?: { km: string; rate: string; route: string };
  /** Shared bill: `total` is my share; fullTotal is the whole bill in `currency` */
  split?: { people: number; fullTotal: string };
  /** Signed statement standing in for a lost receipt */
  missingReceipt?: { reason: string; signer: string; signedAt: string };
  /** Company custom fields: field id → value as typed */
  custom?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}
