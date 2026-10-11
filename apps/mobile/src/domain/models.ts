import type { BudgetRule } from './budget';
import type { ExpenseCategory, PaymentMethod } from './schemas';

/** Local (on-device) shapes. They map 1:1 onto the Supabase rows once sync lands in Phase 2. */

export interface Trip {
  id: string;
  title: string;
  /** ISO dates, inclusive */
  startDate: string;
  endDate: string;
  baseCurrency: string;
  /** Amounts are decimal strings in baseCurrency */
  budget: BudgetRule;
  /** Daily allowance (일비) in baseCurrency; `days` overrides the trip length */
  perDiem?: { amount: string; days?: number };
  /** Set when the company has paid the traveller back */
  reimbursedAt?: string;
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
