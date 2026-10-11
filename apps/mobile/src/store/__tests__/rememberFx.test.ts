import type { Trip } from '../../domain/models';
import { rememberedRate } from '../useAppStore';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const trip = { id: 't1', baseCurrency: 'KRW', fxRates: { USD: '1380' } } as unknown as Trip;

describe('rememberedRate', () => {
  it('uses the rate remembered for the trip first', () => {
    expect(rememberedRate({ rememberFx: true, lastFxRates: { 'USD>KRW': '1300' } }, trip, 'USD', 'KRW')).toBe('1380');
  });
  it('falls back to the last rate for the pair', () => {
    expect(rememberedRate({ rememberFx: true, lastFxRates: { 'JPY>KRW': '9.1' } }, trip, 'JPY', 'KRW')).toBe('9.1');
  });
  it('fills nothing when remembering is off or the currency is the base', () => {
    expect(rememberedRate({ rememberFx: false, lastFxRates: {} }, trip, 'USD', 'KRW')).toBeUndefined();
    expect(rememberedRate({ rememberFx: true, lastFxRates: {} }, trip, 'KRW', 'KRW')).toBeUndefined();
  });
});
