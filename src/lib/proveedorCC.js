// Cuenta corriente de proveedores con CRÉDITO A FAVOR — lógica PURA y testeada
// (ver proveedorCC.test.js). Rediseño 2026-07-03 pedido por el dueño:
//  • Si pagamos de más o dejamos plata en cuenta (ANTICIPO), el saldo queda a
//    favor y el próximo pedido se descuenta de ese crédito sin pagar.
//  • El crédito a favor cuenta como ACTIVO de la empresa (Dashboard).
//  • Un gasto sin factura y sin marca de anticipo es "gasto directo" (impuestos
//    tipo ARCA) y NO toca la CC — antes generaba un "a favor" falso.
//
// Todo DERIVADO del libro único (facturasPendientes + movimientos), más el
// SALDO INICIAL de apertura cargado en la ficha (prov.saldoInicial, en ARS:
// >0 = le debemos de arranque · <0 = a favor nuestro de arranque). Ese saldo
// inicial NO mueve ninguna caja y es de la cuenta entera (no de una obra):
//  deuda   = Σ saldoFacturaPendiente(facturas no anuladas / no 'registrada')
//          + Σ (debe − haber) de ccEntries legacy (hoy vacío en prod)
//          + saldo inicial si es > 0 (le debemos de arranque)
//  crédito = Σ anticipos (movimientos gasto con anticipo:true, en ARS)
//          − Σ aplicaciones de crédito (pagos {tipo:'credito'} en facturas)
//          + saldo inicial a favor si es < 0 (crédito de apertura, consumible)
//  saldo   = deuda − crédito   (>0 le debemos · <0 a favor nuestro · ~0 al día)
//
// Arregla además el doble descuento de la CC vieja (ProveedorCC.jsx:90): las
// facturas entran por su SALDO (ya neteado de sus pagos) y los movimientos de
// pago vinculados NO restan aparte — al saldarse una factura la CC queda en 0.

import { saldoFacturaPendiente, estadoFacturaPendiente } from './facturasPendientes';
import { montoEnARS } from './caja';

const norm = (s) => (s || '').toString().toLowerCase().trim();

const esDelProveedor = (x, prov) =>
  x.proveedorId ? x.proveedorId === prov.id : (x.proveedor && norm(x.proveedor) === norm(prov.nombre));

const facturasCC = (facturas, prov, obraId) =>
  (facturas || []).filter(f => {
    if (!esDelProveedor(f, prov)) return false;
    if (obraId && f.obraId !== obraId) return false;
    const e = estadoFacturaPendiente(f);
    return e !== 'anulada' && e !== 'registrada';
  });

const anticiposDe = (movimientos, prov, obraId) =>
  (movimientos || []).filter(m =>
    m.tipo === 'gasto' && m.anticipo === true && esDelProveedor(m, prov) && (!obraId || m.obraId === obraId)
  );

const aplicacionesDe = (facturas, prov, obraId) =>
  facturasCC(facturas, prov, obraId)
    .flatMap(f => (f.pagos || []).filter(p => p.tipo === 'credito'));

// Saldo inicial de apertura de la cuenta (campo prov.saldoInicial, en ARS):
//  > 0 = le debemos de arranque · < 0 = a favor nuestro de arranque.
// Es un saldo de APERTURA (no mueve ninguna caja) de la cuenta ENTERA → solo
// cuenta a nivel proveedor (obraId null), no se imputa a una obra puntual.
const saldoInicialProv = (prov, obraId) => (obraId ? 0 : (Number(prov?.saldoInicial) || 0));

/** Crédito a favor disponible con un proveedor (en ARS, ≥ 0). */
export function creditoDisponibleProveedor(prov, facturas, movimientos, { cajas, tc, obraId = null } = {}) {
  if (!prov) return 0;
  const anticipado = anticiposDe(movimientos, prov, obraId)
    .reduce((s, m) => s + montoEnARS(m, cajas, tc), 0);
  // Saldo inicial a favor (<0): crédito de apertura, consumible como un anticipo más.
  const inicial = saldoInicialProv(prov, obraId);
  const inicialAFavor = inicial < 0 ? -inicial : 0;
  const aplicado = aplicacionesDe(facturas, prov, obraId)
    .reduce((s, p) => s + (Number(p.monto) || 0), 0);
  return Math.max(0, Math.round(anticipado + inicialAFavor - aplicado));
}

/**
 * Saldo de la CC del proveedor. Devuelve { saldo, deuda, credito }.
 *  saldo > 0 → le debemos · saldo < 0 → a favor nuestro · |saldo| ≤ 1 → al día.
 */
export function saldoProveedorCC(prov, facturas, movimientos, ccEntries, { cajas, tc, obraId = null } = {}) {
  if (!prov) return { saldo: 0, deuda: 0, credito: 0 };
  const deudaFacturas = facturasCC(facturas, prov, obraId)
    .reduce((s, f) => s + saldoFacturaPendiente(f), 0);
  const deudaLegacy = (ccEntries || [])
    .filter(e => e.proveedorId === prov.id && (!obraId || e.obraId === obraId))
    .reduce((s, e) => s + (e.debe || 0) - (e.haber || 0), 0);
  // Saldo inicial que le debemos de arranque (>0) suma a la deuda.
  const inicial = saldoInicialProv(prov, obraId);
  const inicialDeuda = inicial > 0 ? inicial : 0;
  const deuda = Math.round(deudaFacturas + deudaLegacy + inicialDeuda);
  const credito = creditoDisponibleProveedor(prov, facturas, movimientos, { cajas, tc, obraId });
  return { saldo: deuda - credito, deuda, credito };
}

/** Clasifica un saldo de CC (tolerancia $1, mismo criterio que las facturas). */
export function estadoCCProveedor(saldo) {
  if (saldo > 1) return 'debe';
  if (saldo < -1) return 'a-favor';
  return 'al-dia';
}

/**
 * Guard de sobrepago al registrar un pago contra una factura.
 * { ok, excedente, saldo }: excedente > 0 = lo que sobra respecto del saldo
 * (hoy el sistema lo tragaba: saldoFacturaPendiente clampea en 0).
 */
export function validarPagoFactura(f, monto) {
  const saldo = saldoFacturaPendiente(f);
  const m = Number(monto) || 0;
  const e = estadoFacturaPendiente(f);
  const abierta = e === 'pendiente' || e === 'parcial';
  if (!abierta || m <= 0) return { ok: false, excedente: 0, saldo };
  if (m > saldo) return { ok: false, excedente: m - saldo, saldo };
  return { ok: true, excedente: 0, saldo };
}

/**
 * Arma el pago de APLICACIÓN DE CRÉDITO contra una factura (no mueve caja).
 * Lanza si excede el crédito disponible o el saldo de la factura.
 */
export function crearPagoCredito({ factura, credito, monto, fecha }) {
  const m = Math.round(Number(monto) || 0);
  const saldo = saldoFacturaPendiente(factura);
  if (m <= 0) throw new Error('El monto a aplicar debe ser mayor a 0');
  if (m > credito) throw new Error(`El crédito disponible es $${credito.toLocaleString('es-AR')}`);
  if (m > saldo) throw new Error(`El saldo de la factura es $${saldo.toLocaleString('es-AR')}`);
  return { tipo: 'credito', monto: m, fecha };
}

/**
 * Libro de la CC: asientos derivados ordenados por fecha con saldo acumulado.
 * Asientos: factura (debe), pago monetario de factura (haber), aplicación de
 * crédito (haber, tipo 'credito'), anticipo (haber). Los gastos directos sin
 * factura ni anticipo NO aparecen (no son parte de la cuenta corriente).
 */
export function libroProveedor(prov, facturas, movimientos, ccEntries, { cajas, tc, obraId = null } = {}) {
  if (!prov) return [];
  const rows = [];
  for (const f of facturasCC(facturas, prov, obraId)) {
    rows.push({
      fecha: f.fecha || '', tipo: 'factura', ref: f.id, obraId: f.obraId || null, obraNombre: f.obraNombre || '',
      concepto: `Factura ${f.tipoLetra || ''} ${f.numero || 's/n'}${f.concepto ? ` · ${f.concepto}` : ''}`.trim(),
      debe: Math.round(Number(f.monto) || 0), haber: 0,
    });
    for (const p of f.pagos || []) {
      const esCredito = p.tipo === 'credito';
      rows.push({
        fecha: p.fecha || '', tipo: esCredito ? 'credito' : 'pago', ref: p.movimientoId || f.id,
        obraId: f.obraId || null, obraNombre: f.obraNombre || '',
        concepto: esCredito
          ? `Aplicación de crédito · factura ${f.numero || 's/n'}`
          : `Pago factura ${f.numero || 's/n'}`,
        debe: 0, haber: Math.round(Number(p.monto) || 0),
      });
    }
  }
  for (const m of anticiposDe(movimientos, prov, obraId)) {
    rows.push({
      fecha: m.fecha || '', tipo: 'anticipo', ref: m.id, obraId: m.obraId || null, obraNombre: m.obraNombre || '',
      concepto: m.descripcion || 'Anticipo a cuenta',
      debe: 0, haber: montoEnARS(m, cajas, tc),
    });
  }
  for (const e of (ccEntries || []).filter(e => e.proveedorId === prov.id && (!obraId || e.obraId === obraId))) {
    rows.push({
      fecha: e.fecha || '', tipo: e.tipo || 'ajuste', ref: e.id, obraId: e.obraId || null, obraNombre: e.obraNombre || '', legacy: true,
      concepto: e.concepto || '', debe: Math.round(e.debe || 0), haber: Math.round(e.haber || 0),
    });
  }
  rows.sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));
  // Saldo inicial de apertura SIEMPRE primero (crédito/deuda de arranque de la
  // cuenta). >0 = le debemos (debe) · <0 = a favor nuestro (haber).
  const inicial = saldoInicialProv(prov, obraId);
  if (inicial !== 0) {
    rows.unshift({
      fecha: prov.saldoInicialFecha || '', tipo: 'inicial', ref: 'inicial', obraId: null, obraNombre: '',
      concepto: 'Saldo inicial de la cuenta',
      debe: inicial > 0 ? inicial : 0, haber: inicial < 0 ? -inicial : 0,
    });
  }
  let acc = 0;
  return rows.map(r => { acc += r.debe - r.haber; return { ...r, saldoAcum: acc }; });
}

/** Σ de saldos A FAVOR con proveedores (en ARS) — activo para el Dashboard. */
export function creditosEnProveedores(proveedores, facturas, movimientos, ccEntries, { cajas, tc } = {}) {
  return (proveedores || []).reduce((s, p) => {
    const { saldo } = saldoProveedorCC(p, facturas, movimientos, ccEntries, { cajas, tc });
    return s + (saldo < -1 ? -saldo : 0);
  }, 0);
}
