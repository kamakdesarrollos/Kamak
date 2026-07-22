import { createContext, useContext, useMemo } from 'react';
import { supabase } from '../lib/supabase';

const CTX = createContext(null);

// Etapas del pre-embudo kanban (camp_operadores.etapa_prospeccion).
export const ETAPAS_PROSPECCION = [
  'sin_contactar', 'contactado', 'respondio', 'en_conversacion',
  'reunion', 'promovido', 'descartado',
];

// Estados de llamada que implican que el operador fue efectivamente contactado
// (mueven etapa_prospeccion 'sin_contactar' → 'contactado' al registrar la llamada).
const ESTADOS_LLAMADA_CONTACTO = ['DECISOR IDENTIFICADO', 'LEAD CALIENTE'];

const LOTE_IMPORT = 500;  // upserts de filas nuevas, por lote
const LOTE_UPDATE = 20;   // updates parciales en paralelo (Promise.all), por tanda

const ahora = () => new Date().toISOString();

const genId = () =>
  (globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `camp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

// Sanitiza el término de búsqueda para .or() de PostgREST: comas, paréntesis,
// comillas y % rompen la sintaxis de la expresión or=(col.ilike.%X%,...).
const limpiarBusqueda = (s) => String(s || '').replace(/[%,()'"]/g, ' ').replace(/\s+/g, ' ').trim();

// orden: string 'columna' (asc), '-columna' (desc) o { col, asc }.
const resolverOrden = (orden, defCol = 'nombre') => {
  if (!orden) return [defCol, true];
  if (typeof orden === 'string') {
    return orden.startsWith('-') ? [orden.slice(1), false] : [orden, true];
  }
  return [orden.col || defCol, orden.asc !== false];
};

// ── Data layer (module-scope: sin estado — el context es 100% LAZY, no
//    fetchea NADA al boot de la app; cada página pide lo que necesita) ────────

const getOperador = async (operadorId) => {
  const { data, error } = await supabase
    .from('camp_operadores').select('*').eq('id', operadorId).maybeSingle();
  return { data: data || null, error: error || null };
};

// ── Anti-colisión (P6) ────────────────────────────────────────────────────────
// Recibe el operador YA fetcheado (objeto) o su id (string, lo fetchea).
// → null si se puede operar (libre, o el propio dueño), o
//   { ownerId, canal, desde } si está en tratativas con OTRO usuario.
const chequearColision = async (operador, usuarioId) => {
  let op = operador;
  if (typeof op === 'string') {
    const { data } = await getOperador(op);
    op = data;
  }
  if (!op) return null;
  if (op.en_tratativas && op.owner_user_id && op.owner_user_id !== usuarioId) {
    return { ownerId: op.owner_user_id, canal: op.canal_activo || null, desde: op.updated_at || null };
  }
  return null;
};

// Helper interno: fetchea el operador y chequea colisión salvo force.
// → { operador } para seguir, o { rechazo: { error } } para cortar SIN mutar.
const chequearOperadorParaMutar = async (operadorId, usuarioId, force) => {
  const { data: operador, error } = await getOperador(operadorId);
  if (error) return { rechazo: { error } };
  if (!operador) return { rechazo: { error: { message: 'Operador no encontrado' } } };
  if (!force) {
    const colision = await chequearColision(operador, usuarioId);
    if (colision) return { rechazo: { error: { colision } } };
  }
  return { operador };
};

const insertarActividad = (fila) =>
  supabase.from('camp_actividades').insert({ fecha: ahora(), ...fila });

// ── Fetch paginado (server-side, NUNCA cargar todo) ───────────────────────────

const fetchOperadores = async ({ page = 1, pageSize = 50, filtros = {}, orden } = {}) => {
  const { bandera, provincia, etapa, estadoLlamada, confianza, busqueda, listaId } = filtros;
  // provincia/estadoLlamada viven en camp_estaciones y listaId en
  // camp_lista_miembros → embed !inner solo cuando el filtro está activo.
  let sel = '*';
  if (provincia || estadoLlamada) sel += ', camp_estaciones!inner(id)';
  if (listaId) sel += ', camp_lista_miembros!inner(lista_id)';
  let q = supabase.from('camp_operadores').select(sel, { count: 'exact' });
  if (bandera) q = q.contains('banderas', [bandera]);       // banderas es text[]
  if (etapa) q = q.eq('etapa_prospeccion', etapa);
  if (confianza) q = q.eq('confianza', confianza);
  if (provincia) q = q.eq('camp_estaciones.provincia', provincia);
  if (estadoLlamada) q = q.eq('camp_estaciones.estado_llamada', estadoLlamada);
  if (listaId) q = q.eq('camp_lista_miembros.lista_id', listaId);
  const b = limpiarBusqueda(busqueda);
  if (b) q = q.or(`nombre.ilike.%${b}%,nombre_norm.ilike.%${b}%,notas.ilike.%${b}%`);
  const [col, asc] = resolverOrden(orden, 'nombre');
  q = q.order(col, { ascending: asc }).range((page - 1) * pageSize, page * pageSize - 1);
  const { data, error, count } = await q;
  return { rows: data || [], total: count ?? 0, error: error || null };
};

const fetchEstaciones = async ({ operadorId, filtros = {}, page = 1, pageSize = 50, orden } = {}) => {
  let q = supabase.from('camp_estaciones').select('*', { count: 'exact' });
  if (operadorId) q = q.eq('operador_id', operadorId);
  const { bandera, provincia, estadoLlamada, busqueda } = filtros;
  if (bandera) q = q.eq('bandera', bandera);
  if (provincia) q = q.eq('provincia', provincia);
  if (estadoLlamada) q = q.eq('estado_llamada', estadoLlamada);
  const b = limpiarBusqueda(busqueda);
  if (b) q = q.or(`nombre.ilike.%${b}%,direccion.ilike.%${b}%,localidad.ilike.%${b}%,telefono.ilike.%${b}%,apies.ilike.%${b}%`);
  // orden: mismo contrato que fetchOperadores ('updated_at' asc / '-updated_at'
  // desc / default nombre asc) — la cola de llamadas pide updated_at asc para
  // que lo recién trabajado vaya al final y la página 1 traiga lo no tocado.
  const [col, asc] = resolverOrden(orden, 'nombre');
  q = q.order(col, { ascending: asc }).range((page - 1) * pageSize, page * pageSize - 1);
  const { data, error, count } = await q;
  return { rows: data || [], total: count ?? 0, error: error || null };
};

const fetchDecisores = async ({ operadorId, listaId, page = 1, pageSize = 50 } = {}) => {
  let sel = '*';
  if (listaId) sel += ', camp_lista_miembros!inner(lista_id)';
  let q = supabase.from('camp_decisores').select(sel, { count: 'exact' });
  if (operadorId) q = q.eq('operador_id', operadorId);
  if (listaId) q = q.eq('camp_lista_miembros.lista_id', listaId);
  q = q.order('nombre', { ascending: true }).range((page - 1) * pageSize, page * pageSize - 1);
  const { data, error, count } = await q;
  return { rows: data || [], total: count ?? 0, error: error || null };
};

const fetchActividades = async ({ operadorId, limit = 100 } = {}) => {
  let q = supabase.from('camp_actividades').select('*');
  if (operadorId) q = q.eq('operador_id', operadorId);
  q = q.order('fecha', { ascending: false }).limit(limit);
  const { data, error } = await q;
  return { rows: data || [], error: error || null };
};

// Conteo por etapa para kanban/KPIs: una query count head:true por etapa,
// todas en paralelo (nunca trae filas).
const contarPorEtapa = async (filtros = {}) => {
  const { bandera, provincia, estadoLlamada, confianza, busqueda, listaId } = filtros;
  const pares = await Promise.all(ETAPAS_PROSPECCION.map(async (etapa) => {
    let sel = 'id';
    if (provincia || estadoLlamada) sel += ', camp_estaciones!inner(id)';
    if (listaId) sel += ', camp_lista_miembros!inner(lista_id)';
    let q = supabase.from('camp_operadores').select(sel, { count: 'exact', head: true });
    q = q.eq('etapa_prospeccion', etapa);
    if (bandera) q = q.contains('banderas', [bandera]);
    if (confianza) q = q.eq('confianza', confianza);
    if (provincia) q = q.eq('camp_estaciones.provincia', provincia);
    if (estadoLlamada) q = q.eq('camp_estaciones.estado_llamada', estadoLlamada);
    if (listaId) q = q.eq('camp_lista_miembros.lista_id', listaId);
    const b = limpiarBusqueda(busqueda);
    if (b) q = q.or(`nombre.ilike.%${b}%,nombre_norm.ilike.%${b}%,notas.ilike.%${b}%`);
    const { count, error } = await q;
    return [etapa, error ? 0 : (count ?? 0)];
  }));
  return Object.fromEntries(pares);
};

// ── Mutaciones (todas setean updated_at: no hay trigger en la DB) ─────────────

const crearOperador = async (data) => {
  const { data: row, error } = await supabase
    .from('camp_operadores').insert({ ...data }).select().single();
  return { data: row || null, error: error || null };
};

const actualizarOperador = async (id, changes) => {
  const { data: row, error } = await supabase
    .from('camp_operadores')
    .update({ ...changes, updated_at: ahora() })
    .eq('id', id).select().single();
  return { data: row || null, error: error || null };
};

const setEtapaProspeccion = async (operadorId, etapa, { usuario, force = false } = {}) => {
  const { operador, rechazo } = await chequearOperadorParaMutar(operadorId, usuario, force);
  if (rechazo) return rechazo;
  const now = ahora();
  const { error } = await supabase
    .from('camp_operadores')
    .update({ etapa_prospeccion: etapa, updated_at: now })
    .eq('id', operadorId);
  if (error) return { error };
  await insertarActividad({
    operador_id: operadorId,
    tipo: 'cambio_etapa',
    resultado: etapa,
    texto: `Etapa: ${operador.etapa_prospeccion || '—'} → ${etapa}`,
    usuario: usuario || null,
    fecha: now,
    datos: { desde: operador.etapa_prospeccion || null, hasta: etapa },
  });
  return { error: null };
};

const registrarActividad = async ({
  operadorId, decisorId, estacionId, listaId,
  tipo, canal, resultado, texto, usuario, datos, force = false,
} = {}) => {
  if (operadorId && !force) {
    const colision = await chequearColision(operadorId, usuario);
    if (colision) return { error: { colision } };
  }
  const { data, error } = await supabase.from('camp_actividades').insert({
    operador_id: operadorId || null,
    decisor_id: decisorId || null,
    estacion_id: estacionId || null,
    lista_id: listaId || null,
    tipo,
    canal: canal || null,
    resultado: resultado || null,
    texto: texto || '',
    usuario: usuario || null,
    fecha: ahora(),
    datos: datos || {},
  }).select().single();
  return { data: data || null, error: error || null };
};

// Registra el resultado de una llamada sobre una ESTACIÓN: actualiza la estación
// (estado_llamada + decisor/próximo paso; estado_original NO se toca acá — es el
// histórico del import) + actividad tipo 'llamada' colgada del operador.
const registrarLlamada = async (estacionId, {
  estadoLlamada, comentario, decisorNombre, decisorEmail, proximoPaso, usuario, force = false,
} = {}) => {
  const { data: estacion, error: eEst } = await supabase
    .from('camp_estaciones').select('*').eq('id', estacionId).maybeSingle();
  if (eEst) return { error: eEst };
  if (!estacion) return { error: { message: 'Estación no encontrada' } };

  let operador = null;
  if (estacion.operador_id) {
    const { data } = await getOperador(estacion.operador_id);
    operador = data;
    if (!force) {
      const colision = await chequearColision(operador, usuario);
      if (colision) return { error: { colision } };
    }
  }

  const now = ahora();
  const cambios = { estado_llamada: estadoLlamada, updated_at: now };
  if (decisorNombre !== undefined) cambios.decisor_nombre = decisorNombre;
  if (decisorEmail !== undefined) cambios.decisor_email = decisorEmail;
  if (proximoPaso !== undefined) cambios.proximo_paso = proximoPaso;
  const { error: eUpd } = await supabase
    .from('camp_estaciones').update(cambios).eq('id', estacionId);
  if (eUpd) return { error: eUpd };

  await insertarActividad({
    operador_id: estacion.operador_id || null,
    estacion_id: estacionId,
    tipo: 'llamada',
    canal: 'llamada',
    resultado: estadoLlamada,
    texto: comentario || '',
    usuario: usuario || null,
    fecha: now,
  });

  // Contacto real → el operador deja de estar 'sin_contactar'.
  if (ESTADOS_LLAMADA_CONTACTO.includes(estadoLlamada)
      && operador && operador.etapa_prospeccion === 'sin_contactar') {
    await supabase
      .from('camp_operadores')
      .update({ etapa_prospeccion: 'contactado', updated_at: now })
      .eq('id', operador.id);
  }
  return { error: null };
};

const tomarOperador = async (operadorId, { usuario, canal, force = false } = {}) => {
  const { rechazo } = await chequearOperadorParaMutar(operadorId, usuario, force);
  if (rechazo) return rechazo;
  const now = ahora();
  const { error } = await supabase
    .from('camp_operadores')
    .update({ en_tratativas: true, owner_user_id: usuario || null, canal_activo: canal || null, updated_at: now })
    .eq('id', operadorId);
  if (error) return { error };
  await insertarActividad({
    operador_id: operadorId,
    tipo: 'tomado',
    canal: canal || null,
    texto: `En tratativas${canal ? ` vía ${canal}` : ''}`,
    usuario: usuario || null,
    fecha: now,
  });
  return { error: null };
};

const liberarOperador = async (operadorId, { usuario, force = false } = {}) => {
  const { rechazo } = await chequearOperadorParaMutar(operadorId, usuario, force);
  if (rechazo) return rechazo;
  const now = ahora();
  const { error } = await supabase
    .from('camp_operadores')
    .update({ en_tratativas: false, owner_user_id: null, canal_activo: null, updated_at: now })
    .eq('id', operadorId);
  if (error) return { error };
  await insertarActividad({
    operador_id: operadorId,
    tipo: 'liberado',
    texto: 'Tratativas liberadas',
    usuario: usuario || null,
    fecha: now,
  });
  return { error: null };
};

// ── Promoción al embudo real ──────────────────────────────────────────────────
// addCliente/addObra llegan POR PARÁMETRO desde la página (useClientes/useObras):
// este context NO importa esos contexts para no acoplarse a shared_data.
// Crea cliente prospecto + obra esLead (patrón exacto Pipeline.jsx:85-101),
// linkea cliente_id/obra_id en el operador y lo pasa a etapa 'promovido'.
const promoverAEmbudo = async (operadorId, { usuario, addCliente, addObra, force = false } = {}) => {
  if (typeof addCliente !== 'function' || typeof addObra !== 'function') {
    return { error: { message: 'promoverAEmbudo requiere addCliente y addObra (de useClientes/useObras)' } };
  }
  const { operador, rechazo } = await chequearOperadorParaMutar(operadorId, usuario, force);
  if (rechazo) return rechazo;

  // Idempotencia: si la fila FRESCA ya está promovida (etapa o links seteados),
  // devolvemos los links existentes SIN crear nada — cubre la fila vieja en la
  // UI de otro usuario y el reintento tras un fallo parcial.
  if (operador.etapa_prospeccion === 'promovido' || operador.cliente_id || operador.obra_id) {
    return { clienteId: operador.cliente_id || null, obraId: operador.obra_id || null, error: null, yaPromovido: true };
  }

  // Teléfono: el de la primera estación del operador.
  const { data: estaciones } = await supabase
    .from('camp_estaciones').select('*').eq('operador_id', operadorId)
    .order('created_at', { ascending: true }).limit(1);
  const telefono = estaciones?.[0]?.telefono || '';

  const clienteId = await addCliente({ nombre: operador.nombre, telefono, estado: 'prospecto' });
  const nombre = `Estación — ${operador.nombre}`;
  const hoy = new Date().toISOString().split('T')[0];
  // venta.etapa se setea DENTRO de addObra (atómico), igual que en Pipeline.jsx.
  const venta = { etapa: 'prospecto', fechaCambioEtapa: hoy, changelog: [{ etapa: 'prospecto', fecha: hoy, usuario: usuario || null }] };
  const obraId = await addObra({ nombre, cliente: operador.nombre, clienteId, tipo: 'Otro', presupuesto: 0, notas: '', venta, esLead: true });

  const now = ahora();
  // Update CONDICIONAL (.is cliente_id null): si otra sesión promovió en el
  // medio (dos clicks simultáneos), no pisamos sus links — 0 filas afectadas
  // → releemos y devolvemos los de la DB como yaPromovido.
  const { data: afectadas, error } = await supabase
    .from('camp_operadores')
    .update({ cliente_id: clienteId || null, obra_id: obraId || null, etapa_prospeccion: 'promovido', updated_at: now })
    .eq('id', operadorId)
    .is('cliente_id', null)
    .select();
  if (error) return { error };
  if (!afectadas?.length) {
    const { data: fresco } = await getOperador(operadorId);
    return { clienteId: fresco?.cliente_id || null, obraId: fresco?.obra_id || null, error: null, yaPromovido: true };
  }
  await insertarActividad({
    operador_id: operadorId,
    tipo: 'promovido',
    texto: `Promovido al embudo — ${nombre}`,
    usuario: usuario || null,
    fecha: now,
    datos: { clienteId: clienteId || null, obraId: obraId || null },
  });
  return { clienteId, obraId, error: null };
};

// ── Import (aplica el plan de src/lib/campanas/import*.js) ────────────────────
// plan: { operadores:[{accion,data}], estaciones:[{accion,id?,data,operadorRef}],
//         decisores:[{accion,id?,data,operadorRef}], actividades:[...], resumen? }
// operadorRef: índice del array plan.operadores (número) → id insertado, o el
// id de un operador ya existente (string).
// Ejecución POR ACCIÓN: 'crear' → upsert en lotes de 500; 'actualizar' →
// update parcial por id con SOLO los campos del delta (tandas de 20 en
// paralelo). Nunca se pisa la fila entera con el snapshot del preview: lo que
// otro usuario tocó mientras el preview estaba abierto (tomas, estados de
// llamada, etapas) queda intacto.
const ejecutarImport = async (plan, { usuario, archivo, tipo, onProgress } = {}) => {
  const now = ahora();

  // Pre-asignamos id a cada operador del plan para poder resolver operadorRef
  // ANTES de insertar (y que estaciones/decisores/actividades apunten bien).
  const idPorIndice = {};
  const opsCrear = [];
  const opsActualizar = [];
  (plan?.operadores || []).forEach((item, i) => {
    const data = item?.data || {};
    const accion = item?.accion || 'crear';
    const id = item?.id || data.id || genId();
    idPorIndice[i] = id;
    if (accion === 'saltear') return;
    if (accion === 'actualizar') { opsActualizar.push({ id, data }); return; }
    opsCrear.push({ ...data, id, updated_at: now });
  });

  const resolverRef = (ref, data) => {
    if (typeof ref === 'number') return idPorIndice[ref] || null;
    if (typeof ref === 'string' && ref) return ref;
    return data?.operador_id || null;
  };

  // Separa los ítems de una entidad: filas listas para upsert ('crear') y
  // pares { id, data } con el delta ('actualizar'; sin id se saltea).
  const separarItems = (items) => {
    const crear = [];
    const actualizar = [];
    for (const item of items || []) {
      const accion = item?.accion || 'crear';
      if (accion === 'saltear') continue;
      const data = item?.data || item || {};
      if (accion === 'actualizar') {
        const id = item?.id || data.id || null;
        if (id) actualizar.push({ id, data });
        continue;
      }
      crear.push({
        ...data,
        id: data.id || genId(),
        operador_id: resolverRef(item?.operadorRef, data),
        updated_at: now,
      });
    }
    return { crear, actualizar };
  };

  const porTabla = [
    ['camp_operadores', { crear: opsCrear, actualizar: opsActualizar }],
    ['camp_estaciones', separarItems(plan?.estaciones)],
    ['camp_decisores', separarItems(plan?.decisores)],
    ['camp_actividades', separarItems(plan?.actividades)],
  ];

  const contarTabla = ({ crear, actualizar }) => crear.length + actualizar.length;
  const total = porTabla.reduce((a, [, sep]) => a + contarTabla(sep), 0);
  let hecho = 0;
  const avisar = () => { if (typeof onProgress === 'function') onProgress(hecho, total); };
  avisar();

  const subirLotes = async (tabla, filas) => {
    for (let i = 0; i < filas.length; i += LOTE_IMPORT) {
      const lote = filas.slice(i, i + LOTE_IMPORT);
      const { error } = await supabase.from(tabla).upsert(lote);
      if (error) return error;
      hecho += lote.length;
      avisar();
    }
    return null;
  };

  // Updates parciales: SOLO el delta + updated_at, por id. En tandas de
  // LOTE_UPDATE en paralelo para no serializar cientos de round-trips.
  const actualizarLotes = async (tabla, items) => {
    for (let i = 0; i < items.length; i += LOTE_UPDATE) {
      const lote = items.slice(i, i + LOTE_UPDATE);
      const resultados = await Promise.all(lote.map(({ id, data }) => {
        const campos = { ...data, updated_at: now };
        delete campos.id; // el id nunca viaja en el payload
        return supabase.from(tabla).update(campos).eq('id', id);
      }));
      const fallo = resultados.find((r) => r?.error);
      if (fallo) return fallo.error;
      hecho += lote.length;
      avisar();
    }
    return null;
  };

  for (const [tabla, { crear, actualizar }] of porTabla) {
    const eCrear = await subirLotes(tabla, crear);
    if (eCrear) return { error: eCrear, resumen: null };
    const eAct = await actualizarLotes(tabla, actualizar);
    if (eAct) return { error: eAct, resumen: null };
  }

  const resumen = {
    ...(plan?.resumen || {}),
    operadores: contarTabla(porTabla[0][1]),
    estaciones: contarTabla(porTabla[1][1]),
    decisores: contarTabla(porTabla[2][1]),
    actividades: contarTabla(porTabla[3][1]),
  };
  const { data: run, error: eRun } = await supabase
    .from('camp_import_runs')
    .insert({ archivo: archivo || null, tipo: tipo || null, usuario: usuario || null, resumen, fecha: now })
    .select().single();
  if (eRun) return { error: eRun, resumen };
  return { error: null, resumen, importRunId: run?.id || null };
};

// ── Listas ────────────────────────────────────────────────────────────────────

const fetchListas = async () => {
  const { data, error } = await supabase
    .from('camp_listas').select('*').order('created_at', { ascending: false });
  return { rows: data || [], error: error || null };
};

const crearLista = async (data) => {
  const { data: row, error } = await supabase
    .from('camp_listas').insert({ ...data }).select().single();
  return { data: row || null, error: error || null };
};

const setEstadoMiembro = async (listaId, decisorId, estado) => {
  const now = ahora();
  const cambios = { estado, updated_at: now };
  if (estado === 'enviado') cambios.enviado_at = now;
  if (estado === 'respondido' || estado === 'respondio') cambios.respondido_at = now;
  const { error } = await supabase
    .from('camp_lista_miembros').update(cambios)
    .eq('lista_id', listaId).eq('decisor_id', decisorId);
  return { error: error || null };
};

// ── API (objeto estable: ninguna función depende de estado de React) ──────────
const API = {
  // datos paginados
  fetchOperadores, fetchEstaciones, fetchDecisores, fetchActividades, contarPorEtapa,
  // mutaciones
  crearOperador, actualizarOperador, setEtapaProspeccion, registrarLlamada, registrarActividad,
  // anti-colisión (P6)
  chequearColision, tomarOperador, liberarOperador,
  // promoción al embudo real
  promoverAEmbudo,
  // import
  ejecutarImport,
  // listas
  fetchListas, crearLista, setEstadoMiembro,
};

// Provider LAZY: no carga NADA al boot (a diferencia de los contexts de
// shared_data) — solo expone las funciones; cada página fetchea al entrar.
export function CampanasProvider({ children }) {
  const value = useMemo(() => API, []);
  return <CTX.Provider value={value}>{children}</CTX.Provider>;
}

export const useCampanas = () => useContext(CTX);
