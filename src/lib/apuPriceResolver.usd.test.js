import { describe, it, expect } from 'vitest';
import { aplicarDolarItems, buildCatalogIndex, resolverItemAPU } from './apuPriceResolver';

describe('aplicarDolarItems — items en USD atados al dólar venta', () => {
  it('convierte el precio USD a ARS al dólar venta (y guarda el original en _usd)', () => {
    const items = [{ nombre: 'Distribuidor', precio: 230, unidad: 'm', moneda: 'USD' }];
    const out = aplicarDolarItems(items, 1000);
    expect(out[0].precio).toBe(230000);
    expect(out[0]._usd).toBe(230);
    expect(out[0].moneda).toBe('USD');
  });

  it('deja los items en ARS sin tocar (y devuelve la MISMA referencia si no hay USD)', () => {
    const items = [{ nombre: 'Cemento', precio: 500, moneda: 'ARS' }, { nombre: 'Cal', precio: 300 }];
    const out = aplicarDolarItems(items, 1000);
    expect(out).toBe(items);
    expect(out[0].precio).toBe(500);
    expect(out[1].precio).toBe(300);
  });

  it('sin cotización (null) no convierte', () => {
    const items = [{ nombre: 'X', precio: 100, moneda: 'USD' }];
    expect(aplicarDolarItems(items, null)).toBe(items);
  });

  it('también convierte precioHora de MO en USD', () => {
    const items = [{ nombre: 'Oficial', precioHora: 5, moneda: 'USD' }];
    const out = aplicarDolarItems(items, 1200);
    expect(out[0].precioHora).toBe(6000);
    expect(out[0]._usdHora).toBe(5);
  });
});

describe('buildCatalogIndex(catalog, dolarVenta) → resolverItemAPU en ARS', () => {
  it('un material en USD se resuelve a ARS al dólar', () => {
    const catalog = { materiales: [{ nombre: 'Mueble Barra', precio: 230, unidad: 'm', moneda: 'USD' }] };
    const idx = buildCatalogIndex(catalog, 1000);
    const r = resolverItemAPU({ nombre: 'Mueble Barra', cantidad: 2.8, unidad: 'm' }, idx.materiales);
    expect(r.encontrado).toBe(true);
    expect(r.precioUnitario).toBe(230000);          // 230 USD × 1000
    expect(r.subtotal).toBe(Math.round(2.8 * 230000));
  });

  it('sin dólar, el índice deja el precio crudo (no rompe el caso ARS legacy)', () => {
    const catalog = { materiales: [{ nombre: 'Cemento', precio: 500, unidad: 'kg' }] };
    const idx = buildCatalogIndex(catalog); // sin dolarVenta
    const r = resolverItemAPU({ nombre: 'Cemento', cantidad: 10, unidad: 'kg' }, idx.materiales);
    expect(r.precioUnitario).toBe(500);
    expect(r.subtotal).toBe(5000);
  });
});
