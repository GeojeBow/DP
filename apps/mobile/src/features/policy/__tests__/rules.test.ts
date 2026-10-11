import type { Expense } from '../../../domain/models';
import { checkExpenses, type CompanyRule } from '../rules';

const expense = (over: Partial<Expense>): Expense => ({
  id: 'e1',
  tripId: 't1',
  localDate: '2026-10-05',
  merchantName: 'Cafe',
  category: 'meals',
  paymentMethod: 'corporate_card',
  currency: 'KRW',
  total: '10000',
  fxRate: '1',
  baseCurrency: 'KRW',
  totalBase: '10000',
  receiptId: 'r1',
  memo: '',
  createdAt: '2026-10-05T01:00:00Z',
  updatedAt: '2026-10-05T01:00:00Z',
  ...over,
});

const rule = (over: Partial<CompanyRule>): CompanyRule => ({
  id: 'r', type: 'per_item_cap', category: null, amount: '50000', currency: 'KRW', ...over,
});

describe('checkExpenses', () => {
  it('flags an item over the per-item limit for its category only', () => {
    const flags = checkExpenses(
      [expense({ id: 'a', totalBase: '60000' }), expense({ id: 'b', totalBase: '60000', category: 'lodging' })],
      [rule({ category: 'meals' })],
    );
    expect([...flags.keys()]).toEqual(['a']);
  });

  it('flags the expense that pushes a day over its limit', () => {
    const flags = checkExpenses(
      [
        expense({ id: 'a', totalBase: '30000', createdAt: '2026-10-05T01:00:00Z' }),
        expense({ id: 'b', totalBase: '30000', createdAt: '2026-10-05T02:00:00Z' }),
        expense({ id: 'c', totalBase: '30000', localDate: '2026-10-06' }),
      ],
      [rule({ type: 'daily_cap' })],
    );
    expect([...flags.keys()]).toEqual(['b']);
  });

  it('flags a missing receipt above the amount', () => {
    const flags = checkExpenses(
      [expense({ id: 'a', receiptId: null, totalBase: '40000' }), expense({ id: 'b', receiptId: null, totalBase: '20000' })],
      [rule({ type: 'receipt_required_over', amount: '30000' })],
    );
    expect([...flags.keys()]).toEqual(['a']);
  });

  it('skips amount rules set in another currency but keeps the rest', () => {
    const flags = checkExpenses(
      [expense({ id: 'a', baseCurrency: 'USD', currency: 'USD', total: '900', totalBase: '900', category: 'entertainment' })],
      [rule({ amount: '100' }), rule({ id: 'p', type: 'prohibited_category', category: 'entertainment', amount: '' })],
    );
    expect(flags.get('a')?.map((f) => f.ruleId)).toEqual(['p']);
  });
});
