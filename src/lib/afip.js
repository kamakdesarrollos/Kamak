// Núcleo fiscal para facturación electrónica AFIP/ARCA (Argentina).
//
// FUNCIONES PURAS Y TESTEADAS — acá no puede fallar un número (ver afip.test.js).
// Este módulo NO hace llamadas a AFIP: solo ARMA, VALIDA y CALCULA comprobantes
// del lado de la app. La conexión real con el web service de AFIP (WSFE) se hace
// aparte, más adelante; por eso dejamos los CÓDIGOS de AFIP listos en cada
// constante, para que esa integración sea un mapeo directo y sin sorpresas.
//
// Emisor: Conquies Soluciones Constructivas SA (marca comercial Kamak),
// Responsable Inscripto → emite Factura A (a Responsables Inscriptos) y Factura B
// (a Consumidor Final / Monotributo / Exento), con IVA discriminado (21% / 10,5%).

// ── Condiciones frente al IVA (incluye el código AFIP del RECEPTOR, que AFIP
//    exige declarar en el comprobante electrónico). ────────────────────────────
export const CONDICIONES_IVA = [
  { id: 'RI', nombre: 'Responsable Inscripto', codAfip: 1 },
  { id: 'MT', nombre: 'Monotributo',           codAfip: 6 },
  { id: 'EX', nombre: 'Exento',                codAfip: 4 },
  { id: 'CF', nombre: 'Consumidor Final',      codAfip: 5 },
];

// ── Alícuotas de IVA habilitadas (con código AFIP de cada una). ───────────────
export const ALICUOTAS_IVA = [
  { pct: 21,   codAfip: 5 },
  { pct: 10.5, codAfip: 4 },
  { pct: 27,   codAfip: 6 },
  { pct: 0,    codAfip: 3 },
];

// ── Tipos de comprobante de un emisor Responsable Inscripto (código AFIP). ────
export const TIPOS_COMPROBANTE = [
  { id: 'FA',  nombre: 'Factura A',          codAfip: 1, letra: 'A', signo:  1 },
  { id: 'NDA', nombre: 'Nota de Débito A',   codAfip: 2, letra: 'A', signo:  1 },
  { id: 'NCA', nombre: 'Nota de Crédito A',  codAfip: 3, letra: 'A', signo: -1 },
  { id: 'FB',  nombre: 'Factura B',          codAfip: 6, letra: 'B', signo:  1 },
  { id: 'NDB', nombre: 'Nota de Débito B',   codAfip: 7, letra: 'B', signo:  1 },
  { id: 'NCB', nombre: 'Nota de Crédito B',  codAfip: 8, letra: 'B', signo: -1 },
];

export const getTipoComprobante = (id) => TIPOS_COMPROBANTE.find(t => t.id === id) || null;
export const getCondicionIVA   = (id) => CONDICIONES_IVA.find(c => c.id === id) || null;

// Redondeo a 2 decimales (centavos), estable ante errores de float.
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// ── Validación de CUIT (dígito verificador mod-11, algoritmo AFIP) ────────────
// Devuelve true solo si los 11 dígitos y el verificador son correctos.
export function validarCUIT(cuit) {
  const d = String(cuit || '').replace(/\D/g, '');
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false; // 11 dígitos iguales → inválido
  const mult = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(d[i]) * mult[i];
  let dv = 11 - (sum % 11);
  if (dv === 11) dv = 0;
  if (dv === 10) dv = 9;
  return dv === Number(d[10]);
}

// Formatea un CUIT como XX-XXXXXXXX-X (si no tiene 11 dígitos lo devuelve igual).
export function formatCUIT(cuit) {
  const d = String(cuit || '').replace(/\D/g, '');
  if (d.length !== 11) return String(cuit || '');
  return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`;
}

// ── Cálculo de IVA ────────────────────────────────────────────────────────────
// Desde el NETO (base imponible) + alícuota → { neto, iva, total }.
export function calcDesdeNeto(neto, alicuotaPct) {
  const n = round2(neto);
  const iva = round2(n * (Number(alicuotaPct) || 0) / 100);
  return { neto: n, iva, total: round2(n + iva) };
}

// Desde el TOTAL (final, con IVA) + alícuota → { neto, iva, total }.
// Útil cuando se conoce el precio final (ej. el monto de una cuota) y hay que
// "desarmarlo" en neto + IVA.
export function calcDesdeTotal(total, alicuotaPct) {
  const t = round2(total);
  const a = Number(alicuotaPct) || 0;
  const neto = round2(t / (1 + a / 100));
  return { neto, iva: round2(t - neto), total: t };
}

// ── Tipo de factura sugerido (emisor Responsable Inscripto) ───────────────────
// A si el receptor es Responsable Inscripto; B en cualquier otro caso.
export function tipoFacturaSugerido(condReceptorId) {
  return condReceptorId === 'RI' ? 'FA' : 'FB';
}

// ── Validación de un comprobante ANTES de emitirlo ────────────────────────────
// Devuelve un array de mensajes de error (vacío = listo para emitir). NO emite
// ni envía nada: es la última barrera antes de dar un comprobante por válido.
export function validarComprobante(c) {
  const errores = [];
  const tipo = getTipoComprobante(c?.tipoId);
  if (!tipo) errores.push('Falta el tipo de comprobante.');

  // Emisor
  if (!validarCUIT(c?.emisorCuit)) errores.push('El CUIT del emisor es inválido.');
  if (!c?.puntoVenta) errores.push('Falta el punto de venta.');

  // Receptor — Factura A exige CUIT válido y receptor Responsable Inscripto.
  if (tipo?.letra === 'A') {
    if (!validarCUIT(c?.receptorCuit)) errores.push('Factura/Nota A: el CUIT del receptor es inválido.');
    if (c?.receptorCondicion !== 'RI') errores.push('Factura/Nota A: el receptor debe ser Responsable Inscripto.');
  } else if (c?.receptorCuit && !validarCUIT(c.receptorCuit)) {
    // Factura B: el CUIT es opcional, pero si se carga, debe ser válido.
    errores.push('El CUIT del receptor es inválido.');
  }

  // RG 5824/2026: Notas de Crédito/Débito requieren el identificador del
  // comprobante asociado (la factura original que ajustan).
  const esNota = tipo && /^(NC|ND)/.test(tipo.id);
  if (esNota && !c?.comprobanteAsociadoId) {
    errores.push(`${tipo.nombre}: falta indicar la factura original que ajusta (comprobante asociado).`);
  }

  // Importes
  const neto = Number(c?.neto);
  if (!(neto > 0)) errores.push('El neto debe ser mayor a 0.');
  const ali = ALICUOTAS_IVA.find(a => a.pct === Number(c?.alicuota));
  if (!ali) errores.push('La alícuota de IVA no es válida (21 / 10,5 / 27 / 0).');

  // Coherencia: iva = neto × alícuota, total = neto + iva (tolerancia 1 centavo).
  if (neto > 0 && ali) {
    const calc = calcDesdeNeto(neto, c.alicuota);
    if (Math.abs(calc.iva - round2(c?.iva)) > 0.01) errores.push('El IVA no coincide con neto × alícuota.');
    if (Math.abs(calc.total - round2(c?.total)) > 0.01) errores.push('El total no coincide con neto + IVA.');
  }

  if (!c?.fecha) errores.push('Falta la fecha del comprobante.');
  return errores;
}
