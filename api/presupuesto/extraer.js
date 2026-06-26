// Lee un presupuesto de tercero (PDF/imagen en base64) con Claude y devuelve
// { proveedor, cuit, items: [{ nombre, costo, cantidad, unidad }] }. Reusa la
// ANTHROPIC_API_KEY ya configurada (misma cuenta que el bot). Excel NO pasa por
// acá (se parsea en el cliente). Requiere auth + permiso: este endpoint cuesta
// plata por llamada, no puede quedar abierto.
//
// El token de sesión del usuario se valida contra Supabase Auth y, además, se
// confirma que tenga permiso de cargar presupuestos (rol Admin o permiso
// editarPresu) — mismo patrón que api/admin/update-user.js.

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY; // valida el token + lee app_users

// La llamada a Claude con un PDF (sin streaming) puede tardar más de los 10s que
// da Vercel Hobby por defecto y cortaría la request. 60s = máximo de Hobby (#3).
export const config = { maxDuration: 60 };

// Tope de payload alineado al límite real de body de una Vercel Function (~4.5MB):
// más arriba la plataforma corta con un 413 genérico antes de llegar acá. Acotamos
// un poco por debajo para devolver un mensaje claro (#7). base64 ≈ 4/3 del binario,
// así que esto admite archivos de ~3MB (suficiente para un presupuesto típico).
const MAX_BASE64_LEN = 4_300_000;
const MEDIA_OK = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

// Valida el JWT del que llama y confirma que tiene permiso para cargar
// presupuestos: rol Admin o permiso editarPresu (mismo criterio que la UI en
// ObraPresupuesto). Sin esto, cualquier usuario autenticado —incluido el portal
// del cliente— podría gastar Claude (#8).
async function usuarioAutorizado(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token || !SUPABASE_URL || !SUPABASE_KEY) return false;
  const ures = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!ures.ok) return false;
  const email = ((await ures.json())?.email || '').toLowerCase();
  if (!email) return false;
  const ar = await fetch(`${SUPABASE_URL}/rest/v1/app_users?select=email,rol,permisos`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!ar.ok) return false;
  const users = await ar.json();
  const u = (Array.isArray(users) ? users : []).find(x => (x.email || '').toLowerCase() === email);
  return !!u && (u.rol === 'Admin' || u.permisos?.editarPresu === true);
}

const PROMPT = `Sos un extractor de presupuestos de obra. Te paso un presupuesto de un proveedor/subcontratista.
Devolvé SOLO un JSON con esta forma exacta, sin texto adicional:
{"proveedor": {"razonSocial": "<nombre/razón social o null>", "cuit": "<cuit o null>", "domicilio": "<dirección completa o null>", "telefono": "<o null>", "email": "<o null>", "condicionIVA": "<Responsable Inscripto/Monotributo/Exento o null>", "rubro": "<rubro o especialidad del proveedor inferida del presupuesto, o null>"}, "moneda": "<'USD' si los importes están en dólares, 'ARS' si están en pesos, o null si no está claro>", "items": [{"nombre": "<descripción del ítem>", "costo": <número, precio UNITARIO sin símbolos>, "cantidad": <número, 1 si no figura>, "unidad": "<u/m2/ml/gl/etc o 'u'>"}]}
El "costo" es siempre el precio unitario del ítem (si solo hay total de línea, poné cantidad 1 y el total como costo). No inventes datos que no estén: si un dato del proveedor no figura, poné null.
Para "moneda": fijate tanto en los SÍMBOLOS (U$S / US$ / USD / "dólares" = USD; "$" / "pesos" / ARS = ARS) como en NOTAS o aclaraciones del texto (ej. "los valores están expresados en dólares", "presupuesto en pesos"). El "$" solo, sin más contexto, en Argentina suele ser pesos. Si no podés determinarlo con razonable seguridad, poné null.`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'Servidor sin ANTHROPIC_API_KEY' });
  if (!(await usuarioAutorizado(req))) return res.status(403).json({ error: 'no autorizado' });

  const { fileBase64, mediaType } = req.body || {};
  if (!fileBase64 || !mediaType) return res.status(400).json({ error: 'falta fileBase64/mediaType' });
  if (!MEDIA_OK.has(mediaType)) return res.status(415).json({ error: 'tipo de archivo no soportado (PDF o imagen)' });
  if (typeof fileBase64 !== 'string' || fileBase64.length > MAX_BASE64_LEN) {
    return res.status(413).json({ error: 'el archivo es demasiado grande (máx ~3MB); comprimilo o subí menos páginas' });
  }

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
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end < 0) return res.status(422).json({ error: 'No se reconoció un presupuesto en el archivo' });
    const data = JSON.parse(text.slice(start, end + 1));
    const prov = data.proveedor || {};
    return res.status(200).json({
      proveedor: {
        razonSocial: prov.razonSocial || null,
        cuit: prov.cuit || null,
        domicilio: prov.domicilio || null,
        telefono: prov.telefono || null,
        email: prov.email || null,
        condicionIVA: prov.condicionIVA || null,
        rubro: prov.rubro || null,
      },
      moneda: data.moneda === 'USD' || data.moneda === 'ARS' ? data.moneda : null,
      items: Array.isArray(data.items) ? data.items : [],
    });
  } catch (e) {
    // No filtrar e.message al cliente: puede traer detalle interno. Se loguea acá.
    console.error('[presupuesto/extraer]', e.message);
    return res.status(500).json({ error: 'No se pudo leer el presupuesto' });
  }
}
