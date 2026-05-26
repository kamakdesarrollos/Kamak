import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { today, diasHasta, diasDesde, inicioMes, fechaRelativa } from './dates';

describe('dates helpers', () => {
  beforeEach(() => {
    // Congelar la fecha a 2026-05-26 12:00 UTC para tests deterministas.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-26T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('today devuelve la fecha de hoy en formato ISO', () => {
    expect(today()).toBe('2026-05-26');
  });

  it('diasHasta calcula correctamente', () => {
    expect(diasHasta('2026-05-26')).toBe(0);   // hoy
    expect(diasHasta('2026-05-27')).toBe(1);   // mañana
    expect(diasHasta('2026-05-25')).toBe(-1);  // ayer
    expect(diasHasta('2026-06-01')).toBe(6);
  });

  it('diasHasta devuelve null si no hay fecha', () => {
    expect(diasHasta(null)).toBeNull();
    expect(diasHasta('')).toBeNull();
    expect(diasHasta(undefined)).toBeNull();
  });

  it('diasHasta con fecha invalida devuelve null', () => {
    expect(diasHasta('no-es-fecha')).toBeNull();
  });

  it('diasDesde es el negado de diasHasta', () => {
    expect(diasDesde('2026-05-27')).toBe(-1);
    expect(diasDesde('2026-05-25')).toBe(1);
  });

  it('inicioMes devuelve el dia 1 del mes actual', () => {
    expect(inicioMes()).toBe('2026-05-01');
  });

  it('fechaRelativa con dias positivos avanza', () => {
    expect(fechaRelativa(7)).toBe('2026-06-02');
  });

  it('fechaRelativa con dias negativos retrocede', () => {
    expect(fechaRelativa(-7)).toBe('2026-05-19');
  });
});
