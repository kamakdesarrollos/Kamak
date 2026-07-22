// Google Search Console (búsqueda orgánica del sitio) → camp_metricas.
// Enchufable sin clave: sin GSC_SITE_URL + GOOGLE_SA_EMAIL + GOOGLE_SA_KEY
// devuelve {skipped:'sin clave'}. Misma service account que GA4, otro scope.
//
// API: POST webmasters/v3/sites/<site>/searchAnalytics/query. GSC publica los
// datos con ~2-3 días de retraso → se pide el día de HACE 3 DÍAS (dimensión
// date) y la fila lleva ESA fecha. Sin noción de campaña → fila global
// (campana_ext_id null → '' en el upsert) con {clicks, impressions, ctr,
// position}. Si GSC todavía no publicó ese día, rows viene vacío → 0 filas
// (ok, se completa en una corrida futura porque el upsert es idempotente).

import { clampFechaISO, diasAtrasISO } from './comun.js';
import { tokenGoogle } from './googleAuth.js';

const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const LAG_DIAS = 3;

export async function sync() {
  const site = process.env.GSC_SITE_URL;    // 'sc-domain:kamak.com.ar' o URL completa
  const email = process.env.GOOGLE_SA_EMAIL;
  const key = process.env.GOOGLE_SA_KEY;
  if (!site || !email || !key) return { skipped: 'sin clave' };

  const token = await tokenGoogle({ email, key, scope: SCOPE });
  const dia = diasAtrasISO(LAG_DIAS);
  const r = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ startDate: dia, endDate: dia, dimensions: ['date'] }),
  });
  if (!r.ok) throw new Error(`Search Console ${r.status} ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();

  const filas = (Array.isArray(j.rows) ? j.rows : []).map((row) => ({
    fuente: 'gsc',
    campana_ext_id: null,            // métricas globales de la fuente
    campana_ext_nombre: null,
    fecha: clampFechaISO(row.keys?.[0], dia),
    metricas: {
      clicks: row.clicks ?? 0,
      impressions: row.impressions ?? 0,
      ctr: row.ctr ?? 0,
      position: row.position ?? 0,
    },
  }));
  return { filas };
}
