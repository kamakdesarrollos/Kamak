// Lee un presupuesto de tercero (PDF/imagen en base64) con Claude y devuelve
// { proveedor, cuit, items: [{ nombre, costo, cantidad, unidad }] }. Reusa la
// ANTHROPIC_API_KEY ya configurada (misma cuenta que el bot). Excel NO pasa por
// acá (se parsea en el cliente). Requiere auth: este endpoint cuesta plata por
// llamada, no puede quedar abierto.
//
// El token de sesión del usuario se valida contra Supabase Auth (mismo patrón que
// api/admin/update-user.js: /auth/v1/user con la service key como apikey).

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY; // para validar el token del usuario

async function usuarioValido(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token || !SUPABASE_URL || !SUPABASE_KEY) return false;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
  });
  return r.ok;
}

const PROMPT = `Sos un extractor de presupuestos de obra. Te paso un presupuesto de un proveedor/subcontratista.
Devolvé SOLO un JSON con esta forma exacta, sin texto adicional:
{"proveedor": "<razón social o nombre, o null>", "cuit": "<cuit o null>", "items": [{"nombre": "<descripción del ítem>", "costo": <número, precio UNITARIO sin símbolos>, "cantidad": <número, 1 si no figura>, "unidad": "<u/m2/ml/gl/etc o 'u'>"}]}
El "costo" es siempre el precio unitario del ítem (si solo hay total de línea, poné cantidad 1 y el total como costo). No inventes ítems que no estén.`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'Servidor sin ANTHROPIC_API_KEY' });
  if (!(await usuarioValido(req))) return res.status(401).json({ error: 'no autorizado' });

  const { fileBase64, mediaType } = req.body || {};
  if (!fileBase64 || !mediaType) return res.status(400).json({ error: 'falta fileBase64/mediaType' });

  const isPdf = mediaType === 'application/pdf';
  const block = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileBase64 } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data: fileBase64 } };

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        messages: [{ role: 'user', content: [block, { type: 'text', text: PROMPT }] }],
      }),
    });
    const j = await r.json();
    if (!r.ok || j.error) {
      console.error('[presupuesto/extraer] anthropic', r.status, JSON.stringify(j).slice(0, 500));
      return res.status(502).json({ error: 'La IA no pudo procesar el archivo' });
    }
    const text = (j.content || []).map(c => c.text || '').join('').trim();
    const jsonStr = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    const data = JSON.parse(jsonStr);
    return res.status(200).json({
      proveedor: data.proveedor || null,
      cuit: data.cuit || null,
      items: Array.isArray(data.items) ? data.items : [],
    });
  } catch (e) {
    console.error('[presupuesto/extraer]', e.message);
    return res.status(500).json({ error: 'No se pudo leer el presupuesto: ' + e.message });
  }
}
