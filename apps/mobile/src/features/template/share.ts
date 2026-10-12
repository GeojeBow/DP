import { z } from 'zod';

import { CUSTOM_FIELD_TYPES, type CustomField } from '../../domain/customFields';
import { fromBase64, toBase64 } from './base64';
import { TEMPLATE_COLUMNS, TEMPLATE_FIELDS, type CompanyTemplate, type TemplateMapping } from './mapping';
import { readTemplate } from './xlsxTemplate';

/**
 * A company template packed into one file a friend can import: the Excel file, where
 * everything goes, and the company-only boxes the table uses. Personal values
 * (name, team) stay behind.
 */
const APP = 'trip-expense-template';
export const SHARE_EXTENSION = '.tripform.json';

const cellRef = z.string().regex(/^[A-Z]{1,3}\d{1,6}$/);
const colRef = z.string().regex(/^[A-Z]{1,3}$/);

const sharedSchema = z.object({
  app: z.literal(APP),
  version: z.literal(1),
  name: z.string().min(1).max(200),
  fileName: z.string().min(1).max(260),
  mapping: z.object({
    fields: z.partialRecord(z.enum(TEMPLATE_FIELDS), cellRef),
    table: z.object({
      firstRow: z.number().int().positive(),
      columns: z.partialRecord(z.enum(TEMPLATE_COLUMNS), colRef),
      custom: z.record(z.string(), colRef).optional(),
    }).nullable(),
  }),
  customFields: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1).max(100),
    type: z.enum(CUSTOM_FIELD_TYPES),
    options: z.array(z.string()),
    required: z.boolean(),
  })),
  file: z.string().min(1),
});

/** The text of the shared file. */
export function packTemplate(template: CompanyTemplate, bytes: Uint8Array, customFields: readonly CustomField[]): string {
  const used = template.mapping.table?.custom ?? {};
  return JSON.stringify({
    app: APP,
    version: 1,
    name: template.name,
    fileName: template.fileName,
    mapping: template.mapping,
    customFields: customFields.filter((f) => used[f.id]),
    file: toBase64(bytes),
  });
}

export interface UnpackedTemplate {
  template: CompanyTemplate;
  bytes: Uint8Array;
  /** Company-only boxes the receiver doesn't have yet */
  newFields: CustomField[];
}

/**
 * Reads a shared file. Company-only boxes are matched to the receiver's by name and
 * kind, and added when missing, so the table fills exactly as it did for the sender.
 * Throws when the file is not a shared template.
 */
export function unpackTemplate(text: string, mine: readonly CustomField[], newId: () => string): UnpackedTemplate {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Not a shared template');
  }
  const parsed = sharedSchema.safeParse(raw);
  if (!parsed.success) throw new Error('Not a shared template');
  const shared = parsed.data;
  const bytes = fromBase64(shared.file);
  readTemplate(bytes); // throws when the Excel file inside is broken

  const norm = (s: string) => s.trim().toLowerCase();
  const idMap = new Map<string, string>();
  const newFields: CustomField[] = [];
  for (const f of shared.customFields) {
    const same = mine.find((m) => norm(m.name) === norm(f.name) && m.type === f.type);
    if (same) idMap.set(f.id, same.id);
    else {
      const field = { ...f, id: newId() };
      newFields.push(field);
      idMap.set(f.id, field.id);
    }
  }
  const table = shared.mapping.table;
  const custom = Object.fromEntries(
    Object.entries(table?.custom ?? {}).flatMap(([id, col]) => (idMap.has(id) ? [[idMap.get(id)!, col]] : [])),
  );
  const mapping: TemplateMapping = {
    fields: shared.mapping.fields,
    table: table ? { firstRow: table.firstRow, columns: table.columns, custom } : null,
  };
  return {
    template: { id: newId(), name: shared.name, fileName: shared.fileName, mapping, values: {} },
    bytes,
    newFields,
  };
}
