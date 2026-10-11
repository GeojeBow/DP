// Suggests where trip data goes in a company's own Excel report template.
// The app sends a text view of the template's cells (no file, no personal
// data) and confirms or edits the answer before anything is written.
//
// Request:  POST { layout: string }  e.g. "A3=성명 | D3=부서\nA7=No | B7=일자 | ..."
// Response: 200 { mapping: { fields: {...}, table: { firstRow, columns } | null } }
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.8-flash';
const MAX_LAYOUT = 20_000;

const FIELDS = ['traveler', 'department', 'title', 'period', 'startDate', 'endDate', 'total', 'currency', 'today'];
const COLUMNS = ['no', 'date', 'merchant', 'category', 'payment', 'currency', 'amount', 'fxRate', 'amountBase', 'memo'];

const cell = { type: 'string', description: 'A1-style cell address, e.g. "B3"' };
const column = { type: 'string', description: 'Column letter, e.g. "C"' };

// Mirrors TemplateMapping in apps/mobile/src/features/template/mapping.ts.
const SCHEMA = {
  type: 'object',
  required: ['fields', 'table'],
  properties: {
    fields: { type: 'object', properties: Object.fromEntries(FIELDS.map((f) => [f, cell])) },
    table: {
      anyOf: [
        {
          type: 'object',
          required: ['firstRow', 'columns'],
          properties: {
            firstRow: { type: 'integer', description: 'First empty row under the item table header' },
            columns: { type: 'object', properties: Object.fromEntries(COLUMNS.map((c) => [c, column])) },
          },
        },
        { type: 'null' },
      ],
    },
  },
};

const PROMPT = `Below are the non-empty cells of a company's business-trip expense report template (Excel), one row per line, as ADDRESS=TEXT.
Decide where an app should write each value. Return only addresses of cells that are EMPTY in the template (not listed), except "total" may point at a cell that holds a formula (=...).
Single values (fields), each the empty cell next to or under its printed label:
- traveler: employee name; department: team/department; title: trip purpose or name; period: trip dates as one text;
  startDate / endDate: separate start and end date cells; total: grand total in the report currency; currency: report currency code; today: report/submission date.
Item table (one row per expense): firstRow is the first empty row under the table's header row; columns maps each value to the header's column letter:
- no: row number; date; merchant: shop/vendor/description; category: expense type; payment: payment method; currency: local currency code;
  amount: amount in local currency; fxRate: exchange rate; amountBase: amount converted to the report currency (often "금액(KRW)" or "원화금액");
  memo: remarks.
Leave out anything the template has no place for. If a single "amount" column has no currency column beside it, it is amountBase.
If a label's neighbour already holds text (e.g. a fixed team name), leave that field out.

Template:
`;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json(401, { error: 'unauthorized' });

  const body = await req.json().catch(() => null);
  const layout = typeof body?.layout === 'string' ? body.layout : '';
  if (!layout || layout.length > MAX_LAYOUT) return json(400, { error: 'invalid_layout' });

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': Deno.env.get('GEMINI_API_KEY') ?? '', 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: PROMPT + layout }] }],
        generationConfig: { responseMimeType: 'application/json', responseJsonSchema: SCHEMA, temperature: 0 },
      }),
    });
    if (!res.ok) throw new Error(`AI ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const out = await res.json();
    const text = out.candidates?.[0]?.content?.parts?.find((p: { text?: string }) => p.text)?.text;
    const mapping = text ? JSON.parse(text) : null;
    if (!mapping || typeof mapping.fields !== 'object') throw new Error('AI returned no mapping');
    return json(200, { mapping });
  } catch (e) {
    console.error(e);
    return json(502, { error: 'map_failed', detail: String(e instanceof Error ? e.message : e).slice(0, 200) });
  }
});
