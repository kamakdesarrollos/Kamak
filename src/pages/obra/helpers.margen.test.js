import { describe, it, expect } from 'vitest';
import { tareaVentaUnit, tareaSinMargenLinea, calcRubro } from './helpers';

describe('tareaSinMargenLinea', () => {
  it('quita el margenLinea de la tarea', () => {
    const out = tareaSinMargenLinea({ id: 't1', costoMat: 100, costoSub: 50, margenLinea: 40 });
    expect(out.margenLinea).toBeUndefined();
    expect(out.costoMat).toBe(100);
  });

  it('si la tarea no tiene margenLinea, la devuelve sin cambios', () => {
    const t = { id: 't1', costoMat: 100, costoSub: 50 };
    expect(tareaSinMargenLinea(t)).toBe(t);
  });

  it('al limpiar margenLinea, la venta pasa a usar el margen del RUBRO (mat/MO)', () => {
    const rubro = { margenMat: 0, margenMO: 100 };
    const t = { costoMat: 100, costoSub: 50, margenLinea: 40 };
    // Con margenLinea propio (40%): (100+50) * 1.40 = 210
    expect(tareaVentaUnit(t, rubro)).toBe(210);
    // Sin margenLinea: 100*(1+0) + 50*(1+1) = 100 + 100 = 200 (manda el rubro)
    expect(tareaVentaUnit(tareaSinMargenLinea(t), rubro)).toBe(200);
  });
});

describe('calcRubro ignora filas agrupadoras (sub-rubros sin cantidad)', () => {
  it('una fila sin cantidad no mete NaN en los totales', () => {
    const rubro = {
      margenMat: 0, margenMO: 0,
      tareas: [
        { id: 'g', nombre: 'Iluminación' },                               // agrupador: sin cantidad ni costo
        { id: 't', nombre: 'Artefacto', costoMat: 100, costoSub: 50, cantidad: 2 },
      ],
    };
    const r = calcRubro(rubro);
    expect(Number.isNaN(r.costo)).toBe(false);
    expect(Number.isNaN(r.venta)).toBe(false);
    expect(r.costo).toBe(300); // (100+50) * 2
  });
});
