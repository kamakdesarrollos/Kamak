// Emisión electrónica AFIP (WSFEv1 · FECAESolicitar).
//
// El front (src/pages/Facturacion.jsx) arma el payload con feCaeSolicitarPayload()
// y POSTea { comprobante, payload } acá. Este endpoint:
//   1. Obtiene el Ticket de Acceso de WSAA (token+sign), CACHEADO en shared_data
//      (~12hs). AFIP rechaza pedir un 2° TA mientras hay uno vigente → el cache es
//      clave; además evita firmar en cada factura.
//   2. FECompUltimoAutorizado(PtoVta, CbteTipo) → asigna CbteDesde = último + 1
//      (el número correlativo lo manda AFIP, NUNCA el cliente).
//   3. FECAESolicitar(payload) → CAE + vencimiento.
//
// La firma CMS se hace acá mismo con node-forge (ver lib/afip/wsaa.js): los datos
// NO pasan por ningún tercero. Endpoints homologación/producción según AFIP_ENV.
// Ver docs/WSFE-SETUP.md.

import { loginWSAA } from '../../lib/afip/wsaa.js';
import { feCompUltimoAutorizado, feCAESolicitar } from '../../lib/afip/wsfe-client.js';
import { requireAdmin } from '../../lib/auth/requireAdmin.js';

const AFIP_CUIT = process.env.AFIP_CUIT;
const AFIP_CERT = process.env.AFIP_CERT;   // certificado .crt (PEM; admite base64 o \n escapados)
const AFIP_KEY  = process.env.AFIP_KEY;    // clave privada .key (PEM)
const AFIP_ENV  = process.env.AFIP_ENV || 'homologacion';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TA_KEY = 'afip_ta_' + AFIP_ENV;      // cache del TA, separado por entorno

const sbH = () => ({ apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' });

async function taCacheGet() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/shared_data?key=eq.${TA_KEY}&select=data`, { headers: sbH() });
    const rows = await r.json();
    return Array.isArray(rows) && rows[0] ? rows[0].data : null;
  } catch { return null; }
}
async function taCacheSet(ta) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/shared_data`, {
      method: 'POST',
      headers: { ...sbH(), Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ key: TA_KEY, data: ta }),
    });
  } catch { /* best-effort: si falla el cache, igual emitimos */ }
}

// Devuelve un TA vigente: del cache si quedan >5min, sino pide uno nuevo y lo cachea.
async function getTA() {
  const cached = await taCacheGet();
  if (cached?.token && cached?.expirationTime && new Date(cached.expirationTime).getTime() > Date.now() + 5 * 60000) {
    return cached;
  }
  try {
    const ta = await loginWSAA({ certPem: AFIP_CERT, keyPem: AFIP_KEY, service: 'wsfe', env: AFIP_ENV });
    await taCacheSet(ta);
    return ta;
  } catch (e) {
    // Carrera: otra instancia pudo haber pedido el TA recién (AFIP rechaza el 2°).
    // Releemos el cache una vez antes de rendirnos.
    if (/ya posee.*TA|valid|vigente/i.test(e.message || '')) {
      const again = await taCacheGet();
      if (again?.token) return again;
    }
    throw e;
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      configurado: !!(AFIP_CUIT && AFIP_CERT && AFIP_KEY),
      env: AFIP_ENV,
      cuit: AFIP_CUIT || null,
      faltan: [!AFIP_CUIT && 'AFIP_CUIT', !AFIP_CERT && 'AFIP_CERT', !AFIP_KEY && 'AFIP_KEY'].filter(Boolean),
    });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Autorización: SOLO un Admin autenticado puede emitir. El gate `isAdmin` del front
  // es cosmético; sin esta verificación server-side el endpoint quedaría abierto y
  // cualquiera con la URL podría emitir facturas fiscales reales con el CUIT del emisor.
  const admin = await requireAdmin(req, res, { supabaseUrl: SUPABASE_URL, serviceKey: SUPABASE_KEY });
  if (!admin) return; // requireAdmin ya respondió 401/403.

  if (!AFIP_CUIT || !AFIP_CERT || !AFIP_KEY) {
    return res.status(501).json({
      error: 'AFIP no configurado',
      detalle: 'Faltan variables de entorno en Vercel (AFIP_CUIT / AFIP_CERT / AFIP_KEY). Ver docs/WSFE-SETUP.md.',
      faltan: [!AFIP_CUIT && 'AFIP_CUIT', !AFIP_CERT && 'AFIP_CERT', !AFIP_KEY && 'AFIP_KEY'].filter(Boolean),
    });
  }

  // Body: { comprobante, payload }. Vercel parsea JSON; toleramos string por las dudas.
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const payload = body?.payload;
  const cab = payload?.FeCabReq;
  const det = payload?.FeDetReq?.[0];
  if (!cab || !det) return res.status(400).json({ error: 'Payload inválido', detalle: 'Falta FeCabReq / FeDetReq.' });

  try {
    const ta = await getTA();
    const auth = { token: ta.token, sign: ta.sign, cuit: AFIP_CUIT };

    // Número correlativo: lo asigna AFIP (último autorizado + 1), nunca el cliente.
    const ultimo = await feCompUltimoAutorizado(AFIP_ENV, auth, { ptoVta: cab.PtoVta, cbteTipo: cab.CbteTipo });
    const numero = ultimo.nro + 1;
    payload.FeDetReq[0].CbteDesde = numero;
    payload.FeDetReq[0].CbteHasta = numero;

    const r = await feCAESolicitar(AFIP_ENV, auth, payload);

    if (r.resultado === 'A' && r.cae) {
      return res.status(200).json({
        ok: true,
        cae: r.cae, caeVto: r.caeVto,
        numero, puntoVenta: cab.PtoVta, cbteTipo: cab.CbteTipo,
        env: AFIP_ENV,
        obs: r.obs?.length ? r.obs : undefined,
      });
    }

    // Rechazado (R) o parcial (P): devolvemos las observaciones/errores de AFIP.
    return res.status(422).json({
      ok: false,
      error: 'AFIP no aprobó el comprobante',
      resultado: r.resultado || null,
      detalle: [...(r.errs || []), ...(r.obs || [])].map(x => `[${x.code}] ${x.msg}`).join(' · ') || 'sin detalle',
      obs: r.obs, errs: r.errs,
    });
  } catch (e) {
    return res.status(502).json({ error: 'Error comunicándose con AFIP', detalle: e.message });
  }
}
