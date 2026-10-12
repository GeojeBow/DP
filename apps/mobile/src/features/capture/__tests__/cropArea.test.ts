import { cropArea } from '../cropArea';

jest.mock('../../../lib/supabase', () => ({}));

describe('cropArea', () => {
  it('keeps the receipt with a small margin', () => {
    const a = cropArea([200, 300, 900, 600])!;
    expect(a.top).toBeCloseTo(0.185);
    expect(a.left).toBeCloseTo(0.285);
    expect(a.bottom).toBeCloseTo(0.915);
    expect(a.right).toBeCloseTo(0.615);
  });

  it('leaves photos alone when the receipt already fills them or the box is implausible', () => {
    expect(cropArea([0, 0, 1000, 1000])).toBeNull();
    expect(cropArea([20, 30, 980, 960])).toBeNull();
    expect(cropArea([500, 500, 520, 900])).toBeNull();
  });

  it('clamps boxes that run past the photo', () => {
    expect(cropArea([-50, 100, 700, 1200])).toEqual({ top: 0, left: 0.085, bottom: 0.715, right: 1 });
  });
});
