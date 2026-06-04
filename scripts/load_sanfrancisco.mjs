/** Carga el catálogo scrapeado de San Francisco (scripts/sanfrancisco_catalogo.json)
 *  como MATERIALES del catálogo, rubro "Mobiliario". Idempotente: reemplaza el set
 *  completo de materiales con fuente:'sanfrancisco' (así actualiza precios y saca
 *  los discontinuados). Precio = NETO (sin IVA) para costos; guarda precioConIva aparte.
 *
 *    node scripts/load_sanfrancisco.mjs            → carga/actualiza
 *    node scripts/load_sanfrancisco.mjs --borrar   → saca TODOS los de San Francisco
 *
 *  Requiere SUPABASE_SERVICE_KEY en .env.local. */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(resolve(__dirname, '../.env.local'), 'utf8');
const pick = (k) => { const m = env.match(new RegExp('^' + k + '=("?)(.*?)\\1\\s*$', 'm')); return m ? m[2] : null; };
const supabase = createClient(pick('SUPABASE_URL') || pick('VITE_SUPABASE_URL'), pick('SUPABASE_SERVICE_KEY'));
if (!pick('SUPABASE_SERVICE_KEY')) { console.error('Falta SUPABASE_SERVICE_KEY en .env.local'); process.exit(1); }

const today = new Date().toISOString().split('T')[0];
const borrar = process.argv.includes('--borrar');
const FUENTE = 'sanfrancisco';
const RUBRO = 'Mobiliario';
const EXCLUIR = new Set(['servicios', 'servicio de corte', 'herramientas', 'discontinuados', 'discontinuos']);

const pkDe = (url) => { const m = String(url || '').match(/_(\d+)\/?$/); return m ? Number(m[1]) : null; }; // PK Oscar (para el sync por listado)
const esSize = (s) => /^\d|mm$|^\d+x|x\d/.test(String(s || '').trim());
const esTablero = (n) => /\b(placa|mdf|melamina|faplac|egger|sadepan|durlock|osb|terciad|fibroplus|chapadur|compacto|mesada|terciplack|grandis|melamin)\b/i.test(n);
const esLineal  = (n) => /\b(canto|filo|perfil|zocalo|zócalo|moldura|listón|liston|viga|junta|contramarco|deck|wall panel)\b/i.test(n);
const unidadDe = (n) => esTablero(n) ? 'placa' : (esLineal(n) ? 'ml' : 'u');

// subRubro limpio: la categoría real (última del breadcrumb), pero si es una medida
// (22mm, 45x2…) usamos la anterior (el menú de navegación viene pegado adelante).
const subRubroDe = (p) => {
  const segs = String(p.breadcrumb || '').split('>').map(s => s.trim()).filter(Boolean);
  const last = p.categoria || segs[segs.length - 1] || '';
  if (esSize(last) && segs.length >= 2) return segs[segs.length - 2];
  return last;
};

(async () => {
  const { data: row, error } = await supabase.from('shared_data').select('*').eq('key', 'catalog').single();
  if (error) { console.error('ERROR conexión:', error.message); process.exit(1); }
  const col = row.data !== undefined ? 'data' : 'value';
  const c = row[col];
  c.rubros = c.rubros || []; c.materiales = c.materiales || [];

  const bk = resolve(__dirname, `_catalog_backup_PRE_SANFRANCISCO_${Date.now()}.json`);
  writeFileSync(bk, JSON.stringify(c));
  console.log('Backup:', bk);

  const sinSF = c.materiales.filter(m => m.fuente !== FUENTE);

  if (borrar) {
    c.materiales = sinSF;
    const { error: e } = await supabase.from('shared_data').update({ [col]: c }).eq('key', 'catalog');
    if (e) { console.error('ERROR:', e.message); process.exit(1); }
    console.log(`🗑️  Saqué ${row[col].materiales.length - sinSF.length} materiales de San Francisco. Quedan ${sinSF.length}.`);
    return;
  }

  // Asegurar rubro Mobiliario
  if (!c.rubros.some(r => (r.nombre || '').trim().toLowerCase() === RUBRO.toLowerCase())) {
    c.rubros.push({ id: 'prueba-rubro-mob', nombre: RUBRO, updatedAt: today, tareasEstandar: [] });
  }

  const productos = JSON.parse(readFileSync(resolve(__dirname, 'sanfrancisco_catalogo.json'), 'utf8'));
  const usados = productos.filter(p => p.sku && !EXCLUIR.has(String(p.categoria || '').trim().toLowerCase()));

  const sfMats = usados.map(p => ({
    id: `sf-${p.sku}`,
    codigo: p.sku,
    nombre: p.nombre,
    unidad: unidadDe(p.nombre),
    rubro: RUBRO,
    subRubro: subRubroDe(p),
    precio: p.precioNeto ?? p.precioIva ?? 0,   // NETO para costos
    precioConIva: p.precioIva ?? null,
    moneda: 'ARS',
    fuente: FUENTE,
    pkSF: pkDe(p.url),   // clave para el sync por listado
    updatedAt: today,
  }));

  c.materiales = [...sinSF, ...sfMats];
  const { error: up } = await supabase.from('shared_data').update({ [col]: c }).eq('key', 'catalog');
  if (up) { console.error('ERROR al guardar:', up.message); process.exit(1); }

  const porUnidad = {}; sfMats.forEach(m => { porUnidad[m.unidad] = (porUnidad[m.unidad] || 0) + 1; });
  console.log(`✅ Cargados ${sfMats.length} materiales de San Francisco en rubro "${RUBRO}" (excluidos ${productos.length - usados.length} servicios/herramientas/discontinuados).`);
  console.log(`   Unidades: ${Object.entries(porUnidad).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  console.log(`   Total materiales en catálogo ahora: ${c.materiales.length}`);
  console.log('   Para sacarlos: node scripts/load_sanfrancisco.mjs --borrar');
})();
