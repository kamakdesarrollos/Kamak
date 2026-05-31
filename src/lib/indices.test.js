import { describe, it, expect } from 'vitest';
import {
  factorRedeterminacion, redeterminar, valorIndice, variacionPct,
  INDICES_TIPO, getIndiceTipo,
} from './indices';

const INDICES = {
  '2026-01': { cacGeneral: 1000, cacMateriales: 1000, cacManoObra: 1000 },
  '2026-05': { cacGeneral: 1300, cacMateriales: 1250, cacManoObra: 1400 },
};

describe('redeterminación por índice', () => {
  it('factorRedeterminacion = actual / base', () => {
    expect(factorRedeterminacion(1000, 1300)).toBeCloseTo(1.3, 5);
  });
  it('factor = 1 (sin ajuste) si falta un valor o base no positiva', () => {
    expect(factorRedeterminacion(0, 1300)).toBe(1);
    expect(factorRedeterminacion(1000, 0)).toBe(1);
    expect(factorRedeterminacion(null, 1300)).toBe(1);
  });
  it('redeterminar aplica el factor y redondea', () => {
    expect(redeterminar(1000000, 1000, 1300)).toBe(1300000);
    expect(redeterminar(1000000, 1000, 1250)).toBe(1250000);
  });
  it('redeterminar sin índices no cambia el monto', () => {
    expect(redeterminar(500000, 0, 0)).toBe(500000);
  });
  it('valorIndice lee mes+tipo del mapa', () => {
    expect(valorIndice(INDICES, '2026-05', 'cacGeneral')).toBe(1300);
    expect(valorIndice(INDICES, '2026-05', 'cacMateriales')).toBe(1250);
    expect(valorIndice(INDICES, '2026-99', 'cacGeneral')).toBe(0);
  });
  it('variacionPct entre dos meses (1 decimal); null si falta data', () => {
    expect(variacionPct(INDICES, '2026-01', '2026-05', 'cacGeneral')).toBe(30);
    expect(variacionPct(INDICES, '2026-01', '2026-05', 'cacManoObra')).toBe(40);
    expect(variacionPct(INDICES, '2026-01', '2026-99', 'cacGeneral')).toBe(null);
  });
  it('escenario real: cuota de 1.000.000 de enero redeterminada a mayo (CAC general)', () => {
    const base = valorIndice(INDICES, '2026-01', 'cacGeneral');
    const actual = valorIndice(INDICES, '2026-05', 'cacGeneral');
    expect(redeterminar(1000000, base, actual)).toBe(1300000);
  });
  it('INDICES_TIPO / getIndiceTipo', () => {
    expect(INDICES_TIPO.map(t => t.id)).toEqual(['cacGeneral', 'cacMateriales', 'cacManoObra']);
    expect(getIndiceTipo('cacMateriales')?.nombre).toBe('CAC Materiales');
    expect(getIndiceTipo('xx')).toBe(null);
  });
});
