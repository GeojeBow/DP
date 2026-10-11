import type { Expense, Trip } from '../../../domain/models';
import { applyCompanyPolicy, checkWithTrips, type CompanyPolicy, rulesForTrip, type CompanyRule } from '../rules';

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
