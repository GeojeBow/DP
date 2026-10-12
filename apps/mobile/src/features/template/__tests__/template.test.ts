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
    // Only the converted amount has a column, so the currency beside it is the trip's.
    expect(xml).toMatch(/<c r="E8"[^>]*><is><t xml:space="preserve">KRW<\/t>/);
  });

  it('puts the trip-currency amount in a lone amount column', () => {
    const t = readTemplate(fixture());
    const m = guessMapping(t);
    const mapping = { ...m, table: { ...m.table!, columns: { date: 'B', amount: 'F' } } };
    const plan = planFill(trip, [expense(1)], { mapping, values: {} }, labels);
    expect(plan.table?.rows[0]).toMatchObject({ F: 9101 });
    const both = { ...m, table: { ...m.table!, columns: { currency: 'D', amount: 'E', amountBase: 'F' } } };
    expect(planFill(trip, [expense(1)], { mapping: both, values: {} }, labels).table?.rows[0]).toMatchObject({ D: 'JPY', E: 1000, F: 9101 });
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

  it('treats a heading in any column as the end of the item rows', () => {
    const files = unzipSync(fixture());
    files['xl/worksheets/sheet1.xml'] = strToU8(
      '<worksheet><dimension ref="A1:C4"/><sheetData>'
      + '<row r="1"><c r="B1" t="inlineStr"><is><t>내역</t></is></c></row>'
      + '<row r="2"><c r="A2"><v>1</v></c><c r="C2"><f>B2*2</f></c></row>'
      + '<row r="3"><c r="A3"><v>2</v></c><c r="C3"><f>B3*2</f></c></row>'
      + '<row r="4"><c r="A4" t="inlineStr"><is><t>숙박비</t></is></c></row>'
      + '</sheetData></worksheet>',
    );
    const t = readTemplate(zipSync(files));
    const xml = sheetXml(fillTemplate(t, { cells: {}, table: { firstRow: 2, rows: [{ B: 'a' }, { B: 'b' }, { B: 'c' }] } }));
    // Pre-printed numbers and per-row formulas don't stop the table; the heading moves down instead of being overwritten.
    expect(xml).toContain('<c r="B4" t="inlineStr"><is><t xml:space="preserve">c</t></is></c>');
    expect(xml).toContain('<c r="A5" t="inlineStr"><is><t>숙박비</t></is></c>');
  });

  it('keeps going past a pre-filled currency on every item row', () => {
    const files = unzipSync(fixture());
    const usd = (r: number) => `<c r="C${r}" t="inlineStr"><is><t>USD</t></is></c>`;
    files['xl/worksheets/sheet1.xml'] = strToU8(
      '<worksheet><dimension ref="A1:C5"/><sheetData>'
      + '<row r="1"><c r="B1" t="inlineStr"><is><t>내역</t></is></c></row>'
      + `<row r="2">${usd(2)}</row><row r="3">${usd(3)}</row><row r="4">${usd(4)}</row>`
      + '<row r="5"><c r="A5" t="inlineStr"><is><t>숙박비</t></is></c><c r="C5" t="inlineStr"><is><t>USD</t></is></c></row>'
      + '</sheetData></worksheet>',
    );
    const t = readTemplate(zipSync(files));
    const xml = sheetXml(fillTemplate(t, { cells: {}, table: { firstRow: 2, rows: [{ B: 'a' }, { B: 'b' }, { B: 'c' }, { B: 'd' }] } }));
    // The three USD rows are item rows; only the fourth receipt needs a new row, which gets USD too.
    expect(xml).toContain('<c r="B4" t="inlineStr"><is><t xml:space="preserve">c</t></is></c>');
    expect(xml).toContain('<row r="5"><c r="B5" t="inlineStr"><is><t xml:space="preserve">d</t></is></c><c r="C5" t="inlineStr"><is><t>USD</t></is></c></row>');
    expect(xml).toContain('<c r="A6" t="inlineStr"><is><t>숙박비</t></is></c>');
  });

  it('stops at a total row that only has a SUM formula', () => {
    const files = unzipSync(fixture());
    files['xl/worksheets/sheet1.xml'] = strToU8(
      '<worksheet><dimension ref="A1:D5"/><sheetData>'
      + '<row r="1"><c r="B1" t="inlineStr"><is><t>Amount</t></is></c></row>'
      + '<row r="2"><c r="D2"><f t="shared" ref="D2:D3" si="0">B2*2</f></c></row>'
      + '<row r="3"><c r="D3"><f t="shared" si="0"/></c></row>'
      + '<row r="4"><c r="D4"><f>SUM(D2:D3)</f></c></row>'
      + '</sheetData></worksheet>',
    );
    const t = readTemplate(zipSync(files));
    const xml = sheetXml(fillTemplate(t, { cells: {}, table: { firstRow: 2, rows: [{ B: 1 }, { B: 2 }, { B: 3 }] } }));
    // The per-row =B2*2 rows hold receipts; the total row moves down instead of taking the third one.
    expect(xml).toContain('<c r="B4"><v>3</v></c><c r="D4"><f>B4*2</f></c>');
    expect(xml).toContain('<c r="D5"><f>SUM(D2:D4)</f></c>');
  });

  it('fills added rows like the last item row: line numbers, pre-filled rate and formulas', () => {
    const files = unzipSync(fixture());
    const item = (r: number) =>
      `<row r="${r}"><c r="A${r}" s="1"><v>${r - 1}</v></c><c r="B${r}" s="2"/><c r="C${r}" s="3"><v>1</v></c>`
      + `<c r="D${r}" s="4"><f>$B${r}/$C${r}</f><v>0</v></c></row>`;
    files['xl/worksheets/sheet1.xml'] = strToU8(
      '<worksheet><dimension ref="A1:D4"/><sheetData>'
      + '<row r="1"><c r="B1" t="inlineStr"><is><t>Amount</t></is></c></row>'
      + item(2) + item(3)
      + '<row r="4"><c r="D4"><f>SUM(D2:D3)</f></c></row>'
      + '</sheetData></worksheet>',
    );
    const t = readTemplate(zipSync(files));
    const xml = sheetXml(fillTemplate(t, { cells: {}, table: { firstRow: 2, rows: [{ B: 10 }, { B: 20 }, { B: 30 }, { B: 40 }] } }));
    expect(xml).toContain('<row r="4"><c r="A4" s="1"><v>3</v></c><c r="B4" s="2"><v>30</v></c><c r="C4" s="3"><v>1</v></c><c r="D4" s="4"><f>$B4/$C4</f></c></row>');
    expect(xml).toContain('<c r="A5" s="1"><v>4</v></c>');
    expect(xml).toContain('<c r="D6"><f>SUM(D2:D5)</f></c>');
  });

  it('keeps shared formulas valid and carries per-row formulas into added rows', () => {
    const files = unzipSync(fixture());
    files['xl/worksheets/sheet1.xml'] = strToU8(
      '<worksheet><dimension ref="A1:C6"/><sheetData>'
      + '<row r="1"><c r="A1" t="inlineStr"><is><t>Amount</t></is></c><c r="B1"><f>C6</f></c></row>'
      + '<row r="2"><c r="A2" s="3"/><c r="C2" s="4"><f t="shared" ref="C2" si="0">$A2*2</f><v>0</v></c></row>'
      + '<row r="3"><c r="A3" t="inlineStr"><is><t>TOTAL</t></is></c><c r="C3"><f>SUM(C2:C2)</f></c></row>'
      + '<row r="4"><c r="A4"/><c r="C4"><f t="shared" ref="C4:C5" si="1">$A4*3</f><v>0</v></c></row>'
      + '<row r="5"><c r="A5"/><c r="C5"><f t="shared" si="1"/><v>0</v></c></row>'
      + '<row r="6"><c r="C6"><f>SUM(C4:C5)</f></c></row>'
      + '</sheetData></worksheet>',
    );
    const t = readTemplate(zipSync(files));
    const xml = sheetXml(fillTemplate(t, { cells: {}, table: { firstRow: 2, rows: [{ A: 1 }, { A: 2 }, { A: 3 }] } }));
    expect(xml).not.toContain('t="shared"');
    // The added rows get the first item row's style and formula, moved to their own row.
    expect(xml).toContain('<c r="C4" s="4"><f>$A4*2</f></c>');
    expect(xml).toContain('<f>SUM(C2:C4)</f>');
    // The section below moved two rows; its formulas, and the summary at the top, follow it.
    expect(xml).toContain('<c r="C7"><f>$A7*3</f></c>');
    expect(xml).toContain('<f>SUM(C6:C7)</f>');
    expect(xml).toContain('<c r="B1"><f>C8</f></c>');
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
