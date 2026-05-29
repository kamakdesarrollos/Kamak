import { describe, it, expect } from 'vitest';
import {
  validarCUIT, formatCUIT, round2,
  calcDesdeNeto, calcDesdeTotal, tipoFacturaSugerido,
  validarComprobante, getTipoComprobante,
} from './afip';

describe('validarCUIT', () => {
  it('acepta el CUIT real del emisor (Conquies SA)', () => {
    expect(validarCUIT('30-71795385-8')).toBe(true);
    expect(validarCUIT('30717953858')).toBe(true); // sin guiones
  });
  it('acepta otro CUIT válido conocido', () => {
    expect(validarCUIT('20-12345678-6')).toBe(true);
  });
  it('rechaza dígito verificador incorrecto', () => {
    expect(validarCUIT('30-71795385-0')).toBe(false);
    expect(validarCUIT('20-12345678-0')).toBe(false);
  });
  it('rechaza largo incorrecto', () => {
    expect(validarCUIT('30-7179538-8')).toBe(false);
    expect(validarCUIT('123')).toBe(false);
    expect(validarCUIT('')).toBe(false);
    expect(validarCUIT(null)).toBe(false);
  });
  it('rechaza 11 dígitos iguales', () => {
    expect(validarCUIT('11111111111')).toBe(false);
  });
});

describe('formatCUIT', () => {
  it('formatea a XX-XXXXXXXX-X', () => {
    expect(formatCUIT('30717953858')).toBe('30-71795385-8');
  });
  it('deja igual si no tiene 11 dígitos', () => {
    expect(formatCUIT('123')).toBe('123');
  });
});

describe('round2', () => {
  it('redondea a centavos', () => {
    expect(round2(6.9993)).toBe(7);
    expect(round2(1210.005)).toBe(1210.01);
    expect(round2(1000)).toBe(1000);
  });
});

describe('calcDesdeNeto', () => {
  it('IVA 21%', () => {
    expect(calcDesdeNeto(1000, 21)).toEqual({ neto: 1000, iva: 210, total: 1210 });
  });
  it('IVA 10,5%', () => {
    expect(calcDesdeNeto(1000, 10.5)).toEqual({ neto: 1000, iva: 105, total: 1105 });
  });
  it('IVA 0%', () => {
    expect(calcDesdeNeto(1000, 0)).toEqual({ neto: 1000, iva: 0, total: 1000 });
  });
  it('redondea el IVA a centavos', () => {
    expect(calcDesdeNeto(33.33, 21)).toEqual({ neto: 33.33, iva: 7, total: 40.33 });
  });
});

describe('calcDesdeTotal (desarmar el total en neto + IVA)', () => {
  it('21% — 1210 → neto 1000', () => {
    expect(calcDesdeTotal(1210, 21)).toEqual({ neto: 1000, iva: 210, total: 1210 });
  });
  it('10,5% — 1105 → neto 1000', () => {
    expect(calcDesdeTotal(1105, 10.5)).toEqual({ neto: 1000, iva: 105, total: 1105 });
  });
});

describe('tipoFacturaSugerido', () => {
  it('Responsable Inscripto → Factura A', () => {
    expect(tipoFacturaSugerido('RI')).toBe('FA');
  });
  it('Consumidor Final / Monotributo / Exento → Factura B', () => {
    expect(tipoFacturaSugerido('CF')).toBe('FB');
    expect(tipoFacturaSugerido('MT')).toBe('FB');
    expect(tipoFacturaSugerido('EX')).toBe('FB');
  });
});

describe('getTipoComprobante', () => {
  it('trae los códigos AFIP correctos', () => {
    expect(getTipoComprobante('FA').codAfip).toBe(1);
    expect(getTipoComprobante('FB').codAfip).toBe(6);
    expect(getTipoComprobante('NCA').signo).toBe(-1);
  });
});

describe('validarComprobante', () => {
  const base = {
    tipoId: 'FA',
    emisorCuit: '30-71795385-8',
    puntoVenta: 1,
    receptorCuit: '20-12345678-6',
    receptorCondicion: 'RI',
    neto: 1000, alicuota: 21, iva: 210, total: 1210,
    fecha: '2026-05-29',
  };
  it('una Factura A bien armada no tiene errores', () => {
    expect(validarComprobante(base)).toEqual([]);
  });
  it('Factura A a un Consumidor Final → error', () => {
    const errores = validarComprobante({ ...base, receptorCondicion: 'CF' });
    expect(errores.some(e => /Responsable Inscripto/.test(e))).toBe(true);
  });
  it('Factura A con CUIT receptor inválido → error', () => {
    const errores = validarComprobante({ ...base, receptorCuit: '20-12345678-0' });
    expect(errores.some(e => /CUIT del receptor/.test(e))).toBe(true);
  });
  it('neto 0 → error', () => {
    expect(validarComprobante({ ...base, neto: 0, iva: 0, total: 0 }).some(e => /neto/.test(e))).toBe(true);
  });
  it('IVA incoherente → error', () => {
    expect(validarComprobante({ ...base, iva: 999 }).some(e => /IVA no coincide/.test(e))).toBe(true);
  });
  it('total incoherente → error', () => {
    expect(validarComprobante({ ...base, total: 9999 }).some(e => /total no coincide/.test(e))).toBe(true);
  });
  it('Factura B a Consumidor Final sin CUIT → OK', () => {
    const fb = { ...base, tipoId: 'FB', receptorCondicion: 'CF', receptorCuit: '' };
    expect(validarComprobante(fb)).toEqual([]);
  });
  it('emisor con CUIT inválido → error', () => {
    expect(validarComprobante({ ...base, emisorCuit: '30-00000000-0' }).some(e => /emisor/.test(e))).toBe(true);
  });
});
