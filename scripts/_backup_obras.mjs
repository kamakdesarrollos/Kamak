// Backup de seguridad: vuelca shared_data['obras'] completo a un JSON local
// timestampeado ANTES de cualquier seeding. Solo lee de Supabase + escribe local.
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

const stamp = process.argv[2] || 'manual';
const sb = createClient(url, key, { auth: { persistSession: false } });
const { data, error } = await sb.from('shared_data').select('data').eq('key', 'obras').maybeSingle();
if (error) { console.error('ERROR consulta:', error.message); process.exit(1); }

const blob = data?.data || {};
const obras = Array.isArray(blob.obras) ? blob.obras : [];
const file = `scripts/_obras_backup_PRE_SEEDING_${stamp}.json`;
fs.writeFileSync(file, JSON.stringify(blob, null, 2), 'utf8');
console.log(`✓ Backup escrito: ${file}`);
console.log(`  obras: ${obras.length} | detalles: ${Object.keys(blob.detalles || {}).length}`);
console.log('  nombres:', obras.map(o => `${o.nombre} [${o.estado}]`).join(' | '));
