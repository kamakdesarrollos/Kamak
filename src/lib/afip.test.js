import { describe, it, expect } from 'vitest';
import {
  validarCUIT, formatCUIT, round2,
  calcDesdeNeto, calcDesdeTotal, tipoFacturaSugerido,
  validarComprobante, getTipoComprobante,
  fingerprintRecibido, buscarDuplicadoRecibido,
  fingerprintEmitido, buscarDuplicadoEmitido,
  parseMoneyAR,
} from './afip';

describe('parseMoneyAR', () => {
  it('parsea enteros simples', () => {
    expect(parseMoneyAR('1500')).toBe(1500);
    expect(parseMoneyAR(1500)).toBe(1500);
  });
  it('parsea formato AR (punto miles, coma decimal)', () => {
    expect(parseMoneyAR('1.500,75')).toBe(1500.75);
    expect(parseMoneyAR('1.500.000,00')).toBe(1500000);
    expect(parseMoneyAR('1.500')).toBe(1500);
  });
  it('parsea formato US (punto decimal)', () => {
    expect(parseMoneyAR('1500.75')).toBe(1500.75);
    expect(parseMoneyAR('1.5')).toBe(1.5);
  });
  it('tolera símbolo $ y espacios', () => {
    expect(parseMoneyAR('$ 1.500,75')).toBe(1500.75);
    expect(parseMoneyAR('$1500')).toBe(1500);
    expect(parseMoneyAR('  1500  ')).toBe(1500);
  });
  it('devuelve 0 para entradas inválidas/vacías', () => {
    expect(parseMoneyAR('')).toBe(0);
    expect(parseMoneyAR(null)).toBe(0);
    expect(parseMoneyAR(undefined)).toBe(0);
    expect(parseMoneyAR('abc')).toBe(0);
    expect(parseMoneyAR(NaN)).toBe(0);
  });
});

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

describe('fingerprintRecibido', () => {
  it('con N°: misma factura → misma huella (normaliza guiones y ceros)', () => {
    const a = fingerprintRecibido({ tipo: 'A', numero: '0001-00012345', cuit: '30-71795385-8', total: 12000 });
    const b = fingerprintRecibido({ tipo: 'A', numero: '1-12345',       cuit: '30717953858',   total: 12000.00 });
    expect(a).toBe(b);
  });
  it('CUIT distinto → huella distinta', () => {
    const a = fingerprintRecibido({ tipo: 'A', numero: '1', cuit: '30-71795385-8', total: 100 });
    const b = fingerprintRecibido({ tipo: 'A', numero: '1', cuit: '20-12345678-6', total: 100 });
    expect(a).not.toBe(b);
  });
  it('Total distinto → huella distinta', () => {
    expect(fingerprintRecibido({ tipo: 'A', numero: '1', cuit: 'x', total: 100 }))
      .not.toBe(fingerprintRecibido({ tipo: 'A', numero: '1', cuit: 'x', total: 200 }));
  });
  it('Sin N°: usa proveedor + fecha + total (case-insensitive)', () => {
    const a = fingerprintRecibido({ proveedor: 'YPF El Cruce', fecha: '2026-05-30', total: 120050 });
    const b = fingerprintRecibido({ proveedor: 'YPF EL CRUCE', fecha: '2026-05-30', total: 120050 });
    expect(a).toBe(b);
  });
  it('Sin N° y sin proveedor → null (huella no confiable)', () => {
    expect(fingerprintRecibido({ fecha: '2026-05-30', total: 100 })).toBe(null);
  });
  it('Total 0 → null', () => {
    expect(fingerprintRecibido({ tipo: 'A', numero: '1', cuit: 'x', total: 0 })).toBe(null);
  });
});

describe('buscarDuplicadoRecibido', () => {
  const cand = { tipo: 'B', numero: '0001-00012345', cuit: '30-71795385-8', total: 12000, proveedor: 'YPF', fecha: '2026-05-30' };
  it('encuentra match en movimientos por comprobanteRecibido', () => {
    const movs = [{
      id: 'm1', proveedor: 'YPF SA', fecha: '2026-05-30',
      comprobanteRecibido: { tipo: 'B', numero: '1-12345', cuit: '30717953858', total: 12000 },
    }];
    expect(buscarDuplicadoRecibido(cand, { movimientos: movs })?.en).toBe('movimiento');
  });
  it('no encuentra si el N° es distinto', () => {
    const movs = [{
      comprobanteRecibido: { tipo: 'B', numero: '1-99999', cuit: '30717953858', total: 12000 },
    }];
    expect(buscarDuplicadoRecibido(cand, { movimientos: movs })).toBe(null);
  });
  it('encuentra match en pendings (factura en buzón)', () => {
    const pendings = [{
      tipoPendiente: 'factura', tipoFactura: 'B', numeroFactura: '1-12345',
      cuit: '30717953858', montoTotal: 12000,
    }];
    expect(buscarDuplicadoRecibido(cand, { pendings })?.en).toBe('pending');
  });
  it('encuentra match en pendings de movimiento con comprobanteRecibido', () => {
    const pendings = [{
      tipoPendiente: 'movimiento',
      movimiento: { proveedor: 'YPF', fecha: '2026-05-30', comprobanteRecibido: { tipo: 'B', numero: '12345', cuit: '30717953858', total: 12000 } },
    }];
    expect(buscarDuplicadoRecibido(cand, { pendings })?.en).toBe('pending');
  });
  it('legacy fallback: mov viejo con referencia + proveedor parecido → match', () => {
    const movs = [{ id: 'mLegacy', referencia: '0001-12345', proveedor: 'YPF SA', monto: 12000, fecha: '2026-05-29' }];
    expect(buscarDuplicadoRecibido(cand, { movimientos: movs })?.en).toBe('movimiento');
  });
  it('sin huella confiable → null (no rompe)', () => {
    expect(buscarDuplicadoRecibido({ total: 0 }, { movimientos: [] })).toBe(null);
  });
});

describe('fingerprintEmitido / buscarDuplicadoEmitido', () => {
  it('postemisión: mismo tipo+PV+número → misma huella', () => {
    expect(fingerprintEmitido({ tipoId: 'FA', puntoVenta: 1, numero: '00012345' }))
      .toBe(fingerprintEmitido({ tipoId: 'FA', puntoVenta: 1, numero: '12345' }));
  });
  it('borrador: mismo tipo+cliente+fecha+total → misma huella', () => {
    expect(fingerprintEmitido({ tipoId: 'FB', clienteId: 'cl-1', fecha: '2026-05-30', total: 12000 }))
      .toBe(fingerprintEmitido({ tipoId: 'FB', clienteId: 'cl-1', fecha: '2026-05-30', total: 12000 }));
  });
  it('borrador con cliente distinto → distinta huella', () => {
    expect(fingerprintEmitido({ tipoId: 'FB', clienteId: 'cl-1', fecha: '2026-05-30', total: 12000 }))
      .not.toBe(fingerprintEmitido({ tipoId: 'FB', clienteId: 'cl-2', fecha: '2026-05-30', total: 12000 }));
  });
  it('buscarDuplicadoEmitido: encuentra borrador parecido (ignora anulado y el propio)', () => {
    const lista = [
      { id: 'c1', tipoId: 'FB', clienteId: 'cl-1', fecha: '2026-05-30', total: 12000, estado: 'borrador' },
      { id: 'c2', tipoId: 'FB', clienteId: 'cl-1', fecha: '2026-05-30', total: 12000, estado: 'anulado' },
    ];
    const dup = buscarDuplicadoEmitido({ id: 'nuevo', tipoId: 'FB', clienteId: 'cl-1', fecha: '2026-05-30', total: 12000 }, lista);
    expect(dup?.id).toBe('c1');
    // Si lo busco contra sí mismo no hay match
    expect(buscarDuplicadoEmitido(lista[0], lista)).toBe(null);
  });
});
