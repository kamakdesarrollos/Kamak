// Pago de factura ATÓMICO (auditoría 2026-07-03). El circuito de órdenes de
// pago escribía en dos keys sin transacción (movimiento en 'movimientos' + pago
// en 'proveedores') y sin verificar éxito: si fallaba la 2ª escritura la caja
// quedaba debitada con la factura abierta (pasó en prod: pago $405.336 con
// movimientoId muerto). Este orquestador:
//   1. Intenta la RPC transaccional `registrar_pago_factura` (migración 0006):
//      mov + pago + validación de sobrepago en UNA transacción de Postgres.
//   2. Si la RPC no está desplegada, camino viejo pero VERIFICADO: espera cada
//      escritura y si la 2ª falla COMPENSA borrando el movimiento.
// Los efectores (rpc, contexts) se INYECTAN para poder testear la orquestación
// sin mocks de módulos (ver pagoAtomico.test.js).

import { supabase } from './supabase';
import { broadcastChange } from './syncBus';
import { newId } from './id';

/** ¿El error de PostgREST significa "la función no existe todavía"? */
export function esErrorRpcFaltante(error) {
  if (!error) return false;
  if (error.code === 'PGRST202') return true;
  return /could not find the function/i.test(error.message || '');
}

/**
 * Ejecuta el pago: movimiento de caja + (opcional) pago sobre la factura.
 * Devuelve { ok, via: 'rpc'|'fallback', movId, error?, etapa?, compensado? }.
 * NO valida sobrepago acá: eso es de validarPagoFactura (lib/proveedorCC) en el
 * form + la RPC server-side (defensa en profundidad).
 */
export async function ejecutarPagoFactura(
  { movData, facturaId = null, pago = null },
  {
    rpc,
    addMovimientoAsync,
    registrarPagoFacturaAsync,
    removeMovimiento,
    onBroadcast = broadcastChange,
  }
) {
  const mov = {
    ...movData,
    id: movData.id || newId('mov'),
    fecha: movData.fecha || new Date().toISOString().split('T')[0],
  };
  const pagoConMov = pago ? { ...pago, movimientoId: mov.id } : null;

  // ── 1. Camino RPC transaccional ─────────────────────────────────────────────
  const { error } = await rpc('registrar_pago_factura', {
    p_mov: mov,
    p_factura_id: facturaId,
    p_pago: pagoConMov,
  }) || {};

  if (!error) {
    // Persistido server-side: aplicar solo al estado local y avisar a los demás.
    addMovimientoAsync(mov, { soloLocal: true });
    if (facturaId) registrarPagoFacturaAsync(facturaId, pagoConMov, { soloLocal: true });
    onBroadcast('movimientos');
    if (facturaId) onBroadcast('proveedores');
    return { ok: true, via: 'rpc', movId: mov.id };
  }

  if (!esErrorRpcFaltante(error)) {
    // Error real (validación de sobrepago, factura cerrada, red): no se escribió nada.
    return { ok: false, error: error.message || 'Error al registrar el pago', movId: mov.id };
  }

  // ── 2. Fallback verificado (RPC aún no desplegada) ──────────────────────────
  const { done: movDone } = addMovimientoAsync(mov);
  const okMov = await movDone;
  if (!okMov) {
    return { ok: false, etapa: 'movimiento', movId: mov.id, error: 'No se pudo guardar el movimiento de caja. Reintentá.' };
  }
  if (facturaId) {
    const { done: pagoDone } = registrarPagoFacturaAsync(facturaId, pagoConMov);
    const okPago = await pagoDone;
    if (!okPago) {
      removeMovimiento(mov.id); // compensación: nunca dejar caja debitada + factura abierta
      return { ok: false, etapa: 'factura', compensado: true, movId: mov.id, error: 'No se pudo registrar el pago en la factura. Se revirtió el movimiento — reintentá.' };
    }
  }
  return { ok: true, via: 'fallback', movId: mov.id };
}

/** rpc por defecto contra Supabase (efector real para la app). */
export const rpcSupabase = (fn, args) => supabase.rpc(fn, args);

/**
 * Aplica CRÉDITO a favor contra una factura (pago {tipo:'credito'}, sin caja).
 * RPC `aplicar_credito_factura` primero; fallback al patch por ítem verificado.
 */
export async function ejecutarAplicarCredito(
  { facturaId, pago },
  { rpc, registrarPagoFacturaAsync, onBroadcast = broadcastChange }
) {
  const pagoCredito = { ...pago, tipo: 'credito' };
  const { error } = await rpc('aplicar_credito_factura', {
    p_factura_id: facturaId,
    p_pago: pagoCredito,
  }) || {};

  if (!error) {
    registrarPagoFacturaAsync(facturaId, pagoCredito, { soloLocal: true });
    onBroadcast('proveedores');
    return { ok: true, via: 'rpc' };
  }
  if (!esErrorRpcFaltante(error)) {
    return { ok: false, error: error.message || 'No se pudo aplicar el crédito' };
  }
  const { done } = registrarPagoFacturaAsync(facturaId, pagoCredito);
  const okPago = await done;
  return okPago
    ? { ok: true, via: 'fallback' }
    : { ok: false, error: 'No se pudo aplicar el crédito. Reintentá.' };
}
