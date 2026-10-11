import type { ExpenseCategory, PaymentMethod } from './schemas';

/** Local (on-device) shapes. They map 1:1 onto the Supabase rows once sync lands in Phase 2. */

export interface Trip {
  id: string;
  title: string;
  /** ISO dates, inclusive */
  startDate: string;
  endDate: string;
  baseCurrency: string;
  /** Decimal string in baseCurrency, or null for no budget */
  budgetTotal: string | null;
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
  createdAt: string;
  updatedAt: string;
}

export const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  airfare: '항공',
  lodging: '숙박',
  meals: '식비',
  ground_transport: '교통',
  car_rental: '렌터카',
  fuel: '주유',
  parking: '주차',
  communication: '통신',
  entertainment: '접대',
  office_supplies: '사무용품',
  fees: '수수료',
  other: '기타',
};

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  corporate_card: '법인카드',
  personal_card: '개인카드',
  cash: '현금',
  bank_transfer: '계좌이체',
  mobile_pay: '간편결제',
  other: '기타',
};
