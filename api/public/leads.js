// POST /api/public/leads → crea un lead en el embudo Comercial del ERP.
// El form de contacto de la web pega acá. Persiste atómico vía RPC (mismo append
// que usa el cliente) con venta.origen='web' → cae en la columna Prospecto del Kanban.
// Anti-spam: honeypot (_gotcha) + rate-limit best-effort por IP. CORS lockeado.
import { applyCors, appendObjectItem, appendItemInSharedArray } from '../../lib/web/supabaseRest.js';
import { validateLead, leadFromBody } from '../../lib/web/obraPublic.js';

const hits = new Map();
function rateLimited(ip) {
  const now = Date.now(), win = 60_000, max = 5;
  const arr = (hits.get(ip) || []).filter(t => now - t < win);
  arr.push(now); hits.set(ip, arr);
  return arr.length > max;
}

export default async function handler(req, res) {
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
      if (v.errors.includes('honeypot')) return res.status(200).json({ ok: true }); // al bot se le finge éxito
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
