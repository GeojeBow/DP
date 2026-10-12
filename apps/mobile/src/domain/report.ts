import { type ClaimLabels, claimLines, summarizeClaim } from './claim';
import { type CustomField, customCell } from './customFields';
import { formatMoney, fromMinor, sumMinor, toCurrencyCode, toMinor } from './money';
import type { Expense, Trip } from './models';

/** Columns a report can show, in the user's chosen order. */
export const REPORT_COLUMNS = [
  'date', 'merchant', 'category', 'payment', 'currency', 'amount', 'fxRate', 'amountBase', 'memo', 'receipt',
  'vat', 'proof',
] as const;
export type ReportColumn = (typeof REPORT_COLUMNS)[number];

export const REPORT_GROUPINGS = ['date', 'category', 'none'] as const;
export type ReportGrouping = (typeof REPORT_GROUPINGS)[number];

export const REPORT_FORMATS = ['pdf', 'xlsx', 'docx'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

export interface ReportPreset {
  id: string;
  name: string;
  format: ReportFormat;
  columns: ReportColumn[];
  groupBy: ReportGrouping;
  /** PDF and Word: append receipt photos after the table */
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
  /** Column the subtotals and total sit under: the base amount if shown, else the last preset column */
  totalColumn: number;
  sections: ReportSection[];
  total: string;
  totalNumber: number;
  /** Totals for the summary charts, largest category first, days in order */
  summary: {
    byCategory: Array<{ label: string; text: string; number: number; share: number }>;
    byDay: Array<{ date: string; text: string; number: number }>;
  };
  /**
   * One page per line of the table, in the same order and with the same tag, so the receipts
   * at the back match the list at a glance. Lines without a photo get a page saying why.
   */
  attachments: ReportAttachment[];
  /** Spent / company-paid / personal / allowance / claim lines under the table */
  claim: Array<{ label: string; text: string; number: number; strong?: boolean }>;
  /** Signed lost-receipt statements, one page each in the PDF */
  affidavits: Array<{ tag: string; date: string; merchant: string; amount: string; reason: string; signer: string; signedAt: string }>;
}

export interface ReportAttachment {
  /** Tags of the lines this page covers: one, or several when one receipt was split into lines */
  tags: string[];
  date: string;
  merchant: string;
  /** What was paid, in the currency on the receipt */
  amount: string;
  /** The same in the trip's currency, which leads on the page */
  amountBase: string;
  /** Receipt-currency amount when it differs from the trip's, shown under the main one */
  amountLocal: string | null;
  /** amountBase in minor units, for day totals */
  baseMinor: bigint;
  payment: string;
  category: string;
  receiptId: string | null;
  /** Why there is no photo: added without one, a signed lost-receipt statement, or a car trip */
  missing: null | 'none' | 'affidavit' | 'mileage';
  /** Extra line for the page, e.g. the lost-receipt reason or the route */
  note: string;
  /** Everything the user entered, shown in place of the photo when there is none */
  details: Array<{ label: string; value: string }>;
}

export interface ReportLabels {
  column: (c: ReportColumn) => string;
  category: (c: Expense['category']) => string;
  payment: (p: Expense['paymentMethod']) => string;
  /** Header of the tag column that ties each line to its receipt page */
  tagColumn: string;
  /** Receipt cell for a line whose photo is attached, given its tag */
  receiptNo: (tag: string) => string;
  /** Receipt cell for an expense with a signed lost-receipt statement */
  missingReceipt: string;
  /** Receipt cell for an expense added without a receipt */
  noReceipt: string;
  /** Receipt cell for a car trip, which has no receipt */
  mileage: string;
  /** Row labels on a no-photo page, beyond the column names */
  detail?: { reason: string; signer: string; distance: string };
  proof: (p: NonNullable<Expense['proof']>) => string;
  claim: ClaimLabels;
  none: string;
}

/** Turns a trip's expenses into the table every exporter renders. */
export function buildReport(
  trip: Trip,
  expenses: readonly Expense[],
  preset: ReportPreset,
  labels: ReportLabels,
  /** Company custom fields, added as columns after the preset's own */
  customFields: readonly CustomField[] = [],
): ReportTable {
  const base = toCurrencyCode(trip.baseCurrency);
  const sorted = [...expenses].sort((a, b) => a.localDate.localeCompare(b.localDate) || a.createdAt.localeCompare(b.createdAt));
  const money = (e: Expense) => formatMoney(toMinor(e.total, toCurrencyCode(e.currency)), toCurrencyCode(e.currency));

  const groups = new Map<string, Expense[]>();
  for (const e of sorted) {
    const key = preset.groupBy === 'date' ? e.localDate : preset.groupBy === 'category' ? labels.category(e.category) : '';
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  // Tags follow the order lines appear in the table, so the pages at the back read in the same order.
  const ordered = [...groups.values()].flat();
  const width = Math.max(2, String(ordered.length).length);
  const tags = new Map(ordered.map((e, i) => [e.id, `#${String(i + 1).padStart(width, '0')}`]));
  const tagOf = (e: Expense) => tags.get(e.id)!;

  // What the user typed in for an expense with no photo, so the page still says what was spent.
  const noPhotoDetails = (e: Expense): ReportAttachment['details'] => {
    const d = labels.detail;
    const rows: Array<[string, string | undefined]> = [
      [labels.column('date'), e.localDate],
      [labels.column('merchant'), e.merchantName],
      [labels.column('category'), labels.category(e.category)],
      [labels.column('amount'), money(e)],
      [labels.column('amountBase'), e.currency === e.baseCurrency ? undefined : formatMoney(toMinor(e.totalBase, base), base)],
      [labels.column('payment'), labels.payment(e.paymentMethod)],
      [d?.distance ?? 'km', e.mileage ? [e.mileage.route, `${e.mileage.km} km`].filter(Boolean).join(' · ') : undefined],
      [d?.reason ?? 'reason', e.missingReceipt?.reason],
      [d?.signer ?? 'signer', e.missingReceipt ? `${e.missingReceipt.signer} · ${e.missingReceipt.signedAt.slice(0, 10)}` : undefined],
      [labels.column('memo'), e.memo],
    ];
    return rows.filter((r): r is [string, string] => !!r[1]).map(([label, value]) => ({ label, value }));
  };
  const attachments: ReportAttachment[] = [];
  const byReceipt = new Map<string, ReportAttachment>();
  // Running totals for a receipt split into several lines, so its page shows the whole receipt.
  const sums = new Map<ReportAttachment, { local: bigint; base: bigint; currency: string | null }>();
  const addTo = (page: ReportAttachment, e: Expense) => {
    const prev = sums.get(page) ?? { local: 0n, base: 0n, currency: e.currency };
    const same = prev.currency === e.currency;
    const next = {
      local: same ? prev.local + toMinor(e.total, toCurrencyCode(e.currency)) : 0n,
      base: prev.base + toMinor(e.totalBase, base),
      currency: same ? e.currency : null,
    };
    sums.set(page, next);
    page.baseMinor = next.base;
    page.amountBase = formatMoney(next.base, base);
    page.amount = next.currency ? formatMoney(next.local, toCurrencyCode(next.currency)) : page.amountBase;
    page.amountLocal = next.currency && next.currency !== base ? page.amount : null;
  };
  for (const e of ordered) {
    const shared = e.receiptId ? byReceipt.get(e.receiptId) : undefined;
    if (shared) {
      shared.tags.push(tagOf(e));
      addTo(shared, e);
      continue;
    }
    const page: ReportAttachment = {
      tags: [tagOf(e)],
      date: e.localDate,
      merchant: e.merchantName || labels.none,
      amount: money(e),
      amountBase: '',
      amountLocal: null,
      baseMinor: 0n,
      payment: labels.payment(e.paymentMethod),
      category: labels.category(e.category),
      receiptId: e.receiptId,
      missing: e.receiptId ? null : e.mileage ? 'mileage' : e.missingReceipt ? 'affidavit' : 'none',
      note: e.receiptId ? '' : e.mileage ? [e.mileage.route, `${e.mileage.km} km`].filter(Boolean).join(' · ') : e.missingReceipt?.reason ?? e.memo,
      details: e.receiptId ? [] : noPhotoDetails(e),
    };
    addTo(page, e);
    if (e.receiptId) byReceipt.set(e.receiptId, page);
    attachments.push(page);
  }

  const cell = (e: Expense, c: ReportColumn): ReportCell => {
    const local = toCurrencyCode(e.currency);
    switch (c) {
      case 'date': return { text: e.localDate };
      case 'merchant': return { text: (e.merchantName || labels.none) + (e.split ? ` (1/${e.split.people})` : '') };
      case 'category': return { text: labels.category(e.category) };
      case 'payment': return { text: labels.payment(e.paymentMethod) };
      case 'currency': return { text: e.currency };
      case 'amount': return { text: formatMoney(toMinor(e.total, local), local), number: Number(e.total) };
      case 'fxRate': return { text: e.fxRate, number: Number(e.fxRate) };
      case 'amountBase': return { text: formatMoney(toMinor(e.totalBase, base), base), number: Number(e.totalBase) };
      case 'memo': return { text: e.memo };
      case 'receipt':
        return {
          text: e.receiptId ? labels.receiptNo(tagOf(e)) : e.mileage ? labels.mileage : e.missingReceipt ? labels.missingReceipt : labels.noReceipt,
        };
      case 'vat': return e.vat ? { text: formatMoney(toMinor(e.vat, local), local), number: Number(e.vat) } : { text: labels.none };
      case 'proof': return { text: e.proof ? labels.proof(e.proof) : labels.none };
    }
  };

  const sumBase = (list: readonly Expense[]) => sumMinor(list.map((e) => toMinor(e.totalBase, base)));
  const total = sumBase(sorted);
  const totalsBy = (key: (e: Expense) => string) => {
    const m = new Map<string, Expense[]>();
    for (const e of sorted) m.set(key(e), [...(m.get(key(e)) ?? []), e]);
    return [...m.entries()].map(([k, list]) => ({ k, sum: sumBase(list) }));
  };
  const summary: ReportTable['summary'] = {
    byCategory: totalsBy((e) => labels.category(e.category))
      .sort((a, b) => (b.sum > a.sum ? 1 : b.sum < a.sum ? -1 : 0))
      .map(({ k, sum }) => ({
        label: k,
        text: formatMoney(sum, base),
        number: Number(fromMinor(sum, base)),
        share: total > 0n ? Math.round((Number(sum) / Number(total)) * 1000) / 10 : 0,
      })),
    byDay: totalsBy((e) => e.localDate).map(({ k, sum }) => ({ date: k, text: formatMoney(sum, base), number: Number(fromMinor(sum, base)) })),
  };

  // A PDF with receipts at the back always says, line by line, what is attached.
  const columns = preset.receiptAppendix && !preset.columns.includes('receipt') ? [...preset.columns, 'receipt' as const] : preset.columns;

  return {
    title: trip.title,
    period: `${trip.startDate} ~ ${trip.endDate}`,
    baseCurrency: trip.baseCurrency,
    headers: [labels.tagColumn, ...columns.map(labels.column), ...customFields.map((f) => f.name)],
    totalColumn: 1 + (columns.includes('amountBase') ? columns.indexOf('amountBase') : Math.max(0, columns.length - 1)),
    sections: [...groups.entries()].map(([key, list]) => ({
      title: preset.groupBy === 'none' ? null : key,
      rows: list.map((e) => [{ text: tagOf(e) }, ...columns.map((c) => cell(e, c)), ...customFields.map((f) => customCell(f, e.custom?.[f.id]))]),
      subtotal: formatMoney(sumBase(list), base),
    })),
    total: formatMoney(total, base),
    totalNumber: Number(fromMinor(total, base)),
    summary,
    attachments: preset.receiptAppendix ? attachments : [],
    claim: claimLines(trip, summarizeClaim(trip, sorted), labels.claim),
    affidavits: ordered.flatMap((e) =>
      e.missingReceipt && !e.receiptId
        ? [{
            tag: tagOf(e),
            date: e.localDate,
            merchant: e.merchantName || labels.none,
            amount: money(e),
            ...e.missingReceipt,
          }]
        : []),
  };
}
