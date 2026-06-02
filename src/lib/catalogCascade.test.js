import { describe, it, expect } from 'vitest';
import { cascadeRename, syncFormItemNames } from './catalogCascade';

// norm de prueba (en producción usa el normalizarNombre del resolver)
const norm = s => (s || '').toString().toLowerCase().trim();

const tareas = () => ([
  { id: 't1', materiales: [{ id: 'm1', nombre: 'Cemento Loma Negra', cantidad: 2 }, { id: 'm2', nombre: 'Arena' }] },
  { id: 't2', materiales: [{ id: 'm3', nombre: 'Arena' }] },
  { id: 't3', materiales: [{ id: 'm4', nombre: 'CEMENTO loma negra' }] }, // mismo, distinta caja
]);

describe('cascadeRename — renombrar material/MO propaga a las recetas de las APU', () => {
  it('renombra las referencias en las tareas que usan el material (por nombre normalizado)', () => {
    const { tareas: out, cambios } = cascadeRename(tareas(), 'materiales', 'Cemento Loma Negra', 'Cemento Portland', norm);
    expect(out[0].materiales[0].nombre).toBe('Cemento Portland');
    expect(out[0].materiales[1].nombre).toBe('Arena');          // intacto
    expect(out[2].materiales[0].nombre).toBe('Cemento Portland'); // case-insensitive
    expect(cambios.map(c => c.id).sort()).toEqual(['t1', 't3']);
  });

  it('no toca tareas que no usan ese material', () => {
    const { cambios } = cascadeRename(tareas(), 'materiales', 'Cemento Loma Negra', 'X', norm);
    expect(cambios.find(c => c.id === 't2')).toBeUndefined();
  });

  it('preserva las demás props del ítem (cantidad, id)', () => {
    const { tareas: out } = cascadeRename(tareas(), 'materiales', 'Cemento Loma Negra', 'Cemento Portland', norm);
    expect(out[0].materiales[0].cantidad).toBe(2);
    expect(out[0].materiales[0].id).toBe('m1');
  });

  it('devuelve cambios vacíos si no matchea nada, sin mutar el original', () => {
    const orig = tareas();
    const { cambios } = cascadeRename(orig, 'materiales', 'No existe', 'X', norm);
    expect(cambios).toEqual([]);
    expect(orig[0].materiales[0].nombre).toBe('Cemento Loma Negra');
  });

  it('cada cambio trae el array nuevo del field, listo para persistir', () => {
    const { cambios } = cascadeRename(tareas(), 'materiales', 'Arena', 'Arena fina', norm);
    const c1 = cambios.find(c => c.id === 't1');
    expect(c1.materiales[1].nombre).toBe('Arena fina');
    expect(c1.materiales[0].nombre).toBe('Cemento Loma Negra');
  });

  it('funciona igual para subcontratos (MO)', () => {
    const ts = [{ id: 't1', subcontratos: [{ id: 's1', nombre: 'Oficial albañil' }] }];
    const { tareas: out, cambios } = cascadeRename(ts, 'subcontratos', 'Oficial albañil', 'Oficial', norm);
    expect(out[0].subcontratos[0].nombre).toBe('Oficial');
    expect(cambios).toHaveLength(1);
  });
});

describe('syncFormItemNames — mantener el editor de APU abierto matcheado cross-tab', () => {
  it('adopta el nombre nuevo del material POR ID (no por nombre, que ya no matchea)', () => {
    const form = { nombre: 'APU', materiales: [{ id: 'm1', nombre: 'Cemento Loma Negra', cantidad: 5 }] };
    const tarea = { id: 't1', materiales: [{ id: 'm1', nombre: 'Cemento Portland', cantidad: 99 }] };
    const out = syncFormItemNames(form, tarea);
    expect(out.materiales[0].nombre).toBe('Cemento Portland'); // adoptado del catálogo
    expect(out.materiales[0].cantidad).toBe(5);                // la cantidad del form NO se toca
  });

  it('sincroniza también subcontratos (MO) y generales', () => {
    const form = { subcontratos: [{ id: 's1', nombre: 'Viejo' }], generales: [{ id: 'g1', nombre: 'GenViejo' }] };
    const tarea = { subcontratos: [{ id: 's1', nombre: 'Nuevo' }], generales: [{ id: 'g1', nombre: 'GenNuevo' }] };
    const out = syncFormItemNames(form, tarea);
    expect(out.subcontratos[0].nombre).toBe('Nuevo');
    expect(out.generales[0].nombre).toBe('GenNuevo');
  });

  it('devuelve el MISMO objeto form si no hay cambios (no fuerza re-render)', () => {
    const form = { materiales: [{ id: 'm1', nombre: 'X' }] };
    const tarea = { materiales: [{ id: 'm1', nombre: 'X' }] };
    expect(syncFormItemNames(form, tarea)).toBe(form);
  });

  it('no toca ítems del form que no estén en la tarea (por id)', () => {
    const form = { materiales: [{ id: 'm9', nombre: 'Solo en form' }] };
    const tarea = { materiales: [{ id: 'm1', nombre: 'Otro' }] };
    expect(syncFormItemNames(form, tarea).materiales[0].nombre).toBe('Solo en form');
  });

  it('tolera form/tarea nulos', () => {
    expect(syncFormItemNames(null, {})).toBe(null);
    const f = { materiales: [] };
    expect(syncFormItemNames(f, null)).toBe(f);
  });
});
