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
}

export type ReadReceiptOutcome =
  | { kind: 'read'; prefill: ReceiptPrefill; extraTransactions: number }
  | { kind: 'not_receipt' }
  | { kind: 'quota_exceeded' }
  | { kind: 'failed'; reason?: string };

const CARD_HINTS = new Set<PaymentMethod>(['corporate_card', 'personal_card']);

export function toPrefill(result: ReceiptParseResult): ReadReceiptOutcome {
  const [first, ...rest] = result.transactions;
  if (!result.is_receipt || !first) return { kind: 'not_receipt' };
  const prefill: ReceiptPrefill = {};
  if (first.merchant_name) prefill.merchantName = first.merchant_name;
  if (first.total && !first.total.startsWith('-')) prefill.total = first.total;
  if (first.currency) prefill.currency = first.currency;
  if (first.date) prefill.localDate = first.date;
  if (first.category) prefill.category = first.category;
  // A receipt can't tell a corporate card from a personal one, so keep the user's default for cards.
  if (first.payment_method_hint && !CARD_HINTS.has(first.payment_method_hint)) {
    prefill.paymentMethod = first.payment_method_hint;
  }
  return { kind: 'read', prefill, extraTransactions: rest.length };
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
