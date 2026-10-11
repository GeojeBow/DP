import type { Expense } from '../../../domain/models';
import { buildExtraExpenses, type ExtrasContext } from '../extras';

const ctx = (o: Partial<ExtrasContext> = {}): ExtrasContext => ({
  tripId: 't1',
  fallbackDate: '2026-10-05',
  fallbackCurrency: 'JPY',
  baseCurrency: 'KRW',
  rateFor: (c) => (c === 'JPY' ? '9.1' : undefined),
  payment: 'corporate_card',
  receiptId: 'r1',
  existing: [],
  now: '2026-10-05T00:00:00Z',
  ...o,
});

describe('buildExtraExpenses', () => {
  it('converts each statement line with the known rate', () => {
    const r = buildExtraExpenses([{ merchantName: 'Lawson', total: '540', localDate: '2026-10-06', category: 'meals' }], ctx());
    expect(r.expenses).toHaveLength(1);
    expect(r.expenses[0]).toMatchObject({
      merchantName: 'Lawson', currency: 'JPY', total: '540', fxRate: '9.1', totalBase: '4914', receiptId: 'r1', paymentMethod: 'corporate_card',
    });
  });

  it('skips lines with no amount, an unknown rate, or an existing match', () => {
    const existing = [{ id: 'x', currency: 'JPY', total: '1980', localDate: '2026-10-05', merchantName: 'Ichiran' } as Expense];
    const r = buildExtraExpenses(
      [{ merchantName: 'A' }, { total: '10', currency: 'USD' }, { total: '1980', merchantName: 'ICHIRAN' }, { total: '300', currency: 'KRW' }],
      ctx({ existing }),
    );
    expect(r).toMatchObject({ noAmount: 1, noRate: 1, duplicates: 1 });
    expect(r.expenses.map((e) => e.totalBase)).toEqual(['300']);
  });
});
