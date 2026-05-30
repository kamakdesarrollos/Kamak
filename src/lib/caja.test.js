import { describe, it, expect } from 'vitest';
import { efectoEnCaja, calcSaldoCaja } from './caja';

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
