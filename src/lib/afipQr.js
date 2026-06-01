// QR de la factura electrónica (RG 4892/5616). La representación VISIBLE del
// comprobante (PDF/impresión que recibe el cliente) debe llevar este QR.
//
// Formato AFIP: una URL  https://www.afip.gob.ar/fe/qr/?p=<base64(JSON)>
// donde el JSON tiene los datos del comprobante emitido + el CAE.
// Spec: https://www.afip.gob.ar/fe/qr/especificaciones.asp
//
// FUNCIONES PURAS Y TESTEADAS: no generan la imagen (eso lo hace `qrcode` en el
// front, ya disponible vía src/lib/clienteAcceso.js → generateQrDataUrl), solo
// arman el contenido (la URL) que se codifica en el QR.

import { getTipoComprobante } from './afip.js';
import { docReceptor } from './wsfe.js';

export const AFIP_QR_BASE = 'https://www.afip.gob.ar/fe/qr/?p=';

// Base64 de un string UTF-8. Funciona en Node (Buffer, tests) y en el browser
// (TextEncoder + btoa) — btoa solo no maneja UTF-8 directo.
export function b64Utf8(str) {
  if (typeof Buffer !== 'undefined') return Buffer.from(str, 'utf8').toString('base64');
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

const soloDigitos = (v) => Number(String(v == null ? '' : v).replace(/\D/g, '')) || 0;

// Arma el objeto JSON del QR según la spec de AFIP.
// tipoDocRec/nroDocRec son opcionales: se omiten para Consumidor Final sin
// identificar (DocTipo 99 / DocNro 0).
export function buildAfipQrData({ fecha, cuit, ptoVta, tipoCmp, nroCmp, importe, moneda = 'PES', ctz = 1, tipoDocRec, nroDocRec, cae }) {
  const data = {
    ver: 1,
    fecha: String(fecha || '').slice(0, 10),   // YYYY-MM-DD
    cuit: soloDigitos(cuit),                    // CUIT del emisor
    ptoVta: Number(ptoVta) || 0,
    tipoCmp: Number(tipoCmp) || 0,
    nroCmp: Number(nroCmp) || 0,
    importe: Number(importe) || 0,
    moneda,
    ctz: Number(ctz) || 1,
    tipoCodAut: 'E',                            // E = CAE (A = CAEA)
    codAut: soloDigitos(cae),
  };
  if (tipoDocRec && Number(tipoDocRec) !== 99 && Number(nroDocRec)) {
    data.tipoDocRec = Number(tipoDocRec);
    data.nroDocRec = Number(nroDocRec);
  }
  return data;
}

// URL completa que se codifica en el QR.
export function buildAfipQrUrl(args) {
  return AFIP_QR_BASE + b64Utf8(JSON.stringify(buildAfipQrData(args)));
}

// Conveniencia: arma la URL del QR desde un comprobante emitido de la app.
// `emisorCuit` es el CUIT con el que se emitió (config de empresa / AFIP_CUIT).
export function afipQrUrlFromComprobante(c, emisorCuit) {
  const tipo = getTipoComprobante(c.tipoId);
  const { DocTipo, DocNro } = docReceptor(c.receptorCuit);
  return buildAfipQrUrl({
    fecha: c.fecha,
    cuit: emisorCuit,
    ptoVta: c.puntoVenta,
    tipoCmp: tipo?.codAfip ?? 0,
    nroCmp: c.numero,
    importe: c.total,
    moneda: c.monId || 'PES',
    ctz: c.monCotiz || 1,
    tipoDocRec: DocTipo,
    nroDocRec: DocNro,
    cae: c.cae,
  });
}
