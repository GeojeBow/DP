import type { Expense, Trip } from '../../domain/models';
import { deleteReceiptImage } from '../receiptImages';
import { useAppStore } from '../useAppStore';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../receiptImages', () => ({ deleteReceiptImage: jest.fn(async () => {}) }));
jest.mock('../../features/template/storage', () => ({ deleteTemplateFile: jest.fn(async () => {}) }));

const trip = (id: string, startDate: string): Trip =>
  ({ id, title: id, startDate, endDate: startDate, baseCurrency: 'KRW', budget: { kind: 'none' }, ruleMode: 'trip', createdAt: '' });
const expense = (id: string, tripId: string, receiptId: string | null) => ({ id, tripId, receiptId }) as unknown as Expense;

describe('deleteTrip', () => {
  it('removes the trip, its expenses and photos, and moves to another trip', async () => {
    useAppStore.setState({
      trips: [trip('a', '2026-09-01'), trip('b', '2026-10-01'), trip('c', '2026-08-01')],
      expenses: [expense('x', 'b', 'r1'), expense('y', 'b', null), expense('z', 'a', 'r2')],
      activeTripId: 'b',
    });
    await useAppStore.getState().deleteTrip('b');
    const s = useAppStore.getState();
    expect(s.trips.map((t) => t.id)).toEqual(['a', 'c']);
    expect(s.expenses.map((e) => e.id)).toEqual(['z']);
    expect(s.activeTripId).toBe('a');
    expect(deleteReceiptImage).toHaveBeenCalledWith('r1');
    expect(deleteReceiptImage).not.toHaveBeenCalledWith('r2');
  });
});
