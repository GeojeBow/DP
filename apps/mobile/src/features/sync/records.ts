import type { CustomField } from '../../domain/customFields';
import type { Expense, Trip } from '../../domain/models';
import type { ReportPreset } from '../../domain/report';
import type { CompanyPolicy, CompanyRule } from '../policy/rules';
import type { CompanyTemplate } from '../template/mapping';

/** Records kept in the store, mirrored one row each in sync_records. */
export interface Collections {
  trips: Trip[];
  expenses: Expense[];
  companyRules: CompanyRule[];
  policies: CompanyPolicy[];
  customFields: CustomField[];
  reportPresets: ReportPreset[];
  companyTemplates: CompanyTemplate[];
}

export const DOC_KINDS = ['trip', 'expense', 'rule', 'field', 'preset', 'template', 'policy'] as const;
export type DocKind = (typeof DOC_KINDS)[number];
/** Files stored outside the store: receipt photos and uploaded template files. */
export type FileKind = 'receipt' | 'templateFile';
export type SyncKind = DocKind | FileKind;

export const COLLECTION: Record<DocKind, keyof Collections> = {
  trip: 'trips',
  expense: 'expenses',
  rule: 'companyRules',
  field: 'customFields',
  preset: 'reportPresets',
  template: 'companyTemplates',
  policy: 'policies',
};

export const syncKey = (kind: SyncKind, id: string) => `${kind}:${id}`;
export function parseKey(key: string): { kind: SyncKind; id: string } {
  const i = key.indexOf(':');
  return { kind: key.slice(0, i) as SyncKind, id: key.slice(i + 1) };
}

type WithId = { id: string };
const byId = <T extends WithId>(list: readonly T[]) => new Map(list.map((x) => [x.id, x]));
const receiptIds = (expenses: readonly Expense[]) => new Set(expenses.flatMap((e) => (e.receiptId ? [e.receiptId] : [])));

/** Keys of everything that differs between two snapshots, files included. */
export function changedKeys(prev: Collections, next: Collections): string[] {
  const keys: string[] = [];
  for (const kind of DOC_KINDS) {
    const field = COLLECTION[kind];
    if (prev[field] === next[field]) continue;
    const a = byId(prev[field] as WithId[]);
    const b = byId(next[field] as WithId[]);
    for (const [id, x] of b) if (a.get(id) !== x) keys.push(syncKey(kind, id));
    for (const id of a.keys()) if (!b.has(id)) keys.push(syncKey(kind, id));
  }
  if (prev.expenses !== next.expenses) {
    const a = receiptIds(prev.expenses);
    const b = receiptIds(next.expenses);
    for (const id of b) if (!a.has(id)) keys.push(syncKey('receipt', id));
    for (const id of a) if (!b.has(id)) keys.push(syncKey('receipt', id));
  }
  if (prev.companyTemplates !== next.companyTemplates) {
    const a = byId(prev.companyTemplates);
    const b = byId(next.companyTemplates);
    for (const id of b.keys()) if (!a.has(id)) keys.push(syncKey('templateFile', id));
    for (const id of a.keys()) if (!b.has(id)) keys.push(syncKey('templateFile', id));
  }
  return keys;
}

/** Every key a device holds, for the first push after signing in. */
export function allKeys(state: Collections): string[] {
  const empty: Collections = { trips: [], expenses: [], companyRules: [], policies: [], customFields: [], reportPresets: [], companyTemplates: [] };
  return changedKeys(empty, state);
}

/** The local record behind a key; undefined when it was deleted (files are looked up elsewhere). */
export function currentRecord(state: Collections, key: string): unknown {
  const { kind, id } = parseKey(key);
  if (!(DOC_KINDS as readonly string[]).includes(kind)) return undefined;
  return (state[COLLECTION[kind as DocKind]] as WithId[]).find((x) => x.id === id);
}

export interface RemoteRow {
  kind: SyncKind;
  id: string;
  data: unknown;
  deleted: boolean;
}

/**
 * Applies pulled rows to the store's records. A record with an unsent local
 * change keeps the local version; it reaches the server on the next push.
 */
export function applyRemote(state: Collections, rows: readonly RemoteRow[], pending: ReadonlySet<string>): Partial<Collections> {
  const out: Partial<Record<keyof Collections, WithId[]>> = {};
  for (const row of rows) {
    if (!(DOC_KINDS as readonly string[]).includes(row.kind) || pending.has(syncKey(row.kind, row.id))) continue;
    const field = COLLECTION[row.kind as DocKind];
    const list = out[field] ?? [...(state[field] as WithId[])];
    const i = list.findIndex((x) => x.id === row.id);
    if (row.deleted) {
      if (i >= 0) list.splice(i, 1);
    } else if (row.data && typeof row.data === 'object') {
      const record = { ...(row.data as WithId), id: row.id };
      if (i >= 0) list[i] = record;
      else list.push(record);
    }
    out[field] = list;
  }
  return out as Partial<Collections>;
}
