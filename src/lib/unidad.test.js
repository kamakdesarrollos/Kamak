import { describe, it, expect } from 'vitest';
import { normUnidad } from './unidad';

describe('normUnidad', () => {
  it('normaliza m2/M2/m²/M² → m²', () => {
    for (const u of ['m2', 'M2', 'm²', 'M²', ' m2 ', 'M2']) {
      expect(normUnidad(u)).toBe('m²');
    }
  });

  it('normaliza m3/M3/m³/M³ → m³', () => {
    for (const u of ['m3', 'M3', 'm³', 'M³', ' M3 ']) {
      expect(normUnidad(u)).toBe('m³');
    }
  });

  it('deja intactas las demás unidades', () => {
    for (const u of ['u', 'gl', 'kg', 'ml', 'm', 'm2x', 'hs', '']) {
      expect(normUnidad(u)).toBe(u);
    }
  });

  it('no rompe con null/undefined', () => {
    expect(normUnidad(null)).toBe(null);
    expect(normUnidad(undefined)).toBe(undefined);
  });
});
