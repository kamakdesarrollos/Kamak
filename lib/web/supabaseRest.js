// Acceso REST a Supabase con SERVICE_KEY (server-side, bypasa RLS) + helper CORS.
// Mismo patrón que api/portal/data.js. Lo importan los endpoints api/public/*.
// NO se usa nunca desde el cliente (la SERVICE_KEY jamás va al bundle).

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const sbHeaders = () => ({
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export async function loadSharedData(key) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/shared_data?key=eq.${key}&select=data`, { headers: sbHeaders() });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows[0]?.data ?? null;
}

// Append atómico vía la misma RPC que usa el cliente (dbHelpers.appendObjectItem).
export async function appendObjectItem(key, collection, item) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/append_shared_object_item`, {
    method: 'POST', headers: sbHeaders(),
    body: JSON.stringify({ p_key: key, p_collection: collection, p_item: item }),
  });
  return r.ok;
}

export async function appendItemInSharedArray(key, item) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/append_item_in_shared_array`, {
    method: 'POST', headers: sbHeaders(),
    body: JSON.stringify({ p_key: key, p_item: item }),
  });
  return r.ok;
}

// CORS: dominios kamak.com.ar + el origen del sitio público (env PUBLIC_SITE_ORIGIN,
// coma-separado) + github.io/vercel.app (deploy del sitio mientras no haya dominio
// propio). Nunca '*'. Devuelve true si el origin está permitido.
// TODO(seguridad): cuando el sitio tenga dominio estable, quitar el wildcard
// github.io|vercel.app y fijar el host exacto vía PUBLIC_SITE_ORIGIN.
export function applyCors(req, res) {
  const origin = req.headers.origin || '';
  const extra = (process.env.PUBLIC_SITE_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
  const ok = /^https:\/\/([a-z0-9-]+\.)?kamak\.com\.ar$/.test(origin)
    || extra.includes(origin)
    || /^https:\/\/([a-z0-9-]+\.)?(github\.io|vercel\.app)$/.test(origin);
  res.setHeader('Access-Control-Allow-Origin', ok ? origin : 'https://kamak.com.ar');
  res.setHeader('Vary', 'Origin');
  return ok;
}
