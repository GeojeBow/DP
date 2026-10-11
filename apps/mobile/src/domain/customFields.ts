/** Extra boxes a company asks for on every expense, e.g. project code or attendees. */
export const CUSTOM_FIELD_TYPES = ['text', 'number', 'choice'] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export interface CustomField {
  id: string;
  name: string;
  type: CustomFieldType;
  /** choice only */
  options: string[];
  required: boolean;
}

export type CustomFieldProblem = 'required' | 'number' | 'choice';

/** Why a value can't be saved, or null when it's fine. Values are kept as typed strings. */
export function checkCustomValue(field: CustomField, raw: string | undefined): CustomFieldProblem | null {
  const value = (raw ?? '').trim();
  if (!value) return field.required ? 'required' : null;
  if (field.type === 'number' && !/^-?\d+(\.\d+)?$/.test(value.replace(/,/g, ''))) return 'number';
  if (field.type === 'choice' && !field.options.includes(value)) return 'choice';
  return null;
}

/** "a, b ,, c" → ["a", "b", "c"], duplicates dropped. */
export const parseOptions = (text: string) => Array.from(new Set(text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)));

/** The cell value for reports: numbers as numbers so Excel can sum them. */
export function customCell(field: CustomField, raw: string | undefined): { text: string; number?: number } {
  const text = (raw ?? '').trim();
  if (field.type === 'number' && text) {
    const n = Number(text.replace(/,/g, ''));
    if (Number.isFinite(n)) return { text, number: n };
  }
  return { text };
}
