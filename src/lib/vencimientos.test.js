import { describe, it, expect } from 'vitest';
import { diasHasta, chequesPorVencer, cuentasPorVencer } from './vencimientos';

describe('diasHasta', () => {
  it('cuenta días enteros entre hoy y la fecha', () => {
    expect(diasHasta('2026-06-28', '2026-06-25')).toBe(3);
    expect(diasHasta('2026-06-25', '2026-06-25')).toBe(0);
    expect(diasHasta('2026-06-24', '2026-06-25')).toBe(-1);
  });
  it('tolera timestamps ISO completos (corta a YYYY-MM-DD)', () => {
    expect(diasHasta('2026-06-28T13:00:00Z', '2026-06-25T23:59:00Z')).toBe(3);
  });
  it('null si falta fecha o es inválida', () => {
    expect(diasHasta(null, '2026-06-25')).toBeNull();
    expect(diasHasta('2026-06-28', null)).toBeNull();
    expect(diasHasta('no-fecha', '2026-06-25')).toBeNull();
  });
});

describe('chequesPorVencer', () => {
  const hoy = '2026-06-25';
  const cheques = [
    { id: 'c1', estado: 'cartera', fechaVencimiento: '2026-06-27', banco: 'Galicia', numero: '111', monto: 100000 }, // d=2 ✓
    { id: 'c2', estado: 'cartera', fechaVencimiento: '2026-06-25', banco: 'BBVA', numero: '222', monto: 50000 },     // d=0 ✓ (borde)
    { id: 'c3', estado: 'cartera', fechaVencimiento: '2026-07-02', banco: 'Nación', numero: '333', monto: 70000 },   // d=7 ✓ (borde)
    { id: 'c4', estado: 'cartera', fechaVencimiento: '2026-07-03', banco: 'Macro', numero: '444', monto: 80000 },    // d=8 ✗
    { id: 'c5', estado: 'cartera', fechaVencimiento: '2026-06-24', banco: 'ICBC', numero: '555', monto: 90000 },     // d=-1 ✗ (ya venció)
    { id: 'c6', estado: 'depositado', fechaVencimiento: '2026-06-26', banco: 'Santander', numero: '666', monto: 1000 }, // no cartera ✗
    { id: 'c7', estado: 'cartera', fechaVencimiento: '', banco: 'Sin vto', numero: '777', monto: 1 },                // sin fecha ✗
  ];
  it('devuelve solo los cheques en cartera con 0 ≤ d ≤ 7', () => {
    const r = chequesPorVencer(cheques, hoy).map(x => x.id).sort();
    expect(r).toEqual(['c1', 'c2', 'c3']);
  });
  it('respeta un umbral de días custom', () => {
    const r = chequesPorVencer(cheques, hoy, { dias: 2 }).map(x => x.id).sort();
    expect(r).toEqual(['c1', 'c2']);
  });
  it('cada item trae id, d y fechaVto normalizada', () => {
    const c1 = chequesPorVencer(cheques, hoy).find(x => x.id === 'c1');
    expect(c1.d).toBe(2);
    expect(c1.fechaVto).toBe('2026-06-27');
    expect(typeof c1.detalle).toBe('string');
  });
  it('lista vacía con entrada nula/indefinida', () => {
    expect(chequesPorVencer(null, hoy)).toEqual([]);
    expect(chequesPorVencer(undefined, hoy)).toEqual([]);
  });
});

describe('cuentasPorVencer', () => {
  const hoy = '2026-06-25';
  const facturas = [
    { id: 'f1', estado: 'pendiente', fechaVencimiento: '2026-06-27', proveedor: 'Easy', monto: 200000 },   // d=2 ✓
    { id: 'f2', estado: 'parcial',   fechaVencimiento: '2026-06-28', proveedor: 'Distri', monto: 100000 }, // d=3 ✓ (borde)
    { id: 'f3', estado: 'pendiente', fechaVencimiento: '2026-06-29', proveedor: 'Ariel', monto: 50000 },   // d=4 ✗
    { id: 'f4', estado: 'pagada',    fechaVencimiento: '2026-06-26', proveedor: 'Pagada', monto: 1 },       // pagada ✗
    { id: 'f5', estado: 'anulada',   fechaVencimiento: '2026-06-26', proveedor: 'Anulada', monto: 1 },      // anulada ✗
    { id: 'f6', estado: 'registrada',fechaVencimiento: '2026-06-26', proveedor: 'Fiscal', monto: 1 },       // solo fiscal ✗
    { id: 'f7', estado: 'pendiente', proveedor: 'Sin vto', monto: 1 },                                      // sin fecha ✗
  ];
  it('devuelve solo cuentas abiertas con 0 ≤ d ≤ 3 y fecha de vencimiento', () => {
    const r = cuentasPorVencer(facturas, hoy).map(x => x.id).sort();
    expect(r).toEqual(['f1', 'f2']);
  });
  it('acepta un predicado de apertura custom', () => {
    const r = cuentasPorVencer(facturas, hoy, { abierta: () => true, dias: 3 }).map(x => x.id).sort();
    // con abierta:()=>true entran también pagada/anulada/registrada dentro del rango
    expect(r).toEqual(['f1', 'f2', 'f4', 'f5', 'f6']);
  });
  it('lista vacía con entrada nula', () => {
    expect(cuentasPorVencer(null, hoy)).toEqual([]);
  });
});
