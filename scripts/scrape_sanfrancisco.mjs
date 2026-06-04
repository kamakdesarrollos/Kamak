// Scrapea el catálogo público de sanfrancisco-tienda.ar (Django-Oscar) a un JSON.
// Solo lee datos públicos (precio c/IVA y sin IVA, SKU/UPC, stock, categoría).
// Ritmo cuidado: concurrencia baja + pausa entre requests.
//   node scripts/scrape_sanfrancisco.mjs
import { writeFileSync } from 'fs';

const BASE = 'https://sanfrancisco-tienda.ar';
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; KamakCatalogBot/1.0; +procurement)' };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function get(u, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(u, { headers: UA });
      if (r.ok) return await r.text();
      if (r.status === 404) return null;
    } catch { /* retry */ }
    await sleep(400 * (i + 1));
  }
  return null;
}

const parsePrice = (s) => {
  if (!s) return null;
  const n = String(s).replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.');
  const v = parseFloat(n);
  return isFinite(v) ? Math.round(v * 100) / 100 : null;
};

function parseProduct(html, url) {
  const attr = {};
  for (const m of html.matchAll(/<th>([^<]+)<\/th>\s*<td>([\s\S]*?)<\/td>/g)) {
    attr[m[1].trim()] = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  }
  const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1];
  const ogt = (html.match(/property="og:title"\s+content="([^"]+)"/i) || [])[1];
  const nombre = (h1 ? h1.replace(/<[^>]+>/g, '') : (ogt || '')).replace(/\s+/g, ' ').trim();
  const priceColor = (html.match(/class="price_color"[^>]*>([^<]+)</i) || [])[1] || '';
  const bc = [...html.matchAll(/href="\/catalogue\/category\/[^"]*"[^>]*>([^<]+)</g)].map(m => m[1].trim()).filter(x => x && x.toLowerCase() !== 'todos los productos');
  return {
    url: BASE + url,
    sku: attr['UPC'] || '',
    nombre,
    categoria: bc.length ? bc[bc.length - 1] : '',
    breadcrumb: [...new Set(bc)].join(' > '),
    precioNeto: parsePrice(attr['Precio (sin IVA)']),
    precioIva: parsePrice(attr['Precio'] || priceColor),
    stock: (attr['Disponibilidad'] || (html.match(/availability">\s*([\s\S]*?)</i) || [])[1] || '').replace(/\s+/g, ' ').trim(),
  };
}

// 1) Juntar URLs de producto paginando el catálogo.
async function collectUrls() {
  const urls = new Set();
  for (let page = 1; page <= 300; page++) {
    const html = await get(`${BASE}/catalogue/?page=${page}`);
    if (!html) break;
    const links = [...html.matchAll(/href="(\/catalogue\/(?!category\/)[a-z0-9-]+_\d+\/)"/gi)].map(m => m[1]);
    const before = urls.size;
    links.forEach(l => urls.add(l));
    process.stdout.write(`\r  recolectando URLs… pág ${page} · ${urls.size} productos`);
    if (urls.size === before) break;
    await sleep(120);
  }
  process.stdout.write('\n');
  return [...urls];
}

// 2) Fetch productos con pool de concurrencia.
async function scrapeAll(urls, conc = 5) {
  const out = [];
  let i = 0, done = 0;
  async function worker() {
    while (i < urls.length) {
      const idx = i++;
      const html = await get(BASE + urls[idx]);
      if (html) out.push(parseProduct(html, urls[idx]));
      done++;
      if (done % 10 === 0) process.stdout.write(`\r  fichas… ${done}/${urls.length}`);
      await sleep(100);
    }
  }
  await Promise.all(Array.from({ length: conc }, worker));
  process.stdout.write(`\r  fichas… ${done}/${urls.length}\n`);
  return out;
}

(async () => {
  console.log('Scrapeando sanfrancisco-tienda.ar …');
  const urls = await collectUrls();
  const productos = await scrapeAll(urls);
  productos.sort((a, b) => (a.categoria || '').localeCompare(b.categoria || '') || (a.nombre || '').localeCompare(b.nombre || ''));
  writeFileSync('scripts/sanfrancisco_catalogo.json', JSON.stringify(productos, null, 1));
  const cats = {};
  productos.forEach(p => { cats[p.categoria || '(sin)'] = (cats[p.categoria || '(sin)'] || 0) + 1; });
  const conPrecio = productos.filter(p => p.precioNeto != null).length;
  console.log(`\n✅ ${productos.length} productos · con precio: ${conPrecio} · con SKU: ${productos.filter(p => p.sku).length}`);
  console.log('Por categoría:', Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(', '));
  console.log('\nMuestra:');
  productos.slice(0, 8).forEach(p => console.log(`  [${p.sku}] ${p.nombre} | ${p.categoria} | neto $${p.precioNeto} | c/IVA $${p.precioIva}`));
})();
