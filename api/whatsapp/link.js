// Vinculación de usuarios internos (empleados) con el bot de WhatsApp.
//
// El navegador NO puede leer la tabla whatsapp_verifications (está protegida
// con RLS), así que la lectura y la confirmación se hacen acá, server-side,
// con la SERVICE_KEY de Supabase — igual que api/portal/data.js.
//
// GET  ?email=<email>
//      → { pending: { phone } | null }  ·  verificación vigente para ese email.
// POST { action: 'confirm' | 'reject', email, user_id, user_name, user_rol }
//      confirm → crea el link en whatsapp_users + borra las verificaciones del número.
//      reject  → borra las verificaciones vigentes de ese email.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const sbH = () => ({
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

async function sbGet(table, params = '') {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, { headers: sbH() });
  if (!r.ok) throw new Error(`GET ${table} ${r.status}`);
  return r.json();
}

async function sbDelete(table, params) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, { method: 'DELETE', headers: sbH() });
}

async function sbUpsert(table, data) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...sbH(), 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify(data),
  });
}

// Busca la verificación vigente más nueva para un email (case-insensitive).
async function verificacionVigente(email) {
  const nowIso = new Date().toISOString();
  const rows = await sbGet(
    'whatsapp_verifications',
    `?user_email=ilike.${encodeURIComponent(email)}&expires_at=gt.${encodeURIComponent(nowIso)}&order=expires_at.desc&limit=1&select=phone,user_email,expires_at`
  );
  return rows[0] || null;
}

export default async function handler(req, res) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'config' });

  try {
    if (req.method === 'GET') {
      const email = (req.query.email || '').trim();
      if (!email) return res.status(400).json({ error: 'email requerido' });
      const v = await verificacionVigente(email);
      return res.status(200).json({ pending: v ? { phone: v.phone } : null });
    }

    if (req.method === 'POST') {
      const { action, email, user_id, user_name, user_rol } = req.body || {};
      const mail = (email || '').trim();

      if (action === 'reject') {
        if (mail) await sbDelete('whatsapp_verifications', `?user_email=ilike.${encodeURIComponent(mail)}`);
        return res.status(200).json({ ok: true });
      }

      if (action === 'confirm') {
        if (!mail || !user_id) return res.status(400).json({ error: 'datos incompletos' });
        // El phone lo tomamos de la verificación (no se confía en el cliente).
        const v = await verificacionVigente(mail);
        if (!v) return res.status(404).json({ error: 'sin_verificacion' });
        await sbUpsert('whatsapp_users', {
          phone: v.phone,
          user_id,
          user_name: user_name || '',
          user_rol: user_rol || '',
          linked_at: new Date().toISOString(),
        });
        // Limpiar todas las verificaciones de ese número.
        await sbDelete('whatsapp_verifications', `?phone=eq.${encodeURIComponent(v.phone)}`);
        return res.status(200).json({ ok: true, phone: v.phone });
      }

      return res.status(400).json({ error: 'action inválida' });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    console.error('[whatsapp/link] error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
