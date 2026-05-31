import { describe, it, expect } from 'vitest';
import { feCabReq, feDetReq, feCaeSolicitarPayload, docReceptor, fechaAfip, buildLoginTicketRequest } from './wsfe';

const facturaA = {
  tipoId: 'FA', puntoVenta: 3, fecha: '2026-05-30',
  receptorCuit: '20-12345678-6', receptorCondicion: 'RI',
  neto: 1000000, alicuota: 21, iva: 210000, total: 1210000, conceptoAfip: 1, // productos
};

describe('mapeo comprobante → WSFE (FECAESolicitar)', () => {
  it('FeCabReq: tipo (FA→1), punto de venta, CantReg 1', () => {
    expect(feCabReq(facturaA)).toEqual({ CantReg: 1, PtoVta: 3, CbteTipo: 1 });
  });

  it('Factura A: doc CUIT, importes, alícuota 21% y condición IVA receptor', () => {
    const d = feDetReq(facturaA, { numero: 1235 });
    expect(d.DocTipo).toBe(80);
    expect(d.DocNro).toBe(20123456786);
    expect(d.CbteDesde).toBe(1235);
    expect(d.CbteHasta).toBe(1235);
    expect(d.CbteFch).toBe('20260530');
    expect(d.ImpNeto).toBe(1000000);
    expect(d.ImpIVA).toBe(210000);
    expect(d.ImpTotal).toBe(1210000);
    expect(d.Iva).toEqual([{ Id: 5, BaseImp: 1000000, Importe: 210000 }]); // 21% = código 5
    expect(d.CondicionIVAReceptorId).toBe(1); // RI
    expect(d.MonId).toBe('PES');
  });

  it('Concepto productos (1) NO agrega fechas de servicio', () => {
    const d = feDetReq(facturaA, { numero: 1 });
    expect(d.FchServDesde).toBeUndefined();
  });

  it('Concepto servicios (2) agrega período + vencimiento de pago', () => {
    const d = feDetReq({ ...facturaA, conceptoAfip: 2 }, { numero: 1 });
    expect(d.FchServDesde).toBe('20260530');
    expect(d.FchServHasta).toBe('20260530');
    expect(d.FchVtoPago).toBe('20260530');
  });

  it('Factura B a Consumidor Final sin CUIT → DocTipo 99 / DocNro 0', () => {
    const fb = { tipoId: 'FB', puntoVenta: 1, fecha: '2026-05-01', receptorCuit: '', receptorCondicion: 'CF', neto: 10000, alicuota: 21, iva: 2100, total: 12100, conceptoAfip: 1 };
    const d = feDetReq(fb, { numero: 50 });
    expect(d.DocTipo).toBe(99);
    expect(d.DocNro).toBe(0);
    expect(d.CondicionIVAReceptorId).toBe(5); // CF
  });

  it('comprobante exento (alícuota 0) → neto va a ImpOpEx, sin Iva array', () => {
    const ex = { ...facturaA, alicuota: 0, iva: 0, total: 1000000 };
    const d = feDetReq(ex, { numero: 1 });
    expect(d.ImpNeto).toBe(0);
    expect(d.ImpOpEx).toBe(1000000);
    expect(d.Iva).toBeUndefined();
  });

  it('Nota de Crédito A → CbtesAsoc resuelto desde el comprobante asociado', () => {
    const comprobantes = [{ id: 'cbte-1', tipoId: 'FA', puntoVenta: 3, numero: '00001234', estado: 'emitido' }];
    const nc = { tipoId: 'NCA', puntoVenta: 3, fecha: '2026-05-30', receptorCuit: '20-12345678-6', receptorCondicion: 'RI', neto: 100000, alicuota: 21, iva: 21000, total: 121000, conceptoAfip: 1, comprobanteAsociadoId: 'cbte-1' };
    const d = feDetReq(nc, { numero: 10, comprobantes });
    expect(d.CbtesAsoc).toEqual([{ Tipo: 1, PtoVta: 3, Nro: 1234 }]); // FA=1
  });

  it('feCaeSolicitarPayload arma cabecera + un detalle', () => {
    const p = feCaeSolicitarPayload(facturaA, { numero: 1235 });
    expect(p.FeCabReq.CbteTipo).toBe(1);
    expect(p.FeDetReq).toHaveLength(1);
    expect(p.FeDetReq[0].CbteDesde).toBe(1235);
  });
});

describe('helpers WSAA / formato', () => {
  it('fechaAfip convierte ISO a YYYYMMDD', () => {
    expect(fechaAfip('2026-05-30')).toBe('20260530');
    expect(fechaAfip('')).toBe('');
  });
  it('docReceptor: CUIT (11)→80, DNI (7-8)→96, sino 99', () => {
    expect(docReceptor('20-12345678-6')).toEqual({ DocTipo: 80, DocNro: 20123456786 });
    expect(docReceptor('12345678')).toEqual({ DocTipo: 96, DocNro: 12345678 });
    expect(docReceptor('')).toEqual({ DocTipo: 99, DocNro: 0 });
  });
  it('buildLoginTicketRequest arma el LTR con header y service', () => {
    const xml = buildLoginTicketRequest({ service: 'wsfe', uniqueId: 123, generationTime: '2026-05-30T10:00:00-03:00', expirationTime: '2026-05-30T22:00:00-03:00' });
    expect(xml).toContain('<service>wsfe</service>');
    expect(xml).toContain('<uniqueId>123</uniqueId>');
    expect(xml).toContain('loginTicketRequest');
  });
});
