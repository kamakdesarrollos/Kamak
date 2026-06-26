import { describe, it, expect } from 'vitest';
import { rubrosExportables, tareaVentaUnit, resumenRubros } from './presupuestoExport';

const rubro = (over = {}) => ({ id: 'r', nombre: 'Rubro', margenMat: 20, margenMO: 35, ...over });

describe('tareaVentaUnit', () => {
  it('aplica margen por rubro (mat 20% / M.O 35%)', () => {
    const r = rubro();
    expect(tareaVentaUnit({ costoMat: 100, costoSub: 0 }, r)).toBe(120);
    expect(tareaVentaUnit({ costoMat: 0, costoSub: 100 }, r)).toBe(135);
  });
  it('margenLinea pisa al del rubro', () => {
    expect(tareaVentaUnit({ costoMat: 100, costoSub: 0, margenLinea: 0 }, rubro())).toBe(100);
  });
  it('materialesACargoComprador: el material no se cobra', () => {
    const r = rubro({ materialesACargoComprador: true });
    expect(tareaVentaUnit({ costoMat: 100, costoSub: 0 }, r)).toBe(0);
    expect(tareaVentaUnit({ costoMat: 100, costoSub: 50 }, r)).toBe(67.5); // solo M.O
  });
});

describe('rubrosExportables', () => {
  it('quita tareas en $0 pero conserva las que tienen valor', () => {
    const r = rubro({ tareas: [
      { id: 'a', nombre: 'Con valor', costoMat: 100, costoSub: 0, cantidad: 1 },
      { id: 'b', nombre: 'Sin precio', costoMat: 0, costoSub: 0, cantidad: 1 },
    ] });
    const [out] = rubrosExportables([r]);
    expect(out.tareas.map(t => t.id)).toEqual(['a']);
  });

  it('quita el rubro completo si todo queda en $0 (caso equipamiento gastronómico)', () => {
    // Le sacaron los materiales a todo el rubro → todas las tareas en 0.
    const equip = rubro({ nombre: 'Equipamiento gastronómico', tareas: [
      { id: 'a', costoMat: 0, costoSub: 0, cantidad: 1 },
      { id: 'b', costoMat: 0, costoSub: 0, cantidad: 2 },
    ] });
    const otro = rubro({ nombre: 'Pisos', tareas: [{ id: 'c', costoMat: 5000, costoSub: 0, cantidad: 1 }] });
    const out = rubrosExportables([equip, otro]);
    expect(out.map(r => r.nombre)).toEqual(['Pisos']);
  });

  it('material a cargo del comprador (material-only) → venta 0 → no se publica', () => {
    const r = rubro({ materialesACargoComprador: true, tareas: [
      { id: 'a', costoMat: 100000, costoSub: 0, cantidad: 1 }, // solo material → 0
      { id: 'b', costoMat: 100000, costoSub: 20000, cantidad: 1 }, // tiene M.O → queda
    ] });
    const [out] = rubrosExportables([r]);
    expect(out.tareas.map(t => t.id)).toEqual(['b']);
  });

  it('quita encabezados de sección que quedan sin tareas debajo', () => {
    const r = rubro({ tareas: [
      { id: 's1', tipo: 'seccion', nombre: 'Iluminación' },
      { id: 'a', costoMat: 0, costoSub: 0, cantidad: 1 }, // se va → sección s1 queda huérfana
      { id: 's2', tipo: 'seccion', nombre: 'Tomas' },
      { id: 'b', costoMat: 1000, costoSub: 0, cantidad: 1 }, // queda → sección s2 se conserva
    ] });
    const [out] = rubrosExportables([r]);
    expect(out.tareas.map(t => t.id)).toEqual(['s2', 'b']);
  });

  it('no muta la entrada', () => {
    const r = rubro({ tareas: [{ id: 'a', costoMat: 0, costoSub: 0, cantidad: 1 }] });
    const snapshot = JSON.parse(JSON.stringify(r));
    rubrosExportables([r]);
    expect(r).toEqual(snapshot);
  });
});

describe('resumenRubros', () => {
  it('devuelve nombre, total de venta y la lista de nombres (sin cantidades ni precios)', () => {
    const r = rubro({ nombre: 'Demoliciones', tareas: [
      { id: 'a', nombre: 'Demolición de pisos', costoMat: 0, costoSub: 1000, cantidad: 2 },
      { id: 'b', nombre: 'Picado de revestimiento', costoMat: 0, costoSub: 500, cantidad: 1 },
    ] });
    const [out] = resumenRubros([r]);
    expect(out.nombre).toBe('Demoliciones');
    // venta = 1000*1.35*2 + 500*1.35*1 = 2700 + 675 = 3375
    expect(out.venta).toBe(3375);
    expect(out.incluye).toEqual(['Demolición de pisos', 'Picado de revestimiento']);
  });

  it('excluye rubros y tareas en $0, y no incluye secciones en "incluye"', () => {
    const r1 = rubro({ nombre: 'Con valor', tareas: [
      { id: 's', tipo: 'seccion', nombre: 'Sección X' },
      { id: 'a', nombre: 'Tarea real', costoMat: 1000, costoSub: 0, cantidad: 1 },
      { id: 'b', nombre: 'Sin precio', costoMat: 0, costoSub: 0, cantidad: 1 },
    ] });
    const r0 = rubro({ nombre: 'Todo en cero', tareas: [{ id: 'c', costoMat: 0, costoSub: 0, cantidad: 1 }] });
    const out = resumenRubros([r1, r0]);
    expect(out.map(r => r.nombre)).toEqual(['Con valor']);
    expect(out[0].incluye).toEqual(['Tarea real']); // sin la sección ni la de $0
  });
});
