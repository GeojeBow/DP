import type { ReceiptBox } from './readReceipt';

/** Which part of the photo to keep, in 0-1 fractions, or null when cropping wouldn't help. */
export function cropArea(box: ReceiptBox): { top: number; left: number; bottom: number; right: number } | null {
  const [ymin, xmin, ymax, xmax] = box.map((v) => Math.min(Math.max(v, 0), 1000) / 1000) as ReceiptBox;
  // A little margin so the paper's edge isn't cut off.
  const pad = 0.015;
  const area = { top: Math.max(ymin - pad, 0), left: Math.max(xmin - pad, 0), bottom: Math.min(ymax + pad, 1), right: Math.min(xmax + pad, 1) };
  const w = area.right - area.left;
  const h = area.bottom - area.top;
  // Too small to trust, or the receipt already fills the photo (as it does after the document scanner).
  if (w < 0.1 || h < 0.1 || w * h > 0.85) return null;
  return area;
}
