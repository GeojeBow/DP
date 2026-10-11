import { strFromU8, unzipSync } from 'fflate';

import type { ReportTable } from '../../../domain/report';
import { reportToXlsx } from '../xlsx';

const table: ReportTable = {
  title: 'Tokyo <Q4> & co',
  period: '2026-10-01 ~ 2026-10-03',
  baseCurrency: 'KRW',
  headers: ['Date', 'Merchant', 'KRW'],
  totalColumn: 2,
  sections: [{ title: '2026-10-01', rows: [[{ text: '2026-10-01' }, { text: 'Ichiran' }, { text: 'KRW 29,184', number: 29184 }]], subtotal: 'KRW 29,184' }],
  total: 'KRW 29,184',
  totalNumber: 29184,
  receipts: [],
  summary: [],
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
