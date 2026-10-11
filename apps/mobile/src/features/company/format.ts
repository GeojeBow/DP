import { formatMoney, toCurrencyCode, toMinor } from '../../domain/money';

/** Amounts come back from the server as numbers or strings; show them like the rest of the app. */
export function money(amount: string | number, currency: string): string {
  const code = toCurrencyCode(currency.trim());
  try {
    return formatMoney(toMinor(String(amount), code), code);
  } catch {
    return `${code} ${amount}`;
  }
}
