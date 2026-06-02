import { describe, it, expect } from 'vitest';
import { normalizarNombre, findCostoSub, migrarCatalogoConSismat } from './sismatCostFallback';

describe('sismatCostFallback — normalizarNombre', () => {
  it('colapsa no-alfanuméricos (°, paréntesis) y baja acentos', () => {
    expect(normalizarNombre('Columna H°A° 15x20 (Hierro 10mm)')).toBe('columna h a 15x20 hierro 10mm');
  });
  it('decodifica mojibake con Â (grados/ordinales) — fix /[ÃÂ]/', () => {
    // "HÂºAÂº" es el mojibake latin1 de "HºAº"; antes fixEncoding solo disparaba con 'Ã'
    expect(normalizarNombre('Columna HÂºAÂº 15x20')).toBe('columna h a 15x20');
  });
  it('mantiene los números (no confunde 15 / 20 / 150)', () => {
    expect(normalizarNombre('Mampostería de 15')).toBe('mamposteria de 15');
    expect(normalizarNombre('Mampostería de 20')).toBe('mamposteria de 20');
  });
});

describe('sismatCostFallback — findCostoSub (exacto o por prefijo)', () => {
  const map = new Map([
    ['mamposteria de 15 ladrillo comun', { costoMat: 0, costoSub: 9885 }],
    ['mamposteria de 15 con cemento de albanileria', { costoMat: 0, costoSub: 9885 }],
    ['contrapisos', { costoMat: 0, costoSub: 5000 }],
  ]);
  it('matchea por prefijo (la entrada MO es "tarea + sufijo")', () => {
    expect(findCostoSub(map, 'Mampostería de 15')).toBe(9885);
  });
  it('matchea exacto', () => {
    expect(findCostoSub(map, 'Contrapisos')).toBe(5000);
  });
  it('no confunde "15" con "150"/"1" (exige separador tras el prefijo)', () => {
    expect(findCostoSub(map, 'Mampostería de 1')).toBe(0);
  });
  it('devuelve 0 si no hay MO (hueco legítimo)', () => {
    expect(findCostoSub(map, 'Baño químico')).toBe(0);
  });
});

describe('sismatCostFallback — migrarCatalogoConSismat (rescate)', () => {
  const map = new Map([['mamposteria de 15 ladrillo comun', { costoMat: 0, costoSub: 9885 }]]);

  it('agrega un subcontrato MO a la tarea sin MO que matchea por prefijo', () => {
    const catalog = { tareas: [{ id: 't1', nombre: 'Mampostería de 15', unidad: 'm2', subcontratos: [], mo: [] }] };
    const out = migrarCatalogoConSismat(catalog, map);
    expect(out).not.toBeNull();
    const sub = out.tareas[0].subcontratos;
    expect(sub).toHaveLength(1);
    expect(sub[0].precio).toBe(9885);
  });

  it('NO toca una tarea que ya tiene MO (no pisa ediciones del usuario)', () => {
    const catalog = { tareas: [{ id: 't1', nombre: 'Mampostería de 15', subcontratos: [{ precio: 500 }], mo: [] }] };
    expect(migrarCatalogoConSismat(catalog, map)).toBeNull();
  });

  it('devuelve null si no hay nada para rescatar (hueco legítimo)', () => {
    const catalog = { tareas: [{ id: 't9', nombre: 'Baño químico', subcontratos: [], mo: [] }] };
    expect(migrarCatalogoConSismat(catalog, map)).toBeNull();
  });
});
