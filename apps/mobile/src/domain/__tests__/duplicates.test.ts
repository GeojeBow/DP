import { findDuplicate } from '../duplicates';
import type { Expense } from '../models';

const expense = (id: string, o: Partial<Expense> = {}): Expense => ({
  id,
  tripId: 't1',
  localDate: '2026-10-05',
  merchantName: 'ICHIRAN Shibuya',
  category: 'meals',
  paymentMethod: 'corporate_card',
  currency: 'JPY',
  total: '1980',
  fxRate: '9.1',
  baseCurrency: 'KRW',
  totalBase: '18018',
  receiptId: null,
  memo: '',
  createdAt: '2026-10-05T00:00:00Z',
  updatedAt: '2026-10-05T00:00:00Z',
  ...o,
});

describe('findDuplicate', () => {
  const list = [expense('a'), expense('b', { merchantName: 'Lawson', total: '540' })];

  it('matches the same amount and currency on the same day', () => {
    expect(findDuplicate(list, { localDate: '2026-10-05', currency: 'JPY', total: '1980.00', merchantName: '' })?.id).toBe('a');
  });

  it('allows a card statement posting one day later with a similar merchant', () => {
    expect(findDuplicate(list, { localDate: '2026-10-06', currency: 'JPY', total: '1980', merchantName: 'ICHIRAN TOKYO' })?.id).toBe('a');
  });

  it('keeps payments apart when merchants clearly differ', () => {
    expect(findDuplicate(list, { localDate: '2026-10-05', currency: 'JPY', total: '1980', merchantName: 'Starbucks' })).toBeNull();
  });

  it('ignores other days, currencies and the expense being edited', () => {
    expect(findDuplicate(list, { localDate: '2026-10-08', currency: 'JPY', total: '1980', merchantName: '' })).toBeNull();
    expect(findDuplicate(list, { localDate: '2026-10-05', currency: 'USD', total: '1980', merchantName: '' })).toBeNull();
    expect(findDuplicate(list, { localDate: '2026-10-05', currency: 'JPY', total: '1980', merchantName: '' }, 'a')).toBeNull();
  });
});
