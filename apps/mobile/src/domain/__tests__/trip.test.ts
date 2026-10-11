import { uuidv7 } from '../id';
import type { Expense, Trip } from '../models';
import { dailySpend, groupByDate, isValidIsoDate, summarizeTrip } from '../trip';

const trip: Trip = {
  id: 't1',
  title: 'Tokyo',
  startDate: '2026-10-05',
  endDate: '2026-10-09',
  baseCurrency: 'KRW',
  budget: { kind: 'total', amount: '1000000' },
  createdAt: '2026-10-01T00:00:00Z',
};

const expense = (id: string, overrides: Partial<Expense> = {}): Expense => ({
  id,
  tripId: 't1',
  localDate: '2026-10-05',
  merchantName: 'Shop',
  category: 'meals',
  paymentMethod: 'corporate_card',
  currency: 'JPY',
  total: '1000',
  fxRate: '9.1',
  baseCurrency: 'KRW',
  totalBase: '9100',
  receiptId: null,
  memo: '',
  createdAt: `2026-10-05T0${id.length}:00:00Z`,
  updatedAt: '2026-10-05T00:00:00Z',
  ...overrides,
});

describe('summarizeTrip', () => {
  const expenses = [
    expense('a', { totalBase: '300000', category: 'lodging' }),
    expense('bb', { totalBase: '100000' }),
    expense('ccc', { totalBase: '999999', tripId: 'other' }),
  ];

  it('totals spend, burn and per-day allowance mid-trip', () => {
    const s = summarizeTrip(trip, expenses, '2026-10-07');
    expect(s.spent).toBe(400000n);
    expect(s.burnRatio).toBeCloseTo(0.4);
    expect(s.totalDays).toBe(5);
    expect(s.dayOfTrip).toBe(3);
    expect(s.daysRemaining).toBe(3);
    expect(s.remainingPerDay).toBe(200000n);
    expect(s.byCategory.map((c) => c.category)).toEqual(['lodging', 'meals']);
  });

  it('handles before-start, after-end and no budget', () => {
    expect(summarizeTrip(trip, [], '2026-10-01').daysRemaining).toBe(5);
    const after = summarizeTrip(trip, [], '2026-10-20');
    expect(after.daysRemaining).toBe(0);
    expect(after.remainingPerDay).toBeNull();
    expect(after.dayOfTrip).toBe(5);
    expect(summarizeTrip({ ...trip, budget: { kind: 'none' } }, [], '2026-10-06').burnRatio).toBeNull();
  });
});

describe('groupByDate', () => {
  it('orders days and items newest first', () => {
    const groups = groupByDate([
      expense('a', { localDate: '2026-10-05' }),
      expense('bb', { localDate: '2026-10-06' }),
      expense('ccc', { localDate: '2026-10-05' }),
    ]);
    expect(groups.map((g) => g.date)).toEqual(['2026-10-06', '2026-10-05']);
    expect(groups[1]?.items.map((e) => e.id)).toEqual(['ccc', 'a']);
  });
});

describe('isValidIsoDate', () => {
  it('rejects impossible dates', () => {
    expect(isValidIsoDate('2026-02-30')).toBe(false);
    expect(isValidIsoDate('2026-2-3')).toBe(false);
    expect(isValidIsoDate('2026-02-28')).toBe(true);
  });
});

describe('uuidv7', () => {
  it('encodes the timestamp, version and variant', () => {
    const id = uuidv7(0x0190_1234_5678, (b) => b.fill(0xff));
    expect(id).toBe('01901234-5678-7fff-bfff-ffffffffffff');
    expect(uuidv7(1, (b) => b.fill(0)) < uuidv7(2, (b) => b.fill(0))).toBe(true);
  });
});

describe('dailySpend', () => {
  const expenses = [
    expense('a', { localDate: '2026-10-05', totalBase: '1000' }),
    expense('b', { localDate: '2026-10-07', totalBase: '2000' }),
    expense('c', { localDate: '2026-10-07', totalBase: '500' }),
    expense('d', { localDate: '2026-10-07', totalBase: '9999', tripId: 'other' }),
  ];

  it('lists each trip day with zero-spend days filled in', () => {
    expect(dailySpend(trip, expenses, '2026-10-07')).toEqual([
      { date: '2026-10-05', amount: 1000n },
      { date: '2026-10-06', amount: 0n },
      { date: '2026-10-07', amount: 2500n },
      { date: '2026-10-08', amount: 0n },
      { date: '2026-10-09', amount: 0n },
    ]);
  });

  it('keeps the last N days and stops at the trip end', () => {
    const series = dailySpend(trip, expenses, '2026-12-01', 3);
    expect(series.map((d) => d.date)).toEqual(['2026-10-07', '2026-10-08', '2026-10-09']);
  });

  it('ends the window at today once the trip outgrows it', () => {
    expect(dailySpend(trip, expenses, '2026-10-08', 2).map((d) => d.date)).toEqual(['2026-10-07', '2026-10-08']);
  });
});
