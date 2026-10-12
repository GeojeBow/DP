/// <reference types="node" />
import { readFileSync } from 'fs';
import { join } from 'path';

import type { CustomField } from '../../../domain/customFields';
import type { CompanyTemplate } from '../mapping';
import { packTemplate, unpackTemplate } from '../share';

const bytes = new Uint8Array(readFileSync(join(__dirname, 'fixtures/company-template.xlsx')));
const project: CustomField = { id: 'p1', name: '프로젝트 코드', type: 'text', options: [], required: false };
const other: CustomField = { id: 'o1', name: '참석자', type: 'text', options: [], required: false };
const template: CompanyTemplate = {
  id: 't1',
  name: '우리 회사',
  fileName: 'form.xlsx',
  values: { traveler: '해리', department: '영업' },
  mapping: { fields: { traveler: 'B3', total: 'F20' }, table: { firstRow: 8, columns: { date: 'A', amountBase: 'F' }, custom: { p1: 'G' } } },
};

let n = 0;
const newId = () => `new${++n}`;

describe('sharing a template', () => {
  beforeEach(() => {
    n = 0;
  });

  it('gives the friend the same file and places, without personal values', () => {
    const text = packTemplate(template, bytes, [project, other]);
    const got = unpackTemplate(text, [], newId);
    expect(got.bytes).toEqual(bytes);
    expect(got.template.values).toEqual({});
    expect(got.template.mapping.fields).toEqual(template.mapping.fields);
    expect(got.template.mapping.table?.columns).toEqual(template.mapping.table?.columns);
    // The company-only box comes along under a new id and keeps its column.
    expect(got.newFields.map((f) => f.name)).toEqual(['프로젝트 코드']);
    expect(got.template.mapping.table?.custom).toEqual({ [got.newFields[0]!.id]: 'G' });
    expect(text).not.toContain('해리');
  });

  it('reuses a company-only box the friend already has', () => {
    const mine: CustomField = { ...project, id: 'mine', name: ' 프로젝트 코드 ' };
    const got = unpackTemplate(packTemplate(template, bytes, [project]), [mine], newId);
    expect(got.newFields).toEqual([]);
    expect(got.template.mapping.table?.custom).toEqual({ mine: 'G' });
  });

  it('refuses other files', () => {
    expect(() => unpackTemplate('hello', [], newId)).toThrow();
    expect(() => unpackTemplate('{"app":"x"}', [], newId)).toThrow();
    const broken = JSON.parse(packTemplate(template, bytes, [])) as Record<string, unknown>;
    expect(() => unpackTemplate(JSON.stringify({ ...broken, file: 'AAAA' }), [], newId)).toThrow();
  });
});

describe('sharing "not needed" choices', () => {
  it('keeps them, with company-only boxes renamed to the receiver ids', () => {
    const withSkip: CompanyTemplate = { ...template, mapping: { ...template.mapping, skip: ['f:department', 'x:o1'] } };
    const mine: CustomField = { ...other, id: 'mine-o' };
    const got = unpackTemplate(packTemplate(withSkip, bytes, [project, other]), [mine], () => 'new');
    // o1 is skipped, not placed, so it is not packed; its skip entry is dropped rather than left dangling.
    expect(got.template.mapping.skip).toEqual(['f:department']);
  });
});
