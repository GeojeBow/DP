import {
  convertMinor,
  formatMoney,
  fromMinor,
  MoneyError,
  sumMinor,
  toCurrencyCode,
  toMinor,
} from '../money';

const USD = toCurrencyCode('USD');
const JPY = toCurrencyCode('jpy');
const KRW = toCurrencyCode('KRW');
const KWD = toCurrencyCode('KWD');

describe('toMinor / fromMinor', () => {
  it('scales by the currency exponent', () => {
    expect(toMinor('12.5', USD)).toBe(1250n);
    expect(toMinor('3200', JPY)).toBe(3200n);
    expect(toMinor('1.234', KWD)).toBe(1234n);
  });

  it('rounds half away from zero', () => {
    expect(toMinor('0.005', USD)).toBe(1n);
    expect(toMinor('-0.005', USD)).toBe(-1n);
    expect(toMinor('1234.5', KRW)).toBe(1235n);
  });

  it('round-trips', () => {
    expect(fromMinor(1250n, USD)).toBe('12.50');
    expect(fromMinor(5n, USD)).toBe('0.05');
    expect(fromMinor(-5n, USD)).toBe('-0.05');
    expect(fromMinor(3200n, JPY)).toBe('3200');
  });

  it('rejects malformed input', () => {
    expect(() => toMinor('1,000', USD)).toThrow(MoneyError);
    expect(() => toMinor('abc', USD)).toThrow(MoneyError);
    expect(() => toCurrencyCode('US')).toThrow(MoneyError);
  });
});

describe('convertMinor', () => {
  it('converts across different exponents', () => {
    // JPY 3,200 at 1 JPY = 9.1234 KRW -> KRW 29,195
    expect(convertMinor(3200n, JPY, KRW, '9.1234')).toBe(29195n);
    // USD 12.35 at 1 USD = 1385.5 KRW -> KRW 17,111 (17110.925 rounded)
    expect(convertMinor(1235n, USD, KRW, '1385.5')).toBe(17111n);
    // KRW 10,000 at 1 KRW = 0.00072 USD -> USD 7.20
    expect(convertMinor(10000n, KRW, USD, '0.00072')).toBe(720n);
  });

  it('is the identity for the same currency', () => {
    expect(convertMinor(999n, USD, USD, '2')).toBe(999n);
  });

  it('rejects non-positive rates', () => {
    expect(() => convertMinor(100n, USD, KRW, '0')).toThrow(MoneyError);
  });
});

describe('sumMinor / formatMoney', () => {
  it('sums exactly', () => {
    expect(sumMinor([10n, 20n, 1n])).toBe(31n);
    expect(sumMinor([])).toBe(0n);
  });

  it('formats with the ISO code and grouping', () => {
    expect(formatMoney(320000n, JPY)).toBe('JPY 320,000');
    expect(formatMoney(101235n, USD)).toBe('USD 1,012.35');
    expect(formatMoney(-500n, USD)).toBe('-USD 5.00');
  });
});
