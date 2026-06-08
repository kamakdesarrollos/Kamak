// conciliaciones — MODELO + STORAGE del historial de conciliaciones bancarias.
//
// Una "conciliación" es el cruce GUARDADO de un extracto de banco contra los
// movimientos de una caja en un período (típicamente un mes). Sirve de historial
// (qué se concilió, cuándo, con qué saldo) y de respaldo de las marcas
// `conciliado:true` que se ponen en los movimientos.
//
// PERSISTENCIA: shared_data key 'conciliaciones', cuyo `data` es un ARRAY de
// objetos conciliación. Se escribe ATÓMICAMENTE por ítem (append/patch/remove)
// con las RPC de migrations/0003 (fallback read-modify-write), igual que
// plantillas/alertas — así dos admins conciliando a la vez no se pisan el blob.
//
// La MARCA en el movimiento la pone la UI con el CRUD existente:
//   updateMovimiento(movId, { conciliado: true, conciliacionId, lineaExtractoId })
// (ver marcarMovimientoConciliado / desmarcarMovimiento más abajo, helpers de
// los CHANGES — la UI los pasa a updateMovimiento de MovimientosContext).

import {
  loadSharedData,
  appendItemInSharedArray,
  patchItemInSharedArray,
  removeItemInSharedArray,
} from './dbHelpers';
import { newId } from './id';
import { today } from './dates';

export const CONCILIACIONES_KEY = 'conciliaciones';

/**
 * Construye una conciliación nueva (estado 'abierta') lista para guardar.
 * No persiste — devuelve el objeto. La UI lo completa con sus líneas a medida
 * que el usuario resuelve cada una, y al final lo cierra (cerrarConciliacion).
 *
 * Shape de cada línea guardada:
 *   { id, fecha, descripcion, monto, saldo, estado, movimientoId,
 *     clasificacion? }   // clasificacion: para no_coincide resueltas
 *     // estado ∈ 'coincide'|'parecido'|'no_coincide'|'huerfano'|'ignorada'
 */
export function crearConciliacion({
  cajaId,
  cajaNombre = '',
  periodoDesde = null,
  periodoHasta = null,
  saldoFinalBanco = null,
  banco = '',
  lineas = [],
  createdBy = '',
} = {}) {
  return {
    id: newId('conc'),
    cajaId,
    cajaNombre,
    periodoDesde,
    periodoHasta,
    saldoFinalBanco,
    banco,
    lineas: (lineas || []).map(normalizarLineaGuardada),
    estado: 'abierta',     // 'abierta' | 'cerrada'
    fecha: today(),        // fecha de creación/cierre (YYYY-MM-DD)
    createdBy,
  };
}

// Normaliza una línea a lo que se persiste (descarta `raw`, `candidatos`, etc.
// que son de runtime del matcher y no hace falta guardar). Asegura un id por línea.
export function normalizarLineaGuardada(l = {}) {
  return {
    id: l.id || newId('linc'),
    fecha: l.fecha ?? null,
    descripcion: l.descripcion ?? '',
    monto: l.monto ?? null,
    saldo: l.saldo ?? null,
    estado: l.estado ?? 'no_coincide',
    movimientoId: l.movimientoId ?? null,
    clasificacion: l.clasificacion ?? null,
  };
}

// ── Lectura ──────────────────────────────────────────────────────────────────

/** Lee TODAS las conciliaciones guardadas. Devuelve [] si no hay / error. */
export async function leerConciliaciones() {
  const data = await loadSharedData(CONCILIACIONES_KEY);
  return Array.isArray(data) ? data : [];
}

/** Conciliaciones de una caja, más recientes primero. */
export async function leerConciliacionesDeCaja(cajaId) {
  const todas = await leerConciliaciones();
  return todas
    .filter(c => c.cajaId === cajaId)
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
}

// ── Escritura (atómica por ítem) ─────────────────────────────────────────────

/** Guarda una conciliación NUEVA (append atómico). Devuelve el objeto guardado. */
export async function guardarConciliacion(conc) {
  const c = conc.id ? conc : { ...conc, id: newId('conc') };
  await appendItemInSharedArray(CONCILIACIONES_KEY, c);
  return c;
}

/** Aplica cambios puntuales a una conciliación ya guardada (patch atómico). */
export async function actualizarConciliacion(id, changes) {
  return patchItemInSharedArray(CONCILIACIONES_KEY, id, changes);
}

/** Cierra una conciliación: estado 'cerrada' + sella la fecha de cierre. */
export async function cerrarConciliacion(id, { fecha } = {}) {
  return actualizarConciliacion(id, { estado: 'cerrada', fecha: fecha || today() });
}

/** Borra una conciliación del historial (remove atómico). */
export async function borrarConciliacion(id) {
  return removeItemInSharedArray(CONCILIACIONES_KEY, id);
}

// ── Marca `conciliado` en el MOVIMIENTO ──────────────────────────────────────
// No tocan el store directamente: devuelven el objeto de CHANGES que la UI pasa
// a updateMovimiento(id, changes) de MovimientosContext (escritura atómica del
// ítem del movimiento). Centralizado acá para que el shape sea único.

/** Changes para marcar un movimiento como conciliado contra una línea/conc. */
export function marcarMovimientoConciliado(conciliacionId, lineaExtractoId) {
  return { conciliado: true, conciliacionId, lineaExtractoId };
}

/** Changes para revertir la marca (al desconciliar / borrar la conciliación). */
export function desmarcarMovimiento() {
  return { conciliado: false, conciliacionId: null, lineaExtractoId: null };
}
