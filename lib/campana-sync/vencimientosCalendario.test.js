import { describe, it, expect } from 'vitest';
import { planEventosVencimientos } from './vencimientosCalendario.js';

// Lógica PURA: sin red ni mocks — solo fixtures. Fechas relativas a un "hoy"
// fijo (2026-07-22); ventana = hoy..hoy+7 sobre la fecha del EVENTO.
const HOY = '2026-07-22';
const AYER = '2026-07-21';
const D1 = '2026-07-23';
const D3 = '2026-07-25';
const D5 = '2026-07-27';
const D7 = '2026-07-29';   // último día de la ventana
const D8 = '2026-07-30';   // primer día FUERA de la ventana
const D9 = '2026-07-31';   // póliza: evento D7 (dentro)
const D10 = '2026-08-01';  // póliza: evento D8 (fuera)

const base = (over = {}) => ({
  hoy: HOY,
  obras: [],
  detalles: {},
  cheques: [],
  proveedores: null,
  tareas: [],
  movimientos: [],
  cajas: [],
  dolarVenta: 1070,
  yaCreados: {},
  ...over,
});

const plan = (over) => planEventosVencimientos(base(over));

const obraUSD = { id: 'o1', nombre: 'Quilmes S7', estado: 'activa', moneda: 'USD', cliente: 'Mancini' };

// ---------------------------------------------------------------------------
// Cuotas
// ---------------------------------------------------------------------------

describe('cuotas impagas', () => {
  const conCuotas = (cuotas, obra = obraUSD, extra = {}) =>
    plan({ obras: [obra], detalles: { [obra.id]: { cuotas } }, ...extra });

  it('cuota impaga con fecha en ventana → evento con clave/titulo/fecha correctos', () => {
    const out = conCuotas([{ id: 'c1', n: 2, monto: 5000, fecha: D3 }]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      clave: `cal:cuota:o1:c1:${D3}`,
      titulo: '💰 Cobrar cuota 2 — Quilmes S7 — U$S 5.000',
      descripcion: 'Cliente: Mancini · Estado: impaga · Vence 25/07/2026',
      fechaISO: D3,
    });
  });

  it('cuota cubierta por movimientos (libro único) NO genera; la siguiente parcial sí, como parcial', () => {
    const out = conCuotas(
      [
        { id: 'c1', n: 1, monto: 5000, fecha: D1 },
        { id: 'c2', n: 2, monto: 3000, fecha: D5 },
      ],
      obraUSD,
      { movimientos: [{ id: 'm1', obraId: 'o1', tipo: 'ingreso', montoDolar: 6000 }] },
    );
    // c1 quedó paga (5000 de 6000); c2 quedó parcial (1000 de 3000).
    expect(out.map(e => e.clave)).toEqual([`cal:cuota:o1:c2:${D5}`]);
    expect(out[0].descripcion).toContain('parcial (cubierto U$S 1.000 de U$S 3.000)');
  });

  it("cuota marcada 'pagado' a mano (sin pagos) NO genera", () => {
    expect(conCuotas([{ id: 'c1', n: 1, monto: 5000, fecha: D3, estado: 'pagado' }])).toEqual([]);
  });

  it('obra en-presupuesto o pausada NO genera; finalizada SÍ', () => {
    const cuotas = [{ id: 'c1', n: 1, monto: 5000, fecha: D3 }];
    expect(conCuotas(cuotas, { ...obraUSD, estado: 'en-presupuesto' })).toEqual([]);
    expect(conCuotas(cuotas, { ...obraUSD, estado: 'pausada' })).toEqual([]);
    expect(conCuotas(cuotas, { ...obraUSD, estado: 'finalizada' })).toHaveLength(1);
  });

  it('fuera de ventana (hoy+8, ayer), sin fecha o sin monto → nada; hoy y hoy+7 → sí', () => {
    expect(conCuotas([{ id: 'c1', n: 1, monto: 5000, fecha: D8 }])).toEqual([]);
    expect(conCuotas([{ id: 'c1', n: 1, monto: 5000, fecha: AYER }])).toEqual([]);
    expect(conCuotas([{ id: 'c1', n: 1, monto: 5000 }])).toEqual([]);
    expect(conCuotas([{ id: 'c1', n: 1, monto: 0, fecha: D3 }])).toEqual([]);
    expect(conCuotas([{ id: 'c1', n: 1, monto: 5000, fecha: HOY }])).toHaveLength(1);
    expect(conCuotas([{ id: 'c1', n: 1, monto: 5000, fecha: D7 }])).toHaveLength(1);
  });

  it('obra ARS: el monto se convierte a USD con dolarVenta', () => {
    const obraARS = { ...obraUSD, id: 'o2', moneda: 'ARS' };
    const out = plan({ obras: [obraARS], detalles: { o2: { cuotas: [{ id: 'c1', n: 1, monto: 5_350_000, fecha: D3 }] } } });
    expect(out[0].titulo).toBe('💰 Cobrar cuota 1 — Quilmes S7 — U$S 5.000'); // 5.350.000 / 1070
  });
});

// ---------------------------------------------------------------------------
// Cheques
// ---------------------------------------------------------------------------

describe('cheques en cartera', () => {
  const cheque = {
    id: 'chq1', estado: 'cartera', banco: 'Galicia', numero: '4421',
    monto: 1_200_000, titular: 'Norte SRL', obraNombre: 'Burzaco', fechaVencimiento: D5,
  };

  it('cheque en cartera con vencimiento en ventana → evento', () => {
    const out = plan({ cheques: [cheque] });
    expect(out).toEqual([{
      clave: `cal:cheque:chq1:${D5}`,
      titulo: '🏦 Depositar cheque Galicia #4421 — $1.200.000',
      descripcion: 'Titular: Norte SRL · Obra: Burzaco · Vence 27/07/2026',
      fechaISO: D5,
    }]);
  });

  it('depositado, sin fechaVencimiento o fuera de ventana → nada', () => {
    expect(plan({ cheques: [{ ...cheque, estado: 'depositado' }] })).toEqual([]);
    expect(plan({ cheques: [{ ...cheque, fechaVencimiento: '' }] })).toEqual([]);
    expect(plan({ cheques: [{ ...cheque, fechaVencimiento: D8 }] })).toEqual([]);
    expect(plan({ cheques: [{ ...cheque, fechaVencimiento: AYER }] })).toEqual([]);
  });

  it('sin titular/obra la descripcion no queda con huecos', () => {
    const out = plan({ cheques: [{ id: 'chq2', estado: 'cartera', monto: 500, fechaVencimiento: HOY }] });
    expect(out[0].titulo).toBe('🏦 Depositar cheque — #— — $500');
    expect(out[0].descripcion).toBe('Vence 22/07/2026');
  });
});

// ---------------------------------------------------------------------------
// Facturas de proveedor
// ---------------------------------------------------------------------------

describe('facturas de proveedor pendientes', () => {
  const factura = { id: 'f1', proveedor: 'Hierros SA', numero: 'A-0001', monto: 800_000, fechaVencimiento: D3 };
  const conFacturas = (facturasPendientes) => plan({ proveedores: { facturasPendientes } });

  it('pendiente con fechaVencimiento en ventana → evento', () => {
    const out = conFacturas([factura]);
    expect(out).toEqual([{
      clave: `cal:factura:f1:${D3}`,
      titulo: '📄 Vence factura Hierros SA — $800.000',
      descripcion: 'N° A-0001 · Vence 25/07/2026',
      fechaISO: D3,
    }]);
  });

  it('parcial genera con el saldo en la descripcion; pagada NO genera', () => {
    const out = conFacturas([{ ...factura, pagos: [{ monto: 300_000 }] }]);
    expect(out).toHaveLength(1);
    expect(out[0].descripcion).toContain('pago parcial · saldo $500.000');
    expect(conFacturas([{ ...factura, pagos: [{ monto: 800_000 }] }])).toEqual([]);
  });

  it('anulada/registrada, sin fechaVencimiento (opcional) o fuera de ventana → nada', () => {
    expect(conFacturas([{ ...factura, estado: 'anulada' }])).toEqual([]);
    expect(conFacturas([{ ...factura, estado: 'registrada' }])).toEqual([]);
    expect(conFacturas([{ ...factura, fechaVencimiento: undefined }])).toEqual([]);
    expect(conFacturas([{ ...factura, fechaVencimiento: D8 }])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Pólizas (obras ACTIVAS; evento 2 días antes del vencimiento)
// ---------------------------------------------------------------------------

describe('pólizas', () => {
  const conPoliza = (det, obra = obraUSD) => plan({ obras: [obra], detalles: { [obra.id]: det } });
  const detContrato = (polizaVence) => ({
    contratos: [{ id: 'ct1', proveedor: 'PADIC Juan' }],
    segurosPorContrato: { ct1: { polizaUrl: 'https://x/p.pdf', polizaVence } },
  });

  it('polizaVence hoy+9 → evento 2 días antes (hoy+7, borde de la ventana) con la fecha real en la descripcion', () => {
    const out = conPoliza(detContrato(D9));
    expect(out).toEqual([{
      clave: `cal:poliza:o1:ct1:${D9}`,
      titulo: '🛡️ Renovar póliza PADIC Juan — Quilmes S7',
      descripcion: 'La póliza vence el 31/07/2026',
      fechaISO: D7,
    }]);
  });

  it('polizaVence hoy+10 → el evento caería hoy+8, fuera de ventana → nada', () => {
    expect(conPoliza(detContrato(D10))).toEqual([]);
  });

  it('vencimiento a <2 días o ya vencida → el evento cae HOY (nunca en el pasado)', () => {
    const manana = conPoliza(detContrato(D1));
    expect(manana[0].fechaISO).toBe(HOY);
    expect(manana[0].descripcion).toBe('La póliza vence el 23/07/2026');
    const vencida = conPoliza(detContrato(AYER));
    expect(vencida[0].fechaISO).toBe(HOY);
    expect(vencida[0].descripcion).toBe('Póliza VENCIDA el 21/07/2026');
  });

  it('solo obra ACTIVA: finalizada/pausada no generan póliza; sin polizaVence tampoco', () => {
    expect(conPoliza(detContrato(D9), { ...obraUSD, estado: 'finalizada' })).toEqual([]);
    expect(conPoliza(detContrato(D9), { ...obraUSD, estado: 'pausada' })).toEqual([]);
    expect(conPoliza({ contratos: [{ id: 'ct1', proveedor: 'X' }], segurosPorContrato: { ct1: { polizaUrl: 'u' } } })).toEqual([]);
  });

  it('nominaSeguros[].vencimiento genera con nombre/aseguradora/póliza; misma regla de 2 días', () => {
    const out = conPoliza({
      nominaSeguros: [
        { id: 'seg1', nombre: 'Carlos Gómez', aseguradora: 'La Caja', poliza: 'AP-99', vencimiento: D9 },
        { id: 'seg2', nombre: 'Otro', vencimiento: D10 }, // evento fuera de ventana
      ],
    });
    expect(out).toEqual([{
      clave: `cal:poliza:o1:seg1:${D9}`,
      titulo: '🛡️ Renovar póliza Carlos Gómez — Quilmes S7',
      descripcion: 'La Caja · póliza AP-99 · La póliza vence el 31/07/2026',
      fechaISO: D7,
    }]);
  });
});

// ---------------------------------------------------------------------------
// Tareas (solo manuales o del bot; nunca las autogeneradas)
// ---------------------------------------------------------------------------

describe('tareas con fecha límite', () => {
  const tarea = {
    id: 't1', titulo: 'Comprar cemento', origen: 'manual',
    asignadoA: ['u-juan', 'u-fede'], fechaLimite: D3, obraId: 'o1', estado: 'pendiente',
  };
  const conTareas = (tareas) => plan({ obras: [obraUSD], tareas });

  it('tarea manual con fechaLimite en ventana y asignados → evento el día límite', () => {
    const out = conTareas([tarea]);
    expect(out).toEqual([{
      clave: `cal:tarea:t1:${D3}`,
      titulo: '☑ Comprar cemento',
      descripcion: 'Asignada a: u-juan, u-fede · Obra: Quilmes S7 · Límite 25/07/2026',
      fechaISO: D3,
    }]);
  });

  it("tarea del bot (nueva_tarea NO setea origen → undefined) cuenta como de persona → genera", () => {
    const sinOrigen = { ...tarea };
    delete sinOrigen.origen;
    expect(conTareas([sinOrigen])).toHaveLength(1);
  });

  it("autogeneradas ('auto-tipo'/'auto-rubro'/'auto-apu' de generarTareasObra) NO generan", () => {
    for (const origen of ['auto-tipo', 'auto-rubro', 'auto-apu']) {
      expect(conTareas([{ ...tarea, origen }])).toEqual([]);
    }
  });

  it('sin asignados, completada/cancelada, sin fechaLimite o fuera de ventana → nada', () => {
    expect(conTareas([{ ...tarea, asignadoA: [] }])).toEqual([]);
    expect(conTareas([{ ...tarea, asignadoA: undefined }])).toEqual([]);
    expect(conTareas([{ ...tarea, estado: 'completada' }])).toEqual([]);
    expect(conTareas([{ ...tarea, estado: 'cancelada' }])).toEqual([]);
    expect(conTareas([{ ...tarea, fechaLimite: null }])).toEqual([]);
    expect(conTareas([{ ...tarea, fechaLimite: D8 }])).toEqual([]);
    expect(conTareas([{ ...tarea, fechaLimite: AYER }])).toEqual([]);
  });

  it('tarea sin obra (obraId null, administrativa) genera sin la parte "Obra:"', () => {
    const out = conTareas([{ ...tarea, obraId: null }]);
    expect(out[0].descripcion).toBe('Asignada a: u-juan, u-fede · Límite 25/07/2026');
  });
});

// ---------------------------------------------------------------------------
// Idempotencia + integración de fuentes
// ---------------------------------------------------------------------------

describe('idempotencia y mezcla de fuentes', () => {
  const fixtureTodo = () => ({
    obras: [obraUSD],
    detalles: {
      o1: {
        cuotas: [{ id: 'c1', n: 1, monto: 5000, fecha: D3 }],
        contratos: [{ id: 'ct1', proveedor: 'PADIC Juan' }],
        segurosPorContrato: { ct1: { polizaVence: D9 } },
      },
    },
    cheques: [{ id: 'chq1', estado: 'cartera', banco: 'Galicia', numero: '1', monto: 100, fechaVencimiento: D5 }],
    proveedores: { facturasPendientes: [{ id: 'f1', proveedor: 'Hierros SA', monto: 100, fechaVencimiento: D5 }] },
    tareas: [{ id: 't1', titulo: 'X', asignadoA: ['u1'], fechaLimite: D3 }],
  });

  it('las 5 fuentes conviven en una corrida; todo evento tiene clave/titulo/descripcion/fechaISO', () => {
    const out = plan(fixtureTodo());
    expect(out.map(e => e.clave.split(':')[1]).sort()).toEqual(['cheque', 'cuota', 'factura', 'poliza', 'tarea']);
    for (const e of out) {
      expect(typeof e.clave).toBe('string');
      expect(typeof e.titulo).toBe('string');
      expect(typeof e.descripcion).toBe('string');
      expect(e.fechaISO).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('yaCreados (objeto notif_cron_sent, Set o array) filtra los ya agendados y deja el resto', () => {
    const claves = plan(fixtureTodo()).map(e => e.clave);
    const [cuota, ...resto] = claves; // cal:cuota:... es el primero
    const esperadas = resto.sort();

    const conObjeto = plan({ ...fixtureTodo(), yaCreados: { [cuota]: '2026-07-22T13:00:00Z' } });
    expect(conObjeto.map(e => e.clave).sort()).toEqual(esperadas);

    const conSet = plan({ ...fixtureTodo(), yaCreados: new Set([cuota]) });
    expect(conSet.map(e => e.clave).sort()).toEqual(esperadas);

    const conArray = plan({ ...fixtureTodo(), yaCreados: claves });
    expect(conArray).toEqual([]);
  });

  it('sin datos (todo vacío / por defecto) → sin eventos y sin explotar', () => {
    expect(plan({})).toEqual([]);
    expect(planEventosVencimientos({ hoy: HOY })).toEqual([]);
  });
});
