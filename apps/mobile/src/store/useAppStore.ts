import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { Expense, Trip } from '../domain/models';
import type { Language } from '../i18n';
import { deleteReceiptImage } from './receiptImages';

interface AppState {
  trips: Trip[];
  expenses: Expense[];
  activeTripId: string | null;
  /** Last rate used per "FROM>TO" pair, offered as the default next time */
  lastFxRates: Record<string, string>;
  language: Language;
  setLanguage: (language: Language) => void;
  addTrip: (trip: Trip) => void;
  setActiveTrip: (id: string | null) => void;
  upsertExpense: (expense: Expense) => void;
  deleteExpense: (id: string) => Promise<void>;
}

export const fxKey = (from: string, to: string) => `${from}>${to}`;

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      trips: [],
      expenses: [],
      activeTripId: null,
      lastFxRates: {},
      language: 'ko',
      setLanguage: (language) => set({ language }),
      addTrip: (trip) => set((s) => ({ trips: [...s.trips, trip], activeTripId: trip.id })),
      setActiveTrip: (id) => set({ activeTripId: id }),
      upsertExpense: (expense) =>
        set((s) => {
          const exists = s.expenses.some((e) => e.id === expense.id);
          return {
            expenses: exists ? s.expenses.map((e) => (e.id === expense.id ? expense : e)) : [...s.expenses, expense],
            lastFxRates:
              expense.currency === expense.baseCurrency
                ? s.lastFxRates
                : { ...s.lastFxRates, [fxKey(expense.currency, expense.baseCurrency)]: expense.fxRate },
          };
        }),
      deleteExpense: async (id) => {
        const target = get().expenses.find((e) => e.id === id);
        set((s) => ({ expenses: s.expenses.filter((e) => e.id !== id) }));
        if (target?.receiptId) await deleteReceiptImage(target.receiptId);
      },
    }),
    {
      name: 'trip-expense-store',
      version: 2,
      storage: createJSONStorage(() => AsyncStorage),
      migrate: (persisted, version) => {
        const state = persisted as Record<string, unknown>;
        if (version < 2) {
          // v1 trips had `budgetTotal: string | null`.
          const trips = (state.trips as Array<Trip & { budgetTotal?: string | null }>) ?? [];
          state.trips = trips.map(({ budgetTotal, ...trip }) => ({
            ...trip,
            budget: budgetTotal ? { kind: 'total', amount: budgetTotal } : { kind: 'none' },
          }));
          state.language ??= 'ko';
        }
        return state as unknown as AppState;
      },
    },
  ),
);

export function useActiveTrip(): Trip | null {
  return useAppStore((s) => s.trips.find((t) => t.id === s.activeTripId) ?? null);
}
