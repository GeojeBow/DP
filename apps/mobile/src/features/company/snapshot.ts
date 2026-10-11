import type { CustomField } from '../../domain/customFields';
import { fromMinor, sumMinor, toCurrencyCode, toMinor } from '../../domain/money';
import type { Expense, Trip } from '../../domain/models';

/** What an approver sees: the trip exactly as it was when submitted. */
export interface SubmissionSnapshot {
  trip: Pick<Trip, 'id' | 'title' | 'startDate' | 'endDate' | 'baseCurrency'>;
  expenses: Expense[];
  fields: Array<Pick<CustomField, 'id' | 'name'>>;
  /** Expense id → company rules it breaks, in words */
  notes: Record<string, string[]>;
}

export interface NewSubmission {
  org_id: string;
  trip_id: string;
  title: string;
  period: string;
  base_currency: string;
  total: string;
  item_count: number;
  flagged_count: number;
  snapshot: SubmissionSnapshot;
}

export function buildSubmission(
  orgId: string,
  trip: Trip,
  expenses: readonly Expense[],
  fields: readonly CustomField[],
  notes: Record<string, string[]>,
): NewSubmission {
  const own = expenses
    .filter((e) => e.tripId === trip.id)
    .sort((a, b) => a.localDate.localeCompare(b.localDate) || a.createdAt.localeCompare(b.createdAt));
  const base = toCurrencyCode(trip.baseCurrency);
  const ownNotes = Object.fromEntries(own.flatMap((e) => (notes[e.id]?.length ? [[e.id, notes[e.id]!]] : [])));
  return {
    org_id: orgId,
    trip_id: trip.id,
    title: trip.title,
    period: `${trip.startDate} ~ ${trip.endDate}`,
    base_currency: trip.baseCurrency,
    total: fromMinor(sumMinor(own.map((e) => toMinor(e.totalBase, base))), base),
    item_count: own.length,
    flagged_count: Object.keys(ownNotes).length,
    snapshot: {
      trip: { id: trip.id, title: trip.title, startDate: trip.startDate, endDate: trip.endDate, baseCurrency: trip.baseCurrency },
      expenses: own,
      fields: fields.map((f) => ({ id: f.id, name: f.name })),
      notes: ownNotes,
    },
  };
}
