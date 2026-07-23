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
import { normalizarEstado, normalizarTelefonoAR, esEstadoConocido, repararEmail } from './normalizar.js';

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

// ── Formato posicional: hoja "Todas las estaciones" ──────────────────────────
// La hoja madre real NO tiene fila de encabezados: 16 columnas POSICIONALES
// (1=Bandera · 2=etiqueta 'APIES 50014' · 3=Dirección · 4=Localidad ·
// 5=Provincia · 6=Operador · 7=Teléfono · 8=Estado sucio · 9=Email (¡a veces
// Caro escribió ahí otro estado!) · 10=libre · 11=Decisor · 12=Cargo ·
// 13=LinkedIn_decisor · 14=LinkedIn_empresa · 15=Confianza · 16=APIES núm.).
// Recibe el output de sheet_to_json con {header:1} (array de arrays) y
// devuelve objetos con las columnas que planImportUnificado YA entiende, o
// null si el formato no es este (con encabezados → que siga el flujo normal).
// - Detección: 1ª celda de la 1ª fila no-vacía es una bandera conocida Y la
//   fila no trae headers conocidos.
// - Estacion (nombre) = Dirección (la planilla no tiene nombre de estación).
// - APIES: col 16, con fallback a los dígitos de la etiqueta de la col 2 SOLO
//   si empieza con "APIES" (formato YPF real "APIES 50014"). En Axion/Puma/ACA
//   la col 2 es razón social o dirección ("59 SA", "AV. DINDART 1302"): sus
//   dígitos NO son un código y usarlos como APIES fusionaba estaciones
//   distintas vía el dedup (276 estaciones reales perdidas en el primer import).
// - Col 9 sin '@' NUNCA es email (estado de refuerzo o texto suelto): va a la
//   columna de estado — si la col 8 está vacía queda como EL estado; si no, se
//   suma como 'COL8 · COL9' (normalizarEstado canoniza el 1º segmento y
//   preserva el original ENTERO). Así no se pierde nada sin generar miles de
//   errores por fila.
// - Filas totalmente vacías → salteadas sin error.
const HEADERS_CONOCIDOS = new Set([...COLUMNAS_CONOCIDAS].map((c) => claveNombre(c)));

export function mapearFilasPosicionales(filasHeader1) {
  const filas = (filasHeader1 || []).filter((f) => Array.isArray(f) && f.some((c) => !vacio(c)));
  if (!filas.length) return null;
  const primera = filas[0];
  if (!BANDERA_POR_CLAVE.has(claveNombre(primera[0]))) return null;
  if (primera.some((c) => HEADERS_CONOCIDOS.has(claveNombre(c)))) return null;

  return filas.map((f) => {
    const c = (i) => str(f[i]);
    const direccion = c(2);
    let estado = c(7);
    let email = '';
    const col9 = c(8);
    if (col9.includes('@')) {
      email = col9;
    } else if (col9) {
      estado = estado ? `${estado} · ${col9}` : col9;
    }
    return {
      Bandera: c(0),
      Estacion: direccion,
      Direccion: direccion,
      Localidad: c(3),
      Provincia: c(4),
      Operador: c(5),
      Telefono: c(6),
      Estado: estado,   // no es columna "conocida": la detecta la heurística
      Email: email,
      Decisor: c(10),
      Cargo: c(11),
      LinkedIn_decisor: c(12),
      LinkedIn_empresa: c(13),
      Confianza: c(14),
      APIES: c(15) || (/^apies/i.test(c(1)) ? (c(1).match(/\d+/) || [''])[0] : ''),
    };
  });
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
  // Último recurso para filas SIN teléfono normalizable NI APIES (típico
  // Axion/Puma/ACA): nombre+localidad — sin esto, re-importar la planilla
  // duplicaría cada estación sin datos de contacto.
  const claveEst = (nombre, localidad) => `${claveNombre(nombre)}||${claveNombre(localidad)}`;
  const exEstPorNombreLoc = new Map(ex.estaciones.filter((e) => !vacio(e.nombre)).map((e) => [claveEst(e.nombre, e.localidad), e]));
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
  const nombreLocVistos = new Set();

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
      // banderas/multibandera SIEMPRE presentes (shape uniforme para el upsert
      // por lotes); se completan al cierre con lo heredado de las estaciones.
      item = { accion: 'crear', data: { nombre: str(nombre), emails: [], web: null, linkedin_empresa: null, banderas: null, multibandera: false } };
    }
    plan.operadores.push(item);
    const ref = existente ? existente.id : plan.operadores.length - 1;
    entry = { item, existente, ref, banderasVistas: new Set() };
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

    // Dedup interno (misma clave ya vista en el archivo). nombre+localidad
    // solo cuenta como clave si la fila no trae teléfono ni APIES.
    const kNombreLoc = claveEst(nombre, row.Localidad);
    const sinClaves = !telNorm && !apies;
    if ((telNorm && telVistos.has(telNorm)) || (apies && apiesVistos.has(apies))
      || (sinClaves && nombreLocVistos.has(kNombreLoc))) {
      plan.estaciones.push({ accion: 'saltear', operadorRef: opRef, data: { nombre }, motivo: 'duplicada en el archivo' });
      return;
    }
    if (telNorm) telVistos.add(telNorm);
    if (apies) apiesVistos.add(apies);
    nombreLocVistos.add(kNombreLoc);

    // Dedup contra existentes: por teléfono Y por APIES (nombre+localidad de
    // último recurso si la fila no trae ninguno de los dos)
    const existente = (telNorm && exEstPorTel.get(telNorm)) || (apies && exEstPorApies.get(apies))
      || (sinClaves && exEstPorNombreLoc.get(kNombreLoc)) || null;
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
    const banderaFila = normalizarBandera(row.Bandera);
    if (banderaFila) opEntry.banderasVistas.add(banderaFila);
    procesarEstacion(row, opEntry.ref);
    procesarDecisor(row, opEntry);
  });

  // ── Banderas del operador: unión de las banderas de sus filas ─────────────
  // Orden canónico de BANDERAS con desconocidas al final (mismo criterio que
  // el RPC camp_resumen_arbol). En nuevos completa el null inicial; en
  // existentes SOLO si la DB no tiene ninguna (llenar-huecos, como
  // importContactados) — sin esto, el primer import dejó 2.489 operadores
  // "Sin bandera" y hubo que backfillear a mano.
  const idxBandera = new Map(BANDERAS.map((b, i) => [b, i]));
  const ordenBandera = (b) => (idxBandera.has(b) ? idxBandera.get(b) : BANDERAS.length);
  for (const { item, existente, banderasVistas } of opsPorClave.values()) {
    if (!banderasVistas.size) continue;
    const banderas = [...banderasVistas].sort((a, b) => ordenBandera(a) - ordenBandera(b) || a.localeCompare(b));
    if (!existente) {
      item.data.banderas = banderas;
      item.data.multibandera = banderas.length > 1;
    } else if (!(existente.banderas || []).length && !item.data.banderas) {
      item.data.banderas = banderas;
      item.data.multibandera = banderas.length > 1;
      item.accion = 'actualizar';
      delete item.motivo;
    }
  }

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

// ── Hoja "LISTOS PARA ENVIAR" ────────────────────────────────────────────────
// La hoja curada de la campaña de mails (761 filas CON encabezados): Email ·
// Bandera_segmento · Operador/Decisor · Localidad · Provincia ·
// Tamaño_operador · Origen · Estado_envio. Cada fila es UN operador — la
// planilla mezcla razones sociales y personas en Operador/Decisor: va tal
// cual como operador, NO se adivina. Devuelve el MISMO shape de plan que
// planImportUnificado (sin estaciones ni decisores).

// Headers tolerantes (espacios/tildes/'_'): 'Tamaño_operador' y
// 'TAMANO OPERADOR' → 'TAMANO_OPERADOR'; 'Operador / Decisor' → 'OPERADOR/DECISOR'.
function claveHeaderListos(s) {
  return claveNombre(s).toUpperCase().replace(/\s*\/\s*/g, '/').replace(/[\s_]+/g, '_');
}
const COLS_LISTOS = ['EMAIL', 'BANDERA_SEGMENTO', 'OPERADOR/DECISOR', 'LOCALIDAD', 'PROVINCIA', 'TAMANO_OPERADOR', 'ORIGEN', 'ESTADO_ENVIO'];

function normalizarFilaListos(row) {
  const porClave = {};
  for (const [k, v] of Object.entries(row || {})) porClave[claveHeaderListos(k)] = v;
  const out = {};
  for (const col of COLS_LISTOS) out[col] = porClave[col];
  return out;
}

// 'YPF una estación' → ['YPF']: token de bandera conocida por palabra completa,
// case/tilde-insensitive. 'Banderas nuevas' → []. 'Otra' no se busca (escape).
function banderasDeSegmento(raw) {
  const k = ` ${claveNombre(raw).replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  return BANDERAS.filter((b) => b !== 'Otra' && k.includes(` ${claveNombre(b)} `));
}

// ¿El Estado_envio indica que YA se le envió? (no vacío y no 'pendiente')
function envioHecho(raw) {
  const k = claveNombre(raw);
  return Boolean(k) && k !== 'pendiente';
}

export function planImportListos(rows, { existentes = {} } = {}) {
  const ex = { operadores: [], ...existentes };
  const plan = { operadores: [], estaciones: [], decisores: [] };
  const errores = [];

  const exOpPorClave = new Map(ex.operadores.map((o) => [claveNombre(o.nombre), o]));
  const opsPorClave = new Map(); // claveNombre → { item, existente|null, ref }

  // Operador nuevo o existente (patrón resolverOperador de importContactados).
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
          etapa_prospeccion: 'sin_contactar',
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

  // datos.k = v con llenar-huecos (patrón setDato de importContactados): nunca
  // pisa lo que la DB (o una fila anterior) ya tiene; en existentes el delta
  // arranca del jsonb actual para que el update parcial no borre otras claves.
  function setDato(entry, k, v) {
    if (v == null || v === '') return;
    const { item, existente } = entry;
    const base = item.data.datos ?? (existente ? { ...(existente.datos || {}) } : {});
    if (!vacio(base[k])) return;
    base[k] = v;
    item.data.datos = base;
  }

  // Email de la fila → emails[] del operador, con la MISMA reparación/flag de
  // typos que importContactados (repararEmail de normalizar.js).
  function aportarEmail(entry, rawEmail) {
    const s = str(rawEmail);
    if (!s.includes('@')) return; // sin '@' no es un email: no inventamos
    const { email, reparado, sospechoso } = repararEmail(s);
    const { item, existente } = entry;
    if (!existente) {
      if (!item.data.emails.includes(email)) item.data.emails.push(email);
    } else {
      const actuales = (existente.emails || []).map((e) => String(e).toLowerCase());
      const yaEnData = item.data.emails || null;
      if (!actuales.includes(email) && !(yaEnData || []).includes(email)) {
        item.data.emails = [...(yaEnData || existente.emails || []), email];
      }
    }
    if (sospechoso) setDato(entry, 'email_sospechoso', true);
    if (reparado) setDato(entry, 'email_original', s.trim().toLowerCase());
  }

  function aportarBanderas(entry, banderas) {
    if (!banderas.length) return;
    const { item, existente } = entry;
    if (!existente) {
      if (!item.data.banderas) {
        item.data.banderas = banderas;
        item.data.multibandera = banderas.length > 1;
      }
    } else if (!(existente.banderas || []).length && !item.data.banderas) {
      item.data.banderas = banderas;
      item.data.multibandera = banderas.length > 1;
    }
  }

  // La etapa solo sube sin_contactar → contactado; una más avanzada JAMÁS se
  // degrada (mismo criterio que importContactados).
  function subirEtapa(entry) {
    const { item, existente } = entry;
    if (!existente) {
      if (item.data.etapa_prospeccion === 'sin_contactar') item.data.etapa_prospeccion = 'contactado';
      return;
    }
    const etapa = str(existente.etapa_prospeccion) || 'sin_contactar';
    if (etapa === 'sin_contactar' && !item.data.etapa_prospeccion) item.data.etapa_prospeccion = 'contactado';
  }

  (rows || []).forEach((row, i) => {
    const fila = i + 2; // como en Excel: encabezado = fila 1
    const r = normalizarFilaListos(row);
    const nombre = str(r['OPERADOR/DECISOR']);
    if (!nombre) {
      errores.push({ fila, motivo: 'fila sin Operador/Decisor' });
      return;
    }
    const entry = resolverOperador(nombre);
    const segmento = str(r['BANDERA_SEGMENTO']);
    aportarEmail(entry, r['EMAIL']);
    aportarBanderas(entry, banderasDeSegmento(segmento));
    setDato(entry, 'segmento', segmento || null);
    setDato(entry, 'tamano_operador', str(r['TAMANO_OPERADOR']) || null);
    setDato(entry, 'origen', str(r['ORIGEN']) || null);
    setDato(entry, 'estado_envio', str(r['ESTADO_ENVIO']) || null);
    setDato(entry, 'localidad', str(r['LOCALIDAD']) || null);
    setDato(entry, 'provincia', str(r['PROVINCIA']) || null);
    if (envioHecho(r['ESTADO_ENVIO'])) subirEtapa(entry);
    // Cerrar el delta de existentes: con algo en data pasa a 'actualizar'.
    const { item, existente } = entry;
    if (existente && Object.keys(item.data).length) { item.accion = 'actualizar'; delete item.motivo; }
  });

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
