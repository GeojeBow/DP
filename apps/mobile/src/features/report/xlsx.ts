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

export interface XlsxLabels {
  subtotal: string;
  total: string;
  /** Summary sheet with charts; left out when absent */
  summary?: string;
  byCategory?: string;
  byDay?: string;
  share?: string;
  amount?: string;
}

export function reportToXlsx(table: ReportTable, labels: XlsxLabels): Uint8Array {
  const rows: string[] = [];
  const width = Math.max(table.headers.length, 2);
  const lastCol = Math.max(1, Math.min(table.totalColumn, table.headers.length - 1));
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
  if (table.claim.length > 1) {
    addRow([], S.plain);
    for (const line of table.claim) {
      const cells: ReportCell[] = table.headers.map(() => ({ text: '' }));
      cells[0] = { text: line.label };
      cells[lastCol] = { text: line.text, number: line.number };
      addRow(cells, line.strong ? S.bold : S.plain);
    }
  }

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

  const summary = summarySheet(table, labels);
  const files: Record<string, Uint8Array> = {
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/>${summary ? `<sheet name="${esc(summary.name)}" sheetId="2" r:id="rId3"/>` : ''}</sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${summary ? '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' : ''}</Relationships>`),
    'xl/styles.xml': strToU8(styles),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
    ...(summary?.files ?? {}),
  };
  const overrides = [
    ['/xl/workbook.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'],
    ['/xl/worksheets/sheet1.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'],
    ['/xl/styles.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml'],
    ...(summary
      ? [
          ['/xl/worksheets/sheet2.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'],
          ['/xl/drawings/drawing1.xml', 'application/vnd.openxmlformats-officedocument.drawing+xml'],
          ['/xl/charts/chart1.xml', 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml'],
          ['/xl/charts/chart2.xml', 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml'],
        ]
      : []),
  ];
  files['[Content_Types].xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides.map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`).join('')}</Types>`);
  return zipSync(files);
}

const NS = {
  c: 'http://schemas.openxmlformats.org/drawingml/2006/chart',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  xdr: 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing',
};

/** A one-series bar chart over cells of the summary sheet, with cached values for viewers that don't recalculate. */
function chartXml(title: string, sheet: string, firstRow: number, items: Array<{ label: string; value: number }>, horizontal: boolean, color: string): string {
  const last = firstRow + items.length - 1;
  const ref = (col: string) => `'${sheet.replace(/'/g, "''")}'!$${col}$${firstRow}:$${col}$${last}`;
  const strCache = `<c:strCache><c:ptCount val="${items.length}"/>${items.map((x, i) => `<c:pt idx="${i}"><c:v>${esc(x.label)}</c:v></c:pt>`).join('')}</c:strCache>`;
  const numCache = `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${items.length}"/>${items.map((x, i) => `<c:pt idx="${i}"><c:v>${x.value}</c:v></c:pt>`).join('')}</c:numCache>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${NS.c}" xmlns:a="${NS.a}" xmlns:r="${NS.r}"><c:roundedCorners val="0"/><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:p><a:pPr><a:defRPr sz="1200" b="1"/></a:pPr><a:r><a:rPr lang="en-US" sz="1200" b="1"/><a:t>${esc(title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:barChart><c:barDir val="${horizontal ? 'bar' : 'col'}"/><c:grouping val="clustered"/><c:varyColors val="0"/><c:ser><c:idx val="0"/><c:order val="0"/><c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/><c:cat><c:strRef><c:f>${esc(ref('A'))}</c:f>${strCache}</c:strRef></c:cat><c:val><c:numRef><c:f>${esc(ref('B'))}</c:f>${numCache}</c:numRef></c:val></c:ser><c:gapWidth val="60"/><c:axId val="1001"/><c:axId val="1002"/></c:barChart><c:catAx><c:axId val="1001"/><c:scaling><c:orientation val="${horizontal ? 'maxMin' : 'minMax'}"/></c:scaling><c:delete val="0"/><c:axPos val="${horizontal ? 'l' : 'b'}"/><c:numFmt formatCode="General" sourceLinked="0"/><c:tickLblPos val="nextTo"/><c:crossAx val="1002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx><c:valAx><c:axId val="1002"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${horizontal ? 't' : 'l'}"/><c:majorGridlines/><c:numFmt formatCode="#,##0" sourceLinked="0"/><c:tickLblPos val="nextTo"/><c:crossAx val="1001"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx></c:plotArea><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`;
}

const anchor = (id: number, col: number, row: number, toCol: number, toRow: number) =>
  `<xdr:twoCellAnchor><xdr:from><xdr:col>${col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${toCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${id + 1}" name="Chart ${id}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${NS.c}"><c:chart r:id="rId${id}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;

/** Second sheet: category and daily totals as tables, each with a chart beside it. */
function summarySheet(table: ReportTable, labels: XlsxLabels): { name: string; files: Record<string, Uint8Array> } | null {
  const { byCategory, byDay } = table.summary;
  if (!labels.summary || !labels.byCategory || !labels.byDay || byCategory.length === 0) return null;
  const name = labels.summary.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Summary';
  const rows: string[] = [];
  const add = (r: number, cells: ReportCell[], style: number) =>
    rows.push(`<row r="${r}">${cells.map((c, i) => cellXml(`${colName(i)}${r}`, c, style)).join('')}</row>`);

  add(1, [{ text: `${table.title} · ${labels.summary}` }], S.title);
  add(3, [{ text: labels.byCategory }, { text: labels.amount ?? '' }, { text: labels.share ?? '' }], S.header);
  const catFirst = 4;
  byCategory.forEach((c, i) => add(catFirst + i, [{ text: c.label }, { text: c.text, number: c.number }, { text: `${c.share}%` }], S.plain));
  const catLast = catFirst + byCategory.length - 1;
  add(catLast + 1, [{ text: labels.total }, { text: table.total, number: table.totalNumber }], S.bold);

  const dayHeader = catLast + 4;
  add(dayHeader, [{ text: labels.byDay }, { text: labels.amount ?? '' }], S.header);
  const dayFirst = dayHeader + 1;
  byDay.forEach((d, i) => add(dayFirst + i, [{ text: d.date }, { text: d.text, number: d.number }], S.plain));

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${NS.r}"><cols><col min="1" max="1" width="18" customWidth="1"/><col min="2" max="2" width="16" customWidth="1"/><col min="3" max="3" width="9" customWidth="1"/></cols><sheetData>${rows.join('')}</sheetData><drawing r:id="rId1"/></worksheet>`;
  const catHeight = Math.max(byCategory.length + 2, 12);
  // The daily chart sits under the category chart, never on top of it.
  const dayTop = Math.max(dayHeader - 1, 2 + catHeight + 1);
  const drawing = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="${NS.xdr}" xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:c="${NS.c}">${anchor(1, 4, 2, 12, 2 + catHeight)}${anchor(2, 4, dayTop, 12, dayTop + 14)}</xdr:wsDr>`;
  const rel = (targets: string[], type: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${targets.map((t, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${t}"/>`).join('')}</Relationships>`;
  return {
    name,
    files: {
      'xl/worksheets/sheet2.xml': strToU8(sheet),
      'xl/worksheets/_rels/sheet2.xml.rels': strToU8(rel(['../drawings/drawing1.xml'], 'drawing')),
      'xl/drawings/drawing1.xml': strToU8(drawing),
      'xl/drawings/_rels/drawing1.xml.rels': strToU8(rel(['../charts/chart1.xml', '../charts/chart2.xml'], 'chart')),
      'xl/charts/chart1.xml': strToU8(chartXml(labels.byCategory, name, catFirst, byCategory.map((c) => ({ label: c.label, value: c.number })), true, '3E7CB1')),
      'xl/charts/chart2.xml': strToU8(chartXml(labels.byDay, name, dayFirst, byDay.map((d) => ({ label: d.date, value: d.number })), false, 'F2A65A')),
    },
  };
}
