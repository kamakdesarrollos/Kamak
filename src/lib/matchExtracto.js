// matchExtracto — motor de MATCHING para la conciliación bancaria.
//
// Cruza las LÍNEAS de un extracto bancario (ver parseExtractoBancario.js) contra
// los MOVIMIENTOS de la caja del sistema. Reglas decididas con el usuario:
//
//  - Se concilian GASTOS e INGRESOS (débitos y créditos del extracto).
//  - MATCH por MONTO exacto + FECHA ±2 días.
//  - Si la fecha está lejos / la descripción difiere mucho / hay VARIOS
//    candidatos → estado 'parecido' (la UI pregunta / pide confirmar).
//  - Sin candidato por monto → 'no_coincide' (la UI lo clasifica al agregarlo).
//  - HUÉRFANOS: movimientos de la caja DENTRO del período del extracto que
//    ninguna línea matcheó (están en el sistema pero no en el banco).
//
// Convenciones de signo (críticas — ver src/lib/caja.js y parseExtractoBancario.js):
//   - LÍNEA del extracto: `monto` viene CON SIGNO (+ crédito/ingreso, − débito/gasto).
//   - MOVIMIENTO del sistema: `monto` SIEMPRE positivo; el signo lo da `tipo`
//     (gasto → −, ingreso → +). Acá calculamos el "monto con signo" del
//     movimiento desde su efecto en la caja para comparar peras con peras: un
//     débito del banco SOLO matchea un gasto, un crédito SOLO un ingreso.

import { searchNorm } from './searchNorm';
import { efectoEnCaja } from './caja';
import { MS_PER_DAY } from './constants';

// Ventana de fecha (en días) para considerar un movimiento candidato.
export const DIAS_VENTANA = 2;
// Diferencia de fecha (en días) hasta la cual un único candidato se da por
// 'coincide' sin pedir confirmación. Más lejos (pero dentro de la ventana) →
// 'parecido'. Decisión: "fecha igual o muy cercana" ⇒ 1 día.
export const DIAS_CERCANOS = 1;
// Umbral de similitud de descripción [0..1] para considerarla "razonable".
export const SIM_MINIMA = 0.34;

// ── Keywords de GASTO BANCARIO ───────────────────────────────────────────────
// Si la descripción de una línea sin match contiene alguna de estas, la UI
// auto-sugiere clasificarla como "Gasto bancario" (comisiones, impuestos del
// banco, débitos automáticos, etc.). Normalizadas (sin acentos, minúsculas).
const KEYWORDS_GASTO_BANCARIO = [
  'comision', 'iva', 'impuesto', 'percepcion', 'mantenimiento', 'sellado',
  'debito automatico', 'seguro', 'ley 25413', 'ley 25.413',
];

// ¿La descripción parece un gasto del banco? (helper exportado para la UI)
export function esGastoBancario(descripcion) {
  const n = searchNorm(descripcion);
  if (!n) return false;
  return KEYWORDS_GASTO_BANCARIO.some(kw => n.includes(kw));
}

// ── helpers internos ─────────────────────────────────────────────────────────

// Días absolutos entre dos fechas ISO 'YYYY-MM-DD'. null si alguna falta/rompe.
export function diasEntre(isoA, isoB) {
  if (!isoA || !isoB) return null;
  const a = new Date(isoA);
  const b = new Date(isoB);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
  return Math.abs(Math.round((a - b) / MS_PER_DAY));
}

// Monto CON SIGNO de un movimiento respecto de la caja (gasto −, ingreso +,
// traspaso según lado). Reutiliza efectoEnCaja para no duplicar la regla de signos.
export function montoConSignoMov(mov, cajaId) {
  return efectoEnCaja(mov, cajaId);
}

// ¿Coincide el monto de una línea (con signo) con el de un movimiento?
// Comparamos el VALOR ABSOLUTO (tolerancia de 1 centavo por floats) Y que el
// signo coincida (un débito no matchea un ingreso).
function montosCoinciden(montoLinea, montoMovSignado) {
  if (montoLinea == null || montoMovSignado == null) return false;
  const mismoSigno = (montoLinea >= 0) === (montoMovSignado >= 0);
  if (!mismoSigno) return false;
  return Math.abs(Math.abs(montoLinea) - Math.abs(montoMovSignado)) < 0.5;
}

// Similitud de descripción [0..1] por solapamiento de TOKENS (set de palabras
// normalizadas). Robusto a orden y a texto extra. Usa searchNorm (minúsc + sin
// acentos). 0 si alguna está vacía.
export function similitudDescripcion(a, b) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  // Jaccard sobre el conjunto unión.
  const union = ta.size + tb.size - inter;
  return union ? inter / union : 0;
}

function tokens(s) {
  const n = searchNorm(s);
  // Palabras de >=3 chars; descartamos ruido corto ("de", "el", números cortos…).
  return new Set(n.split(/[^a-z0-9]+/).filter(w => w.length >= 3));
}

// ── núcleo: matchear una línea contra los movimientos de la caja ─────────────

// Devuelve { estado, candidatos: [{ movimientoId, mov, dias, similitud, score }] }
// ordenados por score desc (mejor primero).
function matchLinea(linea, movs, cajaId, usados) {
  // 1) candidatos por MONTO (con signo) + FECHA dentro de la ventana.
  const candidatos = [];
  for (const mov of movs) {
    if (usados.has(mov.id)) continue; // ya asignado a otra línea
    const montoMov = montoConSignoMov(mov, cajaId);
    if (!montosCoinciden(linea.monto, montoMov)) continue;
    const dias = diasEntre(linea.fecha, mov.fecha);
    if (dias == null || dias > DIAS_VENTANA) continue;
    const similitud = similitudDescripcion(linea.descripcion, mov.descripcion);
    // Score: prioriza fecha cercana, desempata por similitud de descripción.
    const score = (DIAS_VENTANA - dias) * 10 + similitud;
    candidatos.push({ movimientoId: mov.id, mov, dias, similitud, score });
  }

  if (!candidatos.length) {
    return { estado: 'no_coincide', candidatos: [] };
  }

  candidatos.sort((a, b) => b.score - a.score);
  const mejor = candidatos[0];

  // 2) 'coincide' SOLO si hay exactamente un candidato razonable: fecha muy
  //    cercana (≤ DIAS_CERCANOS) y descripción no dispar (o un único candidato
  //    con fecha igual, donde la descripción es secundaria).
  const unico = candidatos.length === 1;
  const fechaCercana = mejor.dias <= DIAS_CERCANOS;
  const descrOk = mejor.similitud >= SIM_MINIMA;

  if (unico && fechaCercana && (descrOk || mejor.dias === 0)) {
    return { estado: 'coincide', candidatos };
  }

  // 3) sino hay candidato(s) por monto pero algo no cierra → pedir confirmación.
  return { estado: 'parecido', candidatos };
}

// ── API pública ──────────────────────────────────────────────────────────────

/**
 * Matchea las líneas de un extracto contra los movimientos de UNA caja.
 *
 * @param {Array}  lineas  líneas del extracto (parseExtractoBancario): cada una
 *                         { fecha:'YYYY-MM-DD', descripcion, monto (con signo), ... }
 * @param {Array}  movimientosDeLaCaja  movimientos del sistema de esa caja.
 * @param {object} opts
 * @param {string} opts.cajaId  id de la caja (para resolver el signo del efecto;
 *                              si se omite, se infiere del primer movimiento).
 * @param {string} opts.periodoDesde  ISO — inicio del período (para huérfanos).
 * @param {string} opts.periodoHasta  ISO — fin del período (para huérfanos).
 * @returns {{
 *   lineas: Array<{ ...linea, idx, estado, movimientoId, candidatos }>,
 *   huerfanos: Array<mov>,
 *   resumen: { total, coincide, parecido, no_coincide, huerfanos }
 * }}
 */
export function matchearExtracto(lineas, movimientosDeLaCaja, opts = {}) {
  const movs = Array.isArray(movimientosDeLaCaja) ? movimientosDeLaCaja : [];
  const ls = Array.isArray(lineas) ? lineas : [];
  // cajaId: explícito, o el de cualquier movimiento (todos son de la misma caja).
  const cajaId = opts.cajaId
    ?? movs.find(m => m.cajaId)?.cajaId
    ?? movs[0]?.cajaId;

  // Movimientos ya conciliados NO entran al pool (no se re-matchean).
  const disponibles = movs.filter(m => !m.conciliado);

  // Una sola pasada, marcando movimientos usados para no asignar el mismo a dos
  // líneas (importante cuando hay montos repetidos, ej. dos pagos iguales).
  // Primero resolvemos las que tienen UN candidato claro, después el resto, para
  // que un match obvio no se "robe" el movimiento que otra línea necesita.
  const usados = new Set();
  const resultadosTmp = ls.map((linea, idx) => ({ idx, linea }));

  // Orden de resolución: las que probablemente sean 'coincide' primero. Hacemos
  // una pre-pasada sin marcar usados para contar candidatos por línea.
  const conConteo = resultadosTmp.map(r => {
    const pre = matchLinea(r.linea, disponibles, cajaId, new Set());
    return { ...r, nCand: pre.candidatos.length };
  });
  // Menos candidatos (más determinístico) primero; fecha como desempate estable.
  conConteo.sort((a, b) => (a.nCand - b.nCand) || String(a.linea.fecha).localeCompare(String(b.linea.fecha)));

  const porIdx = new Map();
  for (const r of conConteo) {
    const m = matchLinea(r.linea, disponibles, cajaId, usados);
    const elegido = m.candidatos[0] || null;
    // Asignamos (reservamos) el movimiento SOLO en 'coincide'. En 'parecido' la
    // UI confirma a mano, así que no lo bloqueamos para otras líneas todavía.
    if (m.estado === 'coincide' && elegido) usados.add(elegido.movimientoId);
    porIdx.set(r.idx, {
      ...r.linea,
      idx: r.idx,
      estado: m.estado,
      movimientoId: m.estado === 'coincide' ? (elegido?.movimientoId ?? null) : null,
      candidatos: m.candidatos.map(c => ({
        movimientoId: c.movimientoId,
        dias: c.dias,
        similitud: Math.round(c.similitud * 100) / 100,
      })),
    });
  }

  // Reconstruir en el orden original del extracto.
  const lineasMatch = ls.map((_, idx) => porIdx.get(idx));

  // ── Huérfanos: movimientos de la caja en el período que NINGUNA línea matcheó.
  const desde = opts.periodoDesde ?? null;
  const hasta = opts.periodoHasta ?? null;
  const enPeriodo = (fecha) => {
    if (!fecha) return false;
    if (desde && fecha < desde) return false;
    if (hasta && fecha > hasta) return false;
    return true;
  };
  const matcheados = new Set(
    lineasMatch.filter(l => l.movimientoId).map(l => l.movimientoId)
  );
  const huerfanos = disponibles.filter(m =>
    !matcheados.has(m.id) &&
    // Solo cuentan los que mueven la caja (un endoso/NC fiscal no aparece en banco).
    montoConSignoMov(m, cajaId) !== 0 &&
    (desde || hasta ? enPeriodo(m.fecha) : true)
  );

  const resumen = {
    total: lineasMatch.length,
    coincide: lineasMatch.filter(l => l.estado === 'coincide').length,
    parecido: lineasMatch.filter(l => l.estado === 'parecido').length,
    no_coincide: lineasMatch.filter(l => l.estado === 'no_coincide').length,
    huerfanos: huerfanos.length,
  };

  return { lineas: lineasMatch, huerfanos, resumen };
}
