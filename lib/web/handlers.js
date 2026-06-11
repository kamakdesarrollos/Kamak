// Handlers de los endpoints públicos de la web. Viven en lib/ (NO en api/) para
// (1) no contar como Vercel functions extra y (2) ser testeables. El único
// Vercel function es api/public/[kind].js, que despacha a estos.
import { applyCors, loadSharedData, appendObjectItem, appendItemInSharedArray } from './supabaseRest.js';
import { obrasPublicadas, validateLead, leadFromBody } from './obraPublic.js';

// GET /api/public/obras           → lista de obras publicadas (whitelist)
// GET /api/public/obras?slug=xxx  → una obra publicada por slug
export async function obrasHandler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS'); return res.status(204).end(); }
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const blob = await loadSharedData('obras');
    const lista = obrasPublicadas(blob || {});
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    const { slug } = req.query;
    if (slug) {
      const one = lista.find(o => o.slug === slug);
      if (!one) return res.status(404).json({ error: 'not_found' });
      return res.status(200).json({ obra: one });
    }
    return res.status(200).json({ obras: lista, total: lista.length });
  } catch (e) {
    console.error('[public/obras]', e.message);
    return res.status(500).json({ error: 'server_error' });
  }
}

const hits = new Map();
function rateLimited(ip) {
  const now = Date.now(), win = 60_000, max = 5;
  const arr = (hits.get(ip) || []).filter(t => now - t < win);
  arr.push(now); hits.set(ip, arr);
  return arr.length > max;
}

// POST /api/public/leads → crea un lead en el embudo Comercial (origen web)
export async function leadsHandler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) return res.status(429).json({ error: 'rate_limited' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const v = validateLead(body);
    if (!v.ok) {
      if (v.errors.includes('honeypot')) return res.status(200).json({ ok: true });
      return res.status(400).json({ error: 'invalid', fields: v.errors });
    }
    const nowISO = new Date().toISOString();
    const lead = leadFromBody(body, nowISO);
    const ok = await appendObjectItem('obras', 'obras', lead);
    if (!ok) return res.status(502).json({ error: 'persist_failed' });
    await appendItemInSharedArray('crm_actividades', {
      id: `act-${Date.parse(nowISO)}`, obraId: lead.id, clienteId: null,
      tipo: 'nota', texto: 'Lead generado desde la web', fecha: nowISO, usuario: 'sistema', adjuntos: [],
    });
    return res.status(201).json({ ok: true, id: lead.id });
  } catch (e) {
    console.error('[public/leads]', e.message);
    return res.status(500).json({ error: 'server_error' });
  }
}
