import { describe, it, expect } from 'vitest';
import { ejecutarPagoFactura, ejecutarAplicarCredito } from './pagoAtomico';
import { saldoProveedorCC, creditoDisponibleProveedor, creditosEnProveedores } from './proveedorCC';
import { saldoFacturaPendiente, estadoFacturaPendiente } from './facturasPendientes';
import { calcSaldoCaja } from './caja';

// QA de INTEGRACIÓN end-to-end del circuito de dinero (2026-07-03).
// Simula el estado shared_data (movimientos + facturasPendientes) EN MEMORIA y
// hace pasar un caso realista por TODO el circuito usando las funciones reales:
// orquestador de pago, CC con crédito y saldos derivados. Reemplaza la Meta API
// y Postgres por efectores en memoria que replican la lógica de la migración
// 0006 — así valida el camino RPC y el fallback sin tocar producción.

// ── Réplica en JS de la lógica jsonb de la migración 0006 (registrar_pago,
//    aplicar_credito) para probar el camino RPC con parity real ──────────────
function derivarFactura(f) {
  const monto = Number(f.monto) || 0;
  const pagado = (f.pagos || []).reduce((s, p) => s + (Number(p.monto) || 0), 0);
  const saldo = Math.max(0, monto - pagado);
  let estado = f.estado;
  if (estado !== 'anulada' && estado !== 'registrada') {
    estado = saldo <= 1 ? 'pagada' : pagado > 0 ? 'parcial' : 'pendiente';
  }
  return { ...f, estado, saldoPendiente: Math.round(saldo) };
}

function crearMundo() {
  const world = {
    cajas: [{ id: 'banco', moneda: 'ARS', saldoInicial: 500000, saldo: 500000 }],
    movimientos: [],
    facturas: [],
    broadcasts: [],
  };
  const rpc = async (fn, args) => {
    if (fn === 'registrar_pago_factura') {
      const { p_mov, p_factura_id, p_pago } = args;
      if (world.movimientos.some(m => m.id === p_mov.id)) return { error: null }; // idempotente
      if (p_factura_id) {
        const f = world.facturas.find(x => x.id === p_factura_id);
        if (!f) return { error: { code: 'P0001', message: `factura ${p_factura_id} no existe` } };
        const d = derivarFactura(f);
        if (['anulada', 'registrada', 'pagada'].includes(d.estado)) return { error: { code: 'P0001', message: `la factura está ${d.estado}` } };
        if ((Number(p_pago.monto) || 0) > d.saldoPendiente + 1) return { error: { code: 'P0001', message: `el pago excede el saldo $${d.saldoPendiente}` } };
      }
      world.movimientos.unshift(p_mov);
      if (p_factura_id) {
        const idx = world.facturas.findIndex(x => x.id === p_factura_id);
        world.facturas[idx] = derivarFactura({ ...world.facturas[idx], pagos: [...(world.facturas[idx].pagos || []), { ...p_pago, movimientoId: p_mov.id }] });
      }
      return { error: null };
    }
    if (fn === 'aplicar_credito_factura') {
      const { p_factura_id, p_pago } = args;
      const idx = world.facturas.findIndex(x => x.id === p_factura_id);
      const d = derivarFactura(world.facturas[idx]);
      if (!['pendiente', 'parcial'].includes(d.estado)) return { error: { code: 'P0001', message: `la factura está ${d.estado}` } };
      if ((Number(p_pago.monto) || 0) > d.saldoPendiente + 1) return { error: { code: 'P0001', message: 'excede el saldo' } };
      world.facturas[idx] = derivarFactura({ ...world.facturas[idx], pagos: [...(world.facturas[idx].pagos || []), { ...p_pago, tipo: 'credito' }] });
      return { error: null };
    }
    return { error: { code: 'PGRST202', message: 'Could not find the function' } };
  };
  // Efectores del context (solo estado local: la RPC ya persistió server-side).
  const addMovimientoAsync = (data, opts) => {
    const mov = { ...data, id: data.id };
    if (!opts?.soloLocal && !world.movimientos.some(m => m.id === mov.id)) world.movimientos.unshift(mov);
    return { mov, done: Promise.resolve(true) };
  };
  const registrarPagoFacturaAsync = (fid, pago, opts) => {
    if (!opts?.soloLocal) {
      const idx = world.facturas.findIndex(x => x.id === fid);
      if (idx >= 0) world.facturas[idx] = derivarFactura({ ...world.facturas[idx], pagos: [...(world.facturas[idx].pagos || []), pago] });
    }
    return { factura: world.facturas.find(x => x.id === fid), done: Promise.resolve(true) };
  };
  const removeMovimiento = (id) => { world.movimientos = world.movimientos.filter(m => m.id !== id); };
  // Espejo de quitarPagoDeFactura (ProveedoresContext): borrar el mov de un pago
  // revierte el pago en la factura.
  const quitarPagoDeFactura = (movId) => {
    const idx = world.facturas.findIndex(f => (f.pagos || []).some(p => p.movimientoId === movId));
    if (idx < 0) return;
    world.facturas[idx] = derivarFactura({ ...world.facturas[idx], pagos: world.facturas[idx].pagos.filter(p => p.movimientoId !== movId) });
  };
  const onBroadcast = (k) => world.broadcasts.push(k);
  return { world, efectores: { rpc, addMovimientoAsync, registrarPagoFacturaAsync, removeMovimiento, onBroadcast }, quitarPagoDeFactura };
}

const PROV = { id: 'pv-corralon', nombre: 'Corralón Norte' };
const CTX = () => ({ cajas: [{ id: 'banco', moneda: 'ARS' }], tc: 1000 });
const cajaDe = (world) => calcSaldoCaja(world.cajas[0], world.movimientos);
const ccDe = (world) => saldoProveedorCC(PROV, world.facturas, world.movimientos, [], CTX());
let seq = 0;
const movBase = (over) => ({ id: `mov-qa-${++seq}`, tipo: 'gasto', proveedorId: 'pv-corralon', proveedor: 'Corralón Norte', cajaId: 'banco', fecha: '2026-07-03', ...over });

describe('QA circuito de dinero — recorrido realista end-to-end', () => {
  it('pago parcial → factura parcial, caja debitada, CC debe el resto', async () => {
    const { world, efectores } = crearMundo();
    world.facturas.push(derivarFactura({ id: 'F1', proveedorId: 'pv-corralon', proveedor: 'Corralón Norte', monto: 100000, pagos: [], estado: 'pendiente' }));

    const r = await ejecutarPagoFactura({ movData: movBase({ monto: 40000, descripcion: 'Pago parcial F1' }), facturaId: 'F1', pago: { monto: 40000, fecha: '2026-07-03', cajaId: 'banco' } }, efectores);
    expect(r.ok).toBe(true);
    expect(r.via).toBe('rpc');

    const f1 = world.facturas.find(f => f.id === 'F1');
    expect(estadoFacturaPendiente(f1)).toBe('parcial');
    expect(saldoFacturaPendiente(f1)).toBe(60000);
    expect(cajaDe(world)).toBe(460000);       // 500k − 40k
    expect(ccDe(world).saldo).toBe(60000);    // le debemos 60k
  });

  it('SOBREPAGO → factura saldada + excedente como anticipo (crédito a favor), sin plata perdida', async () => {
    const { world, efectores } = crearMundo();
    world.facturas.push(derivarFactura({ id: 'F1', proveedorId: 'pv-corralon', proveedor: 'Corralón Norte', monto: 100000, pagos: [], estado: 'pendiente' }));

    // El modal parte el pago: monto factura = saldo, excedente = anticipo.
    const saldo = 100000, pagoTotal = 120000, exc = pagoTotal - saldo;
    const rPago = await ejecutarPagoFactura({ movData: movBase({ monto: saldo, descripcion: 'Saldo F1', facturaPendienteId: 'F1' }), facturaId: 'F1', pago: { monto: saldo, fecha: '2026-07-03', cajaId: 'banco' } }, efectores);
    const rAnt = await ejecutarPagoFactura({ movData: movBase({ monto: exc, descripcion: 'Anticipo (excedente)', anticipo: true }) }, efectores);
    expect(rPago.ok && rAnt.ok).toBe(true);

    const f1 = world.facturas.find(f => f.id === 'F1');
    expect(estadoFacturaPendiente(f1)).toBe('pagada');
    expect(cajaDe(world)).toBe(500000 - pagoTotal);                 // salió TODO lo pagado
    expect(creditoDisponibleProveedor(PROV, world.facturas, world.movimientos, CTX())).toBe(exc); // 20k a favor
    expect(ccDe(world).saldo).toBe(-exc);                            // saldo a favor nuestro
  });

  it('rechaza un pago que excede el saldo cuando NO se maneja como anticipo (guard server-side)', async () => {
    const { world, efectores } = crearMundo();
    world.facturas.push(derivarFactura({ id: 'F1', proveedorId: 'pv-corralon', proveedor: 'Corralón Norte', monto: 100000, pagos: [], estado: 'pendiente' }));
    const r = await ejecutarPagoFactura({ movData: movBase({ monto: 130000 }), facturaId: 'F1', pago: { monto: 130000, fecha: '2026-07-03', cajaId: 'banco' } }, efectores);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/excede el saldo/);
    expect(world.movimientos.length).toBe(0); // no escribió nada
    expect(cajaDe(world)).toBe(500000);
  });

  it('APLICAR CRÉDITO a una factura NO mueve caja y consume el crédito', async () => {
    const { world, efectores } = crearMundo();
    // Estado de partida: hay un anticipo de 20k y una factura nueva F2 de 50k.
    world.movimientos.push(movBase({ monto: 20000, anticipo: true, descripcion: 'Anticipo previo' }));
    world.facturas.push(derivarFactura({ id: 'F2', proveedorId: 'pv-corralon', proveedor: 'Corralón Norte', monto: 50000, pagos: [], estado: 'pendiente' }));
    const cajaAntes = cajaDe(world);
    expect(creditoDisponibleProveedor(PROV, world.facturas, world.movimientos, CTX())).toBe(20000);

    const r = await ejecutarAplicarCredito({ facturaId: 'F2', pago: { monto: 20000, fecha: '2026-07-04' } }, efectores);
    expect(r.ok).toBe(true);

    const f2 = world.facturas.find(f => f.id === 'F2');
    expect(saldoFacturaPendiente(f2)).toBe(30000);                  // 50k − 20k crédito
    expect(cajaDe(world)).toBe(cajaAntes);                          // NO se movió plata
    expect(creditoDisponibleProveedor(PROV, world.facturas, world.movimientos, CTX())).toBe(0); // crédito consumido
    expect(ccDe(world).saldo).toBe(30000);                         // queda debiendo 30k
  });

  it('BORRAR el movimiento de un pago revierte el pago en la factura (vuelve a deber)', async () => {
    const { world, efectores, quitarPagoDeFactura } = crearMundo();
    world.facturas.push(derivarFactura({ id: 'F1', proveedorId: 'pv-corralon', proveedor: 'Corralón Norte', monto: 100000, pagos: [], estado: 'pendiente' }));
    const r = await ejecutarPagoFactura({ movData: movBase({ monto: 100000, facturaPendienteId: 'F1' }), facturaId: 'F1', pago: { monto: 100000, fecha: '2026-07-03', cajaId: 'banco' } }, efectores);
    expect(estadoFacturaPendiente(world.facturas[0])).toBe('pagada');
    expect(cajaDe(world)).toBe(400000);

    // Simula handleRemoveMov: quitarPagoDeFactura + removeMovimiento.
    quitarPagoDeFactura(r.movId);
    efectores.removeMovimiento(r.movId);

    const f1 = world.facturas.find(f => f.id === 'F1');
    expect(estadoFacturaPendiente(f1)).toBe('pendiente');           // volvió a deber
    expect(saldoFacturaPendiente(f1)).toBe(100000);
    expect(cajaDe(world)).toBe(500000);                             // la caja recuperó la plata
    expect(ccDe(world).saldo).toBe(100000);
  });

  it('fallback SIN RPC desplegada: mismo resultado contable (mov + pago persisten y compensan)', async () => {
    const { world, efectores } = crearMundo();
    world.facturas.push(derivarFactura({ id: 'F1', proveedorId: 'pv-corralon', proveedor: 'Corralón Norte', monto: 100000, pagos: [], estado: 'pendiente' }));
    // Forzar el fallback: rpc devuelve "función no encontrada".
    const efSinRpc = { ...efectores, rpc: async () => ({ error: { code: 'PGRST202', message: 'Could not find the function' } }) };
    const r = await ejecutarPagoFactura({ movData: movBase({ monto: 40000 }), facturaId: 'F1', pago: { monto: 40000, fecha: '2026-07-03', cajaId: 'banco' } }, efSinRpc);
    expect(r.ok).toBe(true);
    expect(r.via).toBe('fallback');
    expect(cajaDe(world)).toBe(460000);
    expect(estadoFacturaPendiente(world.facturas[0])).toBe('parcial');
  });

  it('crédito consolidado del Dashboard: suma solo los saldos a favor como activo', () => {
    const provs = [PROV, { id: 'pv-2', nombre: 'Otro' }];
    const movimientos = [movBase({ monto: 20000, anticipo: true })]; // PROV a favor 20k
    const facturas = [derivarFactura({ id: 'F9', proveedorId: 'pv-2', proveedor: 'Otro', monto: 70000, pagos: [], estado: 'pendiente' })]; // pv-2 debe
    expect(creditosEnProveedores(provs, facturas, movimientos, [], CTX())).toBe(20000);
  });
});
