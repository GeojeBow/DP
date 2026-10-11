/// <reference types="node" />
import { readFileSync } from 'fs';
import { join } from 'path';

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

import type { Expense, Trip } from '../../../domain/models';
import { guessMapping, planFill } from '../mapping';
import { fillTemplate, readTemplate } from '../xlsxTemplate';

const fixture = () => new Uint8Array(readFileSync(join(__dirname, 'fixtures/company-template.xlsx')));

const trip: Trip = {
  id: 't1',
  title: '도쿄 파트너 미팅',
  startDate: '2026-10-05',
  endDate: '2026-10-09',
  baseCurrency: 'KRW',
  budget: { kind: 'none' },
  createdAt: '2026-10-01T00:00:00Z',
};

const expense = (n: number): Expense => ({
  id: `e${n}`,
  tripId: 't1',
  localDate: `2026-10-0${5 + (n % 5)}`,
  merchantName: `Shop ${n}`,
  category: 'meals',
  paymentMethod: 'corporate_card',
  currency: 'JPY',
  total: '1000',
  fxRate: '9.1',
  baseCurrency: 'KRW',
  totalBase: String(9100 + n),
  receiptId: null,
  memo: '',
  createdAt: `2026-10-05T00:00:0${n}Z`,
  updatedAt: '2026-10-05T00:00:00Z',
});

const labels = { category: () => '식비', payment: () => '법인카드', today: '2026-10-11' };
const sheetXml = (bytes: Uint8Array) => strFromU8(unzipSync(bytes)['xl/worksheets/sheet1.xml']!);

describe('company Excel templates', () => {
  it('reads labels and guesses where values go', () => {
    const t = readTemplate(fixture());
    expect(t.sheetName).toBe('출장비 정산서');
    expect(t.cells.find((c) => c.ref === 'A3')?.text).toBe('성명');
    const m = guessMapping(t);
    expect(m.table).toEqual({
      firstRow: 8,
      columns: { no: 'A', date: 'B', merchant: 'C', category: 'D', currency: 'E', amountBase: 'F' },
    });
    expect(m.fields).toMatchObject({ traveler: 'B3', title: 'B4', period: 'B5', total: 'F13' });
    // E3 already says "영업1팀", so the department is left alone.
    expect(m.fields.department).toBeUndefined();
  });

  it('fills the rows it has, keeping cell styles and the SUM formula', () => {
    const t = readTemplate(fixture());
    const plan = planFill(trip, [expense(1), expense(2)], { mapping: guessMapping(t), values: { traveler: '해리' } }, labels);
    const xml = sheetXml(fillTemplate(t, plan));
    expect(xml).toContain('<c r="B3" t="inlineStr"><is><t xml:space="preserve">해리</t></is></c>');
    expect(xml).toContain('<c r="F8" s="5"><v>9101</v></c>');
    expect(xml).toContain('<c r="C9" s="4" t="inlineStr"><is><t xml:space="preserve">Shop 2</t></is></c>');
    expect(xml).toContain('<f>SUM(F8:F12)</f>');
  });

  it('pushes the totals row down and stretches its formula when items overflow', () => {
    const t = readTemplate(fixture());
    const items = [1, 2, 3, 4, 5, 6, 7, 8].map(expense);
    const plan = planFill(trip, items, { mapping: guessMapping(t), values: {} }, labels);
    const xml = sheetXml(fillTemplate(t, plan));
    expect(xml).toContain('<c r="F15" s="5"><v>9104</v></c>');
    expect(xml).toContain('<c r="E16" s="6" t="inlineStr">');
    expect(xml).toContain('<f>SUM(F8:F15)</f>');
    expect(xml).toContain('<row r="18">');
    expect(xml).toContain('<dimension ref="A1:F18"/>');
  });

  it('reads shared strings', () => {
    const files = unzipSync(fixture());
    files['xl/sharedStrings.xml'] = strToU8('<sst><si><t>Name</t></si><si><r><t>Tot</t></r><r><t>al</t></r></si></sst>');
    files['xl/worksheets/sheet1.xml'] = strToU8(
      '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row></sheetData></worksheet>',
    );
    const t = readTemplate(zipSync(files));
    expect(t.cells).toEqual([
      { ref: 'A1', text: 'Name' },
      { ref: 'C1', text: 'Total' },
    ]);
  });

  it('rejects files that are not xlsx', () => {
    expect(() => readTemplate(new Uint8Array([1, 2, 3]))).toThrow('Not an .xlsx file');
  });
});
