// Mapeo de un comprobante de la app a la estructura del Web Service de Factura
// Electrónica de AFIP (WSFEv1 · método FECAESolicitar). FUNCIONES PURAS Y TESTEADAS.
//
// afip.js ya tiene todos los códigos AFIP (tipos de comprobante, alícuotas,
// condiciones IVA, conceptos) justamente para que este mapeo sea directo. Acá NO
// se hace ninguna llamada de red: solo se ARMA el payload. La conexión real
// (WSAA para el token + WSFE para pedir el CAE) vive en api/afip/, necesita el
// certificado AFIP y se prueba primero en homologación (ver docs/WSFE-SETUP.md).

import {
  getTipoComprobante, ALICUOTAS_IVA, getCondicionIVA,
  CONCEPTO_AFIP_DEFAULT, resolverComprobanteAsociado, round2,
} from './afip.js';

// Fecha YYYYMMDD (formato AFIP) desde ISO 'YYYY-MM-DD'.
export const fechaAfip = (iso) => String(iso || '').slice(0, 10).replace(/-/g, '');

// Tipo y número de documento del receptor para WSFE.
// 80 = CUIT, 96 = DNI, 99 = Consumidor Final / Sin identificar (DocNro 0).
export function docReceptor(cuit) {
  const d = String(cuit || '').replace(/\D/g, '');
  if (d.length === 11) return { DocTipo: 80, DocNro: Number(d) };
  if (d.length >= 7 && d.length <= 8) return { DocTipo: 96, DocNro: Number(d) };
  return { DocTipo: 99, DocNro: 0 };
}

// Cabecera FeCabReq (un comprobante por request).
export function feCabReq(c) {
  const tipo = getTipoComprobante(c.tipoId);
  return { CantReg: 1, PtoVta: Number(c.puntoVenta) || 0, CbteTipo: tipo?.codAfip ?? 0 };
}

// Detalle FeDetReq. `numero` lo asigna AFIP (último autorizado + 1 vía
// FECompUltimoAutorizado); se pasa como parámetro porque el borrador no lo tiene.
// `comprobantes` se usa para resolver el comprobante asociado de una NC/ND.
export function feDetReq(c, { numero, comprobantes = [] } = {}) {
  const tipo  = getTipoComprobante(c.tipoId);
  const neto  = round2(c.neto);
  const iva   = round2(c.iva);
  const total = round2(c.total);
  const conIva = iva > 0;
  const aliCod = ALICUOTAS_IVA.find(a => a.pct === Number(c.alicuota))?.codAfip ?? 5;
  const concepto = Number(c.conceptoAfip) || CONCEPTO_AFIP_DEFAULT;
  const { DocTipo, DocNro } = docReceptor(c.receptorCuit);

  const det = {
    Concepto: concepto,
    DocTipo, DocNro,
    CbteDesde: Number(numero), CbteHasta: Number(numero),
    CbteFch: fechaAfip(c.fecha),
    ImpTotal: total,
    ImpTotConc: 0,                          // neto no gravado
    ImpNeto: conIva ? neto : 0,             // si no hay IVA, el neto va como exento
    ImpOpEx: conIva ? 0 : neto,
    ImpIVA: iva,
    ImpTrib: 0,
    MonId: 'PES', MonCotiz: 1,
    // Condición frente al IVA del receptor (RG 5616, obligatoria).
    CondicionIVAReceptorId: getCondicionIVA(c.receptorCondicion)?.codAfip ?? 5,
  };
  if (conIva) det.Iva = [{ Id: aliCod, BaseImp: neto, Importe: iva }];

  // Servicios (concepto 2) o productos+servicios (3) → AFIP exige el período del
  // servicio y la fecha de vencimiento de pago.
  if (concepto === 2 || concepto === 3) {
    const f = fechaAfip(c.fecha);
    det.FchServDesde = f; det.FchServHasta = f; det.FchVtoPago = f;
  }

  // Nota de Crédito/Débito → comprobante asociado (RG 5824).
  if (/^(NC|ND)/.test(tipo?.id || '')) {
    const asoc = resolverComprobanteAsociado(c.comprobanteAsociadoId, comprobantes);
    if (asoc && asoc.numero) {
      det.CbtesAsoc = [{
        Tipo: asoc.codAfip,
        PtoVta: Number(asoc.puntoVenta) || 0,
        Nro: Number(String(asoc.numero).replace(/\D/g, '')) || 0,
      }];
    }
  }
  return det;
}

// Payload completo de FECAESolicitar (sin Auth, que lo agrega el cliente WSFE).
export function feCaeSolicitarPayload(c, opts = {}) {
  return { FeCabReq: feCabReq(c), FeDetReq: [feDetReq(c, opts)] };
}

// ── WSAA: Login Ticket Request (XML a firmar con el certificado) ──────────────
// uniqueId/generationTime/expirationTime se pasan para que sea testeable (en
// runtime se generan con Date.now). El TA resultante (token+sign) dura ~12hs.
export function buildLoginTicketRequest({ service = 'wsfe', uniqueId, generationTime, expirationTime }) {
  return '<?xml version="1.0" encoding="UTF-8"?>'
    + '<loginTicketRequest version="1.0">'
    + '<header>'
    + `<uniqueId>${uniqueId}</uniqueId>`
    + `<generationTime>${generationTime}</generationTime>`
    + `<expirationTime>${expirationTime}</expirationTime>`
    + '</header>'
    + `<service>${service}</service>`
    + '</loginTicketRequest>';
}
