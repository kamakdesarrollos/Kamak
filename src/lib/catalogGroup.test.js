import { describe, it, expect } from 'vitest';
import { groupByKey } from './catalogGroup';

describe('catalogGroup — groupByKey', () => {
  // El bug: la lista venía con el mismo rubro SALTEADO (no contiguo). Agrupar
  // debe dejar un solo bloque por rubro → un solo encabezado al renderizar.
  it('agrupa ítems del mismo rubro aunque vengan salteados (contiguos)', () => {
    const list = [
      { id: 1, rubro: 'Pisos' },
      { id: 2, rubro: 'Cemento' },
      { id: 3, rubro: 'Pisos' },
      { id: 4, rubro: 'Cemento' },
      { id: 5, rubro: 'Pisos' },
    ];
    const out = groupByKey(list, 'rubro');
    expect(out.map(i => i.rubro)).toEqual(['Pisos', 'Pisos', 'Pisos', 'Cemento', 'Cemento']);
    // cantidad de "runs" (transiciones) == cantidad de rubros distintos
    let runs = 0, last = null;
    out.forEach(i => { if (i.rubro !== last) { runs++; last = i.rubro; } });
    expect(runs).toBe(2);
  });

  it('respeta el orden de primera aparición de cada rubro', () => {
    const list = [{ id: 1, rubro: 'B' }, { id: 2, rubro: 'A' }, { id: 3, rubro: 'B' }];
    expect(groupByKey(list, 'rubro').map(i => i.rubro)).toEqual(['B', 'B', 'A']);
  });

  it('preserva el orden interno de cada grupo', () => {
    const list = [{ id: 1, rubro: 'X' }, { id: 2, rubro: 'X' }];
    expect(groupByKey(list, 'rubro').map(i => i.id)).toEqual([1, 2]);
  });

  it('tolera rubro vacío/faltante y lista no-array', () => {
    expect(groupByKey([{ id: 1 }, { id: 2, rubro: '' }], 'rubro').map(i => i.id)).toEqual([1, 2]);
    expect(groupByKey(null, 'rubro')).toEqual([]);
  });
});
