import { AppState } from 'react-native';

import { supabase } from '../../lib/supabase';
import { deleteReceiptImage, loadReceiptImage, saveReceiptImage } from '../../store/receiptImages';
import { useAppStore } from '../../store/useAppStore';
import { deleteTemplateFile, fromBase64, loadTemplateFile, saveTemplateFile, toBase64 } from '../template/storage';
import { applyRemote, changedKeys, type Collections, currentRecord, parseKey, type RemoteRow } from './records';

/**
 * Local-first sync. Every change lands in the store first and its key goes in
 * the outbox; when signed in with an account, the outbox is pushed and newer
 * rows are pulled. Offline, the outbox simply waits for the next attempt.
 */

const TABLE = 'sync_records';
const PAGE = 500;
/** Rows committed slightly out of order still get pulled; re-applying is harmless. */
const OVERLAP_MS = 60_000;

let applyingRemote = false;
let running: Promise<SyncResult> | null = null;

export type SyncResult = 'ok' | 'no-account' | 'failed';

const collections = (): Collections => {
  const s = useAppStore.getState();
  return {
    trips: s.trips, expenses: s.expenses, companyRules: s.companyRules,
    customFields: s.customFields, reportPresets: s.reportPresets, companyTemplates: s.companyTemplates,
  };
};

/** The signed-in account's user id, or null for guests and signed-out devices. */
export async function accountUserId(): Promise<string | null> {
  const { data } = await supabase().auth.getSession();
  const user = data.session?.user;
  return user && !user.is_anonymous ? user.id : null;
}

async function rowFor(key: string, userId: string, at: string) {
  const { kind, id } = parseKey(key);
  let data: unknown;
  if (kind === 'receipt') {
    const uri = await loadReceiptImage(id);
    data = uri ? { uri } : undefined;
  } else if (kind === 'templateFile') {
    const bytes = await loadTemplateFile(id);
    data = bytes ? { b64: toBase64(bytes) } : undefined;
  } else {
    data = currentRecord(collections(), key);
  }
  return { user_id: userId, kind, id, data: data ?? null, deleted: data === undefined, client_updated_at: at };
}

async function push(userId: string): Promise<void> {
  const keys = useAppStore.getState().outbox.slice();
  if (!keys.length) return;
  const before = collections();
  const snapshot = new Map(keys.map((k) => [k, currentRecord(before, k)]));
  const at = new Date().toISOString();
  // Photos are large; send them a few at a time.
  const files = keys.filter((k) => k.startsWith('receipt:') || k.startsWith('templateFile:'));
  const docs = keys.filter((k) => !files.includes(k));
  const batches = [...chunk(docs, 200), ...chunk(files, 5)];
  for (const batch of batches) {
    const rows = await Promise.all(batch.map((k) => rowFor(k, userId, at)));
    const { error } = await supabase().from(TABLE).upsert(rows, { onConflict: 'user_id,kind,id' });
    if (error) throw error;
    // A record edited again while this batch was in flight stays queued.
    const now = collections();
    useAppStore.getState().markPushed(batch.filter((k) => currentRecord(now, k) === snapshot.get(k)));
  }
}

async function pull(): Promise<void> {
  const { lastPulledAt, setSynced } = useAppStore.getState();
  const since = lastPulledAt ? new Date(Date.parse(lastPulledAt) - OVERLAP_MS).toISOString() : '1970-01-01T00:00:00Z';
  let newest = lastPulledAt;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase()
      .from(TABLE)
      .select('kind,id,data,deleted,updated_at')
      .gt('updated_at', since)
      .order('updated_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as Array<RemoteRow & { updated_at: string }>;
    await applyRows(rows);
    if (rows.length) newest = rows[rows.length - 1]!.updated_at;
    if (rows.length < PAGE) break;
  }
  setSynced({ lastPulledAt: newest });
}

async function applyRows(rows: readonly RemoteRow[]): Promise<void> {
  const pending = new Set(useAppStore.getState().outbox);
  for (const row of rows) {
    if (pending.has(`${row.kind}:${row.id}`)) continue;
    const data = row.data as { uri?: string; b64?: string } | null;
    if (row.kind === 'receipt') {
      if (row.deleted) await deleteReceiptImage(row.id);
      else if (data?.uri) await saveReceiptImage(row.id, data.uri);
    } else if (row.kind === 'templateFile') {
      if (row.deleted) await deleteTemplateFile(row.id);
      else if (data?.b64) await saveTemplateFile(row.id, fromBase64(data.b64));
    }
  }
  const patch = applyRemote(collections(), rows, pending);
  if (!Object.keys(patch).length) return;
  applyingRemote = true;
  try {
    useAppStore.setState((s) => {
      // A trip removed elsewhere can't stay the active one.
      const trips = patch.trips ?? s.trips;
      return { ...patch, activeTripId: trips.some((t) => t.id === s.activeTripId) ? s.activeTripId : trips[0]?.id ?? null };
    });
  } finally {
    applyingRemote = false;
  }
}

/** Pushes unsent changes, then pulls newer ones. Safe to call often; calls share one run. */
export function syncNow(): Promise<SyncResult> {
  running ??= (async (): Promise<SyncResult> => {
    try {
      const userId = await accountUserId();
      if (!userId) return 'no-account';
      await push(userId);
      await pull();
      useAppStore.getState().setSynced({ syncedAt: new Date().toISOString() });
      return 'ok';
    } catch {
      return 'failed';
    } finally {
      running = null;
    }
  })();
  return running;
}

let timer: ReturnType<typeof setTimeout> | null = null;
const soon = (ms = 2000) => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), ms);
};

/** Runs a store change that must not be sent to the server, e.g. clearing the device on sign-out. */
export function withoutTracking(fn: () => void): void {
  applyingRemote = true;
  try {
    fn();
  } finally {
    applyingRemote = false;
  }
}

/** Starts watching for changes; returns a stop function. Called once from the root layout. */
export function startSync(): () => void {
  let unsubscribe = () => {};
  // Loading saved data from the device is not a change; start watching after it.
  const watch = () => {
    unsubscribe = useAppStore.subscribe((next, prev) => {
    if (applyingRemote) return;
    const keys = changedKeys(
      { trips: prev.trips, expenses: prev.expenses, companyRules: prev.companyRules, customFields: prev.customFields, reportPresets: prev.reportPresets, companyTemplates: prev.companyTemplates },
      { trips: next.trips, expenses: next.expenses, companyRules: next.companyRules, customFields: next.customFields, reportPresets: next.reportPresets, companyTemplates: next.companyTemplates },
    );
    if (keys.length) {
      next.enqueue(keys);
      soon();
    }
    });
    soon(0);
  };
  const unhydrated = useAppStore.persist.hasHydrated() ? (watch(), null) : useAppStore.persist.onFinishHydration(watch);
  const appState = AppState.addEventListener('change', (s) => s === 'active' && soon(0));
  const interval = setInterval(() => void syncNow(), 60_000);
  return () => {
    unhydrated?.();
    unsubscribe();
    appState.remove();
    clearInterval(interval);
    if (timer) clearTimeout(timer);
  };
}

function chunk<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
