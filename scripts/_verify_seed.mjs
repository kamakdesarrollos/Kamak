// Verificación post-seeding (solo lectura).
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
function loadEnv(p){const o={};if(!fs.existsSync(p))return o;for(const l of fs.readFileSync(p,'utf8').split(/\r?\n/)){if(!l||l.trimStart().startsWith('#')||!l.includes('='))continue;const i=l.indexOf('=');o[l.slice(0,i).trim()]=l.slice(i+1).trim().replace(/^["']|["']$/g,'');}return o;}
const env=loadEnv('.env.local');
const sb=createClient(env.SUPABASE_URL||env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_KEY,{auth:{persistSession:false}});
const {data}=await sb.from('shared_data').select('data').eq('key','obras').maybeSingle();
const obras=data?.data?.obras||[];
console.log('TOTAL obras:', obras.length);
const seed=obras.filter(o=>o.origen==='seed-drive');
console.log('origen seed-drive:', seed.length);
console.log('con obra.web:', obras.filter(o=>o.web).length, '| publicadas (web.publicar):', obras.filter(o=>o.web?.publicar).length);
const byEstado={};for(const o of obras)byEstado[o.estado]=(byEstado[o.estado]||0)+1;console.log('por estado:', JSON.stringify(byEstado));
const check=(n)=>{const o=obras.find(x=>x.nombre.toUpperCase().includes(n));if(!o){console.log(`  ${n}: NO ENCONTRADA`);return;}console.log(`  ${o.nombre}: estado=${o.estado} origen=${o.origen||'-'} web.gallery=${o.web?.gallery?.length||0} antes=${o.web?.imageBefore?'sí':'no'} desp=${o.web?.imageAfter?'sí':'no'} publicar=${o.web?.publicar}`);};
console.log('\nChequeo de enriquecidas y fotos:');
check('CAGLE-ELENA'); check('GALLO'); check('LUCILA'); check('SAN CLEMENTE');
console.log('\nMuestra de 3 nuevas:');
seed.filter(o=>o.id.startsWith('seed-')).slice(0,3).forEach(o=>console.log(`  ${o.nombre} | ${o.web?.slug} | finalizada=${o.estado==='finalizada'} | publicar=${o.web?.publicar}`));
