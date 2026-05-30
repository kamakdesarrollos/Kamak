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
// `codAfip` = código de "Condición frente al IVA del receptor" que AFIP exige en
// el comprobante electrónico (RG 5616). Solo las domésticas que aplican a clientes
// de Conquies — no incluimos Proveedor/Cliente del Exterior (serían Factura E,
// fuera de alcance) ni IVA Liberado Ley 19.640.
export const CONDICIONES_IVA = [
  { id: 'RI',  nombre: 'Responsable Inscripto',                    codAfip: 1 },
  { id: 'MT',  nombre: 'Monotributo',                             codAfip: 6 },
  { id: 'MTS', nombre: 'Monotributo Social',                      codAfip: 13 },
  { id: 'MTP', nombre: 'Monotributo Trab. Independiente Promovido', codAfip: 16 },
  { id: 'EX',  nombre: 'IVA Sujeto Exento',                       codAfip: 4 },
  { id: 'NA',  nombre: 'IVA No Alcanzado',                        codAfip: 15 },
  { id: 'SNC', nombre: 'Sujeto No Categorizado',                  codAfip: 7 },
  { id: 'CF',  nombre: 'Consumidor Final',                        codAfip: 5 },
];

// ── Concepto del comprobante (código AFIP para WSFE). ─────────────────────────
// AFIP exige declarar si la operación es de productos, servicios o ambos. Para
// servicios y "ambos", WSFE además pide el período del servicio (FchServDesde/
// Hasta) — eso se completará cuando se conecte el web service. Construcción suele
// ser servicios, por eso es el default.
export const CONCEPTOS_AFIP = [
  { id: 2, nombre: 'Servicios' },
  { id: 1, nombre: 'Productos' },
  { id: 3, nombre: 'Productos y Servicios' },
];
export const getConceptoAfip = (id) => CONCEPTOS_AFIP.find(c => c.id === Number(id)) || null;
export const CONCEPTO_AFIP_DEFAULT = 2; // Servicios

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

// ── Jurisdicciones de IIBB (percepciones/retenciones sufridas) ────────────────
// Conquies opera hoy SOLO en Provincia de Buenos Aires; el campo existe para
// soportar compras en otra jurisdicción a futuro. Convenio Multilateral: cada
// jurisdicción liquida su propio IIBB, así que una percepción de CABA NO se
// descuenta del IIBB de PBA (se declara contra el IIBB de CABA).
export const JURISDICCIONES_IIBB = [
  { id: 'PBA',  nombre: 'Buenos Aires (PBA)' },
  { id: 'CABA', nombre: 'CABA' },
  { id: 'CBA',  nombre: 'Córdoba' },
  { id: 'OTRA', nombre: 'Otra' },
];
// Data legacy sin el campo = PBA (era el único caso antes de existir el campo).
export const esJurisdiccionPBA = (j) => !j || j === 'PBA';
export const nombreJurisdiccion = (id) => JURISDICCIONES_IIBB.find(j => j.id === id)?.nombre || id || 'Buenos Aires (PBA)';

// Redondeo a 2 decimales (centavos), estable ante errores de float.
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Parser tolerante de montos en formato argentino. Acepta:
//   "1500"          → 1500
//   "1500.75"       → 1500.75    (decimal con punto, formato US)
//   "1.500,75"      → 1500.75    (formato AR: punto miles + coma decimal)
//   "1.500.000"     → 1500000
//   "$ 1.500,75"    → 1500.75    (saca símbolo $ y espacios)
//   ""/null/NaN     → 0
//   1500 (Number)   → 1500
//
// Cuidado con el caso ambiguo "1.500": en AR es mil quinientos, en US es uno coma cinco.
// Lo resolvemos como miles (porque venimos de form/LLM en contexto argentino) si el
// punto va seguido de EXACTAMENTE 3 dígitos sin coma decimal después. Sino, decimal.
export function parseMoneyAR(s) {
  if (s == null) return 0;
  if (typeof s === 'number') return Number.isFinite(s) ? s : 0;
  let str = String(s).trim().replace(/[^\d.,\-]/g, ''); // saca $, espacios, letras
  if (!str) return 0;
  const tieneComa = str.includes(',');
  if (tieneComa) {
    // Formato AR: los puntos son miles, la coma es decimal.
    str = str.replace(/\./g, '').replace(',', '.');
  } else {
    // Sin coma: si hay puntos, decidir si son miles (1.500) o decimal (1.5).
    // Regla: si TODOS los puntos están seguidos por exactamente 3 dígitos
    // (con o sin más puntos después), son miles. Sino, es decimal US.
    const sinMiles = str.replace(/\.(?=\d{3}(\.|$))/g, '');
    // Si sigue habiendo más de un punto, dejamos el último como decimal.
    const partes = sinMiles.split('.');
    if (partes.length > 2) {
      str = partes.slice(0, -1).join('') + '.' + partes[partes.length - 1];
    } else {
      str = sinMiles;
    }
  }
  const n = parseFloat(str);
  return Number.isFinite(n) ? n : 0;
}

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

// Alícuotas de IVA conocidas, para inferir la del ticket cuando la foto discrimina
// el neto pero no la alícuota explícita.
const _ALICUOTAS_CONOCIDAS = [21, 10.5, 27, 0];
const _alicuotaMasCercana = (pct) =>
  _ALICUOTAS_CONOCIDAS.reduce((a, b) => (Math.abs(b - pct) < Math.abs(a - pct) ? b : a));

// ── Desglose fiscal de un comprobante de COMPRA recibido ──────────────────────
// ÚNICA fuente de verdad del cálculo total → baseFiscal → neto + IVA crédito.
// Antes estaba duplicado inline en el modal de aprobación y en 3 ramas del bot;
// centralizarlo evita que diverjan (de ahí salió el bug crítico que descontaba
// el neto en vez del total).
//
// Reglas fiscales:
//  • El `total` es SIEMPRE lo que sale de caja: IVA + percepciones + todo.
//  • Las percepciones (IIBB e IVA) son pagos a cuenta de OTROS impuestos, NO
//    integran la base imponible del IVA del comprobante. Por eso se restan del
//    total ANTES de desarmar neto + IVA. Dividir el total-con-percepción por
//    1.21 inflaría el IVA crédito del Libro Compras (riesgo de impugnación AFIP).
//  • baseFiscal = total − percepcionIIBB − percepcionIVA.
//  • Factura C (monotributo): no discrimina IVA → neto = base, iva = 0.
//  • Si la foto discriminó el neto (montoNeto válido < base) → IVA = base − neto
//    y se infiere la alícuota real del ticket.
//  • Si se pasa una `alicuota` explícita (modal) → se usa esa.
//  • Sino → default 21% (lo más común en construcción).
//
// El `total` devuelto es el total real (con percepciones), para que coincida con
// la caja y con el fingerprint de detección de duplicados.
export function desglosarCompra({
  total, tipoLetra, percepcionIIBB = 0, percepcionIVA = 0, montoNeto = null, alicuota = null,
} = {}) {
  const tot   = Math.round(parseMoneyAR(total));
  const pIIBB = Math.round(parseMoneyAR(percepcionIIBB));
  const pIVA  = Math.round(parseMoneyAR(percepcionIVA));
  const baseFiscal = Math.max(0, tot - pIIBB - pIVA);
  const letra = String(tipoLetra || '').toUpperCase().charAt(0);
  const out = { neto: 0, iva: 0, alicuota: 0, baseFiscal, total: tot, percepcionIIBB: pIIBB, percepcionIVA: pIVA };
  if (tot <= 0) return { ...out, baseFiscal: 0 };
  if (letra === 'C') return { ...out, neto: baseFiscal, iva: 0, alicuota: 0 };

  const netoConocido = montoNeto != null ? Math.round(parseMoneyAR(montoNeto)) : null;
  if (netoConocido != null && netoConocido > 0 && netoConocido < baseFiscal) {
    const iva = Math.max(0, baseFiscal - netoConocido);
    const pct = netoConocido > 0 ? (iva / netoConocido) * 100 : 21;
    return { ...out, neto: netoConocido, iva, alicuota: _alicuotaMasCercana(pct) };
  }
  const ali = alicuota != null ? (Number(alicuota) || 0) : 21;
  const r = calcDesdeTotal(baseFiscal, ali);
  return { ...out, neto: r.neto, iva: r.iva, alicuota: ali };
}

// Signo fiscal de un comprobante RECIBIDO en el Libro IVA Compras. Una nota de
// crédito de proveedor (clase 'nota_credito') REVIERTE crédito IVA y compras, así
// que computa en negativo; cualquier otro comprobante (factura/ticket) suma.
export const signoComprobanteRecibido = (cr) => (cr?.clase === 'nota_credito' ? -1 : 1);

// ── Tipo de factura sugerido (emisor Responsable Inscripto) ───────────────────
// A si el receptor es Responsable Inscripto; B en cualquier otro caso.
export function tipoFacturaSugerido(condReceptorId) {
  return condReceptorId === 'RI' ? 'FA' : 'FB';
}

// ── "Huella" de un comprobante RECIBIDO (factura/ticket de proveedor) ────────
// Sirve para detectar duplicados al cargarlo (foto del bot, manual, etc.).
//
// Con N° de factura formal: huella = letra + número + CUIT + total redondeado.
//   Cubre Factura A/B/C identificadas por sus datos formales.
// Sin N° (ticket no fiscal): heurística = proveedor + fecha + total redondeado.
//   Cubre tickets de combustible/comida sin numeración formal.
//
// Si el total es 0 o no hay forma de identificarlo confiablemente (sin N° y sin
// proveedor) → devuelve null, y el caller debería saltear la detección.
// Normaliza el "serial" de un N° de factura. Toma solo el ÚLTIMO segmento
// numérico (el correlativo), sin ceros a la izquierda. Así "0001-00012345",
// "1-12345" y "12345" se reducen al mismo "12345". Combinado con CUIT + total
// en la huella, dos facturas con mismo correlativo de distinto Pto. de Venta
// solo colisionarían si además coincide CUIT y total — caso prácticamente
// imposible. Esto es más robusto que comparar el formato literal, que sufre
// inconsistencias de extracción (el bot a veces lee el PV, a veces no).
const _normSerial = (s) => {
  const parts = String(s || '').split(/[^0-9]+/).filter(Boolean);
  return parts.length ? (parts[parts.length - 1].replace(/^0+/, '') || '0') : '';
};

export function fingerprintRecibido({ tipo, numero, cuit, total, proveedor, fecha, clase } = {}) {
  const normTotal = Math.round(Number(total) || 0);
  if (!normTotal) return null;
  const normNum  = _normSerial(numero);
  const normCuit = String(cuit || '').replace(/\D/g, '');
  // Prefijo 'NC' para notas de crédito recibidas: una NC y la factura que ajusta
  // pueden compartir letra/CUIT/total pero son comprobantes DISTINTOS — sin este
  // prefijo colisionarían y el sistema rechazaría la NC como "duplicada".
  const pre      = clase === 'nota_credito' ? 'NC' : '';
  const letra    = pre + String(tipo || '').toUpperCase().charAt(0); // 'A'/'B'/'C'/'NCA'/…
  if (normNum) return `n:${letra}|${normNum}|${normCuit}|${normTotal}`;
  const normProv = pre + String(proveedor || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24);
  if (!normProv) return null; // sin proveedor, la huella es muy débil → no chequear
  const normFecha = String(fecha || '').slice(0, 10);
  return `s:${normProv}|${normFecha}|${normTotal}`;
}

// Busca un comprobante RECIBIDO con la misma huella en movimientos y pendings.
// Acepta el candidato (datos del comprobante a cargar) y devuelve
// { en: 'movimiento'|'pending', ref } o null. Incluye un fallback "legacy" por
// si hay movimientos viejos sin `comprobanteRecibido` pero con `referencia` y
// `proveedor` (carga previa al rediseño del libro IVA).
export function buscarDuplicadoRecibido(candidato, { movimientos, pendings } = {}) {
  const fp = fingerprintRecibido(candidato);
  if (!fp) return null;
  // 1) Movimientos con comprobanteRecibido (fingerprint match).
  for (const m of (movimientos || [])) {
    const cr = m?.comprobanteRecibido;
    if (cr) {
      const fpM = fingerprintRecibido({
        tipo: cr.tipo, numero: cr.numero, cuit: cr.cuit, total: cr.total,
        proveedor: m.proveedor, fecha: m.fecha, clase: cr.clase,
      });
      if (fpM === fp) return { en: 'movimiento', ref: m };
    }
  }
  // 2) Pendings: facturas en buzón Y movimientos pendientes con comprobanteRecibido.
  for (const p of (pendings || [])) {
    if (p?.tipoPendiente === 'factura') {
      const fpP = fingerprintRecibido({
        tipo: p.tipoFactura, numero: p.numeroFactura, cuit: p.cuit,
        total: p.montoTotal != null ? p.montoTotal : p.monto,
        proveedor: p.proveedor, fecha: p.fecha, clase: p.claseComprobante,
      });
      if (fpP === fp) return { en: 'pending', ref: p };
    } else if (p?.tipoPendiente === 'movimiento' && p?.movimiento?.comprobanteRecibido) {
      const cr = p.movimiento.comprobanteRecibido;
      const fpP = fingerprintRecibido({
        tipo: cr.tipo, numero: cr.numero, cuit: cr.cuit, total: cr.total,
        proveedor: p.movimiento.proveedor, fecha: p.movimiento.fecha, clase: cr.clase,
      });
      if (fpP === fp) return { en: 'pending', ref: p };
    }
  }
  // 3) Legacy fallback (movs viejos sin comprobanteRecibido) — match por
  //    referencia (= N° factura) + proveedor parecido. Cubre data antes del fix.
  if (candidato?.numero) {
    const numCand = _normSerial(candidato.numero);
    const provN = (s) => String(s || '').toLowerCase().trim();
    const provCand = provN(candidato.proveedor);
    for (const m of (movimientos || [])) {
      if (m?.comprobanteRecibido) continue; // ya cubierto arriba
      if (!m?.referencia) continue;
      const refClean = _normSerial(m.referencia);
      if (!refClean || refClean !== numCand) continue;
      const provMov = provN(m.proveedor);
      if (!provMov || !provCand) continue;
      if (provMov.includes(provCand) || provCand.includes(provMov)) {
        return { en: 'movimiento', ref: m };
      }
    }
  }
  return null;
}

// ── "Huella" de un comprobante EMITIDO (factura emitida por nosotros) ────────
// Postemisión: identidad oficial AFIP = tipo + Pto. de venta + número.
// Pre-emisión (borrador, sin número): heurística = tipo + cliente + fecha + total.
// Sirve para detectar duplicados al cargar una factura nueva en el panel.
export function fingerprintEmitido(c = {}) {
  if (c.numero) {
    return `e:${c.tipoId || ''}|${c.puntoVenta || 0}|${_normSerial(c.numero)}`;
  }
  if (c.clienteId && c.fecha && (c.total || 0) > 0) {
    return `eb:${c.tipoId || ''}|${c.clienteId}|${String(c.fecha).slice(0, 10)}|${Math.round(c.total)}`;
  }
  return null;
}

// Busca un comprobante emitido potencialmente duplicado en la lista actual.
// Ignora el propio (por id) y los anulados.
export function buscarDuplicadoEmitido(c, comprobantes = []) {
  const fp = fingerprintEmitido(c);
  if (!fp) return null;
  return (comprobantes || []).find(x =>
    x && x.estado !== 'anulado' && x.id !== c.id && fingerprintEmitido(x) === fp
  ) || null;
}

// ── Resolución del comprobante asociado de una NC/ND ──────────────────────────
// El comprobante guarda `comprobanteAsociadoId` = id INTERNO de la factura
// original que ajusta. WSFE, en cambio, identifica el asociado por Tipo (código
// AFIP) + Punto de Venta + Número. Esta función hace ese puente: busca la factura
// original y devuelve su referencia estructurada, lista para el web service.
// `emitido` indica si la original ya tiene número de AFIP — WSFE RECHAZA una NC/ND
// contra un comprobante todavía no autorizado, así que es la precondición clave.
export function resolverComprobanteAsociado(comprobanteAsociadoId, comprobantes = []) {
  if (!comprobanteAsociadoId) return null;
  const orig = (comprobantes || []).find(c => c && c.id === comprobanteAsociadoId);
  if (!orig) return null;
  const t = getTipoComprobante(orig.tipoId);
  return {
    id:         orig.id,
    tipoId:     orig.tipoId,
    codAfip:    t?.codAfip ?? null,   // CbteTipo del asociado para WSFE
    letra:      t?.letra ?? null,
    puntoVenta: orig.puntoVenta ?? null,
    numero:     orig.numero ?? null,
    emitido:    !!orig.numero,        // ¿ya tiene número de AFIP?
  };
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
