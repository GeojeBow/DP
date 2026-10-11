import type { Expense, Trip } from '../../../domain/models';
import { allKeys, applyRemote, changedKeys, type Collections } from '../records';

const trip = { id: 't1', title: 'Tokyo' } as Trip;
const expense = (id: string, receiptId: string | null = null) => ({ id, receiptId, tripId: 't1' }) as Expense;
const state = (over: Partial<Collections> = {}): Collections => ({
  trips: [trip], expenses: [expense('e1', 'r1')], companyRules: [], customFields: [], reportPresets: [], companyTemplates: [], ...over,
});

describe('sync records', () => {
  it('lists every record and file for a first push', () => {
    expect(allKeys(state())).toEqual(['trip:t1', 'expense:e1', 'receipt:r1']);
  });

  it('finds added, edited and removed records, and their photos', () => {
    const a = state();
    const b = state({ trips: a.trips, expenses: [{ ...a.expenses[0]!, receiptId: 'r2' }, expense('e2')] });
    expect(changedKeys(a, b).sort()).toEqual(['expense:e1', 'expense:e2', 'receipt:r1', 'receipt:r2']);
    expect(changedKeys(a, { ...a, expenses: [] }).sort()).toEqual(['expense:e1', 'receipt:r1']);
  });

  it('applies pulled rows but keeps unsent local edits', () => {
    const a = state();
    const out = applyRemote(
      a,
      [
        { kind: 'trip', id: 't1', data: { ...trip, title: 'Osaka' }, deleted: false },
        { kind: 'expense', id: 'e1', data: null, deleted: true },
        { kind: 'expense', id: 'e9', data: expense('e9'), deleted: false },
      ],
      new Set(['trip:t1']),
    );
    expect(out.trips).toBeUndefined();
    expect(out.expenses?.map((e) => e.id)).toEqual(['e9']);
  });
});
