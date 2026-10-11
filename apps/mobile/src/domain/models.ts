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
  createdAt: string;
}

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
  /** Company custom fields: field id → value as typed */
  custom?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}
