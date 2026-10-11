import type { Expense, Trip } from '../../../domain/models';
import { buildSubmission } from '../snapshot';

const trip = { id: 't', title: 'Tokyo', startDate: '2026-10-01', endDate: '2026-10-03', baseCurrency: 'KRW', budget: { kind: 'none' }, createdAt: '' } as Trip;
const e = (id: string, tripId: string, date: string, totalBase: string) =>
  ({ id, tripId, localDate: date, totalBase, createdAt: id, receiptId: null }) as Expense;

it('freezes the trip with its own expenses, total and rule notes', () => {
  const sub = buildSubmission('org', trip, [e('b', 't', '2026-10-02', '1000'), e('a', 't', '2026-10-01', '2500.5'), e('x', 'other', '2026-10-01', '9')], [], {
    a: ['Meals up to KRW 2,000'],
    x: ['ignored'],
  });
  expect(sub).toMatchObject({ org_id: 'org', trip_id: 't', period: '2026-10-01 ~ 2026-10-03', total: '3501', item_count: 2, flagged_count: 1 });
  expect(sub.snapshot.expenses.map((x) => x.id)).toEqual(['a', 'b']);
  expect(sub.snapshot.notes).toEqual({ a: ['Meals up to KRW 2,000'] });
});
