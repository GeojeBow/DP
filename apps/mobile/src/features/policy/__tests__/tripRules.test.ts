import type { Expense, Trip } from '../../../domain/models';
import { applyCompanyPolicy, checkExpenses, checkWithTrips, type CompanyPolicy, rulesForTrip, type CompanyRule } from '../rules';

const rule = (id: string, amount: string): CompanyRule => ({ id, type: 'per_item_cap', category: null, amount, currency: 'KRW' });
const trip = (id: string, over: Partial<Trip> = {}): Trip => ({
  id, title: id, startDate: '2026-10-01', endDate: '2026-10-02', baseCurrency: 'KRW', budget: { kind: 'none' }, createdAt: '', ...over,
});
const expense = (id: string, tripId: string, totalBase: string): Expense => ({
  id, tripId, localDate: '2026-10-01', merchantName: 'm', category: 'meals', paymentMethod: 'cash', currency: 'KRW',
  total: totalBase, fxRate: '1', baseCurrency: 'KRW', totalBase, receiptId: 'r', memo: '', createdAt: id, updatedAt: id,
});

describe('per-trip rules', () => {
  const defaults = [rule('d', '50000')];
  const trips = [trip('a'), trip('b', { ruleMode: 'trip', rules: [rule('own', '100000')] })];

  it('uses the defaults unless the trip has chosen its own', () => {
    expect(rulesForTrip(trips[0], defaults)).toBe(defaults);
    expect(rulesForTrip(trips[1], defaults).map((r) => r.id)).toEqual(['own']);
  });

  it('checks each trip against its own set', () => {
    const flags = checkWithTrips([expense('x', 'a', '70000'), expense('y', 'b', '70000')], trips, defaults);
    expect(flags.get('x')?.map((f) => f.ruleId)).toEqual(['d']);
    expect(flags.get('y') ?? []).toEqual([]);
  });
});

describe('company policy', () => {
  const policy: CompanyPolicy = { id: 'company', currency: 'KRW', budget: { kind: 'daily', amount: '100000' }, perDiem: { amount: '30000' } };

  it('copies the budget and allowance into trips that follow it', () => {
    const t = applyCompanyPolicy(trip('a', { ruleMode: 'company' }), policy);
    expect(t.budget).toEqual(policy.budget);
    expect(t.perDiem).toEqual(policy.perDiem);
    expect(applyCompanyPolicy(t, policy)).toBe(t);
  });

  it('leaves trips with their own policy alone', () => {
    const own = trip('b', { ruleMode: 'trip', budget: { kind: 'total', amount: '5' } });
    expect(applyCompanyPolicy(own, policy)).toBe(own);
  });

  it('applies no amounts to a trip in another currency', () => {
    const t = applyCompanyPolicy(trip('c', { ruleMode: 'company', baseCurrency: 'USD' }), policy);
    expect(t.budget).toEqual({ kind: 'none' });
    expect(t.perDiem).toBeUndefined();
  });

  it('flags banned merchant words and keeps the chosen action', () => {
    const banned: CompanyRule = { id: 'k', type: 'prohibited_keyword', category: null, amount: '', currency: 'KRW', keywords: ['노래방'], action: 'block' };
    const e = { ...expense('z', 'a', '1000'), merchantName: '행복 노래방' };
    const flags = checkWithTrips([e, expense('ok', 'a', '1000')], [trip('a')], [banned]);
    expect(flags.get('z')?.map((f) => f.action)).toEqual(['block']);
    expect(flags.get('ok')).toBeUndefined();
  });
});

describe('pooled and app-checked rules', () => {
  const on = (id: string, localDate: string, totalBase: string, over: Partial<Expense> = {}): Expense =>
    ({ ...expense(id, 'a', totalBase), localDate, ...over });
  const daily = (poolDays?: number): CompanyRule =>
    ({ id: 'd', type: 'daily_cap', category: 'meals', amount: '50000', currency: 'KRW', poolDays });
  const flagged = (m: Map<string, unknown[]>) => [...m.keys()].sort();

  it('lets unspent daily allowance carry across the trip', () => {
    const list = [on('x', '2026-10-01', '10000'), on('y', '2026-10-02', '80000')];
    expect(flagged(checkExpenses(list, [daily(0)], '2026-10-01'))).toEqual([]);
    expect(flagged(checkExpenses([...list, on('z', '2026-10-02', '20000')], [daily(0)], '2026-10-01'))).toEqual(['z']);
    expect(flagged(checkExpenses(list, [daily()], '2026-10-01'))).toEqual(['y']);
  });

  it('starts over at each block', () => {
    const list = [on('x', '2026-10-01', '0'), on('y', '2026-10-02', '100000'), on('z', '2026-10-03', '80000')];
    expect(flagged(checkExpenses(list, [daily(2)], '2026-10-01'))).toEqual(['z']);
  });

  it('flags spending past the trip total', () => {
    const cap: CompanyRule = { id: 't', type: 'trip_cap', category: null, amount: '100000', currency: 'KRW' };
    const list = [on('x', '2026-10-01', '60000'), on('y', '2026-10-02', '50000'), on('z', '2026-10-03', '1000')];
    expect(flagged(checkExpenses(list, [cap]))).toEqual(['y', 'z']);
  });

  it('flags the wrong way to pay', () => {
    const pay: CompanyRule = { id: 'p', type: 'payment_required', category: null, amount: '', currency: 'KRW', payment: 'corporate_card' };
    const list = [on('x', '2026-10-01', '1000', { paymentMethod: 'corporate_card' }), on('y', '2026-10-01', '1000')];
    expect(flagged(checkExpenses(list, [pay]))).toEqual(['y']);
  });
});
