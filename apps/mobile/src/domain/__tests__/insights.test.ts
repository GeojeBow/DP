import { currencyBreakdown, submissionChecks } from '../insights';
import type { Expense } from '../models';

const e = (over: Partial<Expense>): Expense => ({
  id: 'x', tripId: 't', localDate: '2026-10-01', merchantName: 'M', category: 'meals', paymentMethod: 'cash',
  currency: 'JPY', total: '1000', fxRate: '9', baseCurrency: 'KRW', totalBase: '9000', receiptId: 'r', memo: '',
  createdAt: '', updatedAt: '', ...over,
});

describe('insights', () => {
  it('sums each foreign currency with its average and range of rates', () => {
    const out = currencyBreakdown(
      [e({}), e({ id: 'y', total: '3000', fxRate: '10', totalBase: '30000' }), e({ id: 'z', currency: 'KRW', total: '5000', fxRate: '1', totalBase: '5000' })],
      'KRW',
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ currency: 'JPY', count: 2, local: 4000n, base: 39000n, avgRate: 9.75, minRate: 9, maxRate: 10 });
  });

  it('handles currencies with cents', () => {
    const [usd] = currencyBreakdown([e({ currency: 'USD', total: '10.50', fxRate: '1400', totalBase: '14700' })], 'KRW');
    expect(usd?.avgRate).toBe(1400);
  });

  it('counts what to fix before submitting', () => {
    const list = [e({ id: 'a', receiptId: null }), e({ id: 'b', merchantName: ' ' }), e({ id: 'c' })];
    expect(submissionChecks(list, new Set(['c']))).toEqual({ ruleBroken: 1, noReceipt: 1, noMerchant: 1 });
  });
});
