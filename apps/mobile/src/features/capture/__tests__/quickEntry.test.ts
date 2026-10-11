import { parseQuickEntry } from '../quickEntry';

describe('parseQuickEntry', () => {
  it('reads Korean amounts and units', () => {
    expect(parseQuickEntry('택시 12,000원')).toEqual({ merchantName: '택시', total: '12000', currency: 'KRW', category: 'ground_transport' });
    expect(parseQuickEntry('점심 김밥천국 1.2만')).toEqual({ merchantName: '점심 김밥천국', total: '12000', category: 'meals' });
  });

  it('reads symbols and currency words', () => {
    expect(parseQuickEntry('Starbucks coffee $6.75')).toEqual({ merchantName: 'Starbucks coffee', total: '6.75', currency: 'USD', category: 'meals' });
    expect(parseQuickEntry('ホテル 12000 円')).toEqual({ merchantName: 'ホテル', total: '12000', currency: 'JPY', category: 'lodging' });
  });

  it('does not match words inside other words', () => {
    expect(parseQuickEntry('business dinner 80 USD').category).toBe('meals');
  });

  it('leaves out what it cannot tell', () => {
    expect(parseQuickEntry('뭔가 샀음')).toEqual({ merchantName: '뭔가 샀음' });
  });
});
