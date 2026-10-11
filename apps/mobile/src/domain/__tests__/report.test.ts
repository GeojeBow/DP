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
  column: (c) => c, category: (c) => c, payment: (p) => p, tagColumn: 'no', receiptNo: (tag) => `att ${tag}`, none: '-', noReceipt: 'noR', mileage: 'car',
  missingReceipt: 'lost', proof: (p) => p,
  claim: {
    spent: 'spent', companyPaid: 'company', personal: 'personal', perDiem: (d, p) => `perDiem ${d}x${p}`,
    claim: 'claim', vatDeductible: 'vatD', vatForeign: 'vatF',
  },
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
    expect(r.headers.slice(0, 2)).toEqual(['no', 'date']);
  });

  it('summarises by category and by day for the charts', () => {
    const r = buildReport(trip, [...expenses, { ...expenses[2]!, id: 'd', category: 'lodging', totalBase: '100000' }], BUILTIN_PRESETS[1]!, labels);
    expect(r.summary.byCategory.map((c) => [c.label, c.number, c.share])).toEqual([['lodging', 100000, 70], ['meals', 42864, 30]]);
    expect(r.summary.byDay.map((d) => [d.date, d.number])).toEqual([['2026-10-01', 29184], ['2026-10-02', 113680]]);
  });

  it('adds custom fields as columns after the preset ones', () => {
    const fields = [{ id: 'p', name: 'Project', type: 'text' as const, options: [], required: false },
      { id: 'n', name: 'People', type: 'number' as const, options: [], required: false }];
    const withCustom = expenses.map((e) => (e.id === 'a' ? { ...e, custom: { p: 'ALPHA', n: '3' } } : e));
    const r = buildReport(trip, withCustom, BUILTIN_PRESETS[1]!, labels, fields);
    expect(r.headers.slice(-2)).toEqual(['Project', 'People']);
    expect(r.sections[0]!.rows[0]!.slice(-2)).toEqual([{ text: 'ALPHA' }, { text: '3', number: 3 }]);
    expect(r.sections[1]!.rows[0]!.slice(-2)).toEqual([{ text: '' }, { text: '' }]);
  });

  it('tags every line and gives each one a page at the back in the same order', () => {
    const preset = { ...BUILTIN_PRESETS[0]!, columns: ['merchant', 'receipt'] as const, groupBy: 'none' as const };
    const r = buildReport(trip, expenses, { ...preset, columns: [...preset.columns] }, labels);
    expect(r.sections).toHaveLength(1);
    expect(r.sections[0]!.rows.map((row) => row.map((c) => c.text))).toEqual([
      ['#01', 'M-a', 'att #01'], ['#02', 'M-b', 'att #02'], ['#03', 'M-c', 'noR'],
    ]);
    expect(r.attachments.map((a) => [a.tags, a.receiptId, a.missing])).toEqual([
      [['#01'], 'r1', null], [['#02'], 'r2', null], [['#03'], null, 'none'],
    ]);
    expect(r.attachments[2]!.details).toEqual([
      { label: 'date', value: '2026-10-02' }, { label: 'merchant', value: 'M-c' }, { label: 'category', value: 'meals' },
      { label: 'amount', value: 'JPY 500' }, { label: 'amountBase', value: 'KRW 4,560' }, { label: 'payment', value: 'cash' },
    ]);
    expect(r.attachments[0]!.details).toEqual([]);
  });

  it('numbers lines in the order the table shows them and shares a page between lines of one receipt', () => {
    const list = [
      expense('a', '2026-10-01', '3200', '29184', 'r1'),
      { ...expense('b', '2026-10-02', '1000', '9120', 'r1'), category: 'lodging' as const },
      { ...expense('m', '2026-10-02', '0', '15000', null), category: 'fuel' as const, mileage: { km: '50', rate: '300', route: 'Seoul-Daejeon' } },
    ];
    const r = buildReport(trip, list, { ...BUILTIN_PRESETS[0]!, groupBy: 'category' }, labels);
    expect(r.headers.at(-1)).toBe('receipt');
    expect(r.sections.map((s) => [s.title, s.rows.map((row) => row[0]!.text)])).toEqual([
      ['meals', ['#01']], ['lodging', ['#02']], ['fuel', ['#03']],
    ]);
    expect(r.attachments.map((a) => [a.tags, a.missing, a.note])).toEqual([
      [['#01', '#02'], null, ''], [['#03'], 'mileage', 'Seoul-Daejeon · 50 km'],
    ]);
  });

  it('keeps numbers for spreadsheet cells', () => {
    const r = buildReport(trip, expenses, BUILTIN_PRESETS[1]!, labels);
    const amountBase = r.sections[0]!.rows[0]![7]!;
    expect(amountBase).toEqual({ text: 'KRW 29,184', number: 29184 });
  });
});
