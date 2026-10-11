import { strToU8, zipSync } from 'fflate';

import type { ReportCell, ReportTable } from '../../domain/report';

/**
 * Writes a ReportTable as a single-sheet .xlsx. Hand-written OOXML zipped with
 * fflate: pure JS, so it runs the same on phones and the web.
 */

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    // Strip control characters XML 1.0 forbids.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

const colName = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : colName(Math.floor(i / 26) - 1) + colName(i % 26));

// Style ids, matching cellXfs in styles.xml below.
const S = { plain: 0, bold: 1, number: 2, boldNumber: 3, header: 4, title: 5 } as const;

function cellXml(ref: string, cell: ReportCell, style: number): string {
  if (cell.number !== undefined && Number.isFinite(cell.number)) {
    return `<c r="${ref}" s="${style === S.bold ? S.boldNumber : S.number}"><v>${cell.number}</v></c>`;
  }
  if (!cell.text) return '';
  return `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${esc(cell.text)}</t></is></c>`;
}

export function reportToXlsx(table: ReportTable, labels: { subtotal: string; total: string }): Uint8Array {
  const rows: string[] = [];
  const width = Math.max(table.headers.length, 2);
  const lastCol = table.headers.length - 1;
  const addRow = (cells: ReportCell[], style: number) => {
    const r = rows.length + 1;
    rows.push(`<row r="${r}">${cells.map((c, i) => cellXml(`${colName(i)}${r}`, c, style)).join('')}</row>`);
  };
  const totalRow = (label: string, number: number | undefined, text: string) => {
    const cells: ReportCell[] = table.headers.map(() => ({ text: '' }));
    cells[0] = { text: label };
    cells[lastCol] = number === undefined ? { text } : { text, number };
    addRow(cells, S.bold);
  };

  addRow([{ text: table.title }], S.title);
  addRow([{ text: `${table.period} · ${table.baseCurrency}` }], S.plain);
  addRow([], S.plain);
  addRow(table.headers.map((text) => ({ text })), S.header);
  for (const section of table.sections) {
    if (section.title) addRow([{ text: section.title }], S.bold);
    for (const row of section.rows) addRow(row, S.plain);
    if (section.title) totalRow(labels.subtotal, undefined, section.subtotal);
  }
  totalRow(labels.total, table.totalNumber, table.total);

  const cols = Array.from({ length: width }, (_, i) => {
    const longest = Math.max(
      table.headers[i]?.length ?? 0,
      ...table.sections.flatMap((s) => s.rows.map((r) => r[i]?.text.length ?? 0)),
    );
    return `<col min="${i + 1}" max="${i + 1}" width="${Math.min(Math.max(longest + 4, 10), 50)}" customWidth="1"/>`;
  }).join('');

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${rows.join('')}</sheetData></worksheet>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.##"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EDF4"/></patternFill></fill></fills>
<borders count="2"><border/><border><bottom style="thin"><color rgb="FF1F3A5F"/></bottom></border></borders>
<cellStyleXfs count="1"><xf/></cellStyleXfs>
<cellXfs count="6"><xf/><xf fontId="1" applyFont="1"/><xf numFmtId="164" applyNumberFormat="1"/><xf numFmtId="164" fontId="1" applyNumberFormat="1" applyFont="1"/><xf fontId="1" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1"/><xf fontId="2" applyFont="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  return zipSync({
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': strToU8(styles),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  });
}
