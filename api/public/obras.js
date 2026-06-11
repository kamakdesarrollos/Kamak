// GET /api/public/obras           → lista de obras publicadas (whitelist sanitizada)
// GET /api/public/obras?slug=xxx  → una obra publicada por slug
// Fuente de verdad: shared_data['obras'] del ERP. Solo se exponen las que tienen
// web.publicar === true. NUNCA viajan costos/márgenes/cliente (ver lib/web/obraPublic).
import { applyCors, loadSharedData } from '../../lib/web/supabaseRest.js';
import { obrasPublicadas } from '../../lib/web/obraPublic.js';

export default async function handler(req, res) {
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
