import { strFromU8, unzipSync } from 'fflate';

import type { ReportTable } from '../../../domain/report';
import { reportToXlsx } from '../xlsx';

const table: ReportTable = {
  title: 'Tokyo <Q4> & co',
  period: '2026-10-01 ~ 2026-10-03',
  baseCurrency: 'KRW',
  headers: ['Date', 'Merchant', 'KRW'],
  totalColumn: 2,
  summary: { byCategory: [], byDay: [] },
  sections: [{ title: '2026-10-01', rows: [[{ text: '2026-10-01' }, { text: 'Ichiran' }, { text: 'KRW 29,184', number: 29184 }]], subtotal: 'KRW 29,184' }],
  total: 'KRW 29,184',
  totalNumber: 29184,
  attachments: [],
  claim: [],
  affidavits: [],
};

describe('reportToXlsx', () => {
  const files = unzipSync(reportToXlsx(table, { subtotal: 'Subtotal', total: 'Total' }));

  it('contains the parts Excel needs', () => {
    expect(Object.keys(files).sort()).toEqual([
      '[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml',
    ]);
  });

  it('escapes text and writes amounts as numbers', () => {
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']!);
    expect(sheet).toContain('Tokyo &lt;Q4&gt; &amp; co');
    expect(sheet).toContain('<c r="C6" s="2"><v>29184</v></c>');
    expect(sheet).toContain('<v>29184</v></c></row></sheetData>');
  });
});

describe('reportToXlsx summary sheet', () => {
  const withSummary: ReportTable = {
    ...table,
    summary: {
      byCategory: [{ label: "Meals 'n co", text: 'KRW 29,184', number: 29184, share: 100 }],
      byDay: [{ date: '2026-10-01', text: 'KRW 29,184', number: 29184 }],
    },
  };
  const files = unzipSync(
    reportToXlsx(withSummary, { subtotal: 'S', total: 'T', summary: 'Summary', byCategory: 'By category', byDay: 'By day', share: '%', amount: 'Amount' }),
  );

  it('adds a sheet with two charts wired to its cells', () => {
    expect(strFromU8(files['xl/workbook.xml']!)).toContain('<sheet name="Summary" sheetId="2" r:id="rId3"/>');
    expect(strFromU8(files['[Content_Types].xml']!)).toContain('/xl/charts/chart2.xml');
    const chart = strFromU8(files['xl/charts/chart1.xml']!);
    expect(chart).toContain("<c:f>&apos;Summary&apos;!$B$4:$B$4</c:f>".replace(/&apos;/g, "'"));
    expect(chart).toContain('Meals &apos;n co'.replace('&apos;', "'"));
    expect(strFromU8(files['xl/worksheets/sheet2.xml']!)).toContain('<drawing r:id="rId1"/>');
  });

  it('leaves the summary out when there is nothing to chart', () => {
    expect(Object.keys(unzipSync(reportToXlsx(table, { subtotal: 'S', total: 'T', summary: 'Summary', byCategory: 'C', byDay: 'D' })))).not.toContain(
      'xl/worksheets/sheet2.xml',
    );
  });
});
