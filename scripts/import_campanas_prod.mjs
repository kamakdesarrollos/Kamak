// IMPORT REAL de la base de ~4.070 estaciones (Kamak_Estaciones_Unificado.xlsx)
// a la DB de Campañas — server-side con service key, replicando EXACTAMENTE el
// flujo de CampImportar.jsx + ejecutarImport (CampanasContext):
//   xlsx → clasificar hojas (posicional "Todas las estaciones" / "LISTOS PARA
//   ENVIAR" / "Contactado…") → planes puros con existentes de la DB destino →
//   fusionarPlanes (estaciones → listos → contactados) → upsert/update por REST
//   → camp_import_runs.
//
// Uso:
//   node scripts/import_campanas_prod.mjs --archivo <ruta.xlsx>            (DRY-RUN)
//   node scripts/import_campanas_prod.mjs --archivo <ruta.xlsx> --ejecutar (escribe)
//   Flags: --prod   obligatorio para tocar el ref de PRODUCCIÓN (guarda dura)
//          --sin-db valida solo parseo+planes con existentes vacíos (sin red)
//
// Env (salvo --sin-db): SUPABASE_URL + SUPABASE_SERVICE_KEY, pasadas por el
// caller (NO se lee .env.local: el destino tiene que ser explícito).
//
// Idempotente: re-correr con la misma planilla no duplica — los planificadores
// dedupean contra los existentes de la DB (operadores por nombre_norm,
// estaciones por telefono_norm y APIES, decisores por linkedin_url y
// nombre+operador), así que lo ya insertado sale como 'saltear'/'actualizar'.

import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import * as XLSXns from 'xlsx';
import { planImportUnificado, planImportListos, mapearFilasPosicionales } from '../src/lib/campanas/importUnificado.js';
import { planImportContactados, fusionarPlanes } from '../src/lib/campanas/importContactados.js';

const XLSX = XLSXns.read ? XLSXns : XLSXns.default;

const PROD_REF = 'eadozwazxejtovfjvdvb';
const LOTE_IMPORT = 500; // upserts de filas nuevas, por lote (= CampanasContext)
const LOTE_UPDATE = 20;  // updates parciales en paralelo, por tanda (= CampanasContext)
const USUARIO_SCRIPT = 'import-script-franco';
const MAX_LISTA = 50;    // ítems listados por bloque del resumen

// Campos mínimos que los planificadores leen de los existentes (llaves de
// dedup + llenar-huecos): ver importUnificado.js / importContactados.js.
const SELECT_EXISTENTES = {
  camp_operadores: 'id,nombre,emails,web,linkedin_empresa,banderas,etapa_prospeccion,notas,datos',
  camp_estaciones: 'id,nombre,bandera,direccion,localidad,provincia,telefono_norm,apies,estado_llamada,telefono_fijo',
  camp_decisores: 'id,nombre,operador_id,linkedin_url,cargo,confianza,email,datos',
};

// ── Args ─────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { archivo: null, ejecutar: false, prod: false, sinDb: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--archivo') args.archivo = argv[++i] || null;
    else if (a === '--ejecutar') args.ejecutar = true;
    else if (a === '--prod') args.prod = true;
    else if (a === '--sin-db') args.sinDb = true;
    else { console.error(`Argumento desconocido: ${a}`); process.exit(2); }
  }
  return args;
}

const args = parseArgs(process.argv);
if (!args.archivo) {
  console.error('Falta --archivo <ruta.xlsx> (la planilla Unificado).');
  process.exit(2);
}
if (!existsSync(args.archivo)) {
  console.error(`No existe el archivo: ${args.archivo}`);
  process.exit(2);
}
if (args.sinDb && args.ejecutar) {
  console.error('--sin-db es solo validación de parseo+planes: no puede combinarse con --ejecutar.');
  process.exit(2);
}

// ── Guarda dura de destino ───────────────────────────────────────────────────
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_KEY || '').trim();
let host = null;

if (!args.sinDb) {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Faltan las env SUPABASE_URL y/o SUPABASE_SERVICE_KEY (pasalas explícitas; este script NO lee .env.local).');
    process.exit(2);
  }
  try { host = new URL(SUPABASE_URL).host; }
  catch { console.error(`SUPABASE_URL inválida: ${SUPABASE_URL}`); process.exit(2); }
  const ref = host.split('.')[0];
  const esProd = ref === PROD_REF;
  console.log('='.repeat(64));
  console.log(`  DESTINO: ${host}${esProd ? '   << PRODUCCIÓN >>' : ''}`);
  console.log('='.repeat(64));
  if (esProd && !args.prod) {
    console.error('\nABORTADO: este es el ref de PRODUCCIÓN y no pasaste --prod.');
    console.error('Si de verdad querés correr contra producción, agregá el flag explícito --prod.');
    process.exit(3);
  }
} else {
  console.log('='.repeat(64));
  console.log('  MODO --sin-db: existentes vacíos, solo valida parseo + planes.');
  console.log('='.repeat(64));
}
console.log(`Archivo: ${args.archivo}`);
console.log(`Modo: ${args.ejecutar ? 'EJECUCIÓN REAL (--ejecutar)' : 'DRY-RUN (sin --ejecutar no se escribe nada)'}\n`);

// ── REST helpers (service key, sin supabase-js: control fino de Prefer) ──────
async function rest(pathQ, { method = 'GET', headers = {}, body } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathQ}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const texto = await res.text();
  if (!res.ok) {
    throw new Error(`${method} /${pathQ.split('?')[0]} → HTTP ${res.status}: ${texto.slice(0, 600)}`);
  }
  return { texto, headers: res.headers };
}

// Todas las filas de una tabla, paginadas de a 1000 (order=id para páginas estables).
async function traerTabla(tabla) {
  const pageSize = 1000;
  const filas = [];
  for (let offset = 0; ; offset += pageSize) {
    const { texto } = await rest(`${tabla}?select=${SELECT_EXISTENTES[tabla]}&order=id.asc&limit=${pageSize}&offset=${offset}`);
    const page = JSON.parse(texto);
    filas.push(...page);
    if (page.length < pageSize) break;
    if (offset >= 100000) throw new Error(`Corte de seguridad: ${tabla} superó 100k filas paginando.`);
  }
  return filas;
}

// Count exacto sin traer filas (verificación post-import).
async function contarTabla(tabla) {
  const { headers } = await rest(`${tabla}?select=id&limit=1`, { headers: { Prefer: 'count=exact' } });
  const m = (headers.get('content-range') || '').match(/\/(\d+)$/);
  return m ? Number(m[1]) : NaN;
}

// ── Clasificación de hojas (copia fiel de clasificarHojas de CampImportar) ───
const normNombre = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

const esHojaContactados = (n) => normNombre(n).includes('contactado');
const esHojaListos = (n) => normNombre(n).includes('listos');

function clasificarHojas(wb) {
  const out = { estaciones: null, listos: null, contactados: null };
  for (const nombre of wb.SheetNames || []) {
    const sheet = wb.Sheets[nombre] || {};
    if (esHojaContactados(nombre)) {
      if (!out.contactados) {
        const rows = XLSX.utils.sheet_to_json(sheet);
        if (rows.length) out.contactados = { hoja: nombre, rows };
      }
      continue;
    }
    if (esHojaListos(nombre)) {
      if (!out.listos) {
        const rows = XLSX.utils.sheet_to_json(sheet);
        if (rows.length) out.listos = { hoja: nombre, rows };
      }
      continue;
    }
    if (out.estaciones) continue;
    const posicionales = mapearFilasPosicionales(XLSX.utils.sheet_to_json(sheet, { header: 1 }));
    if (posicionales) {
      out.estaciones = { hoja: nombre, rows: posicionales, posicional: true };
      continue;
    }
    const rows = XLSX.utils.sheet_to_json(sheet);
    if (rows.length) out.estaciones = { hoja: nombre, rows, posicional: false };
  }
  return out;
}

// ── Resumen en consola ───────────────────────────────────────────────────────
const sumar = (obj) => Object.values(obj || {}).reduce((a, b) => a + (Number(b) || 0), 0);

function conteosPlan(p) {
  const r = p?.resumen || {};
  const partes = [`${sumar(r.nuevos)} nuevos`, `${sumar(r.actualizados)} actualizados`, `${sumar(r.salteados)} salteados`];
  const errs = Array.isArray(r.errores) ? r.errores.length : 0;
  if (errs) partes.push(`${errs} con error`);
  return partes.join(' · ');
}

function listar(titulo, items, formatear) {
  console.log(`\n${titulo}: ${items.length}`);
  for (const it of items.slice(0, MAX_LISTA)) console.log(`  - ${formatear(it)}`);
  if (items.length > MAX_LISTA) console.log(`  ...y ${items.length - MAX_LISTA} más.`);
}

// Emails reparados (datos.email_original) y sospechosos (datos.email_sospechoso)
// que los planificadores dejaron flageados en operadores y decisores.
function escanearEmails(plan) {
  const reparados = [];
  const sospechosos = [];
  const scan = (items, ent) => {
    for (const it of items || []) {
      if (it.accion === 'saltear') continue;
      const datos = it.data?.datos || {};
      const nombre = it.data?.nombre || it.id || '(sin nombre)';
      if (datos.email_original) reparados.push({ ent, nombre, original: datos.email_original });
      if (datos.email_sospechoso) sospechosos.push({ ent, nombre });
    }
  };
  scan(plan.operadores, 'operador');
  scan(plan.decisores, 'decisor');
  return { reparados, sospechosos };
}

function escanearMultibandera(plan) {
  const out = [];
  for (const it of plan.operadores || []) {
    if (it.accion === 'saltear') continue;
    const banderas = it.data?.banderas;
    if (it.data?.multibandera || (Array.isArray(banderas) && banderas.length > 1)) {
      out.push({ nombre: it.data?.nombre || it.id || '(sin nombre)', banderas: (banderas || []).join('/') });
    }
  }
  return out;
}

function imprimirResumen(plan, existentes) {
  const r = plan.resumen || {};
  console.log('\nPLAN FUSIONADO');
  console.log('               nuevos  actualizados  salteados');
  for (const ent of ['operadores', 'estaciones', 'decisores']) {
    const n = (bloque, ancho) => String(r[bloque]?.[ent] || 0).padStart(ancho, ' ');
    console.log(`  ${ent.padEnd(11)} ${n('nuevos', 6)}  ${n('actualizados', 12)}  ${n('salteados', 9)}`);
  }
  console.log(`  (existentes en DB destino: ${existentes.operadores.length} operadores · ${existentes.estaciones.length} estaciones · ${existentes.decisores.length} decisores)`);

  const errores = Array.isArray(r.errores) ? r.errores : [];
  listar('Filas con error (se saltean, el resto se importa igual)', errores, (e) => `fila ${e.fila} — ${e.motivo}`);

  const { reparados, sospechosos } = escanearEmails(plan);
  listar('Emails reparados (typo inequívoco corregido; original preservado en datos)', reparados,
    (e) => `${e.ent} ${e.nombre} — original: ${e.original}`);
  listar('Emails sospechosos (quedan TAL CUAL con flag email_sospechoso)', sospechosos,
    (e) => `${e.ent} ${e.nombre}`);

  const multi = escanearMultibandera(plan);
  listar('Operadores multibandera', multi, (m) => `${m.nombre} [${m.banderas}]`);
}

// ── Completar plan (nombre_norm de operadores nuevos, como CampImportar) ─────
function completarNombreNorm(plan) {
  return {
    ...plan,
    operadores: (plan.operadores || []).map((it) => (
      it.accion === 'crear' && it.data && !it.data.nombre_norm
        ? { ...it, data: { ...it.data, nombre_norm: normNombre(it.data.nombre) } }
        : it)),
  };
}

// ── Ejecución (réplica de ejecutarImport de CampanasContext, vía REST) ───────
// progreso: estado mutable para reportar cuánto entró si un lote falla.
const progreso = { tablas: {}, notar(tabla, tipo, n) {
  const t = this.tablas[tabla] || (this.tablas[tabla] = { creadas: 0, actualizadas: 0, lotesOk: 0 });
  t[tipo] += n;
  t.lotesOk += 1;
} };

async function ejecutarPlan(plan, { archivo }) {
  const now = new Date().toISOString();

  // Ids pre-asignados a los operadores del plan: los 'crear' llevan uuid nuevo
  // y así estaciones/decisores pueden resolver su operadorRef ANTES del insert.
  const idPorIndice = {};
  const opsCrear = [];
  const opsActualizar = [];
  (plan.operadores || []).forEach((item, i) => {
    const data = item?.data || {};
    const accion = item?.accion || 'crear';
    const id = item?.id || data.id || randomUUID();
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
        id: data.id || randomUUID(),
        operador_id: resolverRef(item?.operadorRef, data),
        updated_at: now,
      });
    }
    return { crear, actualizar };
  };

  const porTabla = [
    ['camp_operadores', { crear: opsCrear, actualizar: opsActualizar }],
    ['camp_estaciones', separarItems(plan.estaciones)],
    ['camp_decisores', separarItems(plan.decisores)],
  ];

  // Upsert en lotes de 500 (Prefer resolution=merge-duplicates + on_conflict=id
  // = el .upsert() de supabase-js que usa ejecutarImport).
  // PostgREST exige que TODAS las filas del lote tengan las mismas claves
  // (PGRST102). supabase-js lo resuelve mandando ?columns=<unión>: las claves
  // ausentes en una fila toman su DEFAULT de la tabla. Replicamos eso acá.
  const subirLotes = async (tabla, filas) => {
    const totalLotes = Math.ceil(filas.length / LOTE_IMPORT);
    for (let i = 0; i < filas.length; i += LOTE_IMPORT) {
      const lote = filas.slice(i, i + LOTE_IMPORT);
      const union = [...new Set(lote.flatMap((f) => Object.keys(f)))];
      const columns = union.map((c) => `"${c}"`).join(',');
      await rest(`${tabla}?on_conflict=id&columns=${encodeURIComponent(columns)}`, {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: lote,
      });
      progreso.notar(tabla, 'creadas', lote.length);
      console.log(`  ${tabla}: upsert lote ${Math.floor(i / LOTE_IMPORT) + 1}/${totalLotes} (${lote.length} filas) OK`);
    }
  };

  // Updates parciales: SOLO el delta + updated_at, por id, tandas en paralelo.
  const actualizarLotes = async (tabla, items) => {
    for (let i = 0; i < items.length; i += LOTE_UPDATE) {
      const lote = items.slice(i, i + LOTE_UPDATE);
      await Promise.all(lote.map(({ id, data }) => {
        const campos = { ...data, updated_at: now };
        delete campos.id; // el id nunca viaja en el payload
        return rest(`${tabla}?id=eq.${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: campos,
        });
      }));
      progreso.notar(tabla, 'actualizadas', lote.length);
    }
    if (items.length) console.log(`  ${tabla}: ${items.length} updates parciales OK`);
  };

  console.log('\nAPLICANDO EL PLAN');
  for (const [tabla, { crear, actualizar }] of porTabla) {
    console.log(`- ${tabla}: ${crear.length} a crear · ${actualizar.length} a actualizar`);
    await subirLotes(tabla, crear);
    await actualizarLotes(tabla, actualizar);
  }

  // Registro del run (mismo shape que ejecutarImport + historial de CampImportar).
  const resumen = {
    ...(plan.resumen || {}),
    operadores: opsCrear.length + opsActualizar.length,
    estaciones: porTabla[1][1].crear.length + porTabla[1][1].actualizar.length,
    decisores: porTabla[2][1].crear.length + porTabla[2][1].actualizar.length,
    actividades: 0,
  };
  await rest('camp_import_runs', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: { archivo: basename(archivo), tipo: 'unificado', usuario: USUARIO_SCRIPT, resumen, fecha: now },
  });
  console.log('  camp_import_runs: run registrado OK');
  return { porTabla };
}

// ── Main ─────────────────────────────────────────────────────────────────────
// OJO: acá adentro NUNCA process.exit() — con fetches ya hechos, en Node 24 /
// Windows process.exit() dispara un assert de libuv y pisa el exit code.
// Salida por `return código` + process.exitCode al final (cierre natural).

async function main() {
  // 1. Leer y clasificar el xlsx (idéntico a CampImportar).
  let wb;
  try { wb = XLSX.read(readFileSync(args.archivo), { type: 'buffer' }); }
  catch (e) {
    console.error(`No pude leer el xlsx (¿dañado o abierto en Excel?): ${e.message}`);
    return 1;
  }
  const cls = clasificarHojas(wb);
  if (!cls.estaciones && !cls.listos && !cls.contactados) {
    console.error('No reconocí ninguna hoja con datos: espero la hoja de estaciones (con encabezados o posicional), "LISTOS PARA ENVIAR" o "Contactado…".');
    return 1;
  }

  // 2. Existentes de la DB destino (o vacíos con --sin-db).
  let existentes = { operadores: [], estaciones: [], decisores: [] };
  if (!args.sinDb) {
    console.log('Trayendo existentes de la DB destino (paginado de a 1000)...');
    try {
      const operadores = await traerTabla('camp_operadores');
      const estaciones = await traerTabla('camp_estaciones');
      const decisores = await traerTabla('camp_decisores');
      existentes = { operadores, estaciones, decisores };
      console.log(`  ${operadores.length} operadores · ${estaciones.length} estaciones · ${decisores.length} decisores\n`);
    } catch (e) {
      console.error(`No pude traer los existentes del destino (¿URL/service key correctas?): ${e.message}`);
      return 1;
    }
  }

  // 3. Planes por hoja + fusión en orden estaciones → listos → contactados
  //    (la etapa más avanzada gana; duplicados entre hojas se funden).
  let plan = null;
  console.log('Hojas reconocidas:');
  if (cls.estaciones) {
    const p = planImportUnificado(cls.estaciones.rows, { existentes });
    plan = fusionarPlanes(plan, p);
    console.log(`  "${cls.estaciones.hoja}" — Estaciones${cls.estaciones.posicional ? ' (sin encabezados)' : ''} · ${cls.estaciones.rows.length} filas · ${conteosPlan(p)}`);
  }
  if (cls.listos) {
    const p = planImportListos(cls.listos.rows, { existentes });
    plan = fusionarPlanes(plan, p);
    console.log(`  "${cls.listos.hoja}" — Listos para enviar · ${cls.listos.rows.length} filas · ${conteosPlan(p)}`);
  }
  if (cls.contactados) {
    const p = planImportContactados(cls.contactados.rows, { existentes });
    plan = fusionarPlanes(plan, p);
    console.log(`  "${cls.contactados.hoja}" — Contactados · ${cls.contactados.rows.length} filas · ${conteosPlan(p)}`);
  }
  plan = completarNombreNorm(plan);

  // 4. Resumen detallado.
  imprimirResumen(plan, existentes);

  if (!args.ejecutar) {
    console.log('\nDRY-RUN: NO se escribió nada.');
    console.log('Para aplicar de verdad: agregá --ejecutar (y --prod si el destino es producción).');
    return 0;
  }

  // 5. Ejecución real + verificación con counts.
  const antes = {
    camp_operadores: existentes.operadores.length,
    camp_estaciones: existentes.estaciones.length,
    camp_decisores: existentes.decisores.length,
  };
  try {
    const { porTabla } = await ejecutarPlan(plan, { archivo: args.archivo });

    console.log('\nVERIFICACIÓN (counts REST vs. plan)');
    console.log('  tabla             antes  +creados  esperado  en DB ahora');
    let ok = true;
    for (const [tabla, { crear }] of porTabla) {
      const esperado = antes[tabla] + crear.length;
      const ahora = await contarTabla(tabla);
      const coincide = ahora === esperado;
      if (!coincide) ok = false;
      console.log(`  ${tabla.padEnd(16)} ${String(antes[tabla]).padStart(6)}  ${String(crear.length).padStart(8)}  ${String(esperado).padStart(8)}  ${String(ahora).padStart(11)}  ${coincide ? 'OK' : '<< NO COINCIDE'}`);
    }
    console.log(ok
      ? '\nIMPORT COMPLETO: los counts coinciden con lo planeado.'
      : '\nIMPORT APLICADO pero algún count no coincide (¿escrituras concurrentes?): revisá antes de re-correr.');
    return 0;
  } catch (e) {
    console.error(`\nABORTADO — un lote falló. Error exacto:\n  ${e.message}`);
    console.error('\nLo que YA entró antes del fallo:');
    const tablas = Object.entries(progreso.tablas);
    if (!tablas.length) console.error('  (nada: falló antes del primer lote)');
    for (const [tabla, t] of tablas) {
      console.error(`  ${tabla}: ${t.creadas} creadas · ${t.actualizadas} actualizadas · ${t.lotesOk} lotes OK`);
    }
    console.error('\nRecuperación: re-corré el script con la misma planilla — el dedup contra');
    console.error('existentes hace el proceso idempotente (lo ya insertado no se duplica).');
    return 1;
  }
}

process.exitCode = await main();
