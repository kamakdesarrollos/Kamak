const META_TOKEN      = process.env.META_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;
const SUPABASE_URL    = process.env.SUPABASE_URL;
const SUPABASE_KEY    = process.env.SUPABASE_SERVICE_KEY;

const sbH = () => ({
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

async function loadSharedData(key) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/shared_data?key=eq.${key}&select=data`, { headers: sbH() });
  const rows = await res.json();
  return rows[0]?.data ?? null;
}

async function saveSharedData(key, value) {
  await fetch(`${SUPABASE_URL}/rest/v1/shared_data`, {
    method: 'POST',
    headers: { ...sbH(), 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ key, data: value, updated_at: new Date().toISOString() }),
  });
  await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SUPABASE_KEY}`, 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ topic: 'kamak-data-sync', event: 'changed', payload: { key } }] }),
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token, waPhone, text, obraId, obraNombre, cliente, phone, expires } = req.body;
  if (!token || !waPhone || !text) return res.status(400).json({ error: 'Faltan parámetros' });

  // Always save token first so the link works even if WA send fails
  const tokens = (await loadSharedData('portal_tokens')) || {};
  tokens[token] = { obraId, obraNombre, cliente, phone, expires, createdAt: new Date().toISOString() };
  await saveSharedData('portal_tokens', tokens);

  try {
    const r = await fetch(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${META_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: waPhone, type: 'text', text: { body: text } }),
    });

    const data = await r.json();

    if (!r.ok || data.error) {
      const errCode = data.error?.code;
      const errMsg = data.error?.message || data.error?.error_data?.details || `Error ${r.status}`;
      // 131047 = re-engagement: contact hasn't messaged in 24h, need manual send
      const reengagement = errCode === 131047;
      return res.status(200).json({ error: errMsg, reengagement, tokenSaved: true });
    }

    const wamid = data.messages?.[0]?.id;
    if (wamid) {
      tokens[token].wamid = wamid;
      await saveSharedData('portal_tokens', tokens);
    }

    return res.status(200).json({ ok: true, wamid });
  } catch (e) {
    return res.status(200).json({ error: e.message, tokenSaved: true });
  }
}
