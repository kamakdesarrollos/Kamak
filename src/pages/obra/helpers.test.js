import { describe, it, expect } from 'vitest';
import {
  cuotaMontoFn, cuotaCobrado, cuotaEstadoCalc,
  tareaVentaUnit, calcRubro, calcObra, calcTareaContratada,
  ingresosObraUSD, detallePagosCuotas, repartirCobroEnCuotas, cobradoObraUSD,
  calcTotalClienteUSD, obraConfirmada,
} from './helpers';

describe('obraConfirmada (gate: el plan de pagos solo cuenta si la obra dejó de ser propuesta)', () => {
  it('en-presupuesto = propuesta → NO confirmada', () => {
    expect(obraConfirmada({ estado: 'en-presupuesto' })).toBe(false);
  });
  it('activa y finalizada = confirmadas', () => {
    expect(obraConfirmada({ estado: 'activa' })).toBe(true);
    expect(obraConfirmada({ estado: 'finalizada' })).toBe(true);
  });
  it('tolera null/undefined', () => {
    expect(obraConfirmada(null)).toBe(false);
    expect(obraConfirmada(undefined)).toBe(false);
  });
});

describe('calcTotalClienteUSD (deuda del cliente en USD)', () => {
  it('usa el precio fijo USD si está cargado y NO depende del tipo de cambio', () => {
    expect(calcTotalClienteUSD({ precioVentaUSD: 59634 }, 85000000, 0, 0, 1430)).toBe(59634);
    expect(calcTotalClienteUSD({ precioVentaUSD: 59634 }, 85000000, 0, 0, 9999)).toBe(59634); // tc distinto, mismo total
  });
  it('cae al cálculo viejo (pesos ÷ tc) si no hay precio fijo', () => {
    expect(calcTotalClienteUSD({}, 1430000, 0, 0, 1430)).toBe(1000);
    expect(calcTotalClienteUSD(null, 1430000, 0, 0, 1430)).toBe(1000);
  });
  it('aplica interés y adicionales en el fallback', () => {
    expect(calcTotalClienteUSD({}, 1000000, 430000, 10, 1430)).toBe(1100); // (1.430.000*1,1)/1430
  });
  it('ignora precio fijo vacío / cero / no numérico', () => {
    expect(calcTotalClienteUSD({ precioVentaUSD: '' }, 1430000, 0, 0, 1430)).toBe(1000);
    expect(calcTotalClienteUSD({ precioVentaUSD: 0 }, 1430000, 0, 0, 1430)).toBe(1000);
    expect(calcTotalClienteUSD({ precioVentaUSD: null }, 1430000, 0, 0, 1430)).toBe(1000);
  });
});

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

describe('ingresosObraUSD', () => {
  const cajas = [
    { id: 'ars', moneda: 'ARS' },
    { id: 'usd', moneda: 'USD' },
  ];
  it('convierte ingresos ARS a USD por la caja y ordena por fecha', () => {
    const movs = [
      { id: 'm2', obraId: 'o1', tipo: 'ingreso', cajaId: 'ars', monto: 1000000, fecha: '2026-02-01' },
      { id: 'm1', obraId: 'o1', tipo: 'ingreso', cajaId: 'usd', monto: 500, fecha: '2026-01-01' },
      { id: 'g1', obraId: 'o1', tipo: 'gasto',   cajaId: 'ars', monto: 999, fecha: '2026-01-15' },
      { id: 'mx', obraId: 'otra', tipo: 'ingreso', cajaId: 'usd', monto: 999, fecha: '2026-01-10' },
    ];
    const out = ingresosObraUSD(movs, cajas, 'o1', 1000);
    expect(out.map(i => i.id)).toEqual(['m1', 'm2']); // ordenado por fecha, solo ingresos de o1
    expect(out[0].monto).toBe(500);   // caja USD: tal cual
    expect(out[1].monto).toBe(1000);  // 1.000.000 ARS / 1000
  });
  it('usa montoDolar si el ingreso lo trae', () => {
    const movs = [{ id: 'm1', obraId: 'o1', tipo: 'ingreso', cajaId: 'ars', monto: 1234567, montoDolar: 1000, fecha: '2026-01-01' }];
    expect(ingresosObraUSD(movs, cajas, 'o1', 1000)[0].monto).toBe(1000);
  });
});

describe('detallePagosCuotas', () => {
  const obraMoneda = 'USD';
  const cuotas = [
    { id: 'c1', monto: 1000, _usd: true },
    { id: 'c2', monto: 1000, _usd: true },
    { id: 'c3', monto: 1000, _usd: true },
  ];
  it('reparte en cascada y marca fecha del movimiento que la salda', () => {
    const ingresos = [
      { fecha: '2026-01-01', monto: 1000 },
      { fecha: '2026-02-01', monto: 500 },
    ];
    const d = detallePagosCuotas(cuotas, ingresos, obraMoneda, 1000);
    expect(d.c1.cobrado).toBe(1000);
    expect(d.c1.fechaPagada).toBe('2026-01-01'); // saldada por el 1er ingreso
    expect(d.c2.cobrado).toBe(500);
    expect(d.c2.fechaPagada).toBe(null); // parcial, no saldada
    expect(d.c3.cobrado).toBe(0);
  });
  it('cuota pagada a mano (estado pagado sin pagos) no consume cobros', () => {
    const cuotasMix = [
      { id: 'c1', monto: 1000, _usd: true, estado: 'pagado' }, // toggle manual
      { id: 'c2', monto: 1000, _usd: true },
    ];
    const ingresos = [{ fecha: '2026-01-01', monto: 1000 }];
    const d = detallePagosCuotas(cuotasMix, ingresos, obraMoneda, 1000);
    expect(d.c1.cobrado).toBe(1000);   // marcada paga
    expect(d.c1.pagos).toEqual([]);    // sin movimiento
    expect(d.c2.cobrado).toBe(1000);   // el ingreso fue a c2, no lo comió c1
  });
  it('el cobrado por cuota coincide con repartirCobroEnCuotas (invariante)', () => {
    const cajas = [{ id: 'usd', moneda: 'USD' }];
    const movs = [
      { id: 'm1', obraId: 'o1', tipo: 'ingreso', cajaId: 'usd', monto: 700, fecha: '2026-01-01' },
      { id: 'm2', obraId: 'o1', tipo: 'ingreso', cajaId: 'usd', monto: 900, fecha: '2026-02-01' },
    ];
    const ingresos = ingresosObraUSD(movs, cajas, 'o1', 1000);
    const detalle = detallePagosCuotas(cuotas, ingresos, obraMoneda, 1000);
    const reparto = repartirCobroEnCuotas(cuotas, cobradoObraUSD(movs, cajas, 'o1', 1000), obraMoneda, 1000);
    for (const c of cuotas) expect(detalle[c.id].cobrado).toBe(reparto[c.id]);
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
