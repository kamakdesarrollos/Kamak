// Plan de import del Unificado (Kamak_Estaciones_Unificado.xlsx).
// Función PURA: recibe filas como las devuelve XLSX.utils.sheet_to_json y los
// registros ya existentes en DB, y devuelve un PLAN (crear/actualizar/saltear
// por entidad + resumen). La ejecución del plan la hace CampanasContext.
//
// Decisiones:
// - Agrupa filas por operador (clave: nombre lowercase sin tildes/espacios dobles).
//   Fila con Estacion pero sin Operador → operador implícito con el nombre de la estación.
// - Dedup estación contra existentes por telefono_norm Y por APIES; si matchea,
//   'actualizar' SOLO con los campos que la DB tiene vacíos (nunca pisa datos);
//   sin datos nuevos → 'saltear'. Repetida dentro del archivo → 'saltear' (duplicada).
// - Dedup decisor por LinkedIn normalizada (lowercase, sin protocolo/www, sin
//   query/hash, sin trailing slash) y fallback nombre+operador. Repetido dentro
//   del archivo (caso normal: una fila por estación) → se fusiona, no se duplica.
// - operadorRef: índice dentro de plan.operadores si el operador es nuevo,
//   o el id existente (string) si ya está en DB.
// - Números de fila para errores: como en Excel (encabezado = fila 1, datos desde 2).

import { BANDERAS } from './constants.js';
import { normalizarEstado, normalizarTelefonoAR, esEstadoConocido } from './normalizar.js';

// Columnas reales del Unificado; cualquier otra es candidata a "columna de estado".
const COLUMNAS_CONOCIDAS = new Set([
  'Bandera', 'Estacion', 'Direccion', 'Localidad', 'Provincia', 'Operador',
  'Telefono', 'Email', 'Web', 'Decisor', 'Cargo', 'LinkedIn_decisor',
  'LinkedIn_empresa', 'Confianza', 'APIES',
]);

const str = (v) => (v == null ? '' : String(v).trim());
const vacio = (v) => v == null || String(v).trim() === '';

// Clave de agrupación: lowercase, sin tildes, espacios colapsados.
function claveNombre(s) {
  return str(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

// Clave de dedup de LinkedIn: lowercase, sin protocolo/www, sin query/hash,
// sin trailing slash.
function claveLinkedIn(url) {
  let u = str(url).toLowerCase();
  if (!u) return null;
  u = u.replace(/^https?:\/\//, '').replace(/^www\./, '');
  u = u.split('?')[0].split('#')[0].replace(/\/+$/, '');
  return u || null;
}

function normalizarConfianza(raw) {
  const c = claveNombre(raw);
  return c === 'alta' || c === 'media' || c === 'baja' ? c : null;
}

// 'a@b.com; C@D.com;' → ['a@b.com','c@d.com'] (trim, lowercase, sin vacíos ni repetidos)
function parseEmails(raw) {
  const lista = str(raw)
    .split(/[;,]/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e && e.includes('@'));
  return [...new Set(lista)];
}

// Bandera canónica si matchea case/tilde-insensitive; si no, tal cual (o null).
const BANDERA_POR_CLAVE = new Map(BANDERAS.map((b) => [claveNombre(b), b]));
function normalizarBandera(raw) {
  const s = str(raw);
  if (!s) return null;
  return BANDERA_POR_CLAVE.get(claveNombre(s)) || s;
}

// Heurística: la columna de estado es la NO conocida con más valores que
// matchean estados conocidos (canónicos o variantes sucias).
function detectarColumnaEstado(rows) {
  const puntajes = new Map();
  for (const row of rows) {
    for (const [col, v] of Object.entries(row)) {
      if (COLUMNAS_CONOCIDAS.has(col) || vacio(v)) continue;
      if (esEstadoConocido(String(v))) puntajes.set(col, (puntajes.get(col) || 0) + 1);
    }
  }
  let mejor = null;
  let max = 0;
  for (const [col, n] of puntajes) if (n > max) { max = n; mejor = col; }
  return mejor;
}

export function planImportUnificado(rows, { existentes = {} } = {}) {
  const ex = { operadores: [], estaciones: [], decisores: [], ...existentes };
  const plan = { operadores: [], estaciones: [], decisores: [] };
  const errores = [];

  const colEstado = detectarColumnaEstado(rows || []);

  // Índices de existentes
  const exOpPorClave = new Map(ex.operadores.map((o) => [claveNombre(o.nombre), o]));
  const exEstPorTel = new Map(ex.estaciones.filter((e) => !vacio(e.telefono_norm)).map((e) => [String(e.telefono_norm).trim(), e]));
  const exEstPorApies = new Map(ex.estaciones.filter((e) => !vacio(e.apies)).map((e) => [String(e.apies).trim(), e]));
  const exDecPorLinkedIn = new Map();
  const exDecPorNombreOp = new Map();
  for (const d of ex.decisores) {
    const kl = claveLinkedIn(d.linkedin_url);
    if (kl) exDecPorLinkedIn.set(kl, d);
    exDecPorNombreOp.set(`${claveNombre(d.nombre)}||${d.operador_id ?? ''}`, d);
  }

  // Estado interno del plan
  const opsPorClave = new Map();     // claveNombre → { item, existente|null, ref }
  const decPorClave = new Map();     // claveLinkedIn o nombre||op → { item, existente|null }
  const telVistos = new Set();       // dedup interno de estaciones
  const apiesVistos = new Set();

  // ── Operadores ────────────────────────────────────────────────────────────
  function resolverOperador(nombre) {
    const k = claveNombre(nombre);
    let entry = opsPorClave.get(k);
    if (entry) return entry;
    const existente = exOpPorClave.get(k) || null;
    let item;
    if (existente) {
      item = { accion: 'saltear', id: existente.id, data: {}, motivo: 'sin datos nuevos' };
    } else {
      item = { accion: 'crear', data: { nombre: str(nombre), emails: [], web: null, linkedin_empresa: null } };
    }
    plan.operadores.push(item);
    const ref = existente ? existente.id : plan.operadores.length - 1;
    entry = { item, existente, ref };
    opsPorClave.set(k, entry);
    return entry;
  }

  // Suma datos de una fila al operador: en nuevos llena huecos; en existentes
  // solo lo que la DB no tiene (y eso lo convierte en 'actualizar').
  function aportarOperador(entry, { emails, web, linkedinEmpresa }) {
    const { item, existente } = entry;
    if (!existente) {
      for (const e of emails) if (!item.data.emails.includes(e)) item.data.emails.push(e);
      if (!item.data.web && web) item.data.web = web;
      if (!item.data.linkedin_empresa && linkedinEmpresa) item.data.linkedin_empresa = linkedinEmpresa;
      return;
    }
    const actuales = (existente.emails || []).map((e) => String(e).toLowerCase());
    const yaEnData = item.data.emails || null;
    const nuevos = emails.filter((e) => !actuales.includes(e) && !(yaEnData || []).includes(e));
    if (nuevos.length) item.data.emails = [...(yaEnData || existente.emails || []), ...nuevos];
    if (web && vacio(existente.web) && !item.data.web) item.data.web = web;
    if (linkedinEmpresa && vacio(existente.linkedin_empresa) && !item.data.linkedin_empresa) item.data.linkedin_empresa = linkedinEmpresa;
    if (Object.keys(item.data).length) { item.accion = 'actualizar'; delete item.motivo; }
  }

  // ── Estaciones ────────────────────────────────────────────────────────────
  function procesarEstacion(row, opRef) {
    const nombre = str(row.Estacion);
    if (!nombre) return;
    const telefono = str(row.Telefono) || null;
    const telNorm = normalizarTelefonoAR(row.Telefono);
    const apies = str(row.APIES) || null;
    const est = colEstado != null && row[colEstado] != null
      ? normalizarEstado(row[colEstado])
      : { estado: 'SIN LLAMAR', original: null, flags: {} };

    // Dedup interno (misma clave ya vista en el archivo)
    if ((telNorm && telVistos.has(telNorm)) || (apies && apiesVistos.has(apies))) {
      plan.estaciones.push({ accion: 'saltear', operadorRef: opRef, data: { nombre }, motivo: 'duplicada en el archivo' });
      return;
    }
    if (telNorm) telVistos.add(telNorm);
    if (apies) apiesVistos.add(apies);

    // Dedup contra existentes: por teléfono Y por APIES
    const existente = (telNorm && exEstPorTel.get(telNorm)) || (apies && exEstPorApies.get(apies)) || null;
    if (existente) {
      const data = {};
      const fills = [
        ['nombre', nombre], ['bandera', normalizarBandera(row.Bandera)],
        ['direccion', str(row.Direccion) || null], ['localidad', str(row.Localidad) || null],
        ['provincia', str(row.Provincia) || null], ['apies', apies],
      ];
      for (const [campo, valor] of fills) {
        if (valor != null && valor !== '' && vacio(existente[campo])) data[campo] = valor;
      }
      if (telNorm && vacio(existente.telefono_norm)) { data.telefono = telefono; data.telefono_norm = telNorm; }
      if (est.estado !== 'SIN LLAMAR' && (vacio(existente.estado_llamada) || existente.estado_llamada === 'SIN LLAMAR')) {
        data.estado_llamada = est.estado;
        data.estado_original = est.original;
      }
      if (est.flags.telefonoFijo && !existente.telefono_fijo) data.telefono_fijo = true;
      if (Object.keys(data).length) {
        plan.estaciones.push({ accion: 'actualizar', id: existente.id, operadorRef: opRef, data });
      } else {
        plan.estaciones.push({ accion: 'saltear', id: existente.id, operadorRef: opRef, data: {}, motivo: 'sin datos nuevos' });
      }
      return;
    }

    plan.estaciones.push({
      accion: 'crear',
      operadorRef: opRef,
      data: {
        nombre,
        bandera: normalizarBandera(row.Bandera),
        direccion: str(row.Direccion) || null,
        localidad: str(row.Localidad) || null,
        provincia: str(row.Provincia) || null,
        telefono,
        telefono_norm: telNorm,
        apies,
        estado_llamada: est.estado,
        estado_original: est.original,
        telefono_fijo: Boolean(est.flags.telefonoFijo),
      },
    });
  }

  // ── Decisores ─────────────────────────────────────────────────────────────
  function procesarDecisor(row, opEntry) {
    const nombre = str(row.Decisor);
    if (!nombre) return;
    const cargo = str(row.Cargo) || null;
    const linkedin = str(row.LinkedIn_decisor) || null;
    const kLinkedIn = claveLinkedIn(linkedin);
    const opId = opEntry.existente ? opEntry.existente.id : null;
    const kNombreOp = `${claveNombre(nombre)}||${opId ?? `nuevo:${opEntry.ref}`}`;
    const confianza = normalizarConfianza(row.Confianza);

    // Dedup interno: mismo LinkedIn o mismo nombre+operador → fusionar en el primero
    const entry = (kLinkedIn && decPorClave.get(kLinkedIn)) || decPorClave.get(kNombreOp);
    if (entry) {
      if (!entry.existente) {
        if (!entry.item.data.cargo && cargo) entry.item.data.cargo = cargo;
        if (!entry.item.data.confianza && confianza) entry.item.data.confianza = confianza;
        if (!entry.item.data.linkedin_url && linkedin) entry.item.data.linkedin_url = linkedin;
      } else {
        const it = entry.item;
        if (cargo && vacio(entry.existente.cargo) && !it.data.cargo) it.data.cargo = cargo;
        if (confianza && vacio(entry.existente.confianza) && !it.data.confianza) it.data.confianza = confianza;
        if (linkedin && vacio(entry.existente.linkedin_url) && !it.data.linkedin_url) it.data.linkedin_url = linkedin;
        if (Object.keys(it.data).length) { it.accion = 'actualizar'; delete it.motivo; }
      }
      if (kLinkedIn && !decPorClave.has(kLinkedIn)) decPorClave.set(kLinkedIn, entry);
      return;
    }

    // Dedup contra existentes: LinkedIn normalizada, fallback nombre+operador
    const existente = (kLinkedIn && exDecPorLinkedIn.get(kLinkedIn))
      || (opId && exDecPorNombreOp.get(`${claveNombre(nombre)}||${opId}`))
      || null;
    let item;
    if (existente) {
      const data = {};
      if (cargo && vacio(existente.cargo)) data.cargo = cargo;
      if (confianza && vacio(existente.confianza)) data.confianza = confianza;
      if (linkedin && vacio(existente.linkedin_url)) data.linkedin_url = linkedin;
      item = Object.keys(data).length
        ? { accion: 'actualizar', id: existente.id, operadorRef: opEntry.ref, data }
        : { accion: 'saltear', id: existente.id, operadorRef: opEntry.ref, data: {}, motivo: 'sin datos nuevos' };
    } else {
      item = {
        accion: 'crear',
        operadorRef: opEntry.ref,
        data: { nombre, cargo, linkedin_url: linkedin, confianza },
      };
    }
    plan.decisores.push(item);
    const nuevaEntry = { item, existente };
    if (kLinkedIn) decPorClave.set(kLinkedIn, nuevaEntry);
    decPorClave.set(kNombreOp, nuevaEntry);
  }

  // ── Recorrido de filas ────────────────────────────────────────────────────
  (rows || []).forEach((row, i) => {
    const fila = i + 2; // como en Excel: encabezado = fila 1
    const nombreOperador = str(row.Operador);
    const nombreEstacion = str(row.Estacion);
    if (!nombreOperador && !nombreEstacion) {
      errores.push({ fila, motivo: 'fila sin Operador ni Estacion' });
      return;
    }
    const opEntry = resolverOperador(nombreOperador || nombreEstacion);
    aportarOperador(opEntry, {
      emails: parseEmails(row.Email),
      web: str(row.Web) || null,
      linkedinEmpresa: str(row.LinkedIn_empresa) || null,
    });
    procesarEstacion(row, opEntry.ref);
    procesarDecisor(row, opEntry);
  });

  // ── Resumen ───────────────────────────────────────────────────────────────
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
