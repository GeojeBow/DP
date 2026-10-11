/* A fake sync_records mockTable stands in for Supabase, so two "devices" can sync through it. */
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

type Row = { user_id: string; kind: string; id: string; data: unknown; deleted: boolean; updated_at: string };
const mockTable: Row[] = [];
let mockClock = 0;
const mockSession = { user: { id: 'u1', is_anonymous: false } };

jest.mock('../../../lib/supabase', () => ({
  supabase: () => ({
    auth: { getSession: async () => ({ data: { session: mockSession } }) },
    from: () => ({
      upsert: async (rows: Row[]) => {
        for (const r of rows) {
          const i = mockTable.findIndex((x) => x.kind === r.kind && x.id === r.id);
          const row = { ...r, updated_at: new Date(Date.UTC(2026, 0, 1, 0, 0, ++mockClock)).toISOString() };
          if (i >= 0) mockTable[i] = row;
          else mockTable.push(row);
        }
        return { error: null };
      },
      select: () => {
        let since = '';
        const q = {
          gt: (_: string, v: string) => ((since = v), q),
          order: () => q,
          range: async (from: number, to: number) => ({
            data: mockTable.filter((r) => r.updated_at > since).sort((a, b) => a.updated_at.localeCompare(b.updated_at)).slice(from, to + 1),
            error: null,
          }),
        };
        return q;
      },
    }),
  }),
}));

import type { Expense, Trip } from '../../../domain/models';
import { loadReceiptImage, saveReceiptImage } from '../../../store/receiptImages';
import { useAppStore } from '../../../store/useAppStore';
import { startSync, syncNow, withoutTracking } from '../engine';

const trip = { id: 't1', title: 'Tokyo', startDate: '2026-10-01', endDate: '2026-10-03', baseCurrency: 'KRW', budget: { kind: 'none' }, createdAt: '' } as Trip;
const expense = { id: 'e1', tripId: 't1', receiptId: 'r1', merchantName: 'Cafe' } as Expense;

describe('sync engine', () => {
  let stop: () => void;
  beforeAll(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    stop = startSync();
  });
  afterAll(() => {
    stop();
    jest.useRealTimers();
  });

  it('pushes local changes, then another device pulls them', async () => {
    await saveReceiptImage('r1', 'data:image/jpeg;base64,AAAA');
    useAppStore.getState().addTrip(trip);
    useAppStore.getState().upsertExpense(expense);
    expect(useAppStore.getState().outbox).toEqual(['trip:t1', 'expense:e1', 'receipt:r1']);
    expect(await syncNow()).toBe('ok');
    expect(useAppStore.getState().outbox).toEqual([]);
    expect(mockTable.map((r) => `${r.kind}:${r.id}`)).toEqual(['trip:t1', 'expense:e1', 'receipt:r1']);

    // "Second device": wipe local data without telling the server, then pull everything.
    withoutTracking(() => useAppStore.getState().clearAccountData());
    await require('@react-native-async-storage/async-storage').clear();
    expect(await syncNow()).toBe('ok');
    const s = useAppStore.getState();
    expect(s.trips.map((x) => x.title)).toEqual(['Tokyo']);
    expect(s.expenses.map((x) => x.id)).toEqual(['e1']);
    expect(s.activeTripId).toBe('t1');
    expect(s.outbox).toEqual([]);
    expect(await loadReceiptImage('r1')).toBe('data:image/jpeg;base64,AAAA');
  });

  it('sends deletions and keeps unsent local edits over older server copies', async () => {
    await useAppStore.getState().deleteExpense('e1');
    useAppStore.setState((s) => ({ trips: s.trips.map((x) => ({ ...x, title: 'Osaka' })) }));
    expect(await syncNow()).toBe('ok');
    expect(mockTable.find((r) => r.id === 'e1')?.deleted).toBe(true);
    expect(mockTable.find((r) => r.id === 'r1')?.deleted).toBe(true);
    expect((mockTable.find((r) => r.id === 't1')?.data as Trip).title).toBe('Osaka');
    expect(useAppStore.getState().trips[0]?.title).toBe('Osaka');
  });
});
