import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { CustomField } from '../domain/customFields';
import type { Expense, Trip } from '../domain/models';
import type { Language } from '../i18n';
import type { ReportPreset } from '../domain/report';
import { applyCompanyPolicy, type CompanyPolicy, type CompanyRule, companyPolicyOf } from '../features/policy/rules';
import type { CompanyTemplate } from '../features/template/mapping';
import { deleteTemplateFile } from '../features/template/storage';
import type { ThemeId } from '../theme/tokens';
import type { ReportFormat } from '../domain/report';
import { deleteReceiptImage } from './receiptImages';

interface AppState {
  trips: Trip[];
  expenses: Expense[];
  activeTripId: string | null;
  /** Last rate used per "FROM>TO" pair, offered as the default next time */
  lastFxRates: Record<string, string>;
  language: Language;
  theme: ThemeId;
  /** Evening and end-of-trip reminders */
  reminders: boolean;
  setReminders: (on: boolean) => void;
  /** Reuse the exchange rate entered once for the rest of the trip */
  rememberFx: boolean;
  setRememberFx: (on: boolean) => void;
  /** Report format or company template picked last, preselected next time */
  lastFormatId: string | null;
  setLastFormatId: (id: string) => void;
  /** File type picked on the reports tab (PDF, Excel, Word); null = the format's own */
  fileFormat: ReportFormat | null;
  setFileFormat: (format: ReportFormat) => void;
  /** User-made report formats; built-ins live in code */
  reportPresets: ReportPreset[];
  /** Uploaded company Excel templates; files live in storage.ts */
  companyTemplates: CompanyTemplate[];
  /** Company expense rules, checked on the device */
  companyRules: CompanyRule[];
  addRule: (rule: CompanyRule) => void;
  /** The company's default budget and allowance: zero or one entry (a list so it syncs like the rest) */
  policies: CompanyPolicy[];
  /** Saves the company policy and copies it into every trip that follows it */
  setCompanyPolicy: (policy: CompanyPolicy) => void;
  /** Extra boxes on every expense */
  customFields: CustomField[];
  saveField: (field: CustomField) => void;
  deleteField: (id: string) => void;
  deleteRule: (id: string) => void;
  saveTemplate: (template: CompanyTemplate) => void;
  deleteTemplate: (id: string) => Promise<void>;
  savePreset: (preset: ReportPreset) => void;
  deletePreset: (id: string) => void;
  /** Sync keys ("expense:<id>") changed here and not yet on the server */
  outbox: string[];
  /** Server time of the newest row pulled */
  lastPulledAt: string | null;
  /** When this device last finished a sync */
  syncedAt: string | null;
  enqueue: (keys: readonly string[]) => void;
  /** Drops keys that reached the server */
  markPushed: (keys: readonly string[]) => void;
  setSynced: (patch: { lastPulledAt?: string | null; syncedAt?: string | null }) => void;
  /** Removes everything that belongs to an account, e.g. on sign-out */
  clearAccountData: () => void;
  /** The company picked on the company screen, when the account belongs to several */
  companyId: string | null;
  setCompany: (id: string | null) => void;
  setLanguage: (language: Language) => void;
  setTheme: (theme: ThemeId) => void;
  addTrip: (trip: Trip) => void;
  updateTrip: (trip: Trip) => void;
  setActiveTrip: (id: string | null) => void;
  upsertExpense: (expense: Expense) => void;
  deleteExpense: (id: string) => Promise<void>;
  /** Removes a trip with all its expenses and receipt photos */
  deleteTrip: (id: string) => Promise<void>;
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
      theme: 'peach',
      reminders: true,
      setReminders: (reminders) => set({ reminders }),
      rememberFx: true,
      setRememberFx: (rememberFx) => set({ rememberFx }),
      lastFormatId: null,
      setLastFormatId: (lastFormatId) => set({ lastFormatId }),
      fileFormat: null,
      setFileFormat: (fileFormat) => set({ fileFormat }),
      reportPresets: [],
      companyTemplates: [],
      companyRules: [],
      policies: [],
      setCompanyPolicy: (policy) =>
        set((s) => ({ policies: [policy], trips: s.trips.map((t) => applyCompanyPolicy(t, policy)) })),
      customFields: [],
      saveField: (field) =>
        set((s) => ({
          customFields: s.customFields.some((f) => f.id === field.id)
            ? s.customFields.map((f) => (f.id === field.id ? field : f))
            : [...s.customFields, field],
        })),
      deleteField: (id) => set((s) => ({ customFields: s.customFields.filter((f) => f.id !== id) })),
      addRule: (rule) => set((s) => ({ companyRules: [...s.companyRules, rule] })),
      deleteRule: (id) => set((s) => ({ companyRules: s.companyRules.filter((r) => r.id !== id) })),
      saveTemplate: (template) =>
        set((s) => ({
          companyTemplates: s.companyTemplates.some((x) => x.id === template.id)
            ? s.companyTemplates.map((x) => (x.id === template.id ? template : x))
            : [...s.companyTemplates, template],
        })),
      deleteTemplate: async (id) => {
        set((s) => ({ companyTemplates: s.companyTemplates.filter((x) => x.id !== id) }));
        await deleteTemplateFile(id);
      },
      savePreset: (preset) =>
        set((s) => ({
          reportPresets: s.reportPresets.some((p) => p.id === preset.id)
            ? s.reportPresets.map((p) => (p.id === preset.id ? preset : p))
            : [...s.reportPresets, preset],
        })),
      deletePreset: (id) => set((s) => ({ reportPresets: s.reportPresets.filter((p) => p.id !== id) })),
      outbox: [],
      lastPulledAt: null,
      syncedAt: null,
      enqueue: (keys) =>
        set((s) => {
          const add = keys.filter((k) => !s.outbox.includes(k));
          return add.length ? { outbox: [...s.outbox, ...add] } : {};
        }),
      markPushed: (keys) => set((s) => ({ outbox: s.outbox.filter((k) => !keys.includes(k)) })),
      setSynced: (patch) => set(patch),
      clearAccountData: () =>
        set({
          trips: [], expenses: [], activeTripId: null, companyRules: [], policies: [], customFields: [], reportPresets: [], companyTemplates: [],
          outbox: [], lastPulledAt: null, syncedAt: null, companyId: null,
        }),
      companyId: null,
      setCompany: (companyId) => set({ companyId }),
      setLanguage: (language) => set({ language }),
      setTheme: (theme) => set({ theme }),
      // Trips that follow the company policy always carry its current budget and allowance.
      addTrip: (trip) =>
        set((s) => ({ trips: [...s.trips, applyCompanyPolicy(trip, companyPolicyOf(s.policies))], activeTripId: trip.id })),
      updateTrip: (trip) =>
        set((s) => {
          const next = applyCompanyPolicy(trip, companyPolicyOf(s.policies));
          return { trips: s.trips.map((x) => (x.id === trip.id ? next : x)) };
        }),
      setActiveTrip: (id) => set({ activeTripId: id }),
      upsertExpense: (expense) =>
        set((s) => {
          const exists = s.expenses.some((e) => e.id === expense.id);
          const foreign = expense.currency !== expense.baseCurrency;
          const trips = foreign && s.rememberFx
            ? s.trips.map((t) =>
              t.id === expense.tripId && t.baseCurrency === expense.baseCurrency && t.fxRates?.[expense.currency] !== expense.fxRate
                ? { ...t, fxRates: { ...t.fxRates, [expense.currency]: expense.fxRate } }
                : t)
            : s.trips;
          return {
            trips,
            expenses: exists ? s.expenses.map((e) => (e.id === expense.id ? expense : e)) : [...s.expenses, expense],
            lastFxRates:
              expense.currency === expense.baseCurrency
                ? s.lastFxRates
                : { ...s.lastFxRates, [fxKey(expense.currency, expense.baseCurrency)]: expense.fxRate },
          };
        }),
      deleteTrip: async (id) => {
        const receipts = get().expenses.filter((e) => e.tripId === id).flatMap((e) => (e.receiptId ? [e.receiptId] : []));
        set((s) => {
          const trips = s.trips.filter((t) => t.id !== id);
          // Move to the most recent remaining trip when the active one goes.
          const next = [...trips].sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
          return {
            trips,
            expenses: s.expenses.filter((e) => e.tripId !== id),
            activeTripId: s.activeTripId === id ? next?.id ?? null : s.activeTripId,
          };
        });
        for (const r of receipts) await deleteReceiptImage(r);
      },
      deleteExpense: async (id) => {
        const target = get().expenses.find((e) => e.id === id);
        set((s) => ({ expenses: s.expenses.filter((e) => e.id !== id) }));
        if (target?.receiptId) await deleteReceiptImage(target.receiptId);
      },
    }),
    {
      name: 'trip-expense-store',
      version: 3,
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
        if (version < 3) {
          // Budget and allowance moved under the company policy. Trips that set their own
          // keep them (with a copy of the default rules); the rest follow the company.
          const rules = (state.companyRules as CompanyRule[] | undefined) ?? [];
          const trips = (state.trips as Trip[] | undefined) ?? [];
          state.trips = trips.map((trip) => {
            if (trip.ruleMode) return trip;
            const own = trip.budget.kind !== 'none' || !!trip.perDiem;
            return own
              ? { ...trip, ruleMode: 'trip', rules: trip.rules ?? rules.map((r) => ({ ...r, id: `${r.id}-${trip.id}` })) }
              : { ...trip, ruleMode: 'company' };
          });
        }
        return state as unknown as AppState;
      },
    },
  ),
);

/**
 * The rate to fill in for a currency: the one remembered for this trip, else the last one used
 * anywhere for the same pair. Nothing when the user turned remembering off.
 */
export function rememberedRate(
  s: Pick<AppState, 'rememberFx' | 'lastFxRates'>, trip: Trip | null | undefined, currency: string, base: string,
): string | undefined {
  if (!s.rememberFx || currency === base) return undefined;
  return (trip?.baseCurrency === base ? trip.fxRates?.[currency] : undefined) ?? s.lastFxRates[fxKey(currency, base)];
}

export function useActiveTrip(): Trip | null {
  return useAppStore((s) => s.trips.find((t) => t.id === s.activeTripId) ?? null);
}
