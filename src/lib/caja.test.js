import { describe, it, expect } from 'vitest';
import { efectoEnCaja, calcSaldoCaja, calcSaldoCajaHasta, montoEnARS } from './caja';

describe('montoEnARS — consolidación de monedas', () => {
  const cajas = [
    { id: 'ars', moneda: 'ARS' },
    { id: 'usd', moneda: 'USD' },
  ];
  it('movimiento en caja ARS va tal cual', () => {
    expect(montoEnARS({ cajaId: 'ars', monto: 100000 }, cajas, 1000)).toBe(100000);
  });
  it('movimiento en caja USD se convierte con el tipo de cambio', () => {
    expect(montoEnARS({ cajaId: 'usd', monto: 5000 }, cajas, 1000)).toBe(5000000);
  });
  it('si guardó montoARS, lo usa en vez de convertir', () => {
    expect(montoEnARS({ cajaId: 'usd', monto: 5000, montoARS: 4800000 }, cajas, 1000)).toBe(4800000);
  });
  it('caja inexistente o movimiento nulo → no rompe', () => {
    expect(montoEnARS({ cajaId: 'xxx', monto: 100 }, cajas, 1000)).toBe(100);
    expect(montoEnARS(null, cajas, 1000)).toBe(0);
  });
});

describe('efectoEnCaja — invariante de caja', () => {
  const cajaId = 'cj-1';

  it('un GASTO descuenta el TOTAL del movimiento, no el neto (fix crítico)', () => {
    // Factura A total $1.210.000: el bot guarda monto = total. La caja descuenta
    // el total, NUNCA el neto $1.000.000. Este es exactamente el bug de la sesión
    // pasada (la caja restaba el neto cuando había Factura A).
    expect(efectoEnCaja({ tipo: 'gasto', cajaId, monto: 1210000 }, cajaId)).toBe(-1210000);
  });

  it('un INGRESO suma a su caja', () => {
    expect(efectoEnCaja({ tipo: 'ingreso', cajaId, monto: 5000 }, cajaId)).toBe(5000);
  });

  it('un movimiento de OTRA caja no afecta', () => {
    expect(efectoEnCaja({ tipo: 'gasto', cajaId: 'otra', monto: 9999 }, cajaId)).toBe(0);
  });

  it('TRASPASO: resta del origen, suma al destino (montoDestino para cross-moneda)', () => {
    const t = { tipo: 'traspaso', cajaId: 'A', cajaDestinoId: 'B', monto: 100, montoDestino: 90 };
    expect(efectoEnCaja(t, 'A')).toBe(-100);
    expect(efectoEnCaja(t, 'B')).toBe(90);
  });

  it('NOTA DE CRÉDITO solo-fiscal NO toca caja', () => {
    expect(efectoEnCaja({ tipo: 'nota_credito_compra', cajaId, monto: 50000, afectaCaja: false }, cajaId)).toBe(0);
    expect(efectoEnCaja({ tipo: 'nota_credito_compra', cajaId, monto: 50000 }, cajaId)).toBe(0);
  });

  it('NOTA DE CRÉDITO con devolución suma como crédito a la caja marcada', () => {
    expect(efectoEnCaja({ tipo: 'nota_credito_compra', cajaId, monto: 50000, afectaCaja: true }, cajaId)).toBe(50000);
  });
});

describe('calcSaldoCaja', () => {
  it('saldoInicial + suma de efectos (gasto descuenta total, NC solo-fiscal no)', () => {
    const caja = { id: 'cj-1', saldoInicial: 100000 };
    const movs = [
      { tipo: 'ingreso', cajaId: 'cj-1', monto: 50000 },
      { tipo: 'gasto',   cajaId: 'cj-1', monto: 1210000 },                          // −1.210.000 (total)
      { tipo: 'nota_credito_compra', cajaId: 'cj-1', monto: 200000, afectaCaja: false }, // 0
      { tipo: 'gasto',   cajaId: 'otra', monto: 999 },                              // otra caja → 0
    ];
    expect(calcSaldoCaja(caja, movs)).toBe(100000 + 50000 - 1210000);
  });

  it('sin movimientos = saldoInicial', () => {
    expect(calcSaldoCaja({ id: 'x', saldoInicial: 42000 }, [])).toBe(42000);
  });
});

describe('calcSaldoCajaHasta — saldo al cierre del período', () => {
  const caja = { id: 'cj-1', saldoInicial: 100000 };
  const movs = [
    { tipo: 'ingreso', cajaId: 'cj-1', monto: 50000, fecha: '2026-05-10' },
    { tipo: 'gasto',   cajaId: 'cj-1', monto: 30000, fecha: '2026-05-20' },
    { tipo: 'gasto',   cajaId: 'cj-1', monto: 70000, fecha: '2026-06-05' }, // fuera del período
  ];

  it('solo cuenta movimientos con fecha <= hasta', () => {
    // hasta fin de mayo: 100000 + 50000 - 30000 = 120000 (no incluye el de junio)
    expect(calcSaldoCajaHasta(caja, movs, '2026-05-31')).toBe(120000);
  });

  it('incluye los movimientos del propio día de cierre (<=)', () => {
    // hasta el 20/05: incluye ingreso 10/05 y gasto 20/05 = 120000
    expect(calcSaldoCajaHasta(caja, movs, '2026-05-20')).toBe(120000);
  });

  it('sin fecha de corte = saldo total (equivale a calcSaldoCaja)', () => {
    expect(calcSaldoCajaHasta(caja, movs, null)).toBe(calcSaldoCaja(caja, movs));
  });

  it('un movimiento sin fecha no se cuenta cuando hay corte', () => {
    const conSinFecha = [...movs, { tipo: 'ingreso', cajaId: 'cj-1', monto: 999, fecha: null }];
    expect(calcSaldoCajaHasta(caja, conSinFecha, '2026-05-31')).toBe(120000);
  });
});
