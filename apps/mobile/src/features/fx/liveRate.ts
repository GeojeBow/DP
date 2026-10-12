import { rateString } from '../../domain/fx';

/**
 * Today's market rate from ExchangeRate-API's open endpoint (free, no key, updated daily;
 * attribution required). Used to fill the rate so nobody has to type one; the card's own
 * charged amount can still override it.
 */
export const RATE_SOURCE_URL = 'https://www.exchangerate-api.com';

const cache = new Map<string, { day: string; rates: Record<string, number> }>();

/** 1 `from` = ? `to`, or null when offline or the currency is unknown. */
export async function fetchRate(from: string, to: string): Promise<string | null> {
  const day = new Date().toISOString().slice(0, 10);
  let hit = cache.get(from);
  if (!hit || hit.day !== day) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(from)}`, { signal: controller.signal });
      if (!res.ok) return null;
      const body = (await res.json()) as { result?: string; rates?: Record<string, number> };
      if (body.result !== 'success' || !body.rates) return null;
      hit = { day, rates: body.rates };
      cache.set(from, hit);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  const r = hit.rates[to];
  return typeof r === 'number' && r > 0 ? rateString(r) : null;
}
