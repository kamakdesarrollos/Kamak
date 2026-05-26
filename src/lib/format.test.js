import { describe, it, expect } from 'vitest';
import {
  fmtN, fmtNAbs, fmtMoney, fmtMoneyAbs, fmtQ,
  fmtFecha, fmtFechaCorta, fmtPct,
} from './format';

// Tests basicos para format.js. Es codigo puro (sin React) — facil de testear
// y centralizado, asi cualquier bug en formateo se cubre desde aca.

describe('fmtN', () => {
  it('formatea con separador de miles es-AR', () => {
    expect(fmtN(1234567)).toBe('1.234.567');
  });

  it('preserva signo negativo', () => {
    expect(fmtN(-100)).toBe('-100');
  });

  it('redondea a entero', () => {
    expect(fmtN(123.7)).toBe('124');
    expect(fmtN(123.4)).toBe('123');
  });

  it('NaN se convierte a 0 (no muestra "NaN")', () => {
    expect(fmtN(NaN)).toBe('0');
    expect(fmtN(undefined)).toBe('0');
    expect(fmtN(null)).toBe('0');
  });

  it('strings numericos se aceptan', () => {
    expect(fmtN('1234')).toBe('1.234');
  });
});

describe('fmtNAbs', () => {
  it('aplica valor absoluto', () => {
    expect(fmtNAbs(-1500)).toBe('1.500');
    expect(fmtNAbs(1500)).toBe('1.500');
  });
});

describe('fmtMoney', () => {
  it('USD muestra "U$S"', () => {
    expect(fmtMoney(1000, 'USD')).toBe('U$S 1.000');
  });

  it('otras monedas (incluido ARS) muestran "$"', () => {
    expect(fmtMoney(1000, 'ARS')).toBe('$ 1.000');
    expect(fmtMoney(1000)).toBe('$ 1.000');
  });
});

describe('fmtMoneyAbs', () => {
  it('valor absoluto + simbolo', () => {
    expect(fmtMoneyAbs(-1500, 'ARS')).toBe('$ 1.500');
  });
});

describe('fmtQ', () => {
  it('cero devuelve "0"', () => {
    expect(fmtQ(0)).toBe('0');
    expect(fmtQ(null)).toBe('0');
  });

  it('hasta 3 decimales', () => {
    expect(fmtQ(12.5)).toBe('12,5');
    expect(fmtQ(1.234)).toBe('1,234');
  });
});

describe('fmtFecha', () => {
  it('ISO YYYY-MM-DD -> DD/MM/YYYY', () => {
    expect(fmtFecha('2026-05-26')).toBe('26/05/2026');
  });

  it('null o vacio -> "—"', () => {
    expect(fmtFecha(null)).toBe('—');
    expect(fmtFecha('')).toBe('—');
    expect(fmtFecha(undefined)).toBe('—');
  });

  it('formato malo devuelve el input original', () => {
    expect(fmtFecha('no-es-fecha')).toBe('no-es-fecha');
  });
});

describe('fmtFechaCorta', () => {
  it('YYYY-MM-DD -> DD/MM/YY', () => {
    expect(fmtFechaCorta('2026-05-26')).toBe('26/05/26');
  });
});

describe('fmtPct', () => {
  it('agrega el simbolo %', () => {
    expect(fmtPct(25)).toBe('25%');
    expect(fmtPct(0)).toBe('0%');
  });

  it('NaN va a 0', () => {
    expect(fmtPct(NaN)).toBe('0%');
  });
});
