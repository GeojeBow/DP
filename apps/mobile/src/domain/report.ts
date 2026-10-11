import { formatMoney, fromMinor, sumMinor, toCurrencyCode, toMinor } from './money';
import type { Expense, Trip } from './models';

/** Columns a report can show, in the user's chosen order. */
export const REPORT_COLUMNS = [
  'date', 'merchant', 'category', 'payment', 'currency', 'amount', 'fxRate', 'amountBase', 'memo', 'receipt',
] as const;
export type ReportColumn = (typeof REPORT_COLUMNS)[number];

export const REPORT_GROUPINGS = ['date', 'category', 'none'] as const;
export type ReportGrouping = (typeof REPORT_GROUPINGS)[number];

export const REPORT_FORMATS = ['xlsx', 'pdf'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

export interface ReportPreset {
  id: string;
  name: string;
  format: ReportFormat;
  columns: ReportColumn[];
  groupBy: ReportGrouping;
  /** PDF only: append receipt photos after the table */
  receiptAppendix: boolean;
  builtin?: boolean;
}

export const BUILTIN_PRESETS: readonly ReportPreset[] = [
  {
    id: 'builtin-executive-pdf',
    name: 'Executive PDF',
    format: 'pdf',
    columns: ['date', 'merchant', 'category', 'amount', 'amountBase'],
    groupBy: 'date',
    receiptAppendix: true,
    builtin: true,
  },
  {
    id: 'builtin-modern-excel',
    name: 'Modern Excel',
    format: 'xlsx',
    columns: ['date', 'merchant', 'category', 'currency', 'amount', 'fxRate', 'amountBase', 'payment'],
    groupBy: 'date',
    receiptAppendix: false,
    builtin: true,
  },
];

/** A cell keeps its number separate from its label so Excel can sum it. */
export type ReportCell = { text: string; number?: number };

export interface ReportSection {
  title: string | null;
  rows: ReportCell[][];
  subtotal: string;
}

export interface ReportTable {
  title: string;
  period: string;
  baseCurrency: string;
  headers: string[];
  sections: ReportSection[];
  total: string;
  totalNumber: number;
  /** Receipt ids in table order, numbered from 1 */
  receipts: Array<{ no: number; receiptId: string }>;
}

export interface ReportLabels {
  column: (c: ReportColumn) => string;
  category: (c: Expense['category']) => string;
  payment: (p: Expense['paymentMethod']) => string;
  receiptNo: (n: number) => string;
  none: string;
}

/** Turns a trip's expenses into the table every exporter renders. */
export function buildReport(trip: Trip, expenses: readonly Expense[], preset: ReportPreset, labels: ReportLabels): ReportTable {
  const base = toCurrencyCode(trip.baseCurrency);
  const sorted = [...expenses].sort((a, b) => a.localDate.localeCompare(b.localDate) || a.createdAt.localeCompare(b.createdAt));
  const receipts: ReportTable['receipts'] = [];
  const receiptNo = new Map<string, number>();
  for (const e of sorted) {
    if (e.receiptId && !receiptNo.has(e.id)) {
      receiptNo.set(e.id, receipts.length + 1);
      receipts.push({ no: receipts.length + 1, receiptId: e.receiptId });
    }
  }

  const cell = (e: Expense, c: ReportColumn): ReportCell => {
    const local = toCurrencyCode(e.currency);
    switch (c) {
      case 'date': return { text: e.localDate };
      case 'merchant': return { text: e.merchantName || labels.none };
      case 'category': return { text: labels.category(e.category) };
      case 'payment': return { text: labels.payment(e.paymentMethod) };
      case 'currency': return { text: e.currency };
      case 'amount': return { text: formatMoney(toMinor(e.total, local), local), number: Number(e.total) };
      case 'fxRate': return { text: e.fxRate, number: Number(e.fxRate) };
      case 'amountBase': return { text: formatMoney(toMinor(e.totalBase, base), base), number: Number(e.totalBase) };
      case 'memo': return { text: e.memo };
      case 'receipt': {
        const no = receiptNo.get(e.id);
        return { text: no ? labels.receiptNo(no) : labels.none };
      }
    }
  };

  const groups = new Map<string, Expense[]>();
  for (const e of sorted) {
    const key = preset.groupBy === 'date' ? e.localDate : preset.groupBy === 'category' ? labels.category(e.category) : '';
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const sumBase = (list: readonly Expense[]) => sumMinor(list.map((e) => toMinor(e.totalBase, base)));
  const total = sumBase(sorted);

  return {
    title: trip.title,
    period: `${trip.startDate} ~ ${trip.endDate}`,
    baseCurrency: trip.baseCurrency,
    headers: preset.columns.map(labels.column),
    sections: [...groups.entries()].map(([key, list]) => ({
      title: preset.groupBy === 'none' ? null : key,
      rows: list.map((e) => preset.columns.map((c) => cell(e, c))),
      subtotal: formatMoney(sumBase(list), base),
    })),
    total: formatMoney(total, base),
    totalNumber: Number(fromMinor(total, base)),
    receipts: preset.receiptAppendix ? receipts : [],
  };
}
