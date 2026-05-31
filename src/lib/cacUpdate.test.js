import { describe, it, expect } from 'vitest';
import { aplicarCACalCatalogo, calcularPreviewCAC, COLECCION_INDICE, campoPrecio } from './cacUpdate';

const INDICES = {
  '2026-01': { cacGeneral: 1000, cacMateriales: 1000, cacManoObra: 1000 },
  '2026-05': { cacGeneral: 1300, cacMateriales: 1200, cacManoObra: 1500 },
};
const baseCatalog = () => ({
  materiales:   [{ id: 'm1', nombre: 'Cemento', precio: 10000 }, { id: 'm2', nombre: 'Sin precio', precio: 0 }],
  subcontratos: [{ id: 's1', nombre: 'Colocación', precio: 20000 }],
  generales:    [{ id: 'g1', nombre: 'Flete', precio: 5000 }],
  mo:           [{ id: 'mo1', nombre: 'Albañil hora', precioHora: 3000 }],
  tareas:       [{ id: 't1', nombre: 'APU', materiales: [] }],
});

const opts = (extra) => Object.assign({ mesBase: '2026-01', mesActual: '2026-05', indices: INDICES }, extra || {});

describe('aplicarCACalCatalogo', () => {
  it('materiales y generales suben por CAC-Materiales (×1.2)', () => {
    const r = aplicarCACalCatalogo(baseCatalog(), opts());
    expect(r.materiales[0].precio).toBe(12000); // 10000 × 1200/1000
    expect(r.materiales[0].cacMesBase).toBe('2026-05');
    expect(r.generales[0].precio).toBe(6000);   // 5000 × 1.2
  });
  it('subcontratos (MO real) sube por CAC-Mano de Obra (×1.5)', () => {
    const r = aplicarCACalCatalogo(baseCatalog(), opts());
    expect(r.subcontratos[0].precio).toBe(30000); // 20000 × 1500/1000
  });
  it('ítem con precio 0 se omite (no se toca, sin cacMesBase)', () => {
    const r = aplicarCACalCatalogo(baseCatalog(), opts());
    expect(r.materiales[1].precio).toBe(0);
    expect(r.materiales[1].cacMesBase).toBeUndefined();
  });
  it('mo legacy NO se toca salvo incluirMOLegacy', () => {
    expect(aplicarCACalCatalogo(baseCatalog(), opts()).mo[0].precioHora).toBe(3000);
    expect(aplicarCACalCatalogo(baseCatalog(), opts({ incluirMOLegacy: true })).mo[0].precioHora).toBe(4500); // ×1.5
  });
  it('las APUs (tareas) NO se tocan', () => {
    const r = aplicarCACalCatalogo(baseCatalog(), opts());
    expect(r.tareas).toEqual(baseCatalog().tareas);
  });
  it('IDEMPOTENTE: re-aplicar el mismo mes es no-op', () => {
    const r1 = aplicarCACalCatalogo(baseCatalog(), opts());
    const r2 = aplicarCACalCatalogo(r1, opts());
    expect(r2.materiales[0].precio).toBe(12000);   // NO se vuelve a multiplicar
    expect(r2.subcontratos[0].precio).toBe(30000);
  });
  it('usa el cacMesBase del ítem como base (no el global) — encadenado correcto', () => {
    // Un ítem ya en 2026-05; actualizar a un mes posterior parte de 2026-05.
    const cat = { materiales: [{ id: 'm1', nombre: 'X', precio: 12000, cacMesBase: '2026-05' }] };
    const indices = { '2026-01': { cacMateriales: 1000 }, '2026-05': { cacMateriales: 1200 }, '2026-09': { cacMateriales: 2400 } };
    const r = aplicarCACalCatalogo(cat, { mesBase: '2026-01', mesActual: '2026-09', indices });
    expect(r.materiales[0].precio).toBe(24000); // 12000 × 2400/1200 (base = su cacMesBase 05, NO el global 01)
  });
  it('sin índice para el mes → factor 1, no cambia', () => {
    const r = aplicarCACalCatalogo(baseCatalog(), opts({ mesActual: '2026-99' }));
    expect(r.materiales[0].precio).toBe(10000);
  });
});

describe('calcularPreviewCAC', () => {
  it('resume por colección con actualizados, variación % y ejemplos', () => {
    const p = calcularPreviewCAC(baseCatalog(), opts());
    expect(p.porColeccion.materiales.actualizados).toBe(1); // m1 sí, m2 (precio 0) no
    expect(p.porColeccion.materiales.variacionPct).toBe(20);
    expect(p.porColeccion.subcontratos.variacionPct).toBe(50);
    expect(p.porColeccion.materiales.ejemplos[0]).toEqual({ nombre: 'Cemento', antes: 10000, despues: 12000 });
    expect(p.omitidos).toBe(1); // el material sin precio
    expect(p.totalActualizados).toBe(3); // cemento + colocación + flete (mo legacy off)
  });
  it('no muta el catálogo original', () => {
    const cat = baseCatalog();
    calcularPreviewCAC(cat, opts());
    expect(cat.materiales[0].precio).toBe(10000);
  });
});

describe('mapeo colección→índice/campo', () => {
  it('COLECCION_INDICE y campoPrecio', () => {
    expect(COLECCION_INDICE.materiales).toBe('cacMateriales');
    expect(COLECCION_INDICE.subcontratos).toBe('cacManoObra');
    expect(COLECCION_INDICE.generales).toBe('cacMateriales');
    expect(campoPrecio('mo')).toBe('precioHora');
    expect(campoPrecio('materiales')).toBe('precio');
  });
});
