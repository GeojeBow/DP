import { ensureSignedIn, supabase } from '../../lib/supabase';
import { guessMapping, TEMPLATE_COLUMNS, TEMPLATE_FIELDS, type TemplateMapping } from './mapping';
import { describeTemplate, type ParsedTemplate } from './xlsxTemplate';

const isRef = (v: unknown): v is string => typeof v === 'string' && /^[A-Z]{1,3}\d{1,6}$/.test(v.toUpperCase());
const isCol = (v: unknown): v is string => typeof v === 'string' && /^[A-Z]{1,3}$/.test(v.toUpperCase());

/** Keeps only well-formed addresses from an untrusted mapping. */
export function cleanMapping(raw: unknown): TemplateMapping | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { fields?: Record<string, unknown>; table?: { firstRow?: unknown; columns?: Record<string, unknown> } | null };
  const fields: TemplateMapping['fields'] = {};
  for (const f of TEMPLATE_FIELDS) {
    const v = r.fields?.[f];
    if (isRef(v)) fields[f] = v.toUpperCase();
  }
  let table: TemplateMapping['table'] = null;
  const firstRow = Number(r.table?.firstRow);
  if (r.table && Number.isInteger(firstRow) && firstRow > 0) {
    const columns: NonNullable<TemplateMapping['table']>['columns'] = {};
    for (const c of TEMPLATE_COLUMNS) {
      const v = r.table.columns?.[c];
      if (isCol(v)) columns[c] = v.toUpperCase();
    }
    if (Object.keys(columns).length) table = { firstRow, columns };
  }
  return { fields, table };
}

/**
 * Asks the AI where things go; falls back to matching printed labels when it
 * can't be reached. Either way the user confirms the result.
 */
export async function suggestMapping(t: ParsedTemplate): Promise<{ mapping: TemplateMapping; by: 'ai' | 'labels' }> {
  try {
    await ensureSignedIn();
    const { data, error } = await supabase().functions.invoke('map-template', { body: { layout: describeTemplate(t) } });
    const mapping = error ? null : cleanMapping(data?.mapping);
    if (mapping && (mapping.table || Object.keys(mapping.fields).length)) return { mapping, by: 'ai' };
  } catch {
    // fall through to the label match
  }
  return { mapping: guessMapping(t), by: 'labels' };
}
