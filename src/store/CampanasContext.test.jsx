import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock de supabase: query builder encadenable + thenable. Cada `from()` abre un
// "log" con la tabla y los métodos encadenados; al await-earlo resuelve con lo
// que devuelva el handler configurado por el test (routing por tabla/ops).
// `rpc(fn)` loguea igual, con table `rpc:<fn>` y un op { m: 'rpc', args }.
vi.mock('../lib/supabase', () => {
  const calls = [];
  let handler = null;
  const DEFAULT = { data: null, error: null, count: 0 };
  const METODOS = [
    'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'in', 'is', 'not', 'ilike', 'or', 'contains',
    'order', 'range', 'limit', 'single', 'maybeSingle',
  ];
  function makeChain(table, opsIniciales = []) {
    const log = { table, ops: [...opsIniciales] };
    calls.push(log);
    const chain = {};
    for (const m of METODOS) {
      chain[m] = (...args) => { log.ops.push({ m, args }); return chain; };
    }
    chain.then = (onOk, onErr) => {
      const res = handler ? handler(log) : null;
      return Promise.resolve(res ?? DEFAULT).then(onOk, onErr);
    };
    return chain;
  }
  return {
    supabase: {
      from: (table) => makeChain(table),
      rpc: (fn, params) => makeChain(`rpc:${fn}`, [{ m: 'rpc', args: params === undefined ? [fn] : [fn, params] }]),
      __calls: calls,
      __setHandler: (fn) => { handler = fn; },
      __reset: () => { calls.length = 0; handler = null; },
    },
  };
});

import { renderToString } from 'react-dom/server';
import { supabase } from '../lib/supabase';
import { CampanasProvider, useCampanas } from './CampanasContext';

// El value del provider a través del hook REAL (sin jsdom: render a string,
// el provider es lazy y sin estado así que el value queda capturado entero).
function getApi() {
  let api = null;
  function Capture() { api = useCampanas(); return null; }
  renderToString(<CampanasProvider><Capture /></CampanasProvider>);
  return api;
}

// ── Helpers sobre el log del mock ─────────────────────────────────────────────
const tiene = (log, m) => log.ops.some((o) => o.m === m);
const args = (log, m) => log.ops.find((o) => o.m === m)?.args;
const llamadasA = (tabla) => supabase.__calls.filter((c) => c.table === tabla);
const llamadasCon = (tabla, m) => llamadasA(tabla).filter((c) => tiene(c, m));

const OPERADOR_TOMADO = {
  id: 'op-1', nombre: 'Operadora Sur SA',
  en_tratativas: true, owner_user_id: 'u-caro', canal_activo: 'linkedin',
  etapa_prospeccion: 'contactado', updated_at: '2026-07-20T10:00:00.000Z',
};
const OPERADOR_LIBRE = {
  id: 'op-2', nombre: 'Norte GNC SRL',
  en_tratativas: false, owner_user_id: null, canal_activo: null,
  etapa_prospeccion: 'sin_contactar', updated_at: '2026-07-01T00:00:00.000Z',
};
const ESTACION = {
  id: 'est-1', operador_id: 'op-2', nombre: 'Estación Trucha Norte',
  telefono: '011 4444-5555', estado_llamada: 'SIN LLAMAR', estado_original: 'no atendio nadie',
};

// Handler típico: responde el fetch de un operador por id (select…maybeSingle)
// y deja el resto en default ({ data:null, error:null }).
const responderOperador = (row) => {
  supabase.__setHandler((log) => {
    if (log.table === 'camp_operadores' && tiene(log, 'maybeSingle')) return { data: row, error: null };
    return null;
  });
};

beforeEach(() => {
  supabase.__reset();
});

// ── chequearColision ──────────────────────────────────────────────────────────
describe('chequearColision', () => {
  it('operador en tratativas con OTRO usuario → { ownerId, canal, desde } (sin fetch si le pasan el objeto)', async () => {
    const api = getApi();
    const res = await api.chequearColision(OPERADOR_TOMADO, 'u-fede');
    expect(res).toEqual({ ownerId: 'u-caro', canal: 'linkedin', desde: '2026-07-20T10:00:00.000Z' });
    expect(supabase.__calls.length).toBe(0); // objeto ya fetcheado: no consulta
  });

  it('el propio dueño → null (puede operar normal)', async () => {
    const api = getApi();
    expect(await api.chequearColision(OPERADOR_TOMADO, 'u-caro')).toBeNull();
  });

  it('sin tratativas → null', async () => {
    const api = getApi();
    expect(await api.chequearColision(OPERADOR_LIBRE, 'u-fede')).toBeNull();
  });

  it('acepta un id (string) y fetchea el operador', async () => {
    responderOperador(OPERADOR_TOMADO);
    const api = getApi();
    const res = await api.chequearColision('op-1', 'u-fede');
    expect(res?.ownerId).toBe('u-caro');
    expect(llamadasCon('camp_operadores', 'maybeSingle').length).toBe(1);
  });
});

// ── setEtapaProspeccion ───────────────────────────────────────────────────────
describe('setEtapaProspeccion', () => {
  it('rechaza con { error: { colision } } y NO muta si está tomado por otro', async () => {
    responderOperador(OPERADOR_TOMADO);
    const api = getApi();
    const res = await api.setEtapaProspeccion('op-1', 'respondio', { usuario: 'u-fede' });
    expect(res.error?.colision).toEqual({ ownerId: 'u-caro', canal: 'linkedin', desde: '2026-07-20T10:00:00.000Z' });
    expect(llamadasCon('camp_operadores', 'update').length).toBe(0); // NO llamó update
    expect(llamadasA('camp_actividades').length).toBe(0);           // NO registró actividad
  });

  it('force: true bypasea la colisión (Admin con confirmación) y muta + actividad', async () => {
    responderOperador(OPERADOR_TOMADO);
    const api = getApi();
    const res = await api.setEtapaProspeccion('op-1', 'respondio', { usuario: 'u-admin', force: true });
    expect(res.error).toBeNull();
    const [upd] = llamadasCon('camp_operadores', 'update');
    expect(upd).toBeTruthy();
    expect(args(upd, 'update')[0]).toMatchObject({ etapa_prospeccion: 'respondio' });
    expect(args(upd, 'update')[0].updated_at).toBeTruthy(); // sin trigger: updated_at explícito
    expect(args(upd, 'eq')).toEqual(['id', 'op-1']);
    const [act] = llamadasCon('camp_actividades', 'insert');
    expect(args(act, 'insert')[0]).toMatchObject({ operador_id: 'op-1', tipo: 'cambio_etapa', resultado: 'respondio' });
  });

  it('el dueño opera normal (sin force)', async () => {
    responderOperador(OPERADOR_TOMADO);
    const api = getApi();
    const res = await api.setEtapaProspeccion('op-1', 'reunion', { usuario: 'u-caro' });
    expect(res.error).toBeNull();
    expect(llamadasCon('camp_operadores', 'update').length).toBe(1);
  });
});

// ── registrarActividad ────────────────────────────────────────────────────────
describe('registrarActividad', () => {
  it('rechaza con colisión y NO inserta si el operador está tomado por otro', async () => {
    responderOperador(OPERADOR_TOMADO);
    const api = getApi();
    const res = await api.registrarActividad({ operadorId: 'op-1', tipo: 'nota', texto: 'hola', usuario: 'u-fede' });
    expect(res.error?.colision?.ownerId).toBe('u-caro');
    expect(llamadasA('camp_actividades').length).toBe(0);
  });

  it('operador libre → inserta la actividad con canal/resultado/usuario', async () => {
    supabase.__setHandler((log) => {
      if (log.table === 'camp_operadores' && tiene(log, 'maybeSingle')) return { data: OPERADOR_LIBRE, error: null };
      if (log.table === 'camp_actividades' && tiene(log, 'insert')) return { data: { id: 'act-1' }, error: null };
      return null;
    });
    const api = getApi();
    const res = await api.registrarActividad({ operadorId: 'op-2', tipo: 'nota', canal: 'email', texto: 'seguimiento', usuario: 'u-fede' });
    expect(res.error).toBeNull();
    const [ins] = llamadasCon('camp_actividades', 'insert');
    expect(args(ins, 'insert')[0]).toMatchObject({ operador_id: 'op-2', tipo: 'nota', canal: 'email', texto: 'seguimiento', usuario: 'u-fede' });
  });
});

// ── tomarOperador ─────────────────────────────────────────────────────────────
describe('tomarOperador', () => {
  it('setea en_tratativas + owner + canal_activo y registra actividad', async () => {
    responderOperador(OPERADOR_LIBRE);
    const api = getApi();
    const res = await api.tomarOperador('op-2', { usuario: 'u-caro', canal: 'llamada' });
    expect(res.error).toBeNull();
    const [upd] = llamadasCon('camp_operadores', 'update');
    expect(args(upd, 'update')[0]).toMatchObject({ en_tratativas: true, owner_user_id: 'u-caro', canal_activo: 'llamada' });
    expect(args(upd, 'update')[0].updated_at).toBeTruthy();
    expect(args(upd, 'eq')).toEqual(['id', 'op-2']);
    const [act] = llamadasCon('camp_actividades', 'insert');
    expect(args(act, 'insert')[0]).toMatchObject({ operador_id: 'op-2', tipo: 'tomado', canal: 'llamada', usuario: 'u-caro' });
  });

  it('tomado por otro → rechaza sin mutar', async () => {
    responderOperador(OPERADOR_TOMADO);
    const api = getApi();
    const res = await api.tomarOperador('op-1', { usuario: 'u-fede', canal: 'email' });
    expect(res.error?.colision?.ownerId).toBe('u-caro');
    expect(llamadasCon('camp_operadores', 'update').length).toBe(0);
  });
});

// ── registrarLlamada ──────────────────────────────────────────────────────────
describe('registrarLlamada', () => {
  const handlerLlamada = (operador) => supabase.__setHandler((log) => {
    if (log.table === 'camp_estaciones' && tiene(log, 'maybeSingle')) return { data: ESTACION, error: null };
    if (log.table === 'camp_operadores' && tiene(log, 'maybeSingle')) return { data: operador, error: null };
    return null;
  });

  it('actualiza la estación (SIN tocar estado_original) y crea actividad tipo llamada', async () => {
    handlerLlamada(OPERADOR_LIBRE);
    const api = getApi();
    const res = await api.registrarLlamada('est-1', {
      estadoLlamada: 'NO ATIENDE', comentario: 'sonó 5 veces',
      decisorNombre: 'Juan Gómez', decisorEmail: 'juan@op.com', proximoPaso: 'reintentar mañana',
      usuario: 'u-caro',
    });
    expect(res.error).toBeNull();
    const [upd] = llamadasCon('camp_estaciones', 'update');
    const cambios = args(upd, 'update')[0];
    expect(cambios).toMatchObject({
      estado_llamada: 'NO ATIENDE',
      decisor_nombre: 'Juan Gómez',
      decisor_email: 'juan@op.com',
      proximo_paso: 'reintentar mañana',
    });
    expect(cambios.updated_at).toBeTruthy();
    expect('estado_original' in cambios).toBe(false); // histórico del import: intocable
    expect(args(upd, 'eq')).toEqual(['id', 'est-1']);
    const [act] = llamadasCon('camp_actividades', 'insert');
    expect(args(act, 'insert')[0]).toMatchObject({
      tipo: 'llamada', canal: 'llamada', resultado: 'NO ATIENDE',
      estacion_id: 'est-1', operador_id: 'op-2', usuario: 'u-caro',
    });
    // NO ATIENDE no es contacto: el operador NO cambia de etapa
    expect(llamadasCon('camp_operadores', 'update').length).toBe(0);
  });

  it("LEAD CALIENTE con operador 'sin_contactar' → además lo pasa a 'contactado'", async () => {
    handlerLlamada(OPERADOR_LIBRE); // etapa_prospeccion: 'sin_contactar'
    const api = getApi();
    const res = await api.registrarLlamada('est-1', { estadoLlamada: 'LEAD CALIENTE', usuario: 'u-caro' });
    expect(res.error).toBeNull();
    const [updOp] = llamadasCon('camp_operadores', 'update');
    expect(updOp).toBeTruthy();
    expect(args(updOp, 'update')[0]).toMatchObject({ etapa_prospeccion: 'contactado' });
    expect(args(updOp, 'eq')).toEqual(['id', 'op-2']);
  });

  it('operador de la estación tomado por otro → rechaza sin tocar la estación', async () => {
    handlerLlamada(OPERADOR_TOMADO);
    const api = getApi();
    const res = await api.registrarLlamada('est-1', { estadoLlamada: 'NO ATIENDE', usuario: 'u-fede' });
    expect(res.error?.colision?.ownerId).toBe('u-caro');
    expect(llamadasCon('camp_estaciones', 'update').length).toBe(0);
    expect(llamadasA('camp_actividades').length).toBe(0);
  });
});

// ── fetchEstaciones ───────────────────────────────────────────────────────────
describe('fetchEstaciones', () => {
  it("acepta orden: 'updated_at' → asc, '-updated_at' → desc, default nombre asc", async () => {
    const api = getApi();
    await api.fetchEstaciones({ orden: 'updated_at' });
    await api.fetchEstaciones({ orden: '-updated_at' });
    await api.fetchEstaciones();
    const ordenes = llamadasCon('camp_estaciones', 'order').map((c) => args(c, 'order'));
    expect(ordenes).toEqual([
      ['updated_at', { ascending: true }],
      ['updated_at', { ascending: false }],
      ['nombre', { ascending: true }],
    ]);
  });
});

// ── fetchOperadores ───────────────────────────────────────────────────────────
describe('fetchOperadores', () => {
  it("filtro rubro → eq('rubro') y orden 'etapa' → etapa_prospeccion desc + updated_at desc (default intacto)", async () => {
    const api = getApi();
    await api.fetchOperadores({ filtros: { rubro: 'estaciones' }, orden: 'etapa' });
    await api.fetchOperadores(); // default: sigue nombre asc
    const [conRubro, porDefecto] = llamadasA('camp_operadores');
    expect(conRubro.ops.filter((o) => o.m === 'eq').map((o) => o.args)).toContainEqual(['rubro', 'estaciones']);
    expect(conRubro.ops.filter((o) => o.m === 'order').map((o) => o.args)).toEqual([
      ['etapa_prospeccion', { ascending: false }],
      ['updated_at', { ascending: false }],
    ]);
    expect(porDefecto.ops.filter((o) => o.m === 'order').map((o) => o.args)).toEqual([
      ['nombre', { ascending: true }],
    ]);
  });
});

// ── fetchResumenArbol ─────────────────────────────────────────────────────────
describe('fetchResumenArbol', () => {
  it('llama al rpc camp_resumen_arbol y devuelve el jsonb tal cual (passthrough)', async () => {
    const RESUMEN = {
      global: { operadores: 120, estaciones: 400, en_tratativas: 3 },
      banderas: [{ rubro: 'estaciones', bandera: 'PUMA', operadores: 40 }],
    };
    supabase.__setHandler((log) => {
      if (log.table === 'rpc:camp_resumen_arbol') return { data: RESUMEN, error: null };
      return null;
    });
    const api = getApi();
    const res = await api.fetchResumenArbol();
    expect(res).toEqual({ data: RESUMEN, error: null });
    const rpcs = llamadasA('rpc:camp_resumen_arbol');
    expect(rpcs.length).toBe(1);
    expect(args(rpcs[0], 'rpc')).toEqual(['camp_resumen_arbol']);
  });

  it('data null (RLS: sin permiso) → error criollo, jamás un árbol vacío', async () => {
    // handler default del mock: { data: null, error: null }
    const api = getApi();
    const res = await api.fetchResumenArbol();
    expect(res.data).toBeNull();
    expect(res.error?.message).toMatch(/permiso/i);
  });

  it('error del rpc → passthrough del error', async () => {
    supabase.__setHandler((log) => {
      if (log.table === 'rpc:camp_resumen_arbol') return { data: null, error: { message: 'boom' } };
      return null;
    });
    const api = getApi();
    const res = await api.fetchResumenArbol();
    expect(res).toEqual({ data: null, error: { message: 'boom' } });
  });
});

// ── ejecutarImport ────────────────────────────────────────────────────────────
describe('ejecutarImport', () => {
  it('batchea los upserts de a 500 (1200 filas → 3 llamadas de 500/500/200) + import_run + onProgress', async () => {
    supabase.__setHandler((log) => {
      if (log.table === 'camp_import_runs' && tiene(log, 'insert')) return { data: { id: 'run-1' }, error: null };
      return null; // upserts: default sin error
    });
    const api = getApi();
    const estaciones = Array.from({ length: 1200 }, (_, i) => ({
      accion: 'crear', data: { nombre: `Estación ${i}` }, operadorRef: 'op-existente',
    }));
    const progreso = [];
    const res = await api.ejecutarImport(
      { operadores: [], estaciones, decisores: [] },
      { usuario: 'u-fede', archivo: 'unificado.xlsx', tipo: 'unificado', onProgress: (h, t) => progreso.push([h, t]) },
    );
    expect(res.error).toBeNull();

    const upserts = llamadasCon('camp_estaciones', 'upsert');
    expect(upserts.length).toBe(3);
    expect(upserts.map((c) => args(c, 'upsert')[0].length)).toEqual([500, 500, 200]);
    // cada fila resuelve operadorRef existente (string) y lleva id + updated_at
    const fila0 = args(upserts[0], 'upsert')[0][0];
    expect(fila0.operador_id).toBe('op-existente');
    expect(fila0.id).toBeTruthy();
    expect(fila0.updated_at).toBeTruthy();

    // auditoría del import
    const [run] = llamadasCon('camp_import_runs', 'insert');
    expect(args(run, 'insert')[0]).toMatchObject({ archivo: 'unificado.xlsx', tipo: 'unificado', usuario: 'u-fede' });
    expect(args(run, 'insert')[0].resumen).toMatchObject({ estaciones: 1200 });
    expect(res.importRunId).toBe('run-1');

    // progreso: arranca en 0 y termina en 1200/1200
    expect(progreso[0]).toEqual([0, 1200]);
    expect(progreso[progreso.length - 1]).toEqual([1200, 1200]);
  });

  it("separa por acción: 'actualizar' → update parcial por id (NUNCA upsert); 'crear' → upsert", async () => {
    const api = getApi();
    const progreso = [];
    const res = await api.ejecutarImport({
      operadores: [
        { accion: 'actualizar', id: 'op-ex', data: { web: 'https://x.com' } },
      ],
      estaciones: [
        { accion: 'actualizar', id: 'est-a', data: { direccion: 'Ruta 3 km 40' } },
        { accion: 'actualizar', id: 'est-b', data: { apies: '9901' } },
        { accion: 'actualizar', id: 'est-c', data: { estado_llamada: 'NO ATIENDE', estado_original: 'no atendió' } },
        { accion: 'crear', data: { nombre: 'Estación Nueva' }, operadorRef: 'op-ex' },
      ],
      decisores: [],
    }, { usuario: 'u-fede', archivo: 'u.xlsx', tipo: 'unificado', onProgress: (h, t) => progreso.push([h, t]) });
    expect(res.error).toBeNull();

    // operador 'actualizar': update con eq por id, jamás upsert
    const updOps = llamadasCon('camp_operadores', 'update');
    expect(updOps.length).toBe(1);
    expect(args(updOps[0], 'eq')).toEqual(['id', 'op-ex']);
    expect(llamadasCon('camp_operadores', 'upsert').length).toBe(0);

    // estaciones 'actualizar': un update con eq por CADA una
    const updEst = llamadasCon('camp_estaciones', 'update');
    expect(updEst.length).toBe(3);
    expect(updEst.map((c) => args(c, 'eq'))).toEqual([['id', 'est-a'], ['id', 'est-b'], ['id', 'est-c']]);
    // el payload es SOLO el delta + updated_at (nunca la fila entera ni el id)
    const delta = args(updEst[0], 'update')[0];
    expect(Object.keys(delta).sort()).toEqual(['direccion', 'updated_at']);
    expect(delta.direccion).toBe('Ruta 3 km 40');
    expect(delta.updated_at).toBeTruthy();

    // el 'crear' sigue yendo por upsert en lote
    const upserts = llamadasCon('camp_estaciones', 'upsert');
    expect(upserts.length).toBe(1);
    expect(args(upserts[0], 'upsert')[0]).toHaveLength(1);
    expect(args(upserts[0], 'upsert')[0][0]).toMatchObject({ nombre: 'Estación Nueva', operador_id: 'op-ex' });

    // resumen y progreso cuentan creados + actualizados
    expect(res.resumen).toMatchObject({ operadores: 1, estaciones: 4, decisores: 0 });
    expect(progreso[0]).toEqual([0, 5]);
    expect(progreso[progreso.length - 1]).toEqual([5, 5]);
  });

  it('resuelve operadorRef numérico contra el id del operador nuevo insertado', async () => {
    const api = getApi();
    const res = await api.ejecutarImport({
      operadores: [{ accion: 'crear', data: { nombre: 'Nuevo Operador SA' } }],
      estaciones: [{ accion: 'crear', data: { nombre: 'Estación Nueva' }, operadorRef: 0 }],
      decisores: [{ accion: 'saltear', data: { nombre: 'ya existe' } }], // saltear NO se sube
    }, { usuario: 'u-fede', archivo: 'x.xlsx', tipo: 'unificado' });
    expect(res.error).toBeNull();
    const filaOperador = args(llamadasCon('camp_operadores', 'upsert')[0], 'upsert')[0][0];
    const filaEstacion = args(llamadasCon('camp_estaciones', 'upsert')[0], 'upsert')[0][0];
    expect(filaOperador.id).toBeTruthy();
    expect(filaEstacion.operador_id).toBe(filaOperador.id); // ref índice → id insertado
    expect(llamadasCon('camp_decisores', 'upsert').length).toBe(0);
    expect(res.resumen).toMatchObject({ operadores: 1, estaciones: 1, decisores: 0 });
  });
});

// ── promoverAEmbudo ───────────────────────────────────────────────────────────
describe('promoverAEmbudo', () => {
  it('crea cliente + obra esLead (patrón Pipeline), linkea ids y pasa a promovido', async () => {
    supabase.__setHandler((log) => {
      if (log.table === 'camp_operadores' && tiene(log, 'maybeSingle')) return { data: OPERADOR_LIBRE, error: null };
      if (log.table === 'camp_operadores' && tiene(log, 'update')) return { data: [{ id: 'op-2' }], error: null };
      if (log.table === 'camp_estaciones' && tiene(log, 'select')) return { data: [ESTACION], error: null };
      return null;
    });
    const addCliente = vi.fn(() => 'cl-99');
    const addObra = vi.fn(() => 'obra-99');
    const api = getApi();
    const res = await api.promoverAEmbudo('op-2', { usuario: 'u-fede', addCliente, addObra });

    expect(res).toMatchObject({ clienteId: 'cl-99', obraId: 'obra-99', error: null });
    expect(addCliente).toHaveBeenCalledWith({ nombre: 'Norte GNC SRL', telefono: '011 4444-5555', estado: 'prospecto' });
    const obra = addObra.mock.calls[0][0];
    expect(obra).toMatchObject({
      nombre: 'Estación — Norte GNC SRL', cliente: 'Norte GNC SRL', clienteId: 'cl-99',
      tipo: 'Otro', presupuesto: 0, esLead: true,
    });
    expect(obra.venta.etapa).toBe('prospecto');
    expect(obra.venta.changelog).toHaveLength(1);
    expect(obra.venta.changelog[0]).toMatchObject({ etapa: 'prospecto', usuario: 'u-fede' });

    const [upd] = llamadasCon('camp_operadores', 'update');
    expect(args(upd, 'update')[0]).toMatchObject({ cliente_id: 'cl-99', obra_id: 'obra-99', etapa_prospeccion: 'promovido' });
    // update condicional: solo pega si nadie lo linkeó en el medio
    expect(args(upd, 'is')).toEqual(['cliente_id', null]);
    expect(tiene(upd, 'select')).toBe(true);
    const [act] = llamadasCon('camp_actividades', 'insert');
    expect(args(act, 'insert')[0]).toMatchObject({ operador_id: 'op-2', tipo: 'promovido' });
    expect(args(act, 'insert')[0].datos).toMatchObject({ clienteId: 'cl-99', obraId: 'obra-99' });
  });

  it('promover dos veces → la segunda devuelve los links existentes SIN volver a crear cliente/obra', async () => {
    let op = { ...OPERADOR_LIBRE };
    supabase.__setHandler((log) => {
      if (log.table === 'camp_operadores' && tiene(log, 'maybeSingle')) return { data: { ...op }, error: null };
      if (log.table === 'camp_operadores' && tiene(log, 'update')) {
        if (op.cliente_id) return { data: [], error: null }; // .is('cliente_id', null) ya no matchea
        op = { ...op, cliente_id: 'cl-99', obra_id: 'obra-99', etapa_prospeccion: 'promovido' };
        return { data: [op], error: null };
      }
      if (log.table === 'camp_estaciones' && tiene(log, 'select')) return { data: [ESTACION], error: null };
      return null;
    });
    const addCliente = vi.fn(() => 'cl-99');
    const addObra = vi.fn(() => 'obra-99');
    const api = getApi();

    const r1 = await api.promoverAEmbudo('op-2', { usuario: 'u-fede', addCliente, addObra });
    expect(r1).toMatchObject({ clienteId: 'cl-99', obraId: 'obra-99', error: null });

    const r2 = await api.promoverAEmbudo('op-2', { usuario: 'u-caro', addCliente, addObra });
    expect(r2).toEqual({ clienteId: 'cl-99', obraId: 'obra-99', error: null, yaPromovido: true });
    expect(addCliente).toHaveBeenCalledTimes(1); // la segunda NO creó nada
    expect(addObra).toHaveBeenCalledTimes(1);
  });

  it('carrera: el update condicional no afecta filas → relee y devuelve los links del otro como yaPromovido', async () => {
    let lecturas = 0;
    supabase.__setHandler((log) => {
      if (log.table === 'camp_operadores' && tiene(log, 'maybeSingle')) {
        lecturas += 1;
        // 1ª lectura (guard): libre; relectura post-update: otro ya lo promovió
        return lecturas === 1
          ? { data: { ...OPERADOR_LIBRE }, error: null }
          : { data: { ...OPERADOR_LIBRE, etapa_prospeccion: 'promovido', cliente_id: 'cl-otro', obra_id: 'obra-otro' }, error: null };
      }
      if (log.table === 'camp_operadores' && tiene(log, 'update')) return { data: [], error: null }; // 0 filas
      if (log.table === 'camp_estaciones' && tiene(log, 'select')) return { data: [ESTACION], error: null };
      return null;
    });
    const addCliente = vi.fn(() => 'cl-mio');
    const addObra = vi.fn(() => 'obra-mia');
    const api = getApi();
    const res = await api.promoverAEmbudo('op-2', { usuario: 'u-fede', addCliente, addObra });
    expect(res).toEqual({ clienteId: 'cl-otro', obraId: 'obra-otro', error: null, yaPromovido: true });
    // no registró actividad 'promovido' porque no fue él quien promovió
    expect(llamadasCon('camp_actividades', 'insert').length).toBe(0);
  });

  it('operador tomado por otro → rechaza sin crear nada', async () => {
    responderOperador(OPERADOR_TOMADO);
    const addCliente = vi.fn();
    const addObra = vi.fn();
    const api = getApi();
    const res = await api.promoverAEmbudo('op-1', { usuario: 'u-fede', addCliente, addObra });
    expect(res.error?.colision?.ownerId).toBe('u-caro');
    expect(addCliente).not.toHaveBeenCalled();
    expect(addObra).not.toHaveBeenCalled();
    expect(llamadasCon('camp_operadores', 'update').length).toBe(0);
  });
});

// ── vincularObra (obra EXISTENTE — hermana de promoverAEmbudo) ────────────────
describe('vincularObra', () => {
  it('setea obra_id + cliente_id + updated_at (SIN tocar etapa) y registra actividad obra_vinculada', async () => {
    responderOperador(OPERADOR_LIBRE);
    const api = getApi();
    const res = await api.vincularObra('op-2', { obraId: 'obra-7', clienteId: 'cl-7', usuario: 'u-fede' });
    expect(res).toEqual({ ok: true, error: null });
    const [upd] = llamadasCon('camp_operadores', 'update');
    const cambios = args(upd, 'update')[0];
    expect(cambios).toMatchObject({ obra_id: 'obra-7', cliente_id: 'cl-7' });
    expect(cambios.updated_at).toBeTruthy();
    expect('etapa_prospeccion' in cambios).toBe(false); // la etapa la decide la UI aparte
    expect(args(upd, 'eq')).toEqual(['id', 'op-2']);
    const [act] = llamadasCon('camp_actividades', 'insert');
    expect(args(act, 'insert')[0]).toMatchObject({
      operador_id: 'op-2', tipo: 'obra_vinculada', canal: 'otro', usuario: 'u-fede',
    });
    expect(args(act, 'insert')[0].texto).toContain('obra-7');
    expect(args(act, 'insert')[0].datos).toMatchObject({ obraId: 'obra-7', clienteId: 'cl-7' });
  });

  it('sin clienteId → el update NO incluye cliente_id (no pisa un link previo)', async () => {
    responderOperador(OPERADOR_LIBRE);
    const api = getApi();
    const res = await api.vincularObra('op-2', { obraId: 'obra-7', usuario: 'u-fede' });
    expect(res.error).toBeNull();
    const cambios = args(llamadasCon('camp_operadores', 'update')[0], 'update')[0];
    expect('cliente_id' in cambios).toBe(false);
  });

  it('operador tomado por otro → rechaza con colisión sin mutar ni registrar actividad', async () => {
    responderOperador(OPERADOR_TOMADO);
    const api = getApi();
    const res = await api.vincularObra('op-1', { obraId: 'obra-7', usuario: 'u-fede' });
    expect(res.error?.colision).toEqual({ ownerId: 'u-caro', canal: 'linkedin', desde: '2026-07-20T10:00:00.000Z' });
    expect(llamadasCon('camp_operadores', 'update').length).toBe(0);
    expect(llamadasA('camp_actividades').length).toBe(0);
  });

  it('sin obraId → error criollo sin tocar nada', async () => {
    const api = getApi();
    const res = await api.vincularObra('op-2', { usuario: 'u-fede' });
    expect(res.error?.message).toMatch(/obraId/);
    expect(supabase.__calls.length).toBe(0);
  });
});
