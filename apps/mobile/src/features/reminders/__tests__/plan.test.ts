import type { Expense, Trip } from '../../../domain/models';
import { planReminders } from '../plan';

const trip: Trip = {
  id: 't', title: 'Osaka', startDate: '2026-10-10', endDate: '2026-10-12', baseCurrency: 'KRW', budget: { kind: 'none' }, createdAt: '',
};
const spent = (localDate: string) => ({ tripId: 't', localDate }) as Expense;

describe('planReminders', () => {
  const now = new Date(2026, 9, 10, 22, 0); // 10 Oct, 22:00 local: today's 21:00 has passed

  it('nudges each remaining evening without expenses, then asks for the report', () => {
    const plan = planReminders([trip], [spent('2026-10-11')], now);
    expect(plan.map((r) => [r.kind, r.at.getDate(), r.at.getHours()])).toEqual([
      ['daily', 12, 21],
      ['report', 13, 10],
    ]);
  });

  it('skips the report nudge for empty or paid trips', () => {
    expect(planReminders([trip], [], now).some((r) => r.kind === 'report')).toBe(false);
    expect(planReminders([{ ...trip, reimbursedAt: '2026-10-13' }], [spent('2026-10-10')], now).some((r) => r.kind === 'report')).toBe(false);
  });

  it('plans nothing for finished trips', () => {
    expect(planReminders([trip], [spent('2026-10-10')], new Date(2026, 9, 20))).toEqual([]);
  });
});
