import { describe, it, expect } from 'vitest';
import {
  creditoDisponibleProveedor,
  saldoProveedorCC,
  estadoCCProveedor,
  validarPagoFactura,
  crearPagoCredito,
  libroProveedor,
  creditosEnProveedores,
} from './proveedorCC';

// Rediseño CC de proveedores (2026-07-03, pedido del dueño):
//  • El saldo puede quedar A FAVOR (pagamos de más / dejamos plata en cuenta) y ese
//    crédito se consume en el próximo pedido sin pagar.
//  • Un pago sin factura vinculada puede ser ANTICIPO (anticipo:true → genera
//    crédito) o gasto directo (impuestos tipo ARCA → NO toca la CC).
//  • El crédito a favor cuenta como ACTIVO de la empresa.
// Semántica del saldo (todo derivado, "libro único"):
//  deuda   = Σ saldoFacturaPendiente(facturas no anuladas / no 'registrada')
//          + Σ (debe − haber) de ccEntries legacy
//  crédito = Σ anticipos (movs gasto anticipo:true, en ARS vía montoEnARS)
//          − Σ aplicaciones de crédito (pagos {tipo:'credito'} en facturas)
//  saldo   = deuda − crédito   (>0 debemos · <0 a favor · 0 al día)

const PROV = { id: 'pv-1', nombre: 'Corralón Norte' };
const CAJAS = [{ id: 'ars', moneda: 'ARS' }, { id: 'usd', moneda: 'USD' }];
const TC = 1000;

const factura = (over = {}) => ({
  id: 'fp-1', proveedorId: 'pv-1', proveedor: 'Corralón Norte',
  fecha: '2026-06-01', monto: 100000, pagos: [], estado: 'pendiente', ...over,
});
const anticipo = (over = {}) => ({
  id: 'mov-a1', tipo: 'gasto', anticipo: true, proveedorId: 'pv-1',
  proveedor: 'Corralón Norte', fecha: '2026-06-02', monto: 50000, cajaId: 'ars', ...over,
});

describe('creditoDisponibleProveedor', () => {
  it('sin anticipos no hay crédito', () => {
    expect(creditoDisponibleProveedor(PROV, [], [], { cajas: CAJAS, tc: TC })).toBe(0);
  });

  it('un anticipo genera crédito por su monto', () => {
    expect(creditoDisponibleProveedor(PROV, [], [anticipo()], { cajas: CAJAS, tc: TC })).toBe(50000);
  });

  it('un gasto directo (sin anticipo:true) NO genera crédito — caso ARCA', () => {
    const gastoDirecto = anticipo({ anticipo: undefined });
    expect(creditoDisponibleProveedor(PROV, [], [gastoDirecto], { cajas: CAJAS, tc: TC })).toBe(0);
  });

  it('aplicar crédito a una factura lo consume', () => {
    const f = factura({ pagos: [{ tipo: 'credito', monto: 30000, fecha: '2026-06-03' }] });
    expect(creditoDisponibleProveedor(PROV, [f], [anticipo()], { cajas: CAJAS, tc: TC })).toBe(20000);
  });

  it('anticipo desde caja USD se convierte a ARS', () => {
    const a = anticipo({ cajaId: 'usd', monto: 100 });
    expect(creditoDisponibleProveedor(PROV, [], [a], { cajas: CAJAS, tc: TC })).toBe(100000);
  });

  it('matchea anticipos por nombre cuando no hay proveedorId (fallback legacy)', () => {
    const a = anticipo({ proveedorId: undefined, proveedor: 'corralón norte ' });
    expect(creditoDisponibleProveedor(PROV, [], [a], { cajas: CAJAS, tc: TC })).toBe(50000);
  });

  it('el crédito nunca es negativo (aplicaciones huérfanas no inventan deuda)', () => {
    const f = factura({ pagos: [{ tipo: 'credito', monto: 99999, fecha: '2026-06-03' }] });
    expect(creditoDisponibleProveedor(PROV, [f], [], { cajas: CAJAS, tc: TC })).toBe(0);
  });
});

describe('saldoProveedorCC — deuda, a favor y el bug del doble descuento', () => {
  it('factura abierta = deuda por su saldo', () => {
    const r = saldoProveedorCC(PROV, [factura()], [], [], { cajas: CAJAS, tc: TC });
    expect(r.saldo).toBe(100000);
    expect(r.deuda).toBe(100000);
  });

  it('FIX doble descuento: factura 100% pagada con movimiento deja la CC en 0 (no en −monto)', () => {
    // Bug actual (ProveedorCC.jsx:90): al saldarse, la factura sale del "debe"
    // pero su pago sigue restando como gasto → CC queda en −monto para siempre.
    const f = factura({ pagos: [{ movimientoId: 'mov-p1', monto: 100000, fecha: '2026-06-05' }] });
    const pagoMov = { id: 'mov-p1', tipo: 'gasto', proveedorId: 'pv-1', fecha: '2026-06-05', monto: 100000, cajaId: 'ars', facturaPendienteId: 'fp-1' };
    const r = saldoProveedorCC(PROV, [f], [pagoMov], [], { cajas: CAJAS, tc: TC });
    expect(r.saldo).toBe(0);
  });

  it('pago parcial deja el saldo restante como deuda', () => {
    const f = factura({ pagos: [{ movimientoId: 'mov-p1', monto: 40000, fecha: '2026-06-05' }] });
    const r = saldoProveedorCC(PROV, [f], [], [], { cajas: CAJAS, tc: TC });
    expect(r.saldo).toBe(60000);
  });

  it('facturas anuladas y solo-fiscales (registrada) no son deuda', () => {
    const fs = [factura({ id: 'f1', estado: 'anulada' }), factura({ id: 'f2', estado: 'registrada' })];
    expect(saldoProveedorCC(PROV, fs, [], [], { cajas: CAJAS, tc: TC }).saldo).toBe(0);
  });

  it('anticipo sin deuda → saldo A FAVOR (negativo)', () => {
    const r = saldoProveedorCC(PROV, [], [anticipo()], [], { cajas: CAJAS, tc: TC });
    expect(r.saldo).toBe(-50000);
    expect(r.credito).toBe(50000);
  });

  it('gasto directo sin factura NO afecta el saldo (no genera "a favor" falso — caso ARCA)', () => {
    const gasto = { id: 'mov-x', tipo: 'gasto', proveedorId: 'pv-1', fecha: '2026-06-05', monto: 405336, cajaId: 'ars' };
    expect(saldoProveedorCC(PROV, [], [gasto], [], { cajas: CAJAS, tc: TC }).saldo).toBe(0);
  });

  it('deuda nueva se descuenta del crédito: pedido de $80k con $50k a favor → debe $30k', () => {
    const r = saldoProveedorCC(PROV, [factura({ monto: 80000 })], [anticipo()], [], { cajas: CAJAS, tc: TC });
    expect(r.saldo).toBe(30000);
  });

  it('ccEntries legacy suman debe y restan haber', () => {
    const cc = [
      { id: 'cc1', proveedorId: 'pv-1', fecha: '2026-05-01', debe: 200000, haber: 0 },
      { id: 'cc2', proveedorId: 'pv-1', fecha: '2026-05-02', debe: 0, haber: 150000 },
    ];
    expect(saldoProveedorCC(PROV, [], [], cc, { cajas: CAJAS, tc: TC }).saldo).toBe(50000);
  });

  it('filtra por obra cuando se pasa obraId', () => {
    const fs = [factura({ id: 'f1', obraId: 'ob-1' }), factura({ id: 'f2', obraId: 'ob-2', monto: 999 })];
    expect(saldoProveedorCC(PROV, fs, [], [], { cajas: CAJAS, tc: TC, obraId: 'ob-1' }).saldo).toBe(100000);
  });
});

describe('estadoCCProveedor', () => {
  it('clasifica debe / a-favor / al-dia', () => {
    expect(estadoCCProveedor(10000)).toBe('debe');
    expect(estadoCCProveedor(-10000)).toBe('a-favor');
    expect(estadoCCProveedor(0)).toBe('al-dia');
    expect(estadoCCProveedor(1)).toBe('al-dia'); // tolerancia $1 (mismo criterio que facturas)
    expect(estadoCCProveedor(-1)).toBe('al-dia');
  });
});

describe('validarPagoFactura — guard de sobrepago', () => {
  it('pago dentro del saldo: ok, sin excedente', () => {
    expect(validarPagoFactura(factura(), 100000)).toEqual({ ok: true, excedente: 0, saldo: 100000 });
    expect(validarPagoFactura(factura(), 40000)).toEqual({ ok: true, excedente: 0, saldo: 100000 });
  });

  it('sobrepago: reporta el excedente (hoy el sistema lo traga — clamp en 0)', () => {
    expect(validarPagoFactura(factura(), 130000)).toEqual({ ok: false, excedente: 30000, saldo: 100000 });
  });

  it('monto inválido o factura cerrada: rechaza', () => {
    expect(validarPagoFactura(factura(), 0).ok).toBe(false);
    expect(validarPagoFactura(factura({ estado: 'anulada' }), 1000).ok).toBe(false);
  });
});

describe('crearPagoCredito — aplicación de crédito a una factura', () => {
  it('crea el pago {tipo:credito} limitado por saldo y crédito disponible', () => {
    const p = crearPagoCredito({ factura: factura(), credito: 50000, monto: 50000, fecha: '2026-06-10' });
    expect(p).toEqual({ tipo: 'credito', monto: 50000, fecha: '2026-06-10' });
  });

  it('rechaza si excede el crédito disponible o el saldo de la factura', () => {
    expect(() => crearPagoCredito({ factura: factura(), credito: 20000, monto: 50000, fecha: '2026-06-10' })).toThrow();
    expect(() => crearPagoCredito({ factura: factura({ monto: 30000 }), credito: 99999, monto: 50000, fecha: '2026-06-10' })).toThrow();
  });
});

describe('libroProveedor — asientos derivados con saldo acumulado', () => {
  it('arma el libro: factura (debe), pago monetario (haber), anticipo (haber), aplicación (haber)', () => {
    const f = factura({
      pagos: [
        { movimientoId: 'mov-p1', monto: 40000, fecha: '2026-06-05' },
        { tipo: 'credito', monto: 20000, fecha: '2026-06-06' },
      ],
    });
    const movs = [
      anticipo({ fecha: '2026-05-20' }),
      { id: 'mov-p1', tipo: 'gasto', proveedorId: 'pv-1', fecha: '2026-06-05', monto: 40000, cajaId: 'ars', facturaPendienteId: 'fp-1' },
      // gasto directo: NO debe aparecer en el libro
      { id: 'mov-dir', tipo: 'gasto', proveedorId: 'pv-1', fecha: '2026-06-07', monto: 7777, cajaId: 'ars' },
    ];
    const libro = libroProveedor(PROV, [f], movs, [], { cajas: CAJAS, tc: TC });
    expect(libro.map(e => e.tipo)).toEqual(['anticipo', 'factura', 'pago', 'credito']);
    expect(libro.map(e => e.saldoAcum)).toEqual([-50000, 50000, 10000, -10000]);
    expect(libro.find(e => e.tipo === 'factura').debe).toBe(100000);
    expect(libro.some(e => e.ref === 'mov-dir')).toBe(false);
  });
});

describe('creditosEnProveedores — activo consolidado para el Dashboard', () => {
  it('suma solo los saldos a favor (los que deben no compensan)', () => {
    const provs = [PROV, { id: 'pv-2', nombre: 'Otro' }];
    const facturas = [factura({ id: 'f2', proveedorId: 'pv-2', proveedor: 'Otro', monto: 70000 })];
    const movs = [anticipo()]; // pv-1 queda -50000 (a favor); pv-2 debe 70000
    expect(creditosEnProveedores(provs, facturas, movs, [], { cajas: CAJAS, tc: TC })).toBe(50000);
  });
});
