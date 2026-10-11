/**
 * UUIDv7: a 48-bit millisecond timestamp followed by random bits, so IDs created
 * offline on the device sort by creation time and never collide on sync.
 */
export function uuidv7(
  now: number = Date.now(),
  fillRandom: (bytes: Uint8Array) => void = defaultFillRandom,
): string {
  const bytes = new Uint8Array(16);
  fillRandom(bytes);
  let ts = Math.floor(now);
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ts % 256;
    ts = Math.floor(ts / 256);
  }
  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f); // version 7
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f); // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function defaultFillRandom(bytes: Uint8Array): void {
  // Loaded lazily so pure-logic tests do not need the native module.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Crypto = require('expo-crypto') as typeof import('expo-crypto');
  Crypto.getRandomValues(bytes);
}
