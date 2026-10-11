import type { Expense, Trip } from '../models';
import { BUILTIN_PRESETS, buildReport, type ReportLabels } from '../report';

const trip: Trip = {
  id: 't', title: 'Tokyo', startDate: '2026-10-01', endDate: '2026-10-03', baseCurrency: 'KRW',
  budget: { kind: 'none' }, createdAt: '',
};
const expense = (id: string, localDate: string, total: string, totalBase: string, receiptId: string | null): Expense => ({
  id, tripId: 't', localDate, merchantName: `M-${id}`, category: 'meals', paymentMethod: 'cash', currency: 'JPY',
  total, fxRate: '9.12', baseCurrency: 'KRW', totalBase, receiptId, memo: '', createdAt: id, updatedAt: id,
});
const labels: ReportLabels = {
  column: (c) => c, category: (c) => c, payment: (p) => p, receiptNo: (n) => `#${n}`, none: '-',
};

describe('buildReport', () => {
  const expenses = [
    expense('b', '2026-10-02', '1000', '9120', 'r2'),
    expense('a', '2026-10-01', '3200', '29184', 'r1'),
    expense('c', '2026-10-02', '500', '4560', null),
  ];

  it('groups by date in order with subtotals and a grand total', () => {
    const r = buildReport(trip, expenses, BUILTIN_PRESETS[1]!, labels);
    expect(r.sections.map((s) => s.title)).toEqual(['2026-10-01', '2026-10-02']);
    expect(r.sections[1]!.subtotal).toBe('KRW 13,680');
    expect(r.total).toBe('KRW 42,864');
    expect(r.totalNumber).toBe(42864);
    expect(r.headers[0]).toBe('date');
  });

  it('numbers receipts in table order for the appendix', () => {
    const preset = { ...BUILTIN_PRESETS[0]!, columns: ['merchant', 'receipt'] as const, groupBy: 'none' as const };
    const r = buildReport(trip, expenses, { ...preset, columns: [...preset.columns] }, labels);
    expect(r.sections).toHaveLength(1);
    expect(r.sections[0]!.rows.map((row) => row[1]!.text)).toEqual(['#1', '#2', '-']);
    expect(r.receipts).toEqual([{ no: 1, receiptId: 'r1' }, { no: 2, receiptId: 'r2' }]);
  });

  it('keeps numbers for spreadsheet cells', () => {
    const r = buildReport(trip, expenses, BUILTIN_PRESETS[1]!, labels);
    const amountBase = r.sections[0]!.rows[0]![6]!;
    expect(amountBase).toEqual({ text: 'KRW 29,184', number: 29184 });
  });
});
