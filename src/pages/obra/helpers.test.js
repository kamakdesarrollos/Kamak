import { describe, it, expect } from 'vitest';
import {
  cuotaMontoFn, cuotaCobrado, cuotaEstadoCalc,
  tareaVentaUnit, calcRubro, calcObra, calcTareaContratada,
} from './helpers';

describe('cuotaMontoFn', () => {
  it('respeta el monto si la cuota es _usd', () => {
    expect(cuotaMontoFn({ monto: 1000, _usd: true }, 'USD', 1000)).toBe(1000);
  });

  it('respeta el monto si la moneda activa es ARS', () => {
    expect(cuotaMontoFn({ monto: 50000 }, 'ARS', 1000)).toBe(50000);
  });

  it('convierte ARS->USD si la moneda activa es USD y la cuota no es _usd', () => {
    expect(cuotaMontoFn({ monto: 50000 }, 'USD', 1000)).toBe(50);
  });

  it('devuelve 0 si no hay monto', () => {
    expect(cuotaMontoFn({}, 'ARS', 1000)).toBe(0);
  });
});

describe('cuotaCobrado', () => {
  it('suma 0 si no hay pagos', () => {
    expect(cuotaCobrado({}, 'ARS', 1000)).toBe(0);
  });

  it('suma pagos ARS en moneda ARS', () => {
    expect(cuotaCobrado({ pagos: [
      { monto: 1000, moneda: 'ARS' },
      { monto: 2000, moneda: 'ARS' },
    ] }, 'ARS', 1000)).toBe(3000);
  });

  it('convierte pagos USD a ARS si la cuota es ARS', () => {
    expect(cuotaCobrado({ pagos: [
      { monto: 10, moneda: 'USD', tc: 1000 },
    ] }, 'ARS', 1000)).toBe(10000);
  });

  it('convierte pagos ARS a USD si la cuota es USD', () => {
    expect(cuotaCobrado({ pagos: [
      { monto: 10000, moneda: 'ARS', tc: 1000 },
    ] }, 'USD', 1000)).toBe(10);
  });
});

describe('cuotaEstadoCalc', () => {
  it('pendiente si nada cobrado', () => {
    expect(cuotaEstadoCalc({ monto: 1000, pagos: [] }, 'ARS', 1000)).toBe('pendiente');
  });

  it('pagado si cobrado >= monto', () => {
    expect(cuotaEstadoCalc({
      monto: 1000,
      pagos: [{ monto: 1000, moneda: 'ARS' }],
    }, 'ARS', 1000)).toBe('pagado');
  });

  it('parcial si cobrado entre 0 y monto', () => {
    expect(cuotaEstadoCalc({
      monto: 1000,
      pagos: [{ monto: 500, moneda: 'ARS' }],
    }, 'ARS', 1000)).toBe('parcial');
  });
});

describe('tareaVentaUnit', () => {
  const rubro = { margenMat: 20, margenMO: 40 };

  it('usa margenLinea si esta presente', () => {
    // costoMat 100 + costoSub 50 = 150, margenLinea 25% -> 187.5
    expect(tareaVentaUnit({ costoMat: 100, costoSub: 50, margenLinea: 25 }, rubro)).toBe(187.5);
  });

  it('usa margenes por rubro si no hay margenLinea', () => {
    // 100 * 1.20 + 50 * 1.40 = 120 + 70 = 190
    expect(tareaVentaUnit({ costoMat: 100, costoSub: 50 }, rubro)).toBe(190);
  });

  it('costoSub puede ser undefined', () => {
    expect(tareaVentaUnit({ costoMat: 100 }, rubro)).toBe(120);
  });
});

describe('calcRubro', () => {
  it('suma costos y ventas de las tareas', () => {
    const rubro = {
      margenMat: 0, margenMO: 0,
      tareas: [
        { costoMat: 100, costoSub: 50, cantidad: 2, avance: 50 },
        { costoMat: 200, costoSub: 0,  cantidad: 1, avance: 100 },
      ],
    };
    const r = calcRubro(rubro);
    expect(r.cMat).toBe(400);   // 100*2 + 200*1
    expect(r.cSub).toBe(100);   // 50*2
    expect(r.costo).toBe(500);
    expect(r.venta).toBe(500);  // margenes 0 -> venta == costo
    expect(r.margen).toBe(0);
    expect(r.avance).toBe(75);  // promedio (50+100)/2
  });

  it('ignora tareas tipo seccion', () => {
    const rubro = {
      margenMat: 0, margenMO: 0,
      tareas: [
        { costoMat: 100, costoSub: 0, cantidad: 1, avance: 50 },
        { tipo: 'seccion', costoMat: 9999, costoSub: 9999, cantidad: 9, avance: 0 },
      ],
    };
    expect(calcRubro(rubro).costo).toBe(100);
  });

  it('rubro vacio devuelve 0 en todo', () => {
    const r = calcRubro({ margenMat: 20, margenMO: 40, tareas: [] });
    expect(r.costo).toBe(0);
    expect(r.venta).toBe(0);
    expect(r.margen).toBe(0);
    expect(r.avance).toBe(0);
  });
});

describe('calcObra', () => {
  it('agrega los totales de cada rubro', () => {
    const rubros = [
      { margenMat: 0, margenMO: 0, tareas: [{ costoMat: 100, costoSub: 0, cantidad: 1, avance: 0 }] },
      { margenMat: 0, margenMO: 0, tareas: [{ costoMat: 200, costoSub: 0, cantidad: 1, avance: 0 }] },
    ];
    const r = calcObra(rubros);
    expect(r.costo).toBe(300);
    expect(r.venta).toBe(300);
    expect(r.cMat).toBe(300);
    expect(r.cSub).toBe(0);
    expect(r.rubros).toHaveLength(2);
  });
});

describe('calcTareaContratada', () => {
  it('suma cantidad contratada de tareas activas', () => {
    const contratos = [
      { estado: 'activo', tareas: [{ tareaId: 't1', cantidadContratada: 10 }, { tareaId: 't2', cantidadContratada: 5 }] },
      { estado: 'activo', tareas: [{ tareaId: 't1', cantidadContratada: 3 }] },
    ];
    expect(calcTareaContratada('t1', contratos)).toBe(13);
    expect(calcTareaContratada('t2', contratos)).toBe(5);
  });

  it('ignora contratos anulados', () => {
    const contratos = [
      { estado: 'anulado', tareas: [{ tareaId: 't1', cantidadContratada: 100 }] },
      { estado: 'activo',  tareas: [{ tareaId: 't1', cantidadContratada: 5 }] },
    ];
    expect(calcTareaContratada('t1', contratos)).toBe(5);
  });

  it('devuelve 0 si no hay contratos', () => {
    expect(calcTareaContratada('t1', [])).toBe(0);
  });
});
