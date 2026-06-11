// READ-ONLY grounding: lee shared_data['obras'] en vivo desde Supabase con la SERVICE_KEY.
// No imprime la key. No modifica nada. Sirve para aterrizar el seeding/match.
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

function loadEnv(path) {
  const out = {};
  if (!fs.existsSync(path)) return out;
  for (const line of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = loadEnv('.env.local');
const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_KEY;
if (!url || !key) { console.error('Faltan SUPABASE_URL / SUPABASE_SERVICE_KEY en .env.local'); process.exit(1); }

const sb = createClient(url, key, { auth: { persistSession: false } });
const { data, error } = await sb.from('shared_data').select('data').eq('key', 'obras').maybeSingle();
if (error) { console.error('ERROR consulta:', error.message); process.exit(1); }

const blob = data?.data || {};
const obras = Array.isArray(blob.obras) ? blob.obras : [];
const detalles = blob.detalles || {};

console.log('TOTAL obras:', obras.length);
const byEstado = {};
for (const o of obras) byEstado[o.estado] = (byEstado[o.estado] || 0) + 1;
console.log('Por estado:', JSON.stringify(byEstado));
console.log('Keys de obra[0]:', obras[0] ? Object.keys(obras[0]).join(', ') : '(sin obras)');
const conWeb = obras.filter(o => o.web).length;
console.log('Obras con sub-objeto .web ya existente:', conWeb);

console.log('\n--- LISTADO (estado | nombre | cliente | fechas | fotos-con-url | esLead) ---');
for (const o of obras) {
  const det = detalles[o.id] || {};
  const fotosUrl = (det.fotos || []).filter(f => f && f.url).length;
  console.log(`[${o.estado || '?'}] ${o.nombre || '(sin nombre)'} | ${o.cliente || ''} | ${o.fechaInicio || '?'}->${o.fechaFin || '?'} | fotos=${fotosUrl} | lead=${o.esLead ? 'Y' : ''}`);
}

console.log('\n--- DETALLE.fotos shape (primera obra con fotos) ---');
for (const o of obras) {
  const det = detalles[o.id] || {};
  if ((det.fotos || []).length) {
    console.log('obra:', o.nombre, '| fotos[0] keys:', Object.keys(det.fotos[0]).join(', '));
    break;
  }
}
