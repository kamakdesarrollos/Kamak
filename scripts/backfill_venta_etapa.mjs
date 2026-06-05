// Backfill one-time de obra.venta.etapa en las obras existentes (spec §7.4).
// Idempotente: si una obra ya tiene `venta`, NO la pisa.
// Uso:  node scripts/backfill_venta_etapa.mjs           (dry-run, no escribe)
//       node scripts/backfill_venta_etapa.mjs --apply   (respalda y escribe)
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { etapaInicialBackfill } from '../src/lib/ventaEtapa.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(resolve(__dirname, '../.env.local'), 'utf8');
// Lee KEY=value de .env.local, tolera comillas alrededor del valor.
const pick = (k) => {
  const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
};
const SUPABASE_URL = pick('SUPABASE_URL') || pick('VITE_SUPABASE_URL');
const SUPABASE_KEY = pick('SUPABASE_SERVICE_KEY');
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('Faltan SUPABASE_URL / SUPABASE_SERVICE_KEY en .env.local'); process.exit(1); }
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const APPLY = process.argv.includes('--apply');

const get = async (key) => {
  const { data: row, error } = await supabase.from('shared_data').select('*').eq('key', key).single();
  if (error || !row) return { row: null, col: 'data', val: null };
  const col = row.data !== undefined ? 'data' : 'value';
  return { row, col, val: row[col] };
};

const obr = await get('obras');
const mov = await get('movimientos');
if (!obr.row) { console.error('No existe el blob "obras".'); process.exit(1); }

const blob = obr.val || {};
const obras = blob.obras || [];
const detalles = blob.detalles || {};
const movimientos = (mov.val && mov.val.movimientos) || [];
const tieneIngreso = (obraId) => movimientos.some(m => m.obraId === obraId && m.tipo === 'ingreso');

let cambiadas = 0;
const plan = [];
for (const o of obras) {
  if (o.venta && o.venta.etapa) continue; // idempotente
  const det = detalles[o.id] || {};
  const propuestaEnviada = !!(det.financiacion && det.financiacion.propuestaEnviada);
  const etapa = etapaInicialBackfill(o, { propuestaEnviada, tieneIngreso: tieneIngreso(o.id) });
  // Jerarquía de fechaCambioEtapa (spec §7.4).
  const primerIngreso = movimientos
    .filter(m => m.obraId === o.id && m.tipo === 'ingreso')
    .map(m => m.fecha).filter(Boolean).sort()[0];
  const fechaCambioEtapa =
    etapa === 'cotizado' ? (det.financiacion?.fechaPropuesta || o.createdAt) :
    etapa === 'ganado'   ? (primerIngreso || o.fechaInicio || o.createdAt) :
    etapa === 'perdido'  ? (o.fechaFin || o.createdAt) :
    o.createdAt;
  o.venta = {
    etapa,
    responsable: null,
    origen: null,
    fechaProximoContacto: null,
    motivoPerdida: etapa === 'perdido' ? '(migración)' : null,
    fechaCambioEtapa: fechaCambioEtapa || null,
    changelog: [],
  };
  cambiadas++;
  plan.push(`${o.id} (${o.estado}) -> ${etapa}`);
}

console.log(`Modo: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
console.log(`Obras totales: ${obras.length} · a setear venta: ${cambiadas}`);
plan.slice(0, 50).forEach(l => console.log('  ' + l));
if (plan.length > 50) console.log(`  …(+${plan.length - 50})`);

if (!APPLY) { console.log('\n(DRY-RUN: no se escribió. Corré con --apply.)'); process.exit(0); }
if (cambiadas === 0) { console.log('\nNada para hacer.'); process.exit(0); }

const bk = resolve(__dirname, `_backup_PRE_VENTA_ETAPA_${Date.now()}.json`);
writeFileSync(bk, JSON.stringify(obr.val));
console.log('\nBackup:', bk);

blob.obras = obras;
const { error: upErr } = await supabase.from('shared_data').update({ [obr.col]: blob }).eq('key', 'obras');
if (upErr) { console.error('Error guardando:', upErr.message); process.exit(1); }

// Verificación post-escritura.
const { val: val2 } = await get('obras');
const sinVenta = (val2.obras || []).filter(o => !(o.venta && o.venta.etapa)).length;
console.log(`\n✅ Guardado. Obras sin venta.etapa restantes: ${sinVenta}`);
