import { checkCustomValue, customCell, type CustomField, parseOptions } from '../customFields';

const field = (over: Partial<CustomField>): CustomField => ({ id: 'f', name: 'Project', type: 'text', options: [], required: false, ...over });

describe('custom fields', () => {
  it('requires a value only when the field is required', () => {
    expect(checkCustomValue(field({}), '')).toBeNull();
    expect(checkCustomValue(field({ required: true }), '  ')).toBe('required');
  });
  it('checks numbers and choices', () => {
    expect(checkCustomValue(field({ type: 'number' }), '1,200')).toBeNull();
    expect(checkCustomValue(field({ type: 'number' }), 'abc')).toBe('number');
    expect(checkCustomValue(field({ type: 'choice', options: ['A', 'B'] }), 'C')).toBe('choice');
  });
  it('parses options and report cells', () => {
    expect(parseOptions('a, b ,, a\nc')).toEqual(['a', 'b', 'c']);
    expect(customCell(field({ type: 'number' }), '1,200')).toEqual({ text: '1,200', number: 1200 });
  });
});
