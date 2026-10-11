import { receiptParseResultSchema } from '../../../domain/schemas';
import { toPrefill } from '../readReceipt';

jest.mock('../../../lib/supabase', () => ({}));

const tx = {
  date: '2026-10-03',
  merchant_name: 'Ichiran Shibuya',
  merchant_country: 'JP',
  currency: 'JPY',
  subtotal: null,
  tax: '290',
  tip: null,
  total: '3200',
  category: 'meals',
  payment_method_hint: 'cash',
  card_last4: null,
  line_items: [{ description: 'Ramen', amount: '1180' }],
  confidence: { total: 0.97, currency: 0.95 },
};

const parse = (value: unknown) => receiptParseResultSchema.parse(value);

describe('toPrefill', () => {
  it('fills the confirm card from the first transaction', () => {
    const out = toPrefill(parse({ is_receipt: true, document_kind: 'receipt', transactions: [tx] }));
    expect(out).toEqual({
      kind: 'read',
      extras: [],
      prefill: {
        merchantName: 'Ichiran Shibuya',
        total: '3200',
        currency: 'JPY',
        localDate: '2026-10-03',
        category: 'meals',
        paymentMethod: 'cash',
        vat: '290',
      },
    });
  });

  it('leaves card type and unreadable fields to the user', () => {
    const out = toPrefill(parse({
      is_receipt: true,
      document_kind: 'card_statement',
      transactions: [{ ...tx, total: null, merchant_name: null, payment_method_hint: 'personal_card' }, tx],
    }));
    expect(out).toEqual({
      kind: 'read',
      prefill: { currency: 'JPY', localDate: '2026-10-03', category: 'meals', vat: '290' },
      extras: [
        { merchantName: 'Ichiran Shibuya', total: '3200', currency: 'JPY', localDate: '2026-10-03', category: 'meals', paymentMethod: 'cash', vat: '290' },
      ],
    });
  });

  it('reports non-receipts', () => {
    expect(toPrefill(parse({ is_receipt: false, document_kind: 'other', transactions: [] }))).toEqual({ kind: 'not_receipt' });
  });
});
