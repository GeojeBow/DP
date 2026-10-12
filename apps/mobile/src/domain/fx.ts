/**
 * Exchange rates are stored one way, "1 `currency` = rate `base`" (Expense.fxRate), but
 * people read them the way a bank board shows them: "1 USD = 1,400 KRW", "100 JPY = 940 KRW",
 * whichever currency is on the left. A Quote is that reading direction.
 */

export interface Quote {
  /** Currency on the left of "=" */
  from: string;
  /** Currency on the right */
  to: string;
  /** How many `from` units the board quotes: 100 for yen, else 1 */
  unit: number;
}

// Rough value of one unit in US dollars, only to pick which side goes left before a real rate is known.
const ROUGH_USD: Record<string, number> = {
  USD: 1, EUR: 1.08, GBP: 1.27, CHF: 1.1, AUD: 0.66, CAD: 0.73, NZD: 0.6, SGD: 0.74, HKD: 0.13,
  CNY: 0.14, TWD: 0.031, JPY: 0.0067, KRW: 0.00072, THB: 0.028, VND: 0.00004, IDR: 0.00006,
  PHP: 0.017, MYR: 0.21, INR: 0.012, AED: 0.27, MXN: 0.055, BRL: 0.18,
};

const DEC = /^(\d+)(?:\.(\d+))?$/;
const SCALE = 18;

function scaled(value: string): bigint | null {
  const m = DEC.exec(value.replace(/,/g, '').trim());
  if (!m) return null;
  const [, whole, fraction = ''] = m;
  return BigInt(whole! + fraction.padEnd(SCALE, '0').slice(0, SCALE));
}

function show(units: bigint): string {
  const digits = units.toString().padStart(SCALE + 1, '0');
  const whole = digits.slice(0, -SCALE);
  const fraction = digits.slice(-SCALE).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

/** a ÷ b as a plain decimal string with up to 18 decimals; null when either isn't a positive number. */
export function divide(a: string, b: string): string | null {
  const x = scaled(a);
  const y = scaled(b);
  if (x === null || y === null || x <= 0n || y <= 0n) return null;
  const n = x * 10n ** BigInt(SCALE);
  return show((n * 2n + y) / (y * 2n));
}

function multiply(a: string, k: number): string {
  const x = scaled(a)!;
  return show(x * BigInt(k));
}

/** Which way to show a rate between `currency` (what was paid) and `base` (the trip's currency). */
export function quoteFor(currency: string, base: string, rate?: string): Quote {
  let currencyLeft: boolean;
  const r = rate ? Number(rate) : NaN;
  if (Number.isFinite(r) && r > 0) currencyLeft = r >= 1;
  else {
    const c = ROUGH_USD[currency];
    const b = ROUGH_USD[base];
    currencyLeft = c === undefined || b === undefined ? true : c >= b;
  }
  const from = currencyLeft ? currency : base;
  return { from, to: currencyLeft ? base : currency, unit: from === 'JPY' ? 100 : 1 };
}

/** The number on the right of the board for a stored rate, e.g. "1400". */
export function quoteValue(rate: string, q: Quote, currency: string): string | null {
  const exact = q.from === currency ? multiply(rate, q.unit) : divide(String(q.unit), rate);
  if (exact === null) return null;
  return trim(exact);
}

/** The stored rate (1 currency = ? base) for a number typed against the board. */
export function rateFromQuote(value: string, q: Quote, currency: string): string | null {
  return q.from === currency ? divide(value, String(q.unit)) : divide(String(q.unit), value);
}

/** Rounds to 4 decimals for reading: 1399.99999999 → "1400". */
function trim(exact: string): string {
  const units = scaled(exact)!;
  const step = 10n ** BigInt(SCALE - 4);
  const rounded = ((units + step / 2n) / step) * step;
  return show(rounded);
}

function group(n: string): string {
  const [w = '0', f] = n.split('.');
  return `${w.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${f ? `.${f}` : ''}`;
}

/** "1 USD = 1,400 KRW", "100 JPY = 940 KRW". */
export function formatQuote(rate: string, currency: string, base: string): string {
  const q = quoteFor(currency, base, rate);
  const v = quoteValue(rate, q, currency);
  return `${q.unit} ${q.from} = ${v === null ? '?' : group(v)} ${q.to}`;
}

/** A rate from a floating-point source as a plain decimal string. */
export function rateString(n: number): string {
  const s = n >= 1 ? n.toPrecision(12) : n.toFixed(16);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}
