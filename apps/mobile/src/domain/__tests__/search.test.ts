import type { Expense, Trip } from '../models';
import { searchExpenses } from '../search';

const trips = [{ id: 't1', title: 'Tokyo Q4' }, { id: 't2', title: 'Busan' }] as Trip[];
const e = (id: string, over: Partial<Expense>) => ({
  id, tripId: 't1', localDate: '2026-10-03', merchantName: '', category: 'meals', currency: 'KRW', total: '12000',
  totalBase: '12000', memo: '', createdAt: id, ...over,
}) as Expense;
const list = [
  e('a', { merchantName: 'Ichiran Shibuya', currency: 'JPY', total: '1290', totalBase: '11800' }),
  e('b', { merchantName: '부산 돼지국밥', tripId: 't2', localDate: '2026-09-21', memo: '거래처 미팅' }),
  e('c', { merchantName: 'Taxi', category: 'ground_transport', localDate: '2026-10-04' }),
];
const label = (c: Expense['category']) => (c === 'meals' ? '식비' : '교통');

describe('searchExpenses', () => {
  it('matches shop, memo, trip and category', () => {
    expect(searchExpenses(list, trips, 'ichiran', label).map((x) => x.id)).toEqual(['a']);
    expect(searchExpenses(list, trips, '미팅', label).map((x) => x.id)).toEqual(['b']);
    expect(searchExpenses(list, trips, 'busan 식비', label).map((x) => x.id)).toEqual(['b']);
    expect(searchExpenses(list, trips, '교통', label).map((x) => x.id)).toEqual(['c']);
  });

  it('matches dates and amounts with or without commas, newest first', () => {
    expect(searchExpenses(list, trips, '2026-10', label).map((x) => x.id)).toEqual(['c', 'a']);
    expect(searchExpenses(list, trips, '12,000', label).map((x) => x.id)).toEqual(['c', 'b']);
  });

  it('returns nothing for an empty query', () => {
    expect(searchExpenses(list, trips, '  ', label)).toEqual([]);
  });
});
