import { describe, it, expect } from 'vitest';
import { ejecutarPagoFactura, esErrorRpcFaltante } from './pagoAtomico';

// Orquestación del pago de factura (auditoría 2026-07-03): primero la RPC
// transaccional registrar_pago_factura (mov + pago en UNA transacción); si la
// RPC no está desplegada, camino viejo pero VERIFICADO: se espera cada escritura
// y si la 2ª falla se COMPENSA borrando el movimiento (antes quedaba la caja
// debitada con la factura abierta → riesgo de pagar dos veces).

const movData = { tipo: 'gasto', monto: 1000, cajaId: 'ars', proveedor: 'Prov' };

// Efectores falsos mínimos (inyección de dependencias — sin mocks de módulos).
function efectores({ rpcResult, persistMov = true, persistPago = true } = {}) {
  const calls = [];
  return {
    calls,
    rpc: async (fn, args) => { calls.push(['rpc', fn, args]); return rpcResult; },
    addMovimientoAsync: (data, opts) => {
      calls.push(['addMov', data.id, opts?.soloLocal || false]);
      return { mov: data, done: Promise.resolve(persistMov) };
    },
    registrarPagoFacturaAsync: (fid, pago, opts) => {
      calls.push(['pagoFactura', fid, pago.movimientoId, opts?.soloLocal || false]);
      return { factura: { id: fid }, done: Promise.resolve(persistPago) };
    },
    removeMovimiento: (id) => calls.push(['removeMov', id]),
    onBroadcast: (key) => calls.push(['broadcast', key]),
  };
}

describe('ejecutarPagoFactura — camino RPC', () => {
  it('RPC ok: aplica local SIN re-persistir y broadcastea ambas keys', async () => {
    const fx = efectores({ rpcResult: { error: null } });
    const r = await ejecutarPagoFactura({ movData, facturaId: 'fp-1', pago: { monto: 1000, fecha: '2026-07-03' } }, fx);
    expect(r.ok).toBe(true);
    expect(r.via).toBe('rpc');
    const addMov = fx.calls.find(c => c[0] === 'addMov');
    expect(addMov[2]).toBe(true); // soloLocal
    const pagoF = fx.calls.find(c => c[0] === 'pagoFactura');
    expect(pagoF[3]).toBe(true); // soloLocal
    expect(pagoF[2]).toBe(r.movId); // el pago queda linkeado al mov
    expect(fx.calls.filter(c => c[0] === 'broadcast').map(c => c[1])).toEqual(['movimientos', 'proveedores']);
  });

  it('error de validación de la RPC (ej. sobrepago): NO escribe nada y devuelve el mensaje', async () => {
    const fx = efectores({ rpcResult: { error: { code: 'P0001', message: 'el pago $2000 excede el saldo $1000' } } });
    const r = await ejecutarPagoFactura({ movData, facturaId: 'fp-1', pago: { monto: 2000, fecha: '2026-07-03' } }, fx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/excede el saldo/);
    expect(fx.calls.some(c => c[0] === 'addMov')).toBe(false);
  });

  it('pago suelto (sin factura): RPC con p_factura_id null y sin tocar facturas', async () => {
    const fx = efectores({ rpcResult: { error: null } });
    const r = await ejecutarPagoFactura({ movData }, fx);
    expect(r.ok).toBe(true);
    const rpcCall = fx.calls.find(c => c[0] === 'rpc');
    expect(rpcCall[2].p_factura_id).toBe(null);
    expect(fx.calls.some(c => c[0] === 'pagoFactura')).toBe(false);
  });
});

describe('ejecutarPagoFactura — fallback sin RPC desplegada', () => {
  const rpcFaltante = { error: { code: 'PGRST202', message: 'Could not find the function' } };

  it('persiste mov y pago esperando cada escritura', async () => {
    const fx = efectores({ rpcResult: rpcFaltante });
    const r = await ejecutarPagoFactura({ movData, facturaId: 'fp-1', pago: { monto: 1000, fecha: '2026-07-03' } }, fx);
    expect(r.ok).toBe(true);
    expect(r.via).toBe('fallback');
    expect(fx.calls.find(c => c[0] === 'addMov')[2]).toBe(false); // persiste de verdad
    expect(fx.calls.find(c => c[0] === 'pagoFactura')[3]).toBe(false);
  });

  it('si falla la persistencia del movimiento, corta ahí (no toca la factura)', async () => {
    const fx = efectores({ rpcResult: rpcFaltante, persistMov: false });
    const r = await ejecutarPagoFactura({ movData, facturaId: 'fp-1', pago: { monto: 1000, fecha: '2026-07-03' } }, fx);
    expect(r.ok).toBe(false);
    expect(r.etapa).toBe('movimiento');
    expect(fx.calls.some(c => c[0] === 'pagoFactura')).toBe(false);
  });

  it('si falla el pago en la factura, COMPENSA borrando el movimiento', async () => {
    const fx = efectores({ rpcResult: rpcFaltante, persistPago: false });
    const r = await ejecutarPagoFactura({ movData, facturaId: 'fp-1', pago: { monto: 1000, fecha: '2026-07-03' } }, fx);
    expect(r.ok).toBe(false);
    expect(r.etapa).toBe('factura');
    expect(r.compensado).toBe(true);
    expect(fx.calls.some(c => c[0] === 'removeMov')).toBe(true);
  });
});

describe('esErrorRpcFaltante', () => {
  it('detecta función no desplegada por código PGRST202 o mensaje', () => {
    expect(esErrorRpcFaltante({ code: 'PGRST202', message: 'x' })).toBe(true);
    expect(esErrorRpcFaltante({ message: 'Could not find the function public.registrar_pago_factura' })).toBe(true);
    expect(esErrorRpcFaltante({ code: 'P0001', message: 'excede el saldo' })).toBe(false);
    expect(esErrorRpcFaltante(null)).toBe(false);
  });
});
