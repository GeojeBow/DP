import type { ReportTable } from '../../../domain/report';
import { reportToHtml } from '../html';

const table: ReportTable = {
  title: 'Tokyo', period: '2026-10-01 ~ 2026-10-02', baseCurrency: 'KRW',
  headers: ['No.', 'Merchant', 'KRW', 'Receipt'], totalColumn: 2,
  summary: { byCategory: [], byDay: [] },
  sections: [{
    title: null,
    rows: [[{ text: '#01' }, { text: 'Ichiran' }, { text: 'KRW 29,120', number: 29120 }, { text: 'Attached #01' }],
      [{ text: '#02' }, { text: 'Taxi' }, { text: 'KRW 21,840', number: 21840 }, { text: 'No receipt' }]],
    subtotal: '',
  }],
  total: 'KRW 50,960', totalNumber: 50960,
  attachments: [
    { tags: ['#01'], date: '2026-10-01', merchant: 'Ichiran', amount: 'JPY 3,200', category: 'Meals', receiptId: 'r1', missing: null, note: '' },
    { tags: ['#02'], date: '2026-10-01', merchant: 'Taxi', amount: 'JPY 2,400', category: 'Transport', receiptId: null, missing: 'none', note: 'no slip' },
  ],
  claim: [], affidavits: [],
};
const labels = {
  subtotal: 'Subtotal', total: 'Total', receipts: 'Receipts', generated: 'gen',
  receiptsHint: (p: number, m: number) => `${p} photos, ${m} missing`,
  noPhoto: { none: 'NO RECEIPT', affidavit: 'LOST', mileage: 'CAR', failed: 'FAILED' },
  affidavit: { title: '', date: '', merchant: '', amount: '', reason: '', statement: '', signer: '', signedAt: '' },
};

describe('reportToHtml receipt pages', () => {
  it('gives every line a tagged page, saying why when there is no photo', () => {
    const html = reportToHtml(table, { r1: 'data:image/png;base64,AA' }, labels);
    expect(html).toContain('1 photos, 1 missing');
    expect(html).toContain('<span class="tag off">#02</span>');
    expect(html.indexOf('<span class="tag big">#01</span>')).toBeLessThan(html.indexOf('<span class="tag big">#02</span>'));
    expect(html).toContain('NO RECEIPT');
    expect(html).toContain('no slip');
  });

  it('keeps the page when the photo cannot be loaded', () => {
    expect(reportToHtml(table, { r1: null }, labels)).toContain('FAILED');
  });
});
