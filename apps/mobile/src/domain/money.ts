/**
 * Exact money arithmetic. Amounts are integers in the currency's minor unit
 * (cents for USD, whole yen for JPY) held as bigint, so sums and conversions
 * never pick up floating-point error. Decimal strings come in from OCR and the
 * database (numeric columns) and go back out the same way.
 */

export type CurrencyCode = string & { readonly __brand: 'CurrencyCode' };
export type MinorUnits = bigint;

const ZERO_DECIMAL = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);
const THREE_DECIMAL = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

const CURRENCY_RE = /^[A-Z]{3}$/;
const DECIMAL_RE = /^(-)?(\d+)(?:\.(\d+))?$/;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

export function toCurrencyCode(value: string): CurrencyCode {
  const code = value.trim().toUpperCase();
  if (!CURRENCY_RE.test(code)) {
    throw new MoneyError(`Invalid ISO 4217 currency code: "${value}"`);
  }
  return code as CurrencyCode;
}

/** Number of minor-unit digits (ISO 4217 exponent). */
export function currencyExponent(currency: CurrencyCode): number {
  if (ZERO_DECIMAL.has(currency)) return 0;
  if (THREE_DECIMAL.has(currency)) return 3;
  return 2;
}

interface ScaledDecimal {
  units: bigint;
  scale: number;
}

function parseDecimal(value: string): ScaledDecimal {
  const match = DECIMAL_RE.exec(value.trim());
  if (!match) {
    throw new MoneyError(`Invalid decimal amount: "${value}"`);
  }
  const [, sign, whole, fraction = ''] = match;
  const units = BigInt(`${whole}${fraction}`);
  return { units: sign ? -units : units, scale: fraction.length };
}

const pow10 = (n: number): bigint => 10n ** BigInt(n);

/** Divides and rounds half away from zero, the convention used on receipts and statements. */
function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new MoneyError('Division by zero');
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const rounded = (n * 2n + d) / (d * 2n);
  return negative ? -rounded : rounded;
}

/** "12.345" USD -> 1235n (rounded to cents). */
export function toMinor(amount: string, currency: CurrencyCode): MinorUnits {
  const { units, scale } = parseDecimal(amount);
  const exp = currencyExponent(currency);
  return exp >= scale ? units * pow10(exp - scale) : divRound(units, pow10(scale - exp));
}

/** 1235n USD -> "12.35"; 3200n JPY -> "3200". */
export function fromMinor(minor: MinorUnits, currency: CurrencyCode): string {
  const exp = currencyExponent(currency);
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString().padStart(exp + 1, '0');
  const whole = exp === 0 ? digits : digits.slice(0, -exp);
  const fraction = exp === 0 ? '' : `.${digits.slice(-exp)}`;
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

/**
 * Converts using a rate quoted as "1 `from` = `rate` `to`" (the expenses.fx_rate
 * convention), rounding once at the end.
 */
export function convertMinor(
  amount: MinorUnits,
  from: CurrencyCode,
  to: CurrencyCode,
  rate: string,
): MinorUnits {
  if (from === to) return amount;
  const r = parseDecimal(rate);
  if (r.units <= 0n) throw new MoneyError(`Exchange rate must be positive: "${rate}"`);
  const shift = currencyExponent(to) - currencyExponent(from);
  const numerator = amount * r.units * (shift > 0 ? pow10(shift) : 1n);
  const denominator = pow10(r.scale) * (shift < 0 ? pow10(-shift) : 1n);
  return divRound(numerator, denominator);
}

export function sumMinor(amounts: Iterable<MinorUnits>): MinorUnits {
  let total = 0n;
  for (const a of amounts) total += a;
  return total;
}

/**
 * Formats for display with the ISO code rather than a symbol, so ¥ (JPY vs CNY)
 * and $ (USD vs CAD) are never ambiguous: "JPY 3,200", "USD 1,012.35".
 */
export function formatMoney(minor: MinorUnits, currency: CurrencyCode): string {
  const plain = fromMinor(minor, currency);
  const [whole = '0', fraction] = plain.replace('-', '').split('.');
  // Grouped by hand: Hermes does not localize BigInt.prototype.toLocaleString.
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${minor < 0n ? '-' : ''}${currency} ${grouped}${fraction ? `.${fraction}` : ''}`;
}
