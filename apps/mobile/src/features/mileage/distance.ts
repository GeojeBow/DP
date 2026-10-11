export interface Fix {
  latitude: number;
  longitude: number;
  /** Metres, as reported by the OS */
  accuracy?: number | null;
}

const EARTH_M = 6_371_000;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversine(a: Fix, b: Fix): number {
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Fixes worse than this are noise indoors or under bridges. */
const MAX_ACCURACY_M = 50;
/** Smaller steps are GPS jitter while standing still. */
const MIN_STEP_M = 15;

/** Running total of a drive: adds a fix if it is accurate and a real move. */
export function addFix(state: { metres: number; last: Fix | null }, fix: Fix): { metres: number; last: Fix | null } {
  if (fix.accuracy != null && fix.accuracy > MAX_ACCURACY_M) return state;
  if (!state.last) return { metres: state.metres, last: fix };
  const step = haversine(state.last, fix);
  if (step < MIN_STEP_M) return state;
  return { metres: state.metres + step, last: fix };
}

/** "12.3" km, one decimal. */
export const toKm = (metres: number) => (Math.round(metres / 100) / 10).toFixed(1);
