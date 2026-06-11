// SEEDING de obras históricas para la web (subsistema 3).
// - DRY-RUN por defecto: imprime el plan, NO escribe. Pasar `--write` para ejecutar.
// - Idempotente: las nuevas usan id estable `seed-<n>-<slug>`; re-correr PATCHEA (no duplica).
// - Las 3 finalizadas existentes (Elena/Gallo/La Lucila) se ENRIQUECEN (no se duplican).
// - Sube SOLO fotos locales disponibles (Elena 12 + San Clemente antes/después) a kamak-fotos.
//   El resto de las fotos (Drive) se migran aparte.
// Uso: node scripts/_seed_obras_web.mjs            (dry-run)
//      node scripts/_seed_obras_web.mjs --write     (escribe en producción)
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

const WRITE = process.argv.includes('--write');

function loadEnv(p) {
  const out = {};
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('='); out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}
const env = loadEnv('.env.local');
const URL = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_KEY;
if (!URL || !KEY) { console.error('Faltan SUPABASE_URL/SUPABASE_SERVICE_KEY'); process.exit(1); }
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

const slugify = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'obra';

const BA = 'Buenos Aires';
// n, localidad, provincia, cliente, antes(CHECK), despues(CHECK), comentario
const SEED = [
  [1, 'Necochea', BA, 'Gas Victoria', 1, 0, ''],
  [2, 'Necochea', BA, 'Combustibles Quequén', 0, 0, ''],
  [3, 'San Bernardo', BA, 'Sebastián Cupo', 0, 1, ''],
  [4, 'Madariaga', BA, 'Sarimar', 0, 1, ''],
  [5, 'Lobería', BA, 'Cumelcan', 0, 1, ''],
  [6, 'Tandil', BA, 'El Lucero de Tandil', 1, 1, ''],
  [7, 'Tres Arroyos (centro)', BA, 'Cumeche SRL', 0, 0, ''],
  [8, 'Tres Arroyos (ruta 3)', BA, 'Cumeche SRL', 0, 1, ''],
  [9, 'Azul', BA, 'Sapeda', 1, 1, ''],
  [10, 'Rosario', 'Santa Fe', 'Trafigura', 1, 1, 'fotos no muy lindas'],
  [11, 'Bahía Blanca', BA, 'Bribal Agro', 1, 1, ''],
  [12, 'La Tablada', BA, 'Carokey', 1, 1, 'pocas y no muy lindas'],
  [13, 'Olavarría', BA, 'Gas Carielli', 1, 1, ''],
  [14, 'Mar del Plata', BA, 'Cumelcan', 1, 1, ''],
  [15, 'San Martín', BA, 'Traslux', 1, 1, ''],
  [16, 'Sampacho', 'Córdoba', '', 0, 0, 'solo durante (sin carpeta en Drive)'],
  [17, 'Haedo', BA, 'Traslux', 0, 1, ''],
  [18, 'Zárate', BA, 'Traslux', 1, 1, ''],
  [19, 'Necochea', BA, 'Combustibles Quequén', 1, 1, ''],
  [20, 'Rojas', BA, '', 1, 1, 'sin carpeta en Drive'],
  [21, 'Mar del Plata', BA, 'Energía y Servicios', 1, 1, ''],
  [22, 'Lomas de Zamora', BA, 'Oro Negro', 1, 0, ''],
  [23, 'El Talar', BA, '', 1, 1, ''],
  [24, '30 de Agosto', BA, '', 0, 1, ''],
  [25, 'Garín', BA, '', 1, 1, ''],
  [26, 'Las Toninas', BA, '', 0, 1, ''],
  [27, 'San Clemente', BA, '', 1, 1, ''],
  [28, 'Elena', 'Córdoba', '', 0, 0, ''],
  [29, 'Moquehua', BA, '', 0, 1, ''],
  [30, 'Baradero', BA, 'Costa Paraná', 1, 1, ''],
];

// Match a obras finalizadas existentes (token) — para enriquecer sin duplicar.
const MATCH_EXISTENTES = [
  { token: 'ELENA', desde: 28 },          // CAGLE-ELENA  ← seed #28
  { token: 'GALLO', desde: null, extra: { localidad: '', cliente: 'Gallo Negro', marca: '' } },
  { token: 'LUCILA', desde: null, extra: { localidad: 'La Lucila', cliente: 'Fan de Pan', marca: 'Fan de Pan' } },
];

const LOCAL = '../WEB-Software- Kamak/assets/photos';
function localPhotosFor(n) {
  const r = { gallery: [], imageBefore: null, imageAfter: null };
  const exists = (f) => fs.existsSync(path.join(LOCAL, f));
  if (n === 28) { for (let i = 0; i <= 11; i++) { const f = `elena-${String(i).padStart(2, '0')}.jpg`; if (exists(f)) r.gallery.push(f); } }
  if (n === 27) { if (exists('sanclemente-antes.jpg')) r.imageBefore = 'sanclemente-antes.jpg'; if (exists('sanclemente-despues.jpg')) r.imageAfter = 'sanclemente-despues.jpg'; }
  return r;
}

const nowISO = new Date().toISOString();
function buildWeb({ slug, titulo, localidad, provincia, antes, despues, orden, marca = '' }) {
  return {
    publicar: false, slug, titulo, categoria: 'Tienda', marca,
    m2: null, localidad, provincia, coords: null, diasOverride: null,
    antes: !!(antes && despues), imageBefore: null, imageAfter: null, gallery: [],
    portada: null, texto: [], destacada: false, orden,
    checklist: { antes: !!antes, despues: !!despues },
  };
}

function buildPlan(obras) {
  const finalById = obras.filter(o => o.estado === 'finalizada');
  const byId = new Map(obras.map(o => [o.id, o]));
  const usedSlugs = new Set();
  const uniqueSlug = (base, n) => { let s = usedSlugs.has(base) ? `${base}-${n}` : base; usedSlugs.add(s); return s; };
  const plan = [];

  for (const [n, localidad, provincia, cliente, antes, despues] of SEED) {
    const titulo = cliente ? `${localidad} — ${cliente}` : localidad;
    const matchCfg = MATCH_EXISTENTES.find(m => m.desde === n);
    let targetId, existe, accion;
    const slug = uniqueSlug(slugify(titulo), n);
    if (matchCfg) {
      const ex = finalById.find(o => o.nombre.toUpperCase().includes(matchCfg.token));
      if (ex) { targetId = ex.id; existe = true; accion = `ENRIQUECER «${ex.nombre}»`; }
      else { targetId = `seed-${n}-${slug}`; existe = false; accion = `CREAR (sin match ${matchCfg.token})`; }
    } else {
      targetId = `seed-${n}-${slug}`; existe = byId.has(targetId); accion = existe ? 'RE-PATCH' : 'CREAR';
    }
    const web = buildWeb({ slug, titulo, localidad, provincia, antes, despues, orden: n });
    const lp = localPhotosFor(n);
    const photos = [];
    if (lp.gallery.length) { web.gallery = lp.gallery.map(f => ({ url: `LOCAL:${f}`, caption: '' })); lp.gallery.forEach(f => photos.push({ file: f, slot: 'gallery' })); }
    if (lp.imageBefore) { web.imageBefore = `LOCAL:${lp.imageBefore}`; web.antes = true; photos.push({ file: lp.imageBefore, slot: 'before' }); }
    if (lp.imageAfter) { web.imageAfter = `LOCAL:${lp.imageAfter}`; web.antes = true; photos.push({ file: lp.imageAfter, slot: 'after' }); }
    plan.push({ n, targetId, titulo, localidad, provincia, cliente, slug, existe, web, photos, accion });
  }

  for (const m of MATCH_EXISTENTES.filter(x => x.desde === null)) {
    const ex = finalById.find(o => o.nombre.toUpperCase().includes(m.token));
    if (!ex) { plan.push({ n: '-', targetId: '?', titulo: m.token, photos: [], existe: false, accion: `SALTEAR (no existe ${m.token})` }); continue; }
    const slug = uniqueSlug(slugify(m.extra.cliente || ex.nombre), 90);
    const web = buildWeb({ slug, titulo: ex.nombre, localidad: m.extra.localidad || '', provincia: BA, antes: 0, despues: 0, orden: 90, marca: m.extra.marca || '' });
    plan.push({ n: '-', targetId: ex.id, titulo: ex.nombre, localidad: m.extra.localidad || '', slug, existe: true, web, photos: [], accion: `ENRIQUECER «${ex.nombre}»` });
  }
  return plan;
}

async function main() {
  const { data, error } = await sb.from('shared_data').select('data').eq('key', 'obras').maybeSingle();
  if (error) { console.error('ERROR load:', error.message); process.exit(1); }
  const blob = data?.data || {};
  const obras = Array.isArray(blob.obras) ? blob.obras : [];
  const plan = buildPlan(obras);
  const totalPhotos = plan.reduce((s, p) => s + (p.photos?.length || 0), 0);

  console.log(`\n=== SEEDING OBRAS WEB — ${WRITE ? 'MODO ESCRITURA' : 'DRY-RUN (no escribe)'} ===`);
  console.log(`Obras en la base: ${obras.length} | acciones: ${plan.length} | fotos locales: ${totalPhotos}\n`);
  for (const p of plan) console.log(`  ${String(p.accion).padEnd(28)} | ${String(p.titulo).padEnd(34)} | slug:${(p.slug || '-').padEnd(28)} | antes/desp:${p.web?.antes ? 'sí' : 'no'} | fotos:${p.photos?.length || 0}`);
  console.log(`\nResumen: ${plan.filter(p => p.accion.startsWith('CREAR')).length} crear · ${plan.filter(p => p.accion.startsWith('ENRIQUECER')).length} enriquecer · ${totalPhotos} fotos locales\n`);

  if (!WRITE) { console.log('DRY-RUN: no se escribió nada. Correr con --write para ejecutar.'); return; }

  // Subir fotos locales → URL pública
  const urlByLocal = {};
  for (const p of plan) {
    for (const ph of (p.photos || [])) {
      const buf = fs.readFileSync(path.join(LOCAL, ph.file));
      const dest = `obras/${p.targetId}/web/${ph.file}`;
      const { error: upErr } = await sb.storage.from('kamak-fotos').upload(dest, buf, { upsert: true, contentType: 'image/jpeg' });
      if (upErr) { console.error('  upload err', ph.file, upErr.message); continue; }
      urlByLocal[`${p.targetId}|${ph.file}`] = sb.storage.from('kamak-fotos').getPublicUrl(dest).data.publicUrl;
      console.log('  ✓ subida', dest);
    }
  }
  const resolve = (id, web) => {
    if (Array.isArray(web.gallery)) web.gallery = web.gallery.map(g => g.url?.startsWith('LOCAL:') ? { ...g, url: urlByLocal[`${id}|${g.url.slice(6)}`] || null } : g).filter(g => g.url);
    if (web.imageBefore?.startsWith('LOCAL:')) web.imageBefore = urlByLocal[`${id}|${web.imageBefore.slice(6)}`] || null;
    if (web.imageAfter?.startsWith('LOCAL:')) web.imageAfter = urlByLocal[`${id}|${web.imageAfter.slice(6)}`] || null;
    return web;
  };

  let ok = 0, fail = 0;
  for (const p of plan) {
    if (p.targetId === '?') continue;
    const web = resolve(p.targetId, p.web);
    let res;
    if (p.existe) {
      res = await sb.rpc('patch_shared_object_item', { p_key: 'obras', p_collection: 'obras', p_id: p.targetId, p_patch: { web, origen: 'seed-drive' } });
    } else {
      const obra = {
        id: p.targetId, nombre: p.titulo, cliente: p.cliente || '', clienteId: null,
        direccion: [p.localidad, p.provincia].filter(Boolean).join(', '), tipo: 'Local comercial',
        estado: 'finalizada', moneda: 'ARS', presupuesto: 0, gastado: 0, avance: 100, margen: 0,
        fechaInicio: '', fechaFinEstim: '', fechaFin: '', notas: `Obra histórica (web · Drive #${p.n})`,
        origen: 'seed-drive', createdAt: nowISO, web,
      };
      res = await sb.rpc('append_shared_object_item', { p_key: 'obras', p_collection: 'obras', p_item: obra });
    }
    if (res.error) { console.error('  ✗', p.titulo, res.error.message); fail++; } else { ok++; }
  }
  console.log(`\n✓ Escritura terminada: ${ok} ok, ${fail} con error.`);
}
main().catch(e => { console.error(e); process.exit(1); });
