import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(resolve(__dirname, '../.env.local'), 'utf8');
const pick = (k) => { const m = env.match(new RegExp('^' + k + '=(.*)$', 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : null; };
const supabase = createClient(pick('SUPABASE_URL') || pick('VITE_SUPABASE_URL'), pick('SUPABASE_SERVICE_KEY'));
const APPLY = process.argv.includes('--apply');

const get = async (key) => { const { data: row } = await supabase.from('shared_data').select('*').eq('key', key).single(); if (!row) return { row: null, col: 'data', val: null }; const col = row.data !== undefined ? 'data' : 'value'; return { row, col, val: row[col] }; };

const PLANTILLA_DEFAULT = {
  id: 'plc-default',
  nombre: 'Contrato de obra (estándar)',
  html: `<h2 style="text-align:center">CONTRATO DE OBRA</h2>
<p>Entre <b>KAMAK DESARROLLOS</b> y <b>{{cliente.nombre}}</b> (CUIT {{cliente.cuit}}), en adelante "El Cliente", se acuerda la ejecución de la obra <b>{{obra.nombre}}</b> sita en {{obra.direccion}}.</p>
<p><b>Alcance:</b> {{alcance}}</p>
<p><b>Precio total:</b> U$S {{montoUSD}} + IVA, según el siguiente plan de pagos:</p>
{{planCuotas}}
<p>El Cliente declara aceptar el presente contrato mediante firma electrónica.</p>
<p>Fecha: {{fecha}}</p>`,
  placeholders: ['cliente.nombre', 'cliente.cuit', 'obra.nombre', 'obra.direccion', 'alcance', 'montoUSD', 'planCuotas', 'fecha'],
};

const cur = await get('crm_plantillas_contrato');
const arr = Array.isArray(cur.val) ? cur.val : [];
const yaTiene = arr.some(p => p.id === 'plc-default');
console.log(`Modo: ${APPLY ? 'APPLY' : 'DRY-RUN'} · plantillas actuales: ${arr.length} · default ya existe: ${yaTiene}`);
if (yaTiene) { console.log('Nada para hacer (idempotente).'); process.exit(0); }
if (!APPLY) { console.log('(DRY-RUN: correr con --apply para sembrar la plantilla default.)'); process.exit(0); }

if (cur.row) writeFileSync(resolve(__dirname, `_backup_PRE_PLANTILLA_CONTRATO_${Date.now()}.json`), JSON.stringify(cur.val));
const nuevo = [...arr, PLANTILLA_DEFAULT];
if (cur.row) await supabase.from('shared_data').update({ [cur.col]: nuevo }).eq('key', 'crm_plantillas_contrato');
else await supabase.from('shared_data').insert({ key: 'crm_plantillas_contrato', data: nuevo });
console.log('Plantilla default sembrada.');
