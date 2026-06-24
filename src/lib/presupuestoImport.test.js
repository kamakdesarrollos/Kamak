import { describe, it, expect } from 'vitest';
import { detectarColumnas, mapearColumnas, normalizarItems, itemsATareas } from './presupuestoImport';

describe('detectarColumnas', () => {
  it('reconoce encabezados típicos en español', () => {
    const header = ['Descripción', 'Cant.', 'Precio Unitario', 'Unidad'];
    expect(detectarColumnas(header)).toEqual({ nombre: 0, cantidad: 1, costo: 2, unidad: 3 });
  });
  it('devuelve -1 para columnas que no encuentra', () => {
    const header = ['Item', 'Total'];
    const m = detectarColumnas(header);
    expect(m.nombre).toBe(0);
    expect(m.cantidad).toBe(-1);
    expect(m.unidad).toBe(-1);
  });
});

describe('mapearColumnas', () => {
  it('proyecta filas a items según el mapping', () => {
    const rows = [['Plancha Braf', '1', '185000', 'u'], ['Freidora Braf', '1', '210000', 'u']];
    const mapping = { nombre: 0, cantidad: 1, costo: 2, unidad: 3 };
    expect(mapearColumnas(rows, mapping)).toEqual([
      { nombre: 'Plancha Braf', cantidad: '1', costo: '185000', unidad: 'u' },
      { nombre: 'Freidora Braf', cantidad: '1', costo: '210000', unidad: 'u' },
    ]);
  });
  it('usa cadena vacía cuando un índice es -1', () => {
    const rows = [['Plancha', '185000']];
    const mapping = { nombre: 0, costo: 1, cantidad: -1, unidad: -1 };
    expect(mapearColumnas(rows, mapping)).toEqual([{ nombre: 'Plancha', costo: '185000', cantidad: '', unidad: '' }]);
  });
});

describe('normalizarItems', () => {
  it('coerce números, cantidad default 1, parsea miles AR', () => {
    const out = normalizarItems([{ nombre: 'Plancha', costo: '185.000', cantidad: '', unidad: 'u' }]);
    expect(out).toEqual([{ nombre: 'Plancha', costo: 185000, cantidad: 1, unidad: 'u' }]);
  });
  it('descarta filas sin nombre o sin costo > 0', () => {
    const out = normalizarItems([
      { nombre: '', costo: '100', cantidad: '1', unidad: '' },
      { nombre: 'Subtotal', costo: '0', cantidad: '1', unidad: '' },
      { nombre: 'Horno', costo: '50000', cantidad: '2', unidad: 'u' },
    ]);
    expect(out).toEqual([{ nombre: 'Horno', costo: 50000, cantidad: 2, unidad: 'u' }]);
  });
});

describe('itemsATareas', () => {
  it('mapea costo→costoSub, costoMat 0, linkea contratoId', () => {
    let n = 0;
    const tareas = itemsATareas(
      [{ nombre: 'Plancha', costo: 185000, cantidad: 1, unidad: 'u' }],
      { contratoId: 'ct-9', makeId: () => `id-${++n}` }
    );
    expect(tareas).toEqual([{
      id: 'id-1', codigo: '', nombre: 'Plancha', unidad: 'u', cantidad: 1,
      costoMat: 0, costoSub: 185000, contratoId: 'ct-9', fuente: 'Presupuesto',
      receta: { materiales: [] }, avance: 0,
    }]);
  });
});
