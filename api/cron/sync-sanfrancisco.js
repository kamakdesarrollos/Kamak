// Sync de precios San Francisco → catálogo Kamak.
//
// Disparado por Vercel Cron (ver vercel.json), 1x/día. Scrapea SOLO el LISTADO
// público de sanfrancisco-tienda.ar (~196 págs, 20 productos c/u con precio) —
// no las 3.928 fichas — así entra holgado en el límite de tiempo serverless.
// Actualiza precio de los materiales del catálogo con fuente:'sanfrancisco' cuyo
// precio cambió (match por pkSF = PK Oscar del producto). Mantiene el NETO
// proporcional al cambio del precio c/IVA.
//
// Solo PRECIOS de productos existentes. Altas/bajas de productos → recarga full
// con scripts/scrape_sanfrancisco.mjs + scripts/load_sanfrancisco.mjs.
//
// Seguridad: si CRON_SECRET está seteado, exige el secret (Vercel Cron manda
// Authorization: Bearer <CRON_SECRET>; también acepta ?secret= o x-cron-secret).

const BASE = 'https://sanfrancisco-tienda.ar';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; KamakCatalogBot/1.0)' };

const sbH = () => ({ apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function loadCatalog() {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/shared_data?key=eq.catalog&select=data`, { headers: sbH() });
  if (!r.ok) throw new Error('loadCatalog ' + r.status);
  const rows = await r.json();
  return rows[0]?.data ?? null;
}
async function saveCatalog(data) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/shared_data?on_conflict=key`, {
    method: 'POST',
    headers: { ...sbH(), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ key: 'catalog', data, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error('saveCatalog ' + r.status + ' ' + (await r.text()).slice(0, 200));
}

const parsePrice = (s) => {
  const n = String(s || '').replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.');
  const v = parseFloat(n);
  return isFinite(v) ? Math.round(v * 100) / 100 : null;
};

async function get(u, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(u, { headers: UA }); if (r.ok) return await r.text(); if (r.status === 404) return null; } catch { /* retry */ }
    await sleep(300 * (i + 1));
  }
  return null;
}

// Scrapea el listado paginado → Map pkSF → precio c/IVA.
async function scrapeListado() {
  const precios = new Map();
  const RE = /href="\/catalogue\/[a-z0-9-]+_(\d+)\/"[^>]*title="[^"]*"[\s\S]{0,500}?price_color[^>]*>([^<]+)</gi;
  for (let page = 1; page <= 400; page++) {
    const html = await get(`${BASE}/catalogue/?page=${page}`);
    if (!html) break;
    let found = 0;
    for (const m of html.matchAll(RE)) {
      const pk = Number(m[1]); const precio = parsePrice(m[2]);
      if (pk && precio != null) { precios.set(pk, precio); found++; }
    }
    if (found === 0) break;          // página sin productos → fin
    await sleep(60);
  }
  return precios;
}

export default async function handler(req, res) {
  if (CRON_SECRET) {
    const given = req.query?.secret || req.headers['x-cron-secret'] || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (given !== CRON_SECRET) return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    const precios = await scrapeListado();
    const catalog = await loadCatalog();
    if (!catalog || !Array.isArray(catalog.materiales)) return res.status(500).json({ error: 'catalogo no disponible' });

    let actualizados = 0, sinMatch = 0;
    const hoy = new Date().toISOString().split('T')[0];
    for (const mat of catalog.materiales) {
      if (mat.fuente !== 'sanfrancisco' || mat.pkSF == null) continue;
      const nuevoIva = precios.get(mat.pkSF);
      if (nuevoIva == null) { sinMatch++; continue; }
      if (nuevoIva === mat.precioConIva) continue;            // sin cambio
      const viejoIva = Number(mat.precioConIva) || 0;
      const viejoNeto = Number(mat.precio) || 0;
      const nuevoNeto = viejoIva > 0 && viejoNeto > 0
        ? Math.round(viejoNeto * (nuevoIva / viejoIva) * 100) / 100   // mantiene la relación neto/IVA real
        : Math.round((nuevoIva / 1.21) * 100) / 100;                  // fallback 21%
      mat.precio = nuevoNeto;
      mat.precioConIva = nuevoIva;
      mat.updatedAt = hoy;
      actualizados++;
    }

    if (actualizados > 0) await saveCatalog(catalog);
    const summary = { ok: true, productosListado: precios.size, materialesSF: catalog.materiales.filter(m => m.fuente === 'sanfrancisco').length, actualizados, sinMatch };
    console.log('[sync-sanfrancisco]', JSON.stringify(summary));
    return res.status(200).json(summary);
  } catch (e) {
    console.error('[sync-sanfrancisco] error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
