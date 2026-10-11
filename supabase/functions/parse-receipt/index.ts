// Reads a receipt photo with a Vision model and returns the fields the confirm
// card needs. The image is sent in the request body and not stored here;
// syncing receipt files is a separate step.
//
// Request:  POST { image: base64 JPEG/PNG/WebP, mediaType?: string }
// Response: 200 { result: ReceiptParseResult, model, creditsLeft }
//           429 { error: "quota_exceeded" } once the monthly allowance is used.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const FREE_MONTHLY_CREDITS = 30;
// Gemini's free tier keeps testing at no cost; override per environment with function secrets.
const FAST_MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-2.5-flash';
const STRONG_MODEL = Deno.env.get('GEMINI_STRONG_MODEL') ?? 'gemini-3.5-flash';
const ESCALATE_BELOW = 0.8;
const MAX_IMAGE_BASE64 = 6_000_000;
const MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const CATEGORIES = ['airfare', 'lodging', 'meals', 'ground_transport', 'car_rental', 'fuel', 'parking',
  'communication', 'entertainment', 'office_supplies', 'fees', 'other'];
const PAYMENT_METHODS = ['corporate_card', 'personal_card', 'cash', 'bank_transfer', 'mobile_pay', 'other'];

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] });
const decimal = nullable({ type: 'string', description: 'Plain decimal, no separators or symbols, e.g. "3200" or "12.50"' });

const nullableEnum = (values: string[]) => ({ anyOf: [{ type: 'string', enum: values }, { type: 'null' }] });

// Mirrors receiptParseResultSchema in apps/mobile/src/domain/schemas.ts, which the app validates against.
const RECEIPT_SCHEMA = {
  type: 'object',
  required: ['is_receipt', 'document_kind', 'transactions'],
  properties: {
    is_receipt: { type: 'boolean' },
    document_kind: { type: 'string', enum: ['receipt', 'invoice', 'card_statement', 'other'] },
    transactions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['date', 'merchant_name', 'merchant_country', 'currency', 'subtotal', 'tax', 'tip', 'total',
          'category', 'payment_method_hint', 'card_last4', 'line_items', 'confidence'],
        properties: {
          date: nullable({ type: 'string', description: 'YYYY-MM-DD as printed (local date)' }),
          merchant_name: nullable({ type: 'string' }),
          merchant_country: nullable({ type: 'string', description: 'ISO 3166-1 alpha-2' }),
          currency: nullable({ type: 'string', description: 'ISO 4217, inferred from symbol and country (¥ in Japan = JPY)' }),
          subtotal: decimal,
          tax: decimal,
          tip: decimal,
          total: decimal,
          category: nullableEnum(CATEGORIES),
          payment_method_hint: nullableEnum(PAYMENT_METHODS),
          card_last4: nullable({ type: 'string' }),
          line_items: {
            type: 'array',
            items: {
              type: 'object',
              required: ['description', 'amount'],
              properties: { description: { type: 'string' }, amount: decimal },
            },
          },
          confidence: {
            type: 'object',
            description: 'How sure you are of each field, 0 to 1',
            required: ['total', 'currency', 'date', 'merchant_name'],
            properties: {
              total: { type: 'number' },
              currency: { type: 'number' },
              date: { type: 'number' },
              merchant_name: { type: 'number' },
            },
          },
        },
      },
    },
  },
};

const PROMPT = `This image was taken by a business traveller. Read it and describe it in the requested JSON.
- Use null for anything not printed on it; never guess.
- A card statement or app screenshot may list several transactions; return one entry per transaction.
- total is the amount actually charged, including tax and tip.
- If the image is not a receipt, invoice or statement, set is_receipt to false and return no transactions.`;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

interface Parsed {
  is_receipt: boolean;
  transactions: { total: string | null; confidence: Record<string, number> }[];
}

async function readWithModel(model: string, image: string, mediaType: string): Promise<Parsed> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': Deno.env.get('GEMINI_API_KEY') ?? '', 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mediaType, data: image } }, { text: PROMPT }] }],
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: RECEIPT_SCHEMA, temperature: 0 },
    }),
  });
  if (!res.ok) throw new Error(`Vision API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  const text = body.candidates?.[0]?.content?.parts?.find((p: { text?: string }) => p.text)?.text;
  const parsed = text ? JSON.parse(text) : null;
  if (typeof parsed?.is_receipt !== 'boolean' || !Array.isArray(parsed.transactions)) {
    throw new Error('Vision API returned no receipt data');
  }
  return parsed as Parsed;
}

function needsSecondLook(parsed: Parsed): boolean {
  if (!parsed.is_receipt) return false;
  if (parsed.transactions.length === 0) return true;
  return parsed.transactions.some((t) =>
    t.total === null || ['total', 'currency'].some((k) => (t.confidence?.[k] ?? 0) < ESCALATE_BELOW));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const url = Deno.env.get('SUPABASE_URL')!;
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json(401, { error: 'unauthorized' });

  const body = await req.json().catch(() => null);
  const image = typeof body?.image === 'string' ? body.image : '';
  const mediaType = typeof body?.mediaType === 'string' ? body.mediaType : 'image/jpeg';
  if (!image || image.length > MAX_IMAGE_BASE64 || !MEDIA_TYPES.has(mediaType)) {
    return json(400, { error: 'invalid_image' });
  }

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: creditsLeft, error: creditError } = await admin.rpc('ocr_credit_consume', {
    p_user: user.id,
    p_limit: FREE_MONTHLY_CREDITS,
  });
  if (creditError) return json(500, { error: 'credit_check_failed' });
  if (creditsLeft < 0) return json(429, { error: 'quota_exceeded', limit: FREE_MONTHLY_CREDITS });

  try {
    let model = FAST_MODEL;
    let result = await readWithModel(model, image, mediaType);
    if (needsSecondLook(result)) {
      // Keep the first reading if the stronger model is unavailable (e.g. outside the free tier).
      const second = await readWithModel(STRONG_MODEL, image, mediaType).catch((e) => console.error(e));
      if (second) [model, result] = [STRONG_MODEL, second];
    }
    return json(200, { result, model, creditsLeft });
  } catch (e) {
    console.error(e);
    await admin.rpc('ocr_credit_refund', { p_user: user.id });
    // A short upstream reason (e.g. "Vision API 400: ...") so testers can report what went wrong.
    return json(502, { error: 'read_failed', detail: String(e instanceof Error ? e.message : e).slice(0, 200) });
  }
});
