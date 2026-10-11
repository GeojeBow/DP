import { budgetStatus, type BudgetRule } from '../budget';
import type { Expense } from '../models';
import { toCurrencyCode } from '../money';

const USD = toCurrencyCode('USD');
const trip = { startDate: '2026-10-01', endDate: '2026-10-20' };
const spend = (localDate: string, totalBase: string): Expense => ({
  id: `${localDate}-${totalBase}`, tripId: 't', localDate, merchantName: '', category: 'meals',
  paymentMethod: 'cash', currency: 'USD', total: totalBase, fxRate: '1', baseCurrency: 'USD', totalBase,
  receiptId: null, memo: '', createdAt: '', updatedAt: '',
});
const status = (rule: BudgetRule, today: string, expenses: Expense[] = []) =>
  budgetStatus(rule, trip, expenses, USD, today);

describe('budgetStatus', () => {
  it('total: whole-trip remaining', () => {
    const s = status({ kind: 'total', amount: '1000' }, '2026-10-05', [spend('2026-10-02', '300')]);
    expect(s.available).toBe(70000n);
    expect(s.tripLimit).toBe(100000n);
  });

  it('daily: only today counts and nothing carries over', () => {
    const s = status({ kind: 'daily', amount: '70' }, '2026-10-05', [spend('2026-10-04', '10'), spend('2026-10-05', '50')]);
    expect(s.available).toBe(2000n);
    expect(s.tripLimit).toBe(20n * 7000n);
  });

  it('daily_pooled: accrues within the window', () => {
    // Day 7 of the first 7-day window, nothing spent: 7 x 70 = 490 available.
    const s = status({ kind: 'daily_pooled', amount: '70', poolDays: 7 }, '2026-10-07');
    expect(s.available).toBe(49000n);
    expect(s.periodStart).toBe('2026-10-01');
    expect(s.periodEnd).toBe('2026-10-07');
    expect(s.resetsInDays).toBe(0);
  });

  it('daily_pooled: resets when a new window starts', () => {
    const s = status({ kind: 'daily_pooled', amount: '70', poolDays: 7 }, '2026-10-09', [
      spend('2026-10-03', '100'),
      spend('2026-10-08', '30'),
    ]);
    // Window 2 runs 10-08..10-14; two days accrued (140), 30 spent there.
    expect(s.periodStart).toBe('2026-10-08');
    expect(s.available).toBe(11000n);
    expect(s.resetsInDays).toBe(5);
  });

  it('daily_pooled: the last window is cut at the trip end', () => {
    const s = status({ kind: 'daily_pooled', amount: '70', poolDays: 7 }, '2026-10-20');
    expect(s.periodStart).toBe('2026-10-15');
    expect(s.periodEnd).toBe('2026-10-20');
    expect(s.available).toBe(6n * 7000n);
  });
});
