import { describe, it, expect } from 'vitest';
import { cascadeRename } from './catalogCascade';

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
