import { describe, it, expect } from 'vitest';
import {
  generarLibroIvaDigital, LONGITUD_REGISTRO, _internos,
} from './libroIvaDigital';

const {
  partirNumeroRecibido, codComprobanteRecibido, codDocumento, codAlicuota,
  registroVentaCabecera, registroVentaAlicuota, registroCompraCabecera, registroCompraAlicuota,
} = _internos;

// Factura A emitida: neto 1.000.000 + IVA 21% 210.000 = total 1.210.000.
const ventaA = {
  tipoId: 'FA', puntoVenta: 3, numero: '12345', fecha: '2026-05-30',
  receptorNombre: 'ACME SA', receptorCuit: '30-71795385-8', receptorCondicion: 'RI',
  neto: 1000000, alicuota: 21, iva: 210000, total: 1210000,
};
// Compra: Factura A recibida 0001-00012345, neto 1.000.000 IVA 210.000 total 1.210.000.
const compraA = {
  fecha: '2026-05-28', proveedor: 'Proveedor SRL',
  comprobanteRecibido: { clase: 'factura', tipo: 'A', numero: '0001-00012345', cuit: '30707703793', neto: 1000000, iva: 210000, alicuota: 21, total: 1210000 },
};
// Nota de crédito recibida B.
const ncB = {
  fecha: '2026-05-29', proveedor: 'Mayorista X',
  comprobanteRecibido: { clase: 'nota_credito', tipo: 'B', numero: '0002-55', cuit: '30707703793', neto: 100000, iva: 21000, alicuota: 21, total: 121000 },
};

describe('longitud EXACTA de cada registro (red de seguridad anti-rechazo AFIP)', () => {
  it('Venta Cabecera = 266', () => expect(registroVentaCabecera(ventaA)).toHaveLength(266));
  it('Venta Alícuota = 62', () => expect(registroVentaAlicuota(ventaA)).toHaveLength(62));
  it('Compra Cabecera = 325', () => expect(registroCompraCabecera(compraA)).toHaveLength(325));
  it('Compra Alícuota = 84', () => expect(registroCompraAlicuota(compraA)).toHaveLength(84));
  it('NC recibida también respeta el largo de cabecera', () => expect(registroCompraCabecera(ncB)).toHaveLength(325));
});

describe('posiciones de campos clave — Venta Cabecera', () => {
  const r = registroVentaCabecera(ventaA);
  it('fecha AAAAMMDD en 1-8', () => expect(r.slice(0, 8)).toBe('20260530'));
  it('tipo comprobante (FA=1) en 9-11', () => expect(r.slice(8, 11)).toBe('001'));
  it('punto de venta en 12-16', () => expect(r.slice(11, 16)).toBe('00003'));
  it('número en 17-36', () => expect(r.slice(16, 36)).toBe('00000000000000012345'));
  it('cód documento comprador (CUIT=80) en 57-58', () => expect(r.slice(56, 58)).toBe('80'));
  it('CUIT comprador (solo dígitos) en 59-78', () => expect(r.slice(58, 78)).toBe('00000000030717953858'));
  it('importe total 1.210.000 → centavos en 109-123', () => expect(r.slice(108, 123)).toBe('000000121000000'));
  it('moneda PES en 229-231', () => expect(r.slice(228, 231)).toBe('PES'));
  it('tipo de cambio 1,000000 en 232-241', () => expect(r.slice(231, 241)).toBe('0001000000'));
  it('cantidad de alícuotas = 1 en 242', () => expect(r.slice(241, 242)).toBe('1'));
});

describe('posiciones de campos clave — Venta Alícuota', () => {
  const r = registroVentaAlicuota(ventaA);
  it('neto gravado en 29-43', () => expect(r.slice(28, 43)).toBe('000000100000000'));
  it('código de alícuota 21% = 0005 en 44-47', () => expect(r.slice(43, 47)).toBe('0005'));
  it('impuesto liquidado en 48-62', () => expect(r.slice(47, 62)).toBe('000000021000000'));
});

describe('posiciones de campos clave — Compra Cabecera', () => {
  const r = registroCompraCabecera(compraA);
  it('tipo (Factura A recibida = 1) en 9-11', () => expect(r.slice(8, 11)).toBe('001'));
  it('punto de venta parseado del número (0001) en 12-16', () => expect(r.slice(11, 16)).toBe('00001'));
  it('número correlativo (12345) en 17-36', () => expect(r.slice(16, 36)).toBe('00000000000000012345'));
  it('crédito fiscal computable (IVA) en 240-254', () => expect(r.slice(239, 254)).toBe('000000021000000'));
});

describe('códigos y helpers', () => {
  it('partirNumeroRecibido separa PV y número', () => {
    expect(partirNumeroRecibido('0001-00012345')).toEqual({ ptoVenta: '0001', numero: '00012345' });
    expect(partirNumeroRecibido('12345')).toEqual({ ptoVenta: 0, numero: '12345' });
  });
  it('codComprobanteRecibido: factura A=1/B=6/C=11, NC A=3/B=8/C=13', () => {
    expect(codComprobanteRecibido('A', 'factura')).toBe(1);
    expect(codComprobanteRecibido('B', 'factura')).toBe(6);
    expect(codComprobanteRecibido('C', 'factura')).toBe(11);
    expect(codComprobanteRecibido('A', 'nota_credito')).toBe(3);
    expect(codComprobanteRecibido('B', 'nota_credito')).toBe(8);
    expect(codComprobanteRecibido('C', 'nota_credito')).toBe(13);
  });
  it('codDocumento: 11 dígitos = CUIT (80), sino Consumidor Final (99)', () => {
    expect(codDocumento('30-71795385-8')).toBe('80');
    expect(codDocumento('')).toBe('99');
  });
  it('codAlicuota mapea el % al código AFIP de 4 dígitos', () => {
    expect(codAlicuota(21)).toBe('0005');
    expect(codAlicuota(10.5)).toBe('0004');
    expect(codAlicuota(27)).toBe('0006');
    expect(codAlicuota(0)).toBe('0003');
  });
  it('una NC va con su código (8) e importe POSITIVO, no negativo', () => {
    const r = registroCompraCabecera(ncB);
    expect(r.slice(8, 11)).toBe('008');                 // NC B = 8
    expect(r.slice(104, 119)).toBe('000000012100000');  // total 121.000 positivo
  });
});

describe('generarLibroIvaDigital (integración)', () => {
  it('arma los 4 archivos con una línea por comprobante', () => {
    const out = generarLibroIvaDigital({ ventas: [ventaA], compras: [compraA, ncB] });
    expect(out.ventasCbte.split('\r\n')).toHaveLength(1);
    expect(out.ventasAlicuotas.split('\r\n')).toHaveLength(1);
    expect(out.comprasCbte.split('\r\n')).toHaveLength(2);
    expect(out.comprasAlicuotas.split('\r\n')).toHaveLength(2);
  });
  it('un comprobante sin IVA no genera registro de alícuota', () => {
    const ventaC = { tipoId: 'FB', puntoVenta: 1, numero: '1', fecha: '2026-05-01', receptorNombre: 'CF', receptorCuit: '', neto: 5000, alicuota: 0, iva: 0, total: 5000 };
    const out = generarLibroIvaDigital({ ventas: [ventaC], compras: [] });
    expect(out.ventasCbte).not.toBe('');
    expect(out.ventasAlicuotas).toBe(''); // sin IVA → sin alícuota
  });
  it('LONGITUD_REGISTRO documenta los anchos oficiales', () => {
    expect(LONGITUD_REGISTRO).toEqual({ ventasCbte: 266, ventasAlicuotas: 62, comprasCbte: 325, comprasAlicuotas: 84 });
  });
});
