import { strFromU8, unzipSync } from 'fflate';

import type { ReportTable } from '../../../domain/report';
import { imageSize, reportToDocx } from '../docx';

// 1x1 PNG
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const table: ReportTable = {
  title: 'Tokyo & co', period: '2026-10-01 ~ 2026-10-02', baseCurrency: 'KRW',
  headers: ['No.', 'Merchant', 'KRW', 'Receipt'], totalColumn: 2,
  summary: { byCategory: [], byDay: [] },
  sections: [{ title: null, rows: [[{ text: '#01' }, { text: 'Ichiran' }, { text: 'KRW 29,120', number: 29120 }, { text: 'Attached #01' }],
    [{ text: '#02' }, { text: 'Taxi' }, { text: 'KRW 21,840', number: 21840 }, { text: 'No receipt' }]], subtotal: '' }],
  total: 'KRW 50,960', totalNumber: 50960,
  attachments: [
    { tags: ['#01'], date: '2026-10-01', merchant: 'Ichiran', amount: 'JPY 3,200', amountBase: 'KRW 29,120', amountLocal: 'JPY 3,200', baseMinor: 29120n, payment: 'Card', category: 'Meals', receiptId: 'r1', missing: null, note: '', details: [] },
    { tags: ['#02'], date: '2026-10-01', merchant: 'Taxi', amount: 'JPY 2,400', amountBase: 'KRW 21,840', amountLocal: 'JPY 2,400', baseMinor: 21840n, payment: 'Cash', category: 'Transport', receiptId: null, missing: 'none', note: '', details: [{ label: 'Memo', value: 'airport' }] },
  ],
  claim: [], affidavits: [],
};
const labels = {
  subtotal: 'Subtotal', total: 'Total', receipts: 'Receipts', generated: 'gen',
  receiptsHint: (p: number, m: number) => `${p} photos, ${m} missing`,
  noPhoto: { none: 'NO RECEIPT', affidavit: 'LOST', mileage: 'CAR', failed: 'FAILED' },
  affidavit: { title: '', date: '', merchant: '', amount: '', reason: '', statement: '', signer: '', signedAt: '' },
};

describe('reportToDocx', () => {
  const files = unzipSync(reportToDocx(table, { r1: `data:image/png;base64,${PNG}` }, labels));
  const doc = strFromU8(files['word/document.xml']!);

  it('writes a Word package with the receipt photo embedded', () => {
    expect(Object.keys(files).sort()).toEqual([
      '[Content_Types].xml', '_rels/.rels', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/media/receipt1.png',
    ]);
    expect(strFromU8(files['word/_rels/document.xml.rels']!)).toContain('Target="media/receipt1.png"');
  });

  it('keeps tags, escapes text and describes lines without a photo', () => {
    expect(doc).toContain('Tokyo &amp; co');
    expect(doc).toContain('#02');
    expect(doc).toContain('NO RECEIPT');
    expect(doc).toContain('airport');
    expect(doc).toContain('<w:tblGrid>');
  });

  it('reads picture sizes from PNG and JPEG headers', () => {
    expect(imageSize(Uint8Array.from(atob(PNG), (c) => c.charCodeAt(0)))).toEqual({ width: 1, height: 1 });
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x40, 0x00, 0xf0, 0x03]);
    expect(imageSize(jpeg)).toEqual({ width: 240, height: 320 });
  });
});
