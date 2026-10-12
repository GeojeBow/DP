import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

/**
 * Reads and fills a company's own Excel report template. Only cell values
 * change: styles, fonts, column widths, merged cells and the rest of the
 * workbook are copied through untouched, so the result keeps the company's
 * look. Works on the first worksheet.
 */

export interface TemplateCell {
  /** A1-style address */
  ref: string;
  text: string;
}

export interface ParsedTemplate {
  files: Record<string, Uint8Array>;
  sheetPath: string;
  sheetName: string;
  /** Non-empty cells, in sheet order */
  cells: TemplateCell[];
}

export type CellValue = string | number;

export interface FillPlan {
  /** Single cells, e.g. { B3: '해리' } */
  cells: Record<string, CellValue>;
  /** Item table: first data row and one value per column letter for each item */
  table: { firstRow: number; rows: Array<Record<string, CellValue>> } | null;
}

const decode = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Joined text of every <t> inside a fragment (handles rich-text runs). */
const textOf = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1]!)).join('');

export function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function columnLetters(index: number): string {
  let s = '';
  for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export function splitRef(ref: string): { col: string; row: number } {
  const m = /^([A-Z]{1,3})(\d+)$/.exec(ref.toUpperCase());
  if (!m) throw new RangeError(`Invalid cell reference "${ref}"`);
  return { col: m[1]!, row: Number(m[2]) };
}

function firstSheet(files: Record<string, Uint8Array>): { path: string; name: string } {
  const workbook = strFromU8(files['xl/workbook.xml'] ?? new Uint8Array());
  const sheet = /<sheet\b[^>]*>/.exec(workbook)?.[0] ?? '';
  const name = decode(/\bname="([^"]*)"/.exec(sheet)?.[1] ?? 'Sheet1');
  const rid = /\br:id="([^"]*)"/.exec(sheet)?.[1];
  const rels = strFromU8(files['xl/_rels/workbook.xml.rels'] ?? new Uint8Array());
  const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => r.includes(`Id="${rid}"`));
  let target = rel ? /\bTarget="([^"]*)"/.exec(rel)?.[1] : undefined;
  if (target) target = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  const path = target && files[target] ? target : 'xl/worksheets/sheet1.xml';
  if (!files[path]) throw new Error('This file has no worksheet');
  return { path, name };
}

export function readTemplate(bytes: Uint8Array): ParsedTemplate {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error('Not an .xlsx file');
  }
  const { path, name } = firstSheet(files);
  const shared = files['xl/sharedStrings.xml']
    ? [...strFromU8(files['xl/sharedStrings.xml']).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]!))
    : [];
  const sheet = strFromU8(files[path]!);
  const cells: TemplateCell[] = [];
  for (const m of sheet.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = m[1]!;
    const body = m[2] ?? '';
    const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
    if (!ref) continue;
    const kind = /\bt="([^"]*)"/.exec(attrs)?.[1];
    const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
    let text = '';
    if (kind === 's' && v !== undefined) text = shared[Number(v)] ?? '';
    else if (kind === 'inlineStr') text = textOf(body);
    else if (v !== undefined) text = decode(v);
    else if (/<f>/.test(body)) text = '=' + decode(/<f>([\s\S]*?)<\/f>/.exec(body)?.[1] ?? '');
    if (text.trim()) cells.push({ ref, text: text.trim() });
  }
  return { files, sheetPath: path, sheetName: name, cells };
}

/** A compact text view of the template for the AI: one line per row. */
export function describeTemplate(t: ParsedTemplate, maxRows = 60): string {
  const rows = new Map<number, string[]>();
  for (const c of t.cells) {
    const { row } = splitRef(c.ref);
    if (row > maxRows) continue;
    rows.set(row, [...(rows.get(row) ?? []), `${c.ref}=${c.text.slice(0, 40)}`]);
  }
  return [...rows.entries()].sort(([a], [b]) => a - b).map(([, cells]) => cells.join(' | ')).join('\n');
}

// ---------- filling ----------

interface RowXml {
  num: number;
  attrs: string;
  cells: Map<number, string>;
}

function parseRows(sheetData: string): RowXml[] {
  const rows: RowXml[] = [];
  for (const m of sheetData.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const attrs = m[1]!;
    const num = Number(/\br="(\d+)"/.exec(attrs)?.[1]);
    const cells = new Map<number, string>();
    for (const c of (m[2] ?? '').matchAll(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)) {
      const ref = /\br="([A-Z]+)\d+"/.exec(c[0])?.[1];
      if (ref) cells.set(columnIndex(ref), c[0]);
    }
    rows.push({ num, attrs, cells });
  }
  return rows;
}

const rowXml = (r: RowXml) => {
  const attrs = r.attrs.replace(/\br="\d+"/, `r="${r.num}"`).replace(/\bspans="[^"]*"/, '');
  const cells = [...r.cells.entries()].sort(([a], [b]) => a - b).map(([, xml]) => xml);
  return cells.length ? `<row${attrs}>${cells.join('')}</row>` : `<row${attrs}/>`;
};

const styleOf = (cellXml: string | undefined) => (cellXml ? /\bs="(\d+)"/.exec(cellXml)?.[1] : undefined);
const hasFormula = (cellXml: string | undefined) => !!cellXml && /<f[\s>]/.test(cellXml);
/** A typed-in text cell (shared or inline string with something in it), not a number or formula. */
const isText = (xml: string) =>
  !/<f[\s>]/.test(xml) && ((/\bt="s"/.test(xml) && /<v>[^<]+<\/v>/.test(xml)) || (/\bt="inlineStr"/.test(xml) && /<t[^>]*>[^<]*\S/.test(xml)));

/** What a plain cell holds (shared-string index, inline text or number); undefined for empty cells and formulas. */
const valueKey = (xml: string | undefined): string | undefined => {
  if (!xml || /<f[\s>]/.test(xml)) return undefined;
  if (/\bt="inlineStr"/.test(xml)) {
    const text = [...xml.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((m) => m[1]).join('').trim();
    return text ? `i:${text}` : undefined;
  }
  const v = /<v>([^<]+)<\/v>/.exec(xml)?.[1];
  return v === undefined ? undefined : `${/\bt="s"/.test(xml) ? 's' : 'n'}:${v}`;
};

function cellXml(ref: string, value: CellValue, style: string | undefined): string {
  const s = style ? ` s="${style}"` : '';
  if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"${s}><v>${value}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escape(String(value))}</t></is></c>`;
}

/** Moves every reference at or below `fromRow` down by `delta` in a formula or range string. */
function shiftRefs(text: string, fromRow: number, delta: number, tableEnd: number): string {
  return text.replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(])/g, (all, d1: string, col: string, d2: string, row: string, offset: number, src: string) => {
    const n = Number(row);
    // A range that ends on the last template item row grows with the inserted rows (e.g. SUM(F8:F12)).
    const endsRange = src[offset - 1] === ':' && n === tableEnd;
    if (n >= fromRow || endsRange) return `${d1}${col}${d2}${n + delta}`;
    return all;
  });
}

/**
 * Writes the plan into the template and returns new .xlsx bytes. When there
 * are more items than the template's empty item rows, the rows below the
 * table (totals, signatures) move down and their formulas follow.
 */
export function fillTemplate(t: ParsedTemplate, plan: FillPlan): Uint8Array {
  const files = { ...t.files };
  let sheet = strFromU8(files[t.sheetPath]!);
  const dataMatch = /<sheetData\b[^>]*?(?:\/>|>([\s\S]*?)<\/sheetData>)/.exec(sheet);
  if (!dataMatch) throw new Error('Worksheet has no data section');
  const rows = parseRows(dataMatch[1] ?? '');
  const byNum = new Map(rows.map((r) => [r.num, r]));
  const getRow = (num: number, like?: RowXml): RowXml => {
    let r = byNum.get(num);
    if (!r) {
      r = { num, attrs: like ? like.attrs : ` r="${num}"`, cells: new Map() };
      rows.push(r);
      byNum.set(num, r);
    }
    return r;
  };
  const put = (ref: string, value: CellValue, styleFrom?: string) => {
    const { col, row } = splitRef(ref);
    const r = getRow(row);
    const idx = columnIndex(col);
    const existing = r.cells.get(idx);
    if (hasFormula(existing)) return; // never overwrite the company's own formulas
    r.cells.set(idx, cellXml(`${col}${row}`, value, styleOf(existing) ?? styleFrom));
  };

  let shift = 0;
  let tableEnd = Number.POSITIVE_INFINITY;
  if (plan.table && plan.table.rows.length > 0) {
    const { firstRow } = plan.table;
    const cols = new Set(plan.table.rows.flatMap((r) => Object.keys(r)).map(columnIndex));
    // Template item rows: from firstRow down to the first row that already holds something new:
    // anything in the table's own columns, or text anywhere in the row (a next-section heading
    // like "숙박비" in A31 while receipts go in B). Numbers and formulas in other columns, such as
    // pre-printed line numbers or a per-row =D8*E8, are part of the empty item rows, and so is a
    // value repeated from the first item row or the row above (a pre-filled "USD" on every line).
    const model = byNum.get(firstRow);
    let end = firstRow;
    while (true) {
      const r = byNum.get(end + 1);
      const above = byNum.get(end);
      const repeated = (c: number, xml: string) => {
        const key = valueKey(xml);
        return key !== undefined && (key === valueKey(model?.cells.get(c)) || key === valueKey(above?.cells.get(c)));
      };
      const occupied = r && [...r.cells.entries()].some(([c, xml]) =>
        !repeated(c, xml) && (cols.has(c) ? /<v>[^<]+<\/v>|<t[\s>]|<f[\s>]/.test(xml) : isText(xml)));
      const blankBeyond = !r && ![...byNum.keys()].some((n) => n > end + 1);
      if (occupied || blankBeyond || end - firstRow > 500) break;
      end += 1;
    }
    tableEnd = end;
    const capacity = end - firstRow + 1;
    shift = Math.max(plan.table.rows.length - capacity, 0);
    if (shift > 0) {
      for (const r of rows) {
        if (r.num > end) {
          byNum.delete(r.num);
          r.num += shift;
          for (const [c, xml] of r.cells) {
            r.cells.set(
              c,
              xml
                .replace(/\br="([A-Z]+)\d+"/, `r="$1${r.num}"`)
                .replace(/<f>([\s\S]*?)<\/f>/, (_, f: string) => `<f>${shiftRefs(f, end + 1, shift, end)}</f>`),
            );
          }
        }
      }
      for (const r of rows) byNum.set(r.num, r);
      sheet = sheet.replace(/<mergeCell ref="([^"]+)"\/>/g, (_, ref: string) => `<mergeCell ref="${shiftRefs(ref, end + 1, shift, -1)}"/>`);
    }
    // Pre-filled text on the first item row (such as "USD") is copied into rows that had to be added.
    const filler = [...(model?.cells.entries() ?? [])].filter(([c, xml]) => !cols.has(c) && isText(xml));
    plan.table.rows.forEach((item, i) => {
      const rowNum = firstRow + i;
      const added = rowNum > tableEnd;
      const r = getRow(rowNum, model);
      if (added) {
        for (const [c, xml] of filler) r.cells.set(c, xml.replace(/\br="[A-Z]+\d+"/, `r="${columnLetters(c)}${rowNum}"`));
      }
      for (const [col, value] of Object.entries(item)) {
        const idx = columnIndex(col);
        const existing = r.cells.get(idx);
        if (hasFormula(existing)) continue;
        r.cells.set(idx, cellXml(`${col}${rowNum}`, value, styleOf(existing) ?? styleOf(model?.cells.get(idx))));
      }
    });
  }

  // Single cells below the table moved down with it.
  for (const [ref, value] of Object.entries(plan.cells)) {
    const { col, row } = splitRef(ref);
    put(`${col}${row > tableEnd ? row + shift : row}`, value);
  }

  rows.sort((a, b) => a.num - b.num);
  const sheetData = `<sheetData>${rows.map(rowXml).join('')}</sheetData>`;
  sheet = sheet.replace(/<sheetData\b[^>]*?(?:\/>|>[\s\S]*?<\/sheetData>)/, sheetData);
  const lastRow = rows.at(-1)?.num;
  if (lastRow) {
    sheet = sheet.replace(/<dimension ref="([A-Z]+\d+):([A-Z]+)(\d+)"\/>/, (all, start: string, col: string, row: string) =>
      Number(row) < lastRow ? `<dimension ref="${start}:${col}${lastRow}"/>` : all,
    );
  }
  files[t.sheetPath] = strToU8(sheet);

  // Formulas moved or their inputs changed: drop the calculation chain and ask Excel to recalculate on open.
  delete files['xl/calcChain.xml'];
  const ct = files['[Content_Types].xml'];
  if (ct) files['[Content_Types].xml'] = strToU8(strFromU8(ct).replace(/<Override[^>]*calcChain[^>]*\/>/g, ''));
  const rels = files['xl/_rels/workbook.xml.rels'];
  if (rels) files['xl/_rels/workbook.xml.rels'] = strToU8(strFromU8(rels).replace(/<Relationship[^>]*calcChain[^>]*\/>/g, ''));
  const wb = files['xl/workbook.xml'];
  if (wb) {
    let xml = strFromU8(wb);
    if (/<calcPr\b/.test(xml)) {
      if (!/fullCalcOnLoad=/.test(xml)) xml = xml.replace(/<calcPr\b/, '<calcPr fullCalcOnLoad="1"');
    } else {
      xml = xml.replace(/<\/workbook>/, '<calcPr fullCalcOnLoad="1"/></workbook>');
    }
    files['xl/workbook.xml'] = strToU8(xml);
  }
  return zipSync(files, { level: 6 });
}
