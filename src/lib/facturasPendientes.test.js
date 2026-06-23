import { describe, it, expect } from 'vitest';
import {
  saldoFacturaPendiente, estadoFacturaPendiente, facturasPendientesDeProveedor,
  matchFacturasPorPago, aplicarPagoAFactura, totalPendiente,
} from './facturasPendientes';

const fac = (over = {}) => ({ id: 'f1', proveedorId: 'p1', proveedor: 'Don Luis', monto: 100000, pagos: [], estado: 'pendiente', ...over });

describe('saldoFacturaPendiente', () => {
  it('sin pagos = monto', () => expect(saldoFacturaPendiente(fac())).toBe(100000));
  it('resta los pagos', () => expect(saldoFacturaPendiente(fac({ pagos: [{ monto: 30000 }, { monto: 20000 }] }))).toBe(50000));
  it('nunca negativo (sobrepago)', () => expect(saldoFacturaPendiente(fac({ pagos: [{ monto: 120000 }] }))).toBe(0));
  it('tolera null', () => expect(saldoFacturaPendiente(null)).toBe(0));
});

describe('estadoFacturaPendiente', () => {
  it('sin pagos = pendiente', () => expect(estadoFacturaPendiente(fac())).toBe('pendiente'));
  it('pago parcial = parcial', () => expect(estadoFacturaPendiente(fac({ pagos: [{ monto: 40000 }] }))).toBe('parcial'));
  it('pago total = pagada', () => expect(estadoFacturaPendiente(fac({ pagos: [{ monto: 100000 }] }))).toBe('pagada'));
  it('anulada se respeta', () => expect(estadoFacturaPendiente(fac({ estado: 'anulada' }))).toBe('anulada'));
  it('registrada se respeta (solo fiscal)', () => expect(estadoFacturaPendiente(fac({ estado: 'registrada' }))).toBe('registrada'));
});

describe('registrada (factura solo fiscal, sin deuda)', () => {
  it('NO es abierta → excluida de facturasPendientesDeProveedor', () => {
    const list = [fac({ id: 'a', proveedorId: 'p1' }), fac({ id: 'r', proveedorId: 'p1', estado: 'registrada' })];
    const r = facturasPendientesDeProveedor(list, { id: 'p1', nombre: 'Don Luis' });
    expect(r.map(f => f.id)).toEqual(['a']);
  });
  it('NO suma a totalPendiente', () => {
    const list = [fac({ id: 'a', monto: 100000 }), fac({ id: 'r', monto: 141033, estado: 'registrada' })];
    expect(totalPendiente(list)).toBe(100000);
  });
  it('NO matchea contra un pago (no es deuda a pagar)', () => {
    const list = [fac({ id: 'r', proveedorId: 'p1', monto: 141033, estado: 'registrada' })];
    expect(matchFacturasPorPago(list, { proveedorId: 'p1', monto: 141033 })).toEqual([]);
  });
});

describe('facturasPendientesDeProveedor', () => {
  const list = [fac({ id: 'a', proveedorId: 'p1' }), fac({ id: 'b', proveedorId: 'p2' }), fac({ id: 'c', proveedorId: 'p1', pagos: [{ monto: 100000 }] })];
  it('filtra por proveedorId', () => {
    const r = facturasPendientesDeProveedor(list, { id: 'p1', nombre: 'Don Luis' });
    expect(r.map(f => f.id)).toEqual(['a']); // c está pagada → excluida
  });
  it('soloAbiertas:false incluye pagadas', () => {
    const r = facturasPendientesDeProveedor(list, { id: 'p1' }, { soloAbiertas: false });
    expect(r.map(f => f.id)).toEqual(['a', 'c']);
  });
  it('matchea por nombre si no hay proveedorId en la factura', () => {
    const r = facturasPendientesDeProveedor([fac({ id: 'x', proveedorId: undefined, proveedor: 'DON luis' })], { id: 'p9', nombre: 'Don Luis' });
    expect(r.map(f => f.id)).toEqual(['x']);
  });
});

describe('matchFacturasPorPago', () => {
  const list = [
    fac({ id: 'a', proveedorId: 'p1', monto: 100000 }),
    fac({ id: 'b', proveedorId: 'p1', monto: 245000 }),
    fac({ id: 'c', proveedorId: 'p2', monto: 100000 }),
    fac({ id: 'd', proveedorId: 'p1', monto: 100000, pagos: [{ monto: 100000 }] }), // pagada
  ];
  it('match exacto por proveedorId + monto, ignora pagadas y otros proveedores', () => {
    const r = matchFacturasPorPago(list, { proveedorId: 'p1', monto: 100000 });
    expect(r.map(f => f.id)).toEqual(['a']);
  });
  it('tolerancia ±0,5% absorbe redondeo', () => {
    const r = matchFacturasPorPago(list, { proveedorId: 'p1', monto: 245500 }); // 0,2% de más
    expect(r.map(f => f.id)).toEqual(['b']);
  });
  it('sin match si difiere más que la tolerancia', () => {
    expect(matchFacturasPorPago(list, { proveedorId: 'p1', monto: 130000 })).toEqual([]);
  });
  it('matchea contra el SALDO (no el monto) en parciales', () => {
    const parcial = [fac({ id: 'e', proveedorId: 'p1', monto: 200000, pagos: [{ monto: 150000 }] })]; // saldo 50000
    expect(matchFacturasPorPago(parcial, { proveedorId: 'p1', monto: 50000 }).map(f => f.id)).toEqual(['e']);
  });
});

describe('aplicarPagoAFactura', () => {
  it('agrega el pago, recalcula estado/saldo, inmutable', () => {
    const f = fac();
    const next = aplicarPagoAFactura(f, { movimientoId: 'm1', monto: 100000, fecha: '2026-06-05' });
    expect(next).not.toBe(f);
    expect(f.pagos).toEqual([]); // original intacto
    expect(next.pagos).toHaveLength(1);
    expect(next.estado).toBe('pagada');
    expect(next.saldoPendiente).toBe(0);
  });
  it('pago parcial → estado parcial', () => {
    const next = aplicarPagoAFactura(fac(), { monto: 40000 });
    expect(next.estado).toBe('parcial');
    expect(next.saldoPendiente).toBe(60000);
  });
});

describe('totalPendiente', () => {
  it('suma saldos de pendientes/parciales, ignora pagadas y anuladas', () => {
    const list = [
      fac({ id: 'a', monto: 100000 }),
      fac({ id: 'b', monto: 200000, pagos: [{ monto: 50000 }] }), // saldo 150000
      fac({ id: 'c', monto: 300000, pagos: [{ monto: 300000 }] }), // pagada
      fac({ id: 'd', monto: 80000, estado: 'anulada' }),
    ];
    expect(totalPendiente(list)).toBe(250000);
  });
});
