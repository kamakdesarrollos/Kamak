// Genera un OTP para firmar el contrato y lo manda por WhatsApp. El OTP se guarda
// HASHEADO (scrypt+salt) en shared_data['portal_otp_codes'] (server-only, sin RLS
// para el browser). Mismo gate que data.js: CORS kamak + token mágico válido.
import crypto from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const sbH = () => ({ apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' });

async function loadSharedData(key) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/shared_data?key=eq.${key}&select=data`, { headers: sbH() });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows[0]?.data ?? null;
}
async function saveSharedData(key, data) {
  // upsert simple (portal_otp_codes es un objeto pequeño; sin contención real).
  await fetch(`${SUPABASE_URL}/rest/v1/shared_data?on_conflict=key`, {
    method: 'POST',
    headers: { ...sbH(), Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ key, data }),
  });
}
const hashOtp = (otp, salt) => crypto.scryptSync(otp, salt, 32).toString('hex');

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const corsOk = /^https:\/\/([a-z0-9-]+\.)?kamak\.com\.ar$/.test(origin);
  res.setHeader('Access-Control-Allow-Origin', corsOk ? origin : 'https://kamak.com.ar');
  res.setHeader('Vary', 'Origin');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });

  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: 'token' });

    const tokens = await loadSharedData('portal_tokens');
    const entry = tokens?.[token];
    if (!entry) return res.status(404).json({ error: 'invalid' });
    if (entry.expires && new Date(entry.expires) < new Date()) return res.status(410).json({ error: 'expired' });

    const obraId = entry.obraId;
    // OTP de 6 dígitos.
    const otp = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const salt = crypto.randomBytes(16).toString('hex');
    const otpId = `otp-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    const codes = (await loadSharedData('portal_otp_codes')) || {};
    // Limpieza: descartar los expirados de ese token.
    const now = Date.now();
    for (const k of Object.keys(codes)) { if (codes[k].expiresAt && new Date(codes[k].expiresAt).getTime() < now) delete codes[k]; }
    codes[otpId] = {
      hashOTP: hashOtp(otp, salt), salt, obraId, token,
      canal: 'whatsapp', expiresAt: new Date(now + 10 * 60 * 1000).toISOString(),
      intentos: 0, maxIntentos: 3, verificadoAt: null, usado: false,
    };
    await saveSharedData('portal_otp_codes', codes);

    // Enviar por WhatsApp (plantilla Meta 'otp_firma'). entry.phone debe existir.
    let enviado = false;
    try {
      if (entry.phone) {
        const r = await fetch(`https://graph.facebook.com/v18.0/${process.env.META_PHONE_NUMBER_ID}/messages`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messaging_product: 'whatsapp', to: entry.phone, type: 'template',
            template: { name: 'otp_firma', language: { code: 'es_AR' }, components: [{ type: 'body', parameters: [{ type: 'text', text: otp }] }] },
          }),
        });
        enviado = r.ok;
        if (!r.ok) console.error('[solicitar-otp] Meta error', await r.text());
      }
    } catch (e) { console.error('[solicitar-otp] envío falló', e.message); }

    // No revelamos el OTP. Si no se pudo enviar, igual devolvemos otpId (el cliente
    // verá el aviso); el front muestra "no pudimos enviar el código" si enviado=false.
    return res.status(200).json({ otpId, enviado, canal: 'whatsapp', expiraEnSeg: 600 });
  } catch (e) {
    console.error('[solicitar-otp] error', e.message);
    return res.status(500).json({ error: e.message });
  }
}
