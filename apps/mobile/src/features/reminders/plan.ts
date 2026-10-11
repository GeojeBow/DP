import type { Expense, Trip } from '../../domain/models';
import { localToday } from '../../domain/trip';

export interface PlannedReminder {
  kind: 'daily' | 'report';
  tripId: string;
  tripTitle: string;
  /** Local wall-clock time */
  at: Date;
}

/** Android keeps a limited number of alarms per app; the nearest ones matter most. */
const MAX_REMINDERS = 40;

function atLocal(isoDate: string, hour: number): Date {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y!, m! - 1, d!, hour, 0, 0, 0);
}

function nextDay(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return localToday(new Date(y!, m! - 1, d! + 1));
}

/**
 * Evening nudges on trip days with nothing recorded yet, and a "make your
 * report" nudge the morning after a trip ends (until it is marked paid).
 */
export function planReminders(
  trips: readonly Trip[],
  expenses: readonly Expense[],
  now: Date,
  hours = { daily: 21, report: 10 },
): PlannedReminder[] {
  const today = localToday(now);
  const recorded = new Set(expenses.map((e) => `${e.tripId}|${e.localDate}`));
  const out: PlannedReminder[] = [];
  for (const trip of trips) {
    for (let d = trip.startDate < today ? today : trip.startDate; d <= trip.endDate; d = nextDay(d)) {
      const at = atLocal(d, hours.daily);
      if (at > now && !recorded.has(`${trip.id}|${d}`)) out.push({ kind: 'daily', tripId: trip.id, tripTitle: trip.title, at });
    }
    const after = atLocal(nextDay(trip.endDate), hours.report);
    if (!trip.reimbursedAt && after > now && expenses.some((e) => e.tripId === trip.id)) {
      out.push({ kind: 'report', tripId: trip.id, tripTitle: trip.title, at: after });
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, MAX_REMINDERS);
}
