import { divide, formatQuote, quoteFor, quoteValue, rateFromQuote, rateString } from '../fx';
import { convertMinor, toCurrencyCode } from '../money';

describe('fx quotes', () => {
  it('shows the stronger currency on the left whichever is the trip currency', () => {
    expect(formatQuote('1400', 'USD', 'KRW')).toBe('1 USD = 1,400 KRW');
    expect(formatQuote(divide('1', '1400')!, 'KRW', 'USD')).toBe('1 USD = 1,400 KRW');
    expect(formatQuote('9.4', 'JPY', 'KRW')).toBe('100 JPY = 940 KRW');
  });

  it('turns "1 USD = 1400 KRW" into the stored rate for a KRW receipt on a USD trip', () => {
    const q = quoteFor('KRW', 'USD');
    expect(q).toEqual({ from: 'USD', to: 'KRW', unit: 1 });
    const rate = rateFromQuote('1,400', q, 'KRW')!;
    const usd = toCurrencyCode('USD');
    const krw = toCurrencyCode('KRW');
    expect(convertMinor(70000n, krw, usd, rate)).toBe(5000n);
    expect(quoteValue(rate, q, 'KRW')).toBe('1400');
  });

  it('reads yen per 100', () => {
    const q = quoteFor('JPY', 'KRW');
    expect(rateFromQuote('940', q, 'JPY')).toBe('9.4');
  });

  it('derives the rate from the amount the card charged', () => {
    expect(divide('70,000', '50')).toBe('1400');
    expect(divide('0', '5')).toBeNull();
  });

  it('writes float rates without exponents', () => {
    expect(rateString(0.000714285714)).toBe('0.000714285714');
    expect(rateString(1400.5)).toBe('1400.5');
    expect(rateString(0.0000392)).toBe('0.0000392');
  });
});
