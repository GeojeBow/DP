import { FunctionsHttpError } from '@supabase/supabase-js';

import { type ExpenseCategory, type PaymentMethod, receiptParseResultSchema } from '../../domain/schemas';
import type { ReceiptParseResult } from '../../domain/schemas';
import { ensureSignedIn, supabase } from '../../lib/supabase';

/** Confirm-card fields the AI could read; anything missing stays for the user to fill. */
export interface ReceiptPrefill {
  merchantName?: string;
  total?: string;
  currency?: string;
  localDate?: string;
  category?: ExpenseCategory;
  paymentMethod?: PaymentMethod;
  vat?: string;
}

export type ReadReceiptOutcome =
  /** `extras`: the other payments on the same image, e.g. a card statement's other lines */
  | { kind: 'read'; prefill: ReceiptPrefill; extras: ReceiptPrefill[]; box?: ReceiptBox }
  | { kind: 'not_receipt' }
  | { kind: 'quota_exceeded' }
  | { kind: 'failed'; reason?: string };

/** Where the receipt paper is in the photo: [ymin, xmin, ymax, xmax] on a 0-1000 scale. */
export type ReceiptBox = [number, number, number, number];

const CARD_HINTS = new Set<PaymentMethod>(['corporate_card', 'personal_card']);

type Transaction = ReceiptParseResult['transactions'][number];

function prefillOf(tx: Transaction): ReceiptPrefill {
  const prefill: ReceiptPrefill = {};
  if (tx.merchant_name) prefill.merchantName = tx.merchant_name;
  if (tx.total && !tx.total.startsWith('-')) prefill.total = tx.total;
  if (tx.currency) prefill.currency = tx.currency;
  if (tx.date) prefill.localDate = tx.date;
  if (tx.category) prefill.category = tx.category;
  if (tx.tax && !tx.tax.startsWith('-') && Number(tx.tax) > 0) prefill.vat = tx.tax;
  // A receipt can't tell a corporate card from a personal one, so keep the user's default for cards.
  if (tx.payment_method_hint && !CARD_HINTS.has(tx.payment_method_hint)) {
    prefill.paymentMethod = tx.payment_method_hint;
  }
  return prefill;
}

export function toPrefill(result: ReceiptParseResult): ReadReceiptOutcome {
  const [first, ...rest] = result.transactions;
  if (!result.is_receipt || !first) return { kind: 'not_receipt' };
  const box = result.receipt_box?.length === 4 ? (result.receipt_box as ReceiptBox) : undefined;
  return { kind: 'read', prefill: prefillOf(first), extras: rest.map(prefillOf), ...(box ? { box } : {}) };
}

/** Sends a receipt image (data URI) to the parse-receipt Edge Function. */
export async function readReceipt(dataUri: string): Promise<ReadReceiptOutcome> {
  const match = /^data:(image\/[a-z]+);base64,(.+)$/.exec(dataUri);
  if (!match) return { kind: 'failed' };
  try {
    await ensureSignedIn();
    const { data, error } = await supabase().functions.invoke('parse-receipt', {
      body: { mediaType: match[1], image: match[2] },
    });
    if (error) {
      if (error instanceof FunctionsHttpError && error.context instanceof Response && error.context.status === 429) {
        return { kind: 'quota_exceeded' };
      }
      return { kind: 'failed', reason: await failureReason(error) };
    }
    const parsed = receiptParseResultSchema.safeParse(data?.result);
    return parsed.success ? toPrefill(parsed.data) : { kind: 'failed' };
  } catch (e) {
    return { kind: 'failed', reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Status and server detail of a failed call, shown so testers can report it. */
async function failureReason(error: Error): Promise<string> {
  if (!(error instanceof FunctionsHttpError) || !(error.context instanceof Response)) return error.message;
  const res = error.context;
  const body = await res.json().catch(() => null);
  return [res.status, body?.error, body?.detail].filter(Boolean).join(' ');
}
