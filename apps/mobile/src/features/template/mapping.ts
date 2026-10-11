import { type CustomField, customCell } from '../../domain/customFields';
import { formatMoney, fromMinor, sumMinor, toCurrencyCode, toMinor } from '../../domain/money';
import type { Expense, Trip } from '../../domain/models';
import { type CellValue, columnIndex, columnLetters, type FillPlan, type ParsedTemplate, splitRef } from './xlsxTemplate';

/** Single values a template can ask for, each written into one cell. */
export const TEMPLATE_FIELDS = ['traveler', 'department', 'title', 'period', 'startDate', 'endDate', 'total', 'currency', 'today'] as const;
export type TemplateField = (typeof TEMPLATE_FIELDS)[number];

/** Per-expense values, each written into one column of the item table. */
export const TEMPLATE_COLUMNS = [
  'no', 'date', 'merchant', 'category', 'payment', 'currency', 'amount', 'fxRate', 'amountBase', 'memo',
] as const;
export type TemplateColumn = (typeof TEMPLATE_COLUMNS)[number];

export interface TemplateMapping {
  /** Field → cell address, e.g. traveler → "B3" */
  fields: Partial<Record<TemplateField, string>>;
  /** First empty item row and column letter per value; null when the template has no item table */
  table: {
    firstRow: number;
    columns: Partial<Record<TemplateColumn, string>>;
    /** Custom field id → column letter */
    custom?: Record<string, string>;
  } | null;
}

/** A saved company template: the original file plus where things go. */
export interface CompanyTemplate {
  id: string;
  name: string;
  fileName: string;
  mapping: TemplateMapping;
  /** Typed once by the user, e.g. their name and team */
  values: { traveler?: string; department?: string };
}

const norm = (s: string) => s.toLowerCase().replace(/[\s:：()（）[\]*·._-]/g, '');

const FIELD_LABELS: Record<TemplateField, string[]> = {
  traveler: ['성명', '이름', '출장자', '신청자', '사용자', 'name', 'employee', 'traveler', 'traveller'],
  department: ['부서', '소속', '팀', 'department', 'dept', 'team'],
  title: ['출장명', '출장목적', '목적', '건명', '제목', 'purpose', 'trip', 'title', 'project'],
  period: ['출장기간', '기간', 'period', 'dates', 'tripdates'],
  startDate: ['출발일', '시작일', '출장시작', 'startdate', 'departure'],
  endDate: ['귀국일', '종료일', '도착일', '출장종료', 'enddate', 'returndate'],
  total: ['합계', '총액', '총계', '정산금액', '청구금액', 'total', 'grandtotal', 'amountdue'],
  currency: ['기준통화', '정산통화', 'basecurrency', 'reportcurrency'],
  today: ['작성일', '신청일', '제출일', '정산일', 'date of report', 'reportdate', 'submitted', 'submissiondate'],
};

const COLUMN_LABELS: Record<TemplateColumn, string[]> = {
  no: ['no', '번호', '순번', '#'],
  date: ['일자', '날짜', '사용일', '사용일자', '거래일', 'date', 'transactiondate'],
  merchant: ['사용처', '가맹점', '상호', '거래처', '내역', '적요', 'merchant', 'vendor', 'payee', 'description'],
  category: ['항목', '분류', '계정', '계정과목', '비목', '구분', 'category', 'type', 'expensetype', 'account'],
  payment: ['결제수단', '지불방법', '결제', 'payment', 'paymentmethod', 'paidby'],
  currency: ['통화', '화폐', 'currency', 'ccy'],
  amount: ['현지금액', '외화금액', '사용금액', '금액(현지)', 'localamount', 'amount(local)', 'foreignamount', 'amount'],
  fxRate: ['환율', 'fxrate', 'exchangerate', 'rate'],
  amountBase: ['원화금액', '금액(krw)', '원화', '정산금액', '환산금액', 'krw', 'amount(krw)', 'baseamount', 'convertedamount'],
  memo: ['비고', '메모', '참고', 'memo', 'note', 'notes', 'remarks', 'comment'],
};

function matches(text: string, labels: string[]): number {
  const t = norm(text);
  let best = 0;
  for (const l of labels.map(norm)) {
    if (t === l) best = Math.max(best, 3);
    else if (l.length >= 2 && (t.startsWith(l) || t.endsWith(l))) best = Math.max(best, 2);
    else if (l.length >= 2 && t.includes(l)) best = Math.max(best, 1);
  }
  return best;
}

/**
 * Best guess at where things go, from the labels printed in the template.
 * Used when the AI isn't reachable, and as a starting point the user edits.
 */
export function guessMapping(t: ParsedTemplate): TemplateMapping {
  const byRef = new Map(t.cells.map((c) => [c.ref, c.text]));
  // The item table's header: the row whose cells match the most column labels.
  const rows = new Map<number, typeof t.cells>();
  for (const c of t.cells) rows.set(splitRef(c.ref).row, [...(rows.get(splitRef(c.ref).row) ?? []), c]);
  let header: { row: number; columns: Partial<Record<TemplateColumn, string>>; score: number } | null = null;
  for (const [row, cells] of rows) {
    const columns: Partial<Record<TemplateColumn, string>> = {};
    let score = 0;
    const taken = new Set<string>();
    for (const key of TEMPLATE_COLUMNS) {
      let best: { col: string; s: number } | null = null;
      for (const c of cells) {
        const col = splitRef(c.ref).col;
        if (taken.has(col)) continue;
        const s = matches(c.text, COLUMN_LABELS[key]);
        if (s > (best?.s ?? 0)) best = { col, s };
      }
      if (best && best.s >= 2) {
        columns[key] = best.col;
        taken.add(best.col);
        score += best.s;
      }
    }
    if (Object.keys(columns).length >= 2 && score > (header?.score ?? 0)) header = { row, columns, score };
  }
  // A lone "금액" next to a currency column is the local amount; without one it's already in the base currency.
  if (header && header.columns.amount && !header.columns.amountBase && !header.columns.currency) {
    header.columns.amountBase = header.columns.amount;
    delete header.columns.amount;
  }

  const fields: TemplateMapping['fields'] = {};
  const used = new Set<string>();
  for (const key of TEMPLATE_FIELDS) {
    let best: { ref: string; s: number } | null = null;
    for (const c of t.cells) {
      const { col, row } = splitRef(c.ref);
      if (header && row === header.row) continue;
      if (c.text.startsWith('=')) continue;
      const s = matches(c.text, FIELD_LABELS[key]);
      if (s < 2 || s <= (best?.s ?? 0)) continue;
      // The value goes in the first empty cell to the right, or else the cell below.
      let target: string | null = null;
      let prefilled = false;
      for (let i = columnIndex(col) + 1; i <= columnIndex(col) + 4; i++) {
        const ref = `${columnLetters(i)}${row}`;
        const v = byRef.get(ref);
        if (v === undefined) {
          target = ref;
          break;
        }
        if (v.startsWith('=')) {
          target = ref; // a formula already computes it; filling skips formula cells
          break;
        }
        // Another label: stop looking right. Plain text: the company already filled this in.
        prefilled = matches(v, Object.values(FIELD_LABELS).flat()) < 3;
        break;
      }
      if (!target && !prefilled && !byRef.has(`${col}${row + 1}`)) target = `${col}${row + 1}`;
      if (target && !used.has(target)) best = { ref: target, s };
    }
    if (best) {
      fields[key] = best.ref;
      used.add(best.ref);
    }
  }
  return { fields, table: header ? { firstRow: header.row + 1, columns: header.columns } : null };
}

export interface FillLabels {
  category: (c: Expense['category']) => string;
  payment: (p: Expense['paymentMethod']) => string;
  today: string;
}

/** Turns trip data into cell values for the mapped template. */
export function planFill(
  trip: Trip,
  expenses: readonly Expense[],
  template: Pick<CompanyTemplate, 'mapping' | 'values'>,
  labels: FillLabels,
  customFields: readonly CustomField[] = [],
): FillPlan {
  const base = toCurrencyCode(trip.baseCurrency);
  const own = expenses
    .filter((e) => e.tripId === trip.id)
    .sort((a, b) => a.localDate.localeCompare(b.localDate) || a.createdAt.localeCompare(b.createdAt));
  const total = sumMinor(own.map((e) => toMinor(e.totalBase, base)));
  const { fields, table } = template.mapping;
  const fieldValue: Record<TemplateField, CellValue | undefined> = {
    traveler: template.values.traveler,
    department: template.values.department,
    title: trip.title,
    period: `${trip.startDate} ~ ${trip.endDate}`,
    startDate: trip.startDate,
    endDate: trip.endDate,
    total: Number(fromMinor(total, base)),
    currency: base,
    today: labels.today,
  };
  const cells: Record<string, CellValue> = {};
  for (const key of TEMPLATE_FIELDS) {
    const ref = fields[key];
    const v = fieldValue[key];
    if (ref && v !== undefined && v !== '') cells[ref.toUpperCase()] = v;
  }
  const rows = table
    ? own.map((e, i) => {
        const values: Record<TemplateColumn, CellValue> = {
          no: i + 1,
          date: e.localDate,
          merchant: e.merchantName,
          category: labels.category(e.category),
          payment: labels.payment(e.paymentMethod),
          currency: e.currency,
          amount: Number(e.total),
          fxRate: Number(e.fxRate),
          amountBase: Number(e.totalBase),
          memo: e.memo,
        };
        const row: Record<string, CellValue> = {};
        for (const [key, col] of Object.entries(table.columns) as Array<[TemplateColumn, string]>) row[col.toUpperCase()] = values[key];
        for (const f of customFields) {
          const col = table.custom?.[f.id];
          if (!col) continue;
          const c = customCell(f, e.custom?.[f.id]);
          row[col.toUpperCase()] = c.number ?? c.text;
        }
        return row;
      })
    : [];
  return { cells, table: table && rows.length ? { firstRow: table.firstRow, rows } : null };
}

/** Readable total for the confirm screen. */
export const formatTotal = (trip: Trip, expenses: readonly Expense[]) => {
  const base = toCurrencyCode(trip.baseCurrency);
  return formatMoney(sumMinor(expenses.filter((e) => e.tripId === trip.id).map((e) => toMinor(e.totalBase, base))), base);
};
