import { describe, it, expect } from 'vitest';
import { buildAfipQrData, buildAfipQrUrl, afipQrUrlFromComprobante, AFIP_QR_BASE, b64Utf8 } from './afipQr';

// Decodifica la URL del QR de vuelta al objeto JSON (round-trip).
function decodeQr(url) {
  const p = url.slice(AFIP_QR_BASE.length);
  const json = typeof Buffer !== 'undefined'
    ? Buffer.from(p, 'base64').toString('utf8')
    : decodeURIComponent(escape(atob(p)));
  return JSON.parse(json);
}

const args = {
  fecha: '2026-05-30', cuit: '30-71795385-8', ptoVta: 3, tipoCmp: 1,
  nroCmp: 1235, importe: 1210000, moneda: 'PES', ctz: 1,
  tipoDocRec: 80, nroDocRec: 20123456786, cae: '75123456789012',
};

describe('buildAfipQrData (RG 4892)', () => {
  it('arma el JSON con ver=1, CAE como tipoCodAut E y CUIT/CAE solo dígitos', () => {
    const d = buildAfipQrData(args);
    expect(d.ver).toBe(1);
    expect(d.fecha).toBe('2026-05-30');
    expect(d.cuit).toBe(30717953858);           // sin guiones
    expect(d.ptoVta).toBe(3);
    expect(d.tipoCmp).toBe(1);
    expect(d.nroCmp).toBe(1235);
    expect(d.importe).toBe(1210000);
    expect(d.tipoCodAut).toBe('E');
    expect(d.codAut).toBe(75123456789012);
    expect(d.tipoDocRec).toBe(80);
    expect(d.nroDocRec).toBe(20123456786);
  });

  it('omite doc del receptor para Consumidor Final sin identificar (DocTipo 99)', () => {
    const d = buildAfipQrData({ ...args, tipoDocRec: 99, nroDocRec: 0 });
    expect(d.tipoDocRec).toBeUndefined();
    expect(d.nroDocRec).toBeUndefined();
  });

  it('fecha se normaliza a YYYY-MM-DD aunque venga con hora', () => {
    expect(buildAfipQrData({ ...args, fecha: '2026-05-30T12:00:00Z' }).fecha).toBe('2026-05-30');
  });
});

describe('buildAfipQrUrl', () => {
  it('empieza con la base de AFIP y round-trip decodifica al mismo JSON', () => {
    const url = buildAfipQrUrl(args);
    expect(url.startsWith(AFIP_QR_BASE)).toBe(true);
    expect(decodeQr(url)).toEqual(buildAfipQrData(args));
  });

  it('b64Utf8 produce base64 válido y reversible', () => {
    const s = '{"a":"áéí","n":1}';
    expect(JSON.parse(Buffer.from(b64Utf8(s), 'base64').toString('utf8'))).toEqual({ a: 'áéí', n: 1 });
  });
});

describe('afipQrUrlFromComprobante', () => {
  it('mapea un comprobante emitido (tipoId→codAfip, receptor→doc) a la URL del QR', () => {
    const c = {
      tipoId: 'FA', fecha: '2026-05-30', puntoVenta: 3, numero: 1235,
      total: 1210000, receptorCuit: '20-12345678-6', cae: '75123456789012',
    };
    const d = decodeQr(afipQrUrlFromComprobante(c, '30-71795385-8'));
    expect(d.tipoCmp).toBe(1);           // FA → 1
    expect(d.cuit).toBe(30717953858);
    expect(d.ptoVta).toBe(3);
    expect(d.nroCmp).toBe(1235);
    expect(d.tipoDocRec).toBe(80);       // CUIT
    expect(d.nroDocRec).toBe(20123456786);
    expect(d.codAut).toBe(75123456789012);
  });
});
