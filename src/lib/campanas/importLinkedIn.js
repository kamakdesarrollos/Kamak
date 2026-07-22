// Importador del export oficial de datos de LinkedIn (Settings → Get a copy of your data → ZIP).
// Funciones puras y autocontenidas: NO importa nada de otros archivos del módulo.
// El parseo CSV es propio (RFC4180 simple: quoted fields, "" escapadas, newlines dentro de comillas).

// ---------------------------------------------------------------------------
// Parser CSV RFC4180
// ---------------------------------------------------------------------------

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let s = String(text ?? '');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1); // BOM
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } // comilla escapada
        else inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue; // CRLF → tratamos el \n
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Convierte filas crudas en objetos usando la fila `headerIdx` como encabezado.
function filasAObjetos(rows, headerIdx) {
  const header = rows[headerIdx].map((h) => String(h || '').trim());
  const out = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r.length || r.every((c) => String(c || '').trim() === '')) continue; // fila vacía
    const obj = {};
    header.forEach((h, j) => { if (h) obj[h] = r[j] !== undefined ? r[j] : ''; });
    out.push(obj);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Normalizaciones
// ---------------------------------------------------------------------------

function normUrl(raw) {
  if (!raw) return '';
  let u = String(raw).trim().toLowerCase();
  u = u.replace(/^https?:\/\//, '').replace(/^www\./, '');
  const q = u.indexOf('?');
  if (q >= 0) u = u.slice(0, q);
  return u.replace(/\/+$/, '');
}

function normNombre(raw) {
  return String(raw || '')
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

// ---------------------------------------------------------------------------
// Fechas de los 3 formatos del export
// ---------------------------------------------------------------------------

const MESES_EN = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

// '2026-07-15 14:22:33 UTC' (messages) · '15 Jul 2026' (Connections) ·
// '7/9/26, 1:05 PM' (Invitations). Devuelve ISO string o null.
function parseFecha(raw) {
  const t = String(raw || '').trim();
  if (!t) return null;
  let m = t.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\s*UTC)?$/i);
  if (m) return new Date(`${m[1]}T${m[2]}Z`).toISOString();
  m = t.match(/^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/);
  if (m && MESES_EN[m[2].toLowerCase()] !== undefined) {
    return new Date(Date.UTC(Number(m[3]), MESES_EN[m[2].toLowerCase()], Number(m[1]))).toISOString();
  }
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (m) {
    const [, mes, dia, anio, hh, mm, ampm] = m;
    let h = Number(hh) % 12;
    if (ampm.toUpperCase() === 'PM') h += 12;
    let y = Number(anio);
    if (y < 100) y += 2000;
    return new Date(Date.UTC(y, Number(mes) - 1, Number(dia), h, Number(mm))).toISOString();
  }
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// ---------------------------------------------------------------------------
// parseLinkedInZip
// ---------------------------------------------------------------------------

const ARCHIVOS_ZIP = { 'messages.csv': 'messages', 'connections.csv': 'connections', 'invitations.csv': 'invitations' };

/**
 * Extrae los CSV relevantes de un JSZip ya cargado (case-insensitive, cualquier subcarpeta).
 * @param {import('jszip')} zip
 * @returns {Promise<{messages: string|null, connections: string|null, invitations: string|null}>}
 */
export async function parseLinkedInZip(zip) {
  const out = { messages: null, connections: null, invitations: null };
  for (const path of Object.keys(zip?.files || {})) {
    const entry = zip.files[path];
    if (!entry || entry.dir) continue;
    const base = path.split('/').pop().toLowerCase();
    const key = ARCHIVOS_ZIP[base];
    if (key && out[key] === null) out[key] = await entry.async('string');
  }
  return out;
}

// ---------------------------------------------------------------------------
// planImportLinkedIn
// ---------------------------------------------------------------------------

function claveActividad(tipo, decisorId, datos, fecha) {
  const disc = datos?.conversationId || String(fecha || '').slice(0, 10);
  return `${tipo}|${decisorId}|${disc}`;
}

/**
 * Genera el plan de import (diff puro, sin tocar la DB) a partir de los CSV crudos del ZIP.
 * @param {{messages: string|null, connections: string|null, invitations: string|null}} rawFiles
 * @param {{decisores: Array<{id:string, nombre:string, linkedin_url?:string|null}>,
 *          actividadesPrevias?: Array<{tipo:string, decisor_id?:string, decisorId?:string, fecha?:string, datos?:object}>,
 *          miNombre: string}} opts
 * @returns {{actividades: Array, sinMatch: Array, resumen: object}}
 */
export function planImportLinkedIn({ messages, connections, invitations } = {}, { decisores = [], actividadesPrevias = [], miNombre } = {}) {
  const porUrl = new Map();
  const porNombre = new Map();
  for (const d of decisores) {
    const u = normUrl(d.linkedin_url);
    if (u && !porUrl.has(u)) porUrl.set(u, d);
    const n = normNombre(d.nombre);
    if (n && !porNombre.has(n)) porNombre.set(n, d);
  }
  const miNombreNorm = normNombre(miNombre);
  const esMio = (from) => normNombre(from) === miNombreNorm;

  const matchDecisor = ({ url, nombre }) => {
    const u = normUrl(url);
    if (u && porUrl.has(u)) return porUrl.get(u);
    const n = normNombre(nombre);
    if (n && porNombre.has(n)) return porNombre.get(n);
    return null;
  };

  const vistas = new Set(
    actividadesPrevias.map((p) => claveActividad(p.tipo, p.decisor_id ?? p.decisorId, p.datos, p.fecha))
  );
  const actividades = [];
  let duplicadosSalteados = 0;
  const agregarActividad = (act) => {
    const clave = claveActividad(act.tipo, act.decisorId, act.datos, act.fecha);
    if (vistas.has(clave)) { duplicadosSalteados++; return; }
    vistas.add(clave);
    actividades.push(act);
  };

  const sinMatch = [];
  const sinMatchVistos = new Set();
  const agregarSinMatch = ({ nombre, url, origen }) => {
    const n = normNombre(nombre);
    if (!n || sinMatchVistos.has(n)) return;
    sinMatchVistos.add(n);
    const item = { nombre: String(nombre).trim(), origen };
    if (url) item.url = String(url).trim();
    sinMatch.push(item);
  };

  // --- messages.csv -------------------------------------------------------
  if (messages) {
    const filas = filasAObjetos(parseCsv(messages), 0);
    const conversaciones = new Map();
    for (const f of filas) {
      const id = String(f['CONVERSATION ID'] || '').trim();
      if (!id || !String(f['FROM'] || '').trim()) continue;
      if (!conversaciones.has(id)) conversaciones.set(id, []);
      conversaciones.get(id).push(f);
    }
    for (const [conversationId, msjs] of conversaciones) {
      msjs.sort((a, b) => String(parseFecha(a['DATE']) || '').localeCompare(String(parseFecha(b['DATE']) || '')));
      // La contraparte: el primer mensaje ajeno (FROM + SENDER PROFILE URL);
      // si nunca respondieron, el destinatario de mi primer mensaje (TO + RECIPIENT PROFILE URLS).
      const ajeno = msjs.find((m) => !esMio(m['FROM']));
      const persona = ajeno
        ? { nombre: ajeno['FROM'], url: ajeno['SENDER PROFILE URL'] }
        : {
            nombre: String(msjs[0]['TO'] || '').split(/[;,]/)[0],
            url: String(msjs[0]['RECIPIENT PROFILE URLS'] || '').split(/[;,]/)[0],
          };
      const decisor = matchDecisor(persona);
      if (!decisor) { agregarSinMatch({ ...persona, origen: 'messages' }); continue; }

      if (esMio(msjs[0]['FROM'])) {
        agregarActividad({
          tipo: 'linkedin_contactado',
          decisorId: decisor.id,
          fecha: parseFecha(msjs[0]['DATE']),
          datos: { conversationId },
        });
      }
      // Primer mensaje ajeno POSTERIOR a un mensaje mío → respondió.
      let huboMio = false;
      for (const m of msjs) {
        if (esMio(m['FROM'])) { huboMio = true; continue; }
        if (huboMio) {
          agregarActividad({
            tipo: 'linkedin_respondio',
            decisorId: decisor.id,
            fecha: parseFecha(m['DATE']),
            datos: { conversationId },
          });
          break;
        }
      }
    }
  }

  // --- Connections.csv (preámbulo de notas antes del header real) ---------
  if (connections) {
    const rows = parseCsv(connections);
    const headerIdx = rows.findIndex((r) => r.some((c) => /^first name$/i.test(String(c || '').trim())));
    if (headerIdx >= 0) {
      for (const f of filasAObjetos(rows, headerIdx)) {
        const nombre = `${String(f['First Name'] || '').trim()} ${String(f['Last Name'] || '').trim()}`.trim();
        if (!nombre) continue;
        const persona = { nombre, url: f['URL'] };
        const decisor = matchDecisor(persona);
        if (!decisor) { agregarSinMatch({ ...persona, origen: 'connections' }); continue; }
        agregarActividad({
          tipo: 'linkedin_acepto',
          decisorId: decisor.id,
          fecha: parseFecha(f['Connected On']),
          datos: {},
        });
      }
    }
  }

  // --- Invitations.csv (solo OUTGOING; sin URL → match por nombre) --------
  if (invitations) {
    for (const f of filasAObjetos(parseCsv(invitations), 0)) {
      if (String(f['Direction'] || '').trim().toUpperCase() !== 'OUTGOING') continue;
      const nombre = String(f['To'] || '').trim();
      if (!nombre) continue;
      const decisor = matchDecisor({ nombre });
      if (!decisor) { agregarSinMatch({ nombre, origen: 'invitations' }); continue; }
      agregarActividad({
        tipo: 'linkedin_invitado',
        decisorId: decisor.id,
        fecha: parseFecha(f['Sent At']),
        datos: {},
      });
    }
  }

  const contar = (tipo) => actividades.filter((a) => a.tipo === tipo).length;
  return {
    actividades,
    sinMatch,
    resumen: {
      contactados: contar('linkedin_contactado'),
      respondieron: contar('linkedin_respondio'),
      aceptaron: contar('linkedin_acepto'),
      invitados: contar('linkedin_invitado'),
      sinMatch: sinMatch.length,
      duplicadosSalteados,
    },
  };
}
