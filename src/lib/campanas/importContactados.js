// Plan de import de la hoja "Contactado Caro" del Unificado: los operadores
// que Caro YA contactó (una fila por grupo/empresa, sin estaciones).
// Función PURA (patrón importUnificado.js): recibe filas de
// XLSX.utils.sheet_to_json + existentes de DB y devuelve el MISMO shape de
// plan que planImportUnificado ({operadores:[{accion,data,...}], decisores,
// estaciones:[], resumen}) para que ejecutarImport lo trague sin cambios.
//
// Decisiones:
// - Columnas reales (headers con espacios/tildes tolerados): GRUPO/EMPRESA ·
//   CONTACTO · VIA DE CONTACTO · BANDERA · TIENDA TIPO · COMENTARIOS.
// - etapa_prospeccion = 'contactado' (ya fueron contactados). En existentes:
//   sin_contactar → contactado; una etapa más avanzada NUNCA se degrada.
// - VIA mezclada: email → decisor u operador según CONTACTO; teléfono →
//   normalizarTelefonoAR a datos.telefono_contacto (original preservado);
//   otra cosa → datos.via_contacto (no se pierde).
// - Emails con typo: se reparan SOLO los inequívocos (@gmailcom, @hotmailcom,
//   '..'); lo dudoso (hmail.com, 'com' pegado al dominio) queda TAL CUAL con
//   flag email_sospechoso en datos.
// - CONTACTO genérico (ADMINISTRACION/vacío) → sin decisor, email al operador.
//   "SILVINA/JUAN" → UN decisor con ese nombre (no se inventan dos).
// - COMENTARIOS → notas (llenar-huecos); /ya tienen constructora/i → además
//   datos.senal = 'no_interesa_constructora' (la etapa NO cambia sola: eso lo
//   decide el usuario).
// - fusionarPlanes(a, b): concatena los planes re-basando los operadorRef
//   numéricos de b, con DEDUP CRUZADO: el mismo operador aparece en varias
//   hojas del mismo archivo (ej. ADOLFO SARTORI S.A. está en "Todas las
//   estaciones", "LISTOS PARA ENVIAR" y "Contactado Caro"), así que los
//   'crear' duplicados se fusionan (ver el bloque de fusión abajo).

import { BANDERAS, ETAPAS_PROSPECCION } from './constants.js';
import { normalizarTelefonoAR, repararEmail } from './normalizar.js';

const str = (v) => (v == null ? '' : String(v).trim());
const vacio = (v) => v == null || String(v).trim() === '';

// Clave de comparación de nombres: lowercase, sin tildes, espacios colapsados
// (misma normalización que nombre_norm en DB y normNombre de CampImportar).
function claveNombre(s) {
  return str(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

// ── Headers tolerantes ───────────────────────────────────────────────────────
// La hoja real trae headers con espacios extra ("CONTACTO ") y podría traer
// tildes ("VÍA DE CONTACTO"): clave = MAYÚSCULAS sin tildes, espacios
// colapsados y sin espacios alrededor de '/'.
function claveHeader(s) {
  return claveNombre(s).toUpperCase().replace(/\s*\/\s*/g, '/');
}

const COLS = ['GRUPO/EMPRESA', 'CONTACTO', 'VIA DE CONTACTO', 'BANDERA', 'TIENDA TIPO', 'COMENTARIOS'];

// row crudo de sheet_to_json → { 'GRUPO/EMPRESA': v, ... } con claves canónicas.
function normalizarFila(row) {
  const porClave = {};
  for (const [k, v] of Object.entries(row || {})) porClave[claveHeader(k)] = v;
  const out = {};
  for (const col of COLS) out[col] = porClave[col];
  return out;
}

// ── Banderas ─────────────────────────────────────────────────────────────────
// 'YPF/SHELL' → ['YPF','Shell']: split por '/', canónica de BANDERAS si
// matchea case/tilde-insensitive (patrón normalizarBandera del Unificado),
// tal cual si no.
const BANDERA_POR_CLAVE = new Map(BANDERAS.map((b) => [claveNombre(b), b]));
function parseBanderas(raw) {
  const lista = str(raw)
    .split('/')
    .map((b) => b.trim())
    .filter(Boolean)
    .map((b) => BANDERA_POR_CLAVE.get(claveNombre(b)) || b);
  return [...new Set(lista)];
}

// ── VIA DE CONTACTO ──────────────────────────────────────────────────────────
// VIA cruda → { tipo: 'email'|'telefono'|'otro'|'nada', ... }.
// email: { email, sospechoso, original? } — original solo si hubo reparación
//   (la reparación/flag de typos vive en repararEmail de normalizar.js).
// telefono: { telefono (E.164 o crudo si no normaliza), original }.
function analizarVia(raw) {
  const s = str(raw);
  if (!s) return { tipo: 'nada' };
  if (s.includes('@')) {
    const { email, reparado, sospechoso } = repararEmail(s);
    if (sospechoso) return { tipo: 'email', email, sospechoso: true };
    return { tipo: 'email', email, sospechoso: false, original: reparado ? s.trim().toLowerCase() : null };
  }
  const digitos = s.replace(/\D/g, '');
  if (digitos.length >= 8) return { tipo: 'telefono', telefono: normalizarTelefonoAR(s) || s, original: s };
  return { tipo: 'otro', original: s };
}

// ── CONTACTO ─────────────────────────────────────────────────────────────────
// Genérico (no persona): vacío o ADMINISTRACION/ADMINISTRACIÓN.
function esContactoGenerico(contacto) {
  const c = claveNombre(contacto);
  return !c || c === 'administracion';
}

// 'GINO GIAVENO' → 'Gino Giaveno'; 'SILVINA/JUAN' → 'Silvina/Juan'.
function titleCase(s) {
  return str(s).toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (m, sep, ch) => sep + ch.toUpperCase());
}

// ── Señales en COMENTARIOS ───────────────────────────────────────────────────
const RE_CONSTRUCTORA = /ya tienen constructora/i;

// ── Planificador ─────────────────────────────────────────────────────────────
export function planImportContactados(rows, { existentes = {} } = {}) {
  const ex = { operadores: [], decisores: [], ...existentes };
  const plan = { operadores: [], estaciones: [], decisores: [] };
  const errores = [];

  const exOpPorClave = new Map(ex.operadores.map((o) => [claveNombre(o.nombre), o]));
  const exDecPorNombreOp = new Map(ex.decisores.map((d) => [`${claveNombre(d.nombre)}||${d.operador_id ?? ''}`, d]));

  const opsPorClave = new Map();  // claveNombre → { item, existente|null, ref }
  const decVistos = new Set();    // dedup interno: claveNombre(decisor)||ref

  // Operador nuevo o existente (patrón resolverOperador del Unificado).
  function resolverOperador(nombre) {
    const k = claveNombre(nombre);
    let entry = opsPorClave.get(k);
    if (entry) return entry;
    const existente = exOpPorClave.get(k) || null;
    let item;
    if (existente) {
      item = { accion: 'saltear', id: existente.id, data: {}, motivo: 'sin datos nuevos' };
    } else {
      item = {
        accion: 'crear',
        data: {
          nombre: str(nombre),
          nombre_norm: k,
          banderas: null,
          multibandera: false,
          etapa_prospeccion: 'contactado',
          emails: [],
          notas: null,
          datos: {},
        },
      };
    }
    plan.operadores.push(item);
    const ref = existente ? existente.id : plan.operadores.length - 1;
    entry = { item, existente, ref };
    opsPorClave.set(k, entry);
    return entry;
  }

  // datos.k = v con llenar-huecos: nunca pisa lo que la DB (o una fila
  // anterior) ya tiene. En existentes el delta arranca del jsonb actual para
  // que el update parcial no borre otras claves.
  function setDato(entry, k, v) {
    if (v == null || v === '') return;
    const { item, existente } = entry;
    const base = item.data.datos ?? (existente ? { ...(existente.datos || {}) } : {});
    if (!vacio(base[k])) return;
    base[k] = v;
    item.data.datos = base;
  }

  // Suma los campos de una fila al operador: en nuevos llena huecos; en
  // existentes solo lo que la DB no tiene (→ 'actualizar'). La etapa solo
  // sube sin_contactar → contactado, nunca degrada una más avanzada.
  function aportarOperador(entry, { banderas, tiendaTipo, comentarios }) {
    const { item, existente } = entry;
    if (!existente) {
      if (banderas.length && !item.data.banderas) {
        item.data.banderas = banderas;
        item.data.multibandera = banderas.length > 1;
      }
      if (comentarios && !item.data.notas) item.data.notas = comentarios;
    } else {
      const etapa = str(existente.etapa_prospeccion) || 'sin_contactar';
      if (etapa === 'sin_contactar' && !item.data.etapa_prospeccion) item.data.etapa_prospeccion = 'contactado';
      if (banderas.length && !(existente.banderas || []).length && !item.data.banderas) {
        item.data.banderas = banderas;
        item.data.multibandera = banderas.length > 1;
      }
      if (comentarios && vacio(existente.notas) && !item.data.notas) item.data.notas = comentarios;
    }
    setDato(entry, 'tienda_tipo', tiendaTipo);
    if (comentarios && RE_CONSTRUCTORA.test(comentarios)) setDato(entry, 'senal', 'no_interesa_constructora');
  }

  // Email al operador (contacto genérico), con flags del typo en datos.
  function aportarEmailOperador(entry, via) {
    const { item, existente } = entry;
    if (!existente) {
      if (!item.data.emails.includes(via.email)) item.data.emails.push(via.email);
    } else {
      const actuales = (existente.emails || []).map((e) => String(e).toLowerCase());
      const yaEnData = item.data.emails || null;
      if (!actuales.includes(via.email) && !(yaEnData || []).includes(via.email)) {
        item.data.emails = [...(yaEnData || existente.emails || []), via.email];
      }
    }
    if (via.sospechoso) setDato(entry, 'email_sospechoso', true);
    if (via.original) setDato(entry, 'email_original', via.original);
  }

  // Persona real → decisor (fuente 'Contactado Caro'), dedup por
  // nombre+operador contra existentes con llenar-huecos del email.
  function procesarDecisor(opEntry, contacto, via) {
    const nombre = titleCase(contacto);
    const k = `${claveNombre(nombre)}||${opEntry.ref}`;
    if (decVistos.has(k)) return;
    decVistos.add(k);
    const email = via.tipo === 'email' ? via.email : null;
    const opId = opEntry.existente ? opEntry.existente.id : null;
    const existente = opId ? exDecPorNombreOp.get(`${claveNombre(nombre)}||${opId}`) || null : null;
    if (existente) {
      const data = {};
      if (email && vacio(existente.email)) data.email = email;
      if (email && via.sospechoso) {
        const datos = { ...(existente.datos || {}) };
        if (vacio(datos.email_sospechoso)) { datos.email_sospechoso = true; data.datos = datos; }
      }
      plan.decisores.push(Object.keys(data).length
        ? { accion: 'actualizar', id: existente.id, operadorRef: opEntry.ref, data }
        : { accion: 'saltear', id: existente.id, operadorRef: opEntry.ref, data: {}, motivo: 'sin datos nuevos' });
      return;
    }
    const datos = {};
    if (email && via.sospechoso) datos.email_sospechoso = true;
    if (email && via.original) datos.email_original = via.original;
    plan.decisores.push({
      accion: 'crear',
      operadorRef: opEntry.ref,
      data: { nombre, email, fuente: 'Contactado Caro', datos },
    });
  }

  // ── Recorrido de filas ────────────────────────────────────────────────────
  (rows || []).forEach((row, i) => {
    const fila = i + 2; // como en Excel: encabezado = fila 1
    const r = normalizarFila(row);
    const nombre = str(r['GRUPO/EMPRESA']);
    if (!nombre) {
      errores.push({ fila, motivo: 'fila sin GRUPO/EMPRESA' });
      return;
    }
    const opEntry = resolverOperador(nombre);
    const via = analizarVia(r['VIA DE CONTACTO']);
    const contacto = str(r['CONTACTO']);
    aportarOperador(opEntry, {
      banderas: parseBanderas(r['BANDERA']),
      tiendaTipo: str(r['TIENDA TIPO']) || null,
      comentarios: str(r['COMENTARIOS']) || null,
    });
    if (via.tipo === 'telefono') {
      setDato(opEntry, 'telefono_contacto', via.telefono);
      setDato(opEntry, 'telefono_contacto_original', via.original);
    } else if (via.tipo === 'otro') {
      setDato(opEntry, 'via_contacto', via.original);
    }
    if (esContactoGenerico(contacto)) {
      if (via.tipo === 'email') aportarEmailOperador(opEntry, via);
    } else {
      procesarDecisor(opEntry, contacto, via);
    }
    // Cerrar el delta de existentes: con algo en data pasa a 'actualizar'.
    const { item, existente } = opEntry;
    if (existente && Object.keys(item.data).length) { item.accion = 'actualizar'; delete item.motivo; }
  });

  // ── Resumen (mismo formato que el Unificado) ──────────────────────────────
  const contar = (items, accion) => items.filter((it) => it.accion === accion).length;
  const porAccion = (accion) => ({
    operadores: contar(plan.operadores, accion),
    estaciones: contar(plan.estaciones, accion),
    decisores: contar(plan.decisores, accion),
  });
  return {
    ...plan,
    resumen: {
      nuevos: porAccion('crear'),
      actualizados: porAccion('actualizar'),
      salteados: porAccion('saltear'),
      errores,
    },
  };
}

// ── Fusión de planes ─────────────────────────────────────────────────────────
// Fusiona dos planes del MISMO archivo (orden: estaciones → listos →
// contactados) con DEDUP CRUZADO — el mismo operador suele estar en varias
// hojas. Reglas:
// - Operadores 'crear' de b cuyo nombre ya está en un 'crear' de a se FUSIONAN
//   en el de a: llenar huecos campo a campo, emails y banderas = unión sin
//   duplicados, notas concatenadas con ' · ' si difieren, datos = merge
//   shallow donde ante conflicto gana a, etapa = la más avanzada según el
//   orden de ETAPAS_PROSPECCION, multibandera recalculada de la unión.
// - Los operadorRef NUMÉRICOS de b se re-mapean: al índice de a si el operador
//   se fusionó, al índice corrido si es nuevo (los string son ids existentes y
//   no se tocan).
// - Decisores 'crear' duplicados (mismo nombre + mismo operador destino, con
//   el ref ya re-mapeado) también se fusionan con llenar-huecos.
// - Contra la DB no hay choque posible acá: todos los planificadores reciben
//   los MISMOS existentes, así que un operador que ya está en la base nunca
//   llega como 'crear' en dos planes.
// - El resumen se RECALCULA del plan fusionado (no se suma a ciegas); los
//   errores sí se concatenan. Pura: no muta a ni b.

const ETAPA_IDX = new Map(ETAPAS_PROSPECCION.map((e, i) => [e, i]));
function etapaMasAvanzada(x, y) {
  if (x == null || x === '') return y;
  if (y == null || y === '') return x;
  return (ETAPA_IDX.get(y) ?? 0) > (ETAPA_IDX.get(x) ?? 0) ? y : x;
}

function union(xs, ys) {
  const out = [...(xs || [])];
  for (const v of ys || []) if (!out.includes(v)) out.push(v);
  return out;
}

// datos jsonb: merge shallow llenando huecos (ante conflicto gana `base`).
function mergeDatos(base, extra) {
  const out = { ...(base || {}) };
  for (const [k, v] of Object.entries(extra || {})) if (vacio(out[k])) out[k] = v;
  return out;
}

// data de dos operadores 'crear' → uno: huecos llenados, a gana conflictos.
function fusionarDataOperador(da, db) {
  const out = { ...da };
  for (const [k, v] of Object.entries(db || {})) {
    if (v == null || v === '') continue;
    if (k === 'emails') out.emails = union(da.emails, v);
    else if (k === 'banderas') out.banderas = union(da.banderas, v);
    else if (k === 'multibandera') continue; // se recalcula de la unión, abajo
    else if (k === 'notas') {
      if (vacio(da.notas)) out.notas = v;
      else if (str(da.notas) !== str(v)) out.notas = `${da.notas} · ${v}`;
    } else if (k === 'datos') {
      if (Object.keys(v).length) out.datos = mergeDatos(da.datos, v);
    } else if (k === 'etapa_prospeccion') {
      out.etapa_prospeccion = etapaMasAvanzada(da.etapa_prospeccion, v);
    } else if (vacio(da[k])) {
      out[k] = v;
    }
  }
  if (Array.isArray(out.banderas)) out.multibandera = out.banderas.length > 1;
  return out;
}

// data de dos decisores 'crear' → uno: huecos llenados, a gana conflictos.
function fusionarDataDecisor(da, db) {
  const out = { ...da };
  for (const [k, v] of Object.entries(db || {})) {
    if (v == null || v === '') continue;
    if (k === 'datos') {
      if (Object.keys(v).length) out.datos = mergeDatos(da.datos, v);
    } else if (vacio(da[k])) {
      out[k] = v;
    }
  }
  return out;
}

export function fusionarPlanes(a, b) {
  if (!a) return b;
  if (!b) return a;

  // Operadores: 'crear' de b con nombre ya visto en un 'crear' → fusión.
  const operadores = [...(a.operadores || [])];
  const idxPorClave = new Map();
  operadores.forEach((op, i) => {
    if (op.accion === 'crear' && op.data?.nombre) idxPorClave.set(claveNombre(op.data.nombre), i);
  });
  const refMap = new Map(); // índice en b.operadores → índice fusionado
  (b.operadores || []).forEach((op, i) => {
    const k = op.accion === 'crear' && op.data?.nombre ? claveNombre(op.data.nombre) : null;
    const destino = k != null ? idxPorClave.get(k) : undefined;
    if (destino != null) {
      operadores[destino] = { ...operadores[destino], data: fusionarDataOperador(operadores[destino].data, op.data) };
      refMap.set(i, destino);
    } else {
      operadores.push(op);
      refMap.set(i, operadores.length - 1);
      if (k != null) idxPorClave.set(k, operadores.length - 1);
    }
  });
  const rebasar = (it) => (typeof it.operadorRef === 'number'
    ? { ...it, operadorRef: refMap.get(it.operadorRef) ?? it.operadorRef }
    : it);

  const estaciones = [...(a.estaciones || []), ...(b.estaciones || []).map(rebasar)];

  // Decisores: dedup de 'crear' por nombre + operador destino (ref re-mapeado).
  const decisores = [...(a.decisores || [])];
  const decPorClave = new Map();
  decisores.forEach((d, i) => {
    if (d.accion === 'crear' && d.data?.nombre) decPorClave.set(`${claveNombre(d.data.nombre)}||${d.operadorRef}`, i);
  });
  for (const d0 of b.decisores || []) {
    const d = rebasar(d0);
    const k = d.accion === 'crear' && d.data?.nombre ? `${claveNombre(d.data.nombre)}||${d.operadorRef}` : null;
    const destino = k != null ? decPorClave.get(k) : undefined;
    if (destino != null) {
      decisores[destino] = { ...decisores[destino], data: fusionarDataDecisor(decisores[destino].data, d.data) };
    } else {
      decisores.push(d);
      if (k != null) decPorClave.set(k, decisores.length - 1);
    }
  }

  const contar = (items, accion) => items.filter((it) => it.accion === accion).length;
  const porAccion = (accion) => ({
    operadores: contar(operadores, accion),
    estaciones: contar(estaciones, accion),
    decisores: contar(decisores, accion),
  });
  return {
    operadores,
    estaciones,
    decisores,
    resumen: {
      nuevos: porAccion('crear'),
      actualizados: porAccion('actualizar'),
      salteados: porAccion('saltear'),
      errores: [...(a.resumen?.errores || []), ...(b.resumen?.errores || [])],
    },
  };
}
