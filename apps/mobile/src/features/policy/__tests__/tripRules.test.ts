import type { Expense, Trip } from '../../../domain/models';
import { checkWithTrips, rulesForTrip, type CompanyRule } from '../rules';

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
