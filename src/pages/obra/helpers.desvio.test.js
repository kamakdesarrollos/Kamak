import { describe, it, expect } from 'vitest';
import { gastadoPorRubro, gastadoDeRubro, desvioRubro } from './helpers';

describe('imputación de gasto a rubro / desvío presupuesto-vs-real', () => {
  it('gastadoPorRubro agrupa por id, por nombre y sin rubro; ignora ingresos', () => {
    const m = gastadoPorRubro([
      { tipo: 'gasto', monto: 100, rubroId: 'r1' },
      { tipo: 'gasto', monto: 50, rubroNombre: 'Albañilería' },
      { tipo: 'gasto', monto: 30 },                 // sin rubro
      { tipo: 'ingreso', monto: 999, rubroId: 'r1' }, // no cuenta (no es gasto)
    ]);
    expect(m.porRubroId.r1).toBe(100);
    expect(m.porNombre['Albañilería']).toBe(50);
    expect(m.sinRubro).toBe(30);
  });

  it('gastadoDeRubro suma lo imputado por id Y por nombre del mismo rubro', () => {
    const m = gastadoPorRubro([
      { tipo: 'gasto', monto: 100, rubroId: 'r1' },
      { tipo: 'gasto', monto: 40, rubroNombre: 'Pintura' },
    ]);
    expect(gastadoDeRubro({ id: 'r1', nombre: 'Pintura' }, m)).toBe(140);
  });

  it('desvioRubro: costo presupuestado vs gastado real; sobrecosto = desvío positivo', () => {
    const rubro = { id: 'r1', nombre: 'Albañilería', margenMat: 0, margenMO: 0,
      tareas: [{ tipo: 'normal', costoMat: 100, costoSub: 0, cantidad: 1, avance: 0 }] };
    const m = gastadoPorRubro([{ tipo: 'gasto', monto: 130, rubroId: 'r1' }]);
    const d = desvioRubro(rubro, m);
    expect(d.costo).toBe(100);
    expect(d.gastado).toBe(130);
    expect(d.desvio).toBe(30);     // gastó 30 más de lo presupuestado
    expect(d.pct).toBe(130);       // 130% del presupuesto consumido
  });

  it('rubro presupuestado sin gasto imputado → 0% consumido', () => {
    const rubro = { id: 'r2', nombre: 'Pintura', margenMat: 0, margenMO: 0,
      tareas: [{ tipo: 'normal', costoMat: 200, costoSub: 0, cantidad: 1, avance: 0 }] };
    const d = desvioRubro(rubro, gastadoPorRubro([]));
    expect(d.gastado).toBe(0);
    expect(d.desvio).toBe(-200);   // todo el presupuesto sin consumir
    expect(d.pct).toBe(0);
  });
});
