import { customFieldDefinitionSchema, receiptParseResultSchema } from '../schemas';

const transaction = {
  date: '2026-10-07',
  merchant_name: 'Ichiran Shibuya',
  merchant_country: 'JP',
  currency: 'JPY',
  subtotal: '1800',
  tax: '180',
  tip: null,
  total: '1980',
  category: 'meals',
  payment_method_hint: 'corporate_card',
  card_last4: '1234',
  line_items: [{ description: 'Ramen', amount: '1980' }],
  confidence: { total: 0.98, merchant_name: 0.91 },
};

describe('receiptParseResultSchema', () => {
  it('accepts a well-formed Vision response', () => {
    const parsed = receiptParseResultSchema.parse({ is_receipt: true, document_kind: 'receipt', transactions: [transaction] });
    expect(parsed.transactions[0]?.total).toBe('1980');
  });

  it('rejects numeric amounts and unknown categories', () => {
    expect(
      receiptParseResultSchema.safeParse({
        is_receipt: true,
        document_kind: 'receipt',
        transactions: [{ ...transaction, total: 1980 }],
      }).success,
    ).toBe(false);
    expect(
      receiptParseResultSchema.safeParse({
        is_receipt: true,
        document_kind: 'receipt',
        transactions: [{ ...transaction, category: 'snacks' }],
      }).success,
    ).toBe(false);
  });
});

describe('customFieldDefinitionSchema', () => {
  it('requires options for select fields', () => {
    expect(customFieldDefinitionSchema.safeParse({ type: 'select', options: [] }).success).toBe(false);
    expect(
      customFieldDefinitionSchema.safeParse({
        type: 'select',
        options: [{ value: 'PRJ-001', label: '신사업 TF' }],
        remember_last: true,
      }).success,
    ).toBe(true);
  });
});
