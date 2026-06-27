import { describe, it, expect } from 'vitest';
import { rubrosExportables, tareaVentaUnit, resumenRubros, notaRubroAuto, FRASE_CON_MAT, FRASE_SIN_MAT, FRASE_VIATICOS } from './presupuestoExport';

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

describe('notaRubroAuto', () => {
  it('rubro con materiales → frase con materiales', () => {
    const r = rubro({ nombre: 'Pisos', tareas: [{ id: 'a', nombre: 'Porcelanato', costoMat: 5000, costoSub: 2000 }] });
    expect(notaRubroAuto(r)).toBe(FRASE_CON_MAT);
  });
  it('rubro solo mano de obra → frase a cargo del comprador', () => {
    const r = rubro({ nombre: 'Demoliciones', tareas: [{ id: 'a', nombre: 'Demolición', costoMat: 0, costoSub: 1000 }] });
    expect(notaRubroAuto(r)).toBe(FRASE_SIN_MAT);
  });
  it('materiales a cargo del comprador → frase a cargo del comprador (no con materiales)', () => {
    const r = rubro({ nombre: 'Revestimientos', materialesACargoComprador: true, tareas: [{ id: 'a', nombre: 'Cerámico', costoMat: 5000, costoSub: 2000 }] });
    expect(notaRubroAuto(r)).toBe(FRASE_SIN_MAT);
  });
  it('logística sin viáticos → frase de viáticos a cargo del comprador', () => {
    const r = rubro({ nombre: '47 - LOGISTICA', tareas: [{ id: 'a', nombre: 'Flete y acarreo', costoMat: 0, costoSub: 1000 }] });
    expect(notaRubroAuto(r)).toBe(FRASE_VIATICOS);
  });
  it('logística CON viáticos (acento) → no usa la frase de viáticos', () => {
    const r = rubro({ nombre: '47 - LOGISTICA', tareas: [{ id: 'a', nombre: 'Viáticos del equipo', costoMat: 0, costoSub: 1000 }] });
    expect(notaRubroAuto(r)).not.toBe(FRASE_VIATICOS);
  });
});

describe('resumenRubros', () => {
  it('devuelve nombre, total, nota manual y notaAuto; no expone tareas', () => {
    const r = rubro({ nombre: 'Demoliciones', tareas: [
      { id: 'a', nombre: 'Demolición de pisos', costoMat: 0, costoSub: 1000, cantidad: 2 },
      { id: 'b', nombre: 'Picado de revestimiento', costoMat: 0, costoSub: 500, cantidad: 1 },
    ] });
    const [out] = resumenRubros([r]);
    expect(out.nombre).toBe('Demoliciones');
    expect(out.venta).toBe(3375); // 1000*1.35*2 + 500*1.35
    expect(out.notaAuto).toBe(FRASE_SIN_MAT);
    expect(out.nota).toBeUndefined();
    expect(out.incluye).toBeUndefined(); // no se exponen las tareas
  });

  it('rubro con materiales → notaAuto con materiales', () => {
    const r = rubro({ nombre: 'Pisos', tareas: [{ id: 'a', nombre: 'Porcelanato', costoMat: 5000, costoSub: 2000, cantidad: 1 }] });
    expect(resumenRubros([r])[0].notaAuto).toBe(FRASE_CON_MAT);
  });

  it('excluye rubros en $0', () => {
    const r0 = rubro({ nombre: 'Todo en cero', tareas: [{ id: 'c', costoMat: 0, costoSub: 0, cantidad: 1 }] });
    const r1 = rubro({ nombre: 'Con valor', tareas: [{ id: 'a', costoMat: 1000, costoSub: 0, cantidad: 1 }] });
    expect(resumenRubros([r1, r0]).map(r => r.nombre)).toEqual(['Con valor']);
  });

  it('pasa la nota manual del rubro (o undefined si no tiene)', () => {
    const conNota = rubro({ nombre: 'Pisos', nota: 'No incluye nivelación de contrapiso.', tareas: [{ id: 'a', costoMat: 1000, costoSub: 0, cantidad: 1 }] });
    const sinNota = rubro({ nombre: 'Pintura', tareas: [{ id: 'b', costoMat: 0, costoSub: 1000, cantidad: 1 }] });
    const [a, b] = resumenRubros([conNota, sinNota]);
    expect(a.nota).toBe('No incluye nivelación de contrapiso.');
    expect(b.nota).toBeUndefined();
  });
});
