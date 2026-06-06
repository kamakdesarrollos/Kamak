const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const corsOk = /^https:\/\/([a-z0-9-]+\.)?kamak\.com\.ar$/.test(origin);
  res.setHeader('Access-Control-Allow-Origin', corsOk ? origin : 'https://kamak.com.ar');
  res.setHeader('Vary', 'Origin');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token requerido' });

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/shared_data?key=eq.portal_tokens&select=data`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
    });
    const rows = await r.json();
    const tokens = rows[0]?.data;
    if (!tokens) return res.status(404).json({ error: 'invalid' });

    const entry = tokens[token];
    if (!entry) return res.status(404).json({ error: 'invalid' });
    if (entry.expires && new Date(entry.expires) < new Date()) return res.status(410).json({ error: 'expired' });

    return res.status(200).json({ obraId: entry.obraId });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
