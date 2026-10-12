import { z } from 'zod';

/**
 * Shared shapes for data that crosses a trust boundary: Vision AI output,
 * JSONB columns, and sync payloads. Enum values mirror the Postgres enums in
 * supabase/migrations/20261011000000_initial_schema.sql and must stay in sync.
 */

export const EXPENSE_CATEGORIES = [
  'airfare', 'lodging', 'meals', 'ground_transport', 'car_rental', 'fuel', 'parking',
  'communication', 'entertainment', 'office_supplies', 'fees', 'other',
] as const;
export const expenseCategorySchema = z.enum(EXPENSE_CATEGORIES);
export type ExpenseCategory = z.infer<typeof expenseCategorySchema>;

export const PAYMENT_METHODS = [
  'corporate_card', 'personal_card', 'cash', 'bank_transfer', 'mobile_pay', 'other',
] as const;
export const paymentMethodSchema = z.enum(PAYMENT_METHODS);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const expenseStatusSchema = z.enum([
  'draft', 'processing', 'needs_review', 'confirmed', 'submitted', 'approved', 'rejected',
]);
export type ExpenseStatus = z.infer<typeof expenseStatusSchema>;

export const POLICY_RULE_TYPES = [
  'daily_cap', 'per_item_cap', 'nightly_cap', 'prohibited_category', 'prohibited_keyword',
  'receipt_required_over', 'pre_approval_over', 'weekend_flag',
] as const;
export const policyRuleTypeSchema = z.enum(POLICY_RULE_TYPES);
export const policyActionSchema = z.enum(['warn', 'block', 'require_justification']);
export type PolicyAction = z.infer<typeof policyActionSchema>;

/** Decimal amount as a string, e.g. "1234.50"; never a JS number. */
export const decimalStringSchema = z.string().regex(/^-?\d+(\.\d+)?$/, 'Expected a decimal string');
export const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/, 'Expected an ISO 4217 code');
export const isoDateSchema = z.iso.date();

const confidenceSchema = z.number().min(0).max(1);

/** One transaction read from a receipt or from a card statement screenshot. */
export const parsedTransactionSchema = z.object({
  date: isoDateSchema.nullable(),
  merchant_name: z.string().min(1).nullable(),
  merchant_country: z.string().regex(/^[A-Z]{2}$/).nullable(),
  currency: currencyCodeSchema.nullable(),
  subtotal: decimalStringSchema.nullable(),
  tax: decimalStringSchema.nullable(),
  tip: decimalStringSchema.nullable(),
  total: decimalStringSchema.nullable(),
  category: expenseCategorySchema.nullable(),
  payment_method_hint: paymentMethodSchema.nullable(),
  // Models sometimes return the masked number ("****5678"); keep only its last four digits.
  card_last4: z.preprocess(
    (v) => (typeof v === 'string' ? /(\d{4})\D*$/.exec(v)?.[1] ?? null : v),
    z.string().regex(/^\d{4}$/).nullable(),
  ),
  line_items: z.array(z.object({ description: z.string(), amount: decimalStringSchema.nullable() })),
  confidence: z.record(z.string(), confidenceSchema),
});
export type ParsedTransaction = z.infer<typeof parsedTransactionSchema>;

/** The JSON the ocr-parse Edge Function requires the Vision model to return. */
export const receiptParseResultSchema = z.object({
  is_receipt: z.boolean(),
  document_kind: z.enum(['receipt', 'invoice', 'card_statement', 'other']),
  /** Where the receipt paper is in the photo: [ymin, xmin, ymax, xmax] on a 0-1000 scale. */
  receipt_box: z.array(z.number()).length(4).nullable().optional(),
  transactions: z.array(parsedTransactionSchema),
});
export type ReceiptParseResult = z.infer<typeof receiptParseResultSchema>;

/** custom_fields.definition */
export const customFieldDefinitionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), validation: z.object({ regex: z.string().optional() }).optional() }),
  z.object({ type: z.literal('number'), validation: z.object({ min: z.number().optional(), max: z.number().optional() }).optional() }),
  z.object({ type: z.literal('date') }),
  z.object({ type: z.literal('boolean') }),
  z.object({ type: z.literal('tax_id') }),
  z.object({
    type: z.enum(['select', 'multi_select']),
    options: z.array(z.object({ value: z.string().min(1), label: z.string().min(1) })).min(1),
  }),
]).and(z.object({
  default: z.unknown().optional(),
  applies_to_categories: z.array(expenseCategorySchema).optional(),
  ai_hint: z.string().max(200).optional(),
  remember_last: z.boolean().optional(),
}));
export type CustomFieldDefinition = z.infer<typeof customFieldDefinitionSchema>;

/** policy_rules.params, keyed by rule_type. Amounts are in the policy's currency. */
export const policyParamsSchemas = {
  daily_cap: z.object({ amount: decimalStringSchema }),
  per_item_cap: z.object({ amount: decimalStringSchema }),
  nightly_cap: z.object({ amount: decimalStringSchema }),
  prohibited_category: z.object({}),
  prohibited_keyword: z.object({
    keywords: z.array(z.string().min(1)).min(1),
    line_item_match: z.boolean().default(true),
  }),
  receipt_required_over: z.object({ amount: decimalStringSchema }),
  pre_approval_over: z.object({ amount: decimalStringSchema }),
  weekend_flag: z.object({}),
} as const;
