// Generación de los archivos del LIBRO IVA DIGITAL de AFIP (RG 5363, ex RG 4597).
// Formato de ancho fijo, un registro por línea, separados por CRLF. Layout EXACTO
// según el "Diseño de Registros" oficial de AFIP (Anexo I):
//   • Ventas  — Cabecera (266) + Alícuotas (62)
//   • Compras — Cabecera (325) + Alícuotas (84)
// Las longitudes y posiciones están testeadas en libroIvaDigital.test.js — si AFIP
// rechaza un archivo, casi siempre es por un ancho de campo, no por la lógica.
//
// IMPORTANTE: una Nota de Crédito va con su PROPIO código de comprobante (NC A=3,
// B=8, C=13) e importes POSITIVOS. El tipo ya le dice a AFIP que es un crédito —
// NO se mandan importes negativos (a diferencia de la vista en pantalla).

import { getTipoComprobante, ALICUOTAS_IVA } from './afip';

// ── Builders de campos de ancho fijo ──────────────────────────────────────────
// Alfanumérico: izquierda, rellena con espacios a la derecha, trunca a `len`.
const alpha = (v, len) => String(v ?? '').replace(/[\r\n]+/g, ' ').slice(0, len).padEnd(len, ' ');
// Numérico entero: derecha, rellena con ceros a la izquierda.
const num = (v, len) => String(Math.abs(Math.trunc(Number(v) || 0))).slice(-len).padStart(len, '0');
// Importe: 13 enteros + 2 decimales SIN punto (ej. $1.210,00 → '000000000121000'),
// ancho 15. Siempre positivo (el signo lo da el tipo de comprobante).
const imp = (v, len = 15) => String(Math.round(Math.abs(Number(v) || 0) * 100)).slice(-len).padStart(len, '0');
// Fecha AAAAMMDD desde ISO YYYY-MM-DD.
const fecha = (iso) => String(iso || '').slice(0, 10).replace(/-/g, '').slice(0, 8).padEnd(8, '0');
// Código de alícuota de IVA (tabla AFIP): 21%→5, 10,5%→4, 27%→6, 0%→3. Ancho 4.
const codAlicuota = (pct) => num(ALICUOTAS_IVA.find(a => a.pct === Number(pct))?.codAfip ?? 3, 4);
// Moneda PES y tipo de cambio 1,000000 (4 enteros + 6 decimales → '0001000000').
const MONEDA_PES = 'PES';
const TC_UNO = '0001000000';

// Parte un número de comprobante recibido ("0001-00012345", "1-12345", "12345")
// en { ptoVenta, numero }. Si no trae punto de venta separable, PV = 0.
function partirNumeroRecibido(numeroStr) {
  const grupos = String(numeroStr || '').split(/[^0-9]+/).filter(Boolean);
  if (grupos.length >= 2) return { ptoVenta: grupos[0], numero: grupos[grupos.length - 1] };
  return { ptoVenta: 0, numero: grupos[0] || 0 };
}

// Código AFIP de un comprobante RECIBIDO según su letra (A/B/C) y clase.
// Factura: A=1, B=6, C=11 · Nota de crédito: A=3, B=8, C=13.
function codComprobanteRecibido(letra, clase) {
  const L = String(letra || '').toUpperCase().charAt(0);
  const esNC = clase === 'nota_credito';
  const map = esNC ? { A: 3, B: 8, C: 13 } : { A: 1, B: 6, C: 11 };
  return map[L] || (esNC ? 8 : 6); // default B
}

// Código de documento del comprador/vendedor: 80 = CUIT, 99 = Consumidor Final
// (sin identificar). 11 dígitos → CUIT.
const codDocumento = (cuit) => (String(cuit || '').replace(/\D/g, '').length === 11 ? '80' : '99');
const soloCuit = (cuit) => String(cuit || '').replace(/\D/g, '');

// ── VENTAS ────────────────────────────────────────────────────────────────────
// `comprobantes`: array de comprobantes emitidos del mes (no anulados).
function registroVentaCabecera(c) {
  const t = getTipoComprobante(c.tipoId);
  const conIva = (Number(c.iva) || 0) > 0;
  const docCod = c.receptorCuit ? codDocumento(c.receptorCuit) : '99';
  return [
    fecha(c.fecha),                                  // 1   1-8   fecha
    num(t?.codAfip ?? 0, 3),                          // 2   9-11  tipo comprobante
    num(c.puntoVenta, 5),                             // 3   12-16 punto de venta
    num(c.numero, 20),                                // 4   17-36 número
    num(c.numero, 20),                                // 5   37-56 número hasta (= número, 1 cbte)
    docCod,                                            // 6   57-58 cód documento comprador
    num(soloCuit(c.receptorCuit), 20),                // 7   59-78 nro identificación comprador
    alpha(c.receptorNombre, 30),                      // 8   79-108 apellido/nombre
    imp(c.total),                                      // 9   109-123 importe total operación
    imp(0),                                            // 10  124-138 conceptos no gravados
    imp(0),                                            // 11  139-153 percepción a no categorizados
    imp(conIva ? 0 : c.neto),                          // 12  154-168 operaciones exentas
    imp(0),                                            // 13  169-183 percep/pagos a cta imp. Nacionales
    imp(0),                                            // 14  184-198 percepciones IIBB
    imp(0),                                            // 15  199-213 percepciones Municipales
    imp(0),                                            // 16  214-228 impuestos internos
    MONEDA_PES,                                        // 17  229-231 código de moneda
    TC_UNO,                                            // 18  232-241 tipo de cambio
    num(conIva ? 1 : 0, 1),                            // 19  242 cantidad de alícuotas
    conIva ? ' ' : 'E',                                // 20  243 código de operación (E=exento si no hay IVA)
    imp(0),                                            // 21  244-258 otros tributos
    fecha(c.fecha),                                    // 22  259-266 fecha vto/pago
  ].join('');
}

function registroVentaAlicuota(c) {
  const t = getTipoComprobante(c.tipoId);
  return [
    num(t?.codAfip ?? 0, 3),  // 1  1-3   tipo comprobante
    num(c.puntoVenta, 5),     // 2  4-8   punto de venta
    num(c.numero, 20),        // 3  9-28  número
    imp(c.neto),              // 4  29-43 importe neto gravado
    codAlicuota(c.alicuota),  // 5  44-47 alícuota (código)
    imp(c.iva),               // 6  48-62 impuesto liquidado
  ].join('');
}

// ── COMPRAS ───────────────────────────────────────────────────────────────────
// `compras`: array de movimientos con comprobanteRecibido del mes.
function registroCompraCabecera(m) {
  const cr = m.comprobanteRecibido || {};
  const { ptoVenta, numero } = partirNumeroRecibido(cr.numero);
  const conIva = (Number(cr.iva) || 0) > 0;
  return [
    fecha(m.fecha),                                   // 1   1-8    fecha
    num(codComprobanteRecibido(cr.tipo, cr.clase), 3),// 2   9-11   tipo comprobante
    num(ptoVenta, 5),                                  // 3   12-16  punto de venta
    num(numero, 20),                                   // 4   17-36  número
    alpha('', 16),                                     // 5   37-52  despacho de importación (n/a)
    codDocumento(cr.cuit),                             // 6   53-54  cód documento vendedor
    num(soloCuit(cr.cuit), 20),                        // 7   55-74  nro identificación vendedor
    alpha(m.proveedor, 30),                            // 8   75-104 apellido/nombre vendedor
    imp(cr.total || m.monto),                          // 9   105-119 importe total operación
    imp(0),                                            // 10  120-134 conceptos no gravados
    imp(conIva ? 0 : cr.neto),                         // 11  135-149 operaciones exentas
    imp(m.percepcionIVA),                              // 12  150-164 percep/pagos a cta IVA
    imp(0),                                            // 13  165-179 percep/pagos a cta otros nac.
    imp(m.percepcionIIBB),                             // 14  180-194 percepciones IIBB
    imp(0),                                            // 15  195-209 percepciones Municipales
    imp(0),                                            // 16  210-224 impuestos internos
    MONEDA_PES,                                        // 17  225-227 código de moneda
    TC_UNO,                                            // 18  228-237 tipo de cambio
    num(conIva ? 1 : 0, 1),                            // 19  238 cantidad de alícuotas
    conIva ? ' ' : 'E',                                // 20  239 código de operación
    imp(conIva ? cr.iva : 0),                          // 21  240-254 crédito fiscal computable
    imp(0),                                            // 22  255-269 otros tributos
    num(0, 11),                                        // 23  270-280 CUIT emisor/corredor (n/a)
    alpha('', 30),                                     // 24  281-310 denominación emisor/corredor
    imp(0),                                            // 25  311-325 IVA comisión
  ].join('');
}

function registroCompraAlicuota(m) {
  const cr = m.comprobanteRecibido || {};
  const { ptoVenta, numero } = partirNumeroRecibido(cr.numero);
  return [
    num(codComprobanteRecibido(cr.tipo, cr.clase), 3), // 1  1-3   tipo comprobante
    num(ptoVenta, 5),                                   // 2  4-8   punto de venta
    num(numero, 20),                                    // 3  9-28  número
    codDocumento(cr.cuit),                              // 4  29-30 cód documento vendedor
    num(soloCuit(cr.cuit), 20),                         // 5  31-50 nro identificación vendedor
    imp(cr.neto),                                       // 6  51-65 importe neto gravado
    codAlicuota(cr.alicuota),                           // 7  66-69 alícuota (código)
    imp(cr.iva),                                        // 8  70-84 impuesto liquidado
  ].join('');
}

// ── API pública ───────────────────────────────────────────────────────────────
// Devuelve los 4 archivos como strings (registros separados por CRLF). `ventas`
// son comprobantes emitidos del mes; `compras` son movimientos con
// comprobanteRecibido del mes. Solo se emiten alícuotas para comprobantes con IVA.
export function generarLibroIvaDigital({ ventas = [], compras = [] } = {}) {
  const CRLF = '\r\n';
  const ventasConIva = ventas.filter(c => (Number(c.iva) || 0) > 0);
  const comprasConIva = compras.filter(m => (Number(m.comprobanteRecibido?.iva) || 0) > 0);
  return {
    ventasCbte:        ventas.map(registroVentaCabecera).join(CRLF),
    ventasAlicuotas:   ventasConIva.map(registroVentaAlicuota).join(CRLF),
    comprasCbte:       compras.map(registroCompraCabecera).join(CRLF),
    comprasAlicuotas:  comprasConIva.map(registroCompraAlicuota).join(CRLF),
  };
}

// Nombres de archivo oficiales de AFIP para cada registro.
export const NOMBRES_ARCHIVO_LIBRO_IVA = {
  ventasCbte:       'LIBRO_IVA_DIGITAL_VENTAS_CBTE.txt',
  ventasAlicuotas:  'LIBRO_IVA_DIGITAL_VENTAS_ALICUOTAS.txt',
  comprasCbte:      'LIBRO_IVA_DIGITAL_COMPRAS_CBTE.txt',
  comprasAlicuotas: 'LIBRO_IVA_DIGITAL_COMPRAS_ALICUOTAS.txt',
};

// Longitud oficial de cada registro (para validación/tests).
export const LONGITUD_REGISTRO = {
  ventasCbte: 266, ventasAlicuotas: 62, comprasCbte: 325, comprasAlicuotas: 84,
};

// Exports internos para tests unitarios.
export const _internos = {
  partirNumeroRecibido, codComprobanteRecibido, codDocumento, codAlicuota,
  registroVentaCabecera, registroVentaAlicuota, registroCompraCabecera, registroCompraAlicuota,
};
