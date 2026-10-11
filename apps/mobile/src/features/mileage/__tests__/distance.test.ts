import { addFix, haversine, toKm } from '../distance';

describe('distance', () => {
  it('measures Seoul to Daejeon roughly', () => {
    const km = haversine({ latitude: 37.5665, longitude: 126.978 }, { latitude: 36.3504, longitude: 127.3845 }) / 1000;
    expect(km).toBeGreaterThan(138);
    expect(km).toBeLessThan(142);
  });

  it('ignores inaccurate fixes and jitter', () => {
    let s = { metres: 0, last: null as null | { latitude: number; longitude: number } };
    s = addFix(s, { latitude: 37.5, longitude: 127, accuracy: 10 });
    s = addFix(s, { latitude: 37.50005, longitude: 127, accuracy: 10 }); // ~5 m jitter
    s = addFix(s, { latitude: 37.6, longitude: 127, accuracy: 500 }); // bad fix
    s = addFix(s, { latitude: 37.51, longitude: 127, accuracy: 10 }); // ~1.1 km
    expect(toKm(s.metres)).toBe('1.1');
  });
});
