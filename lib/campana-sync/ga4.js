// Google Analytics 4 (tráfico de la web por campaña) → camp_metricas.
// Enchufable sin clave: sin GA4_PROPERTY_ID + GOOGLE_SA_EMAIL + GOOGLE_SA_KEY
// devuelve {skipped:'sin clave'}. Auth por service account (googleAuth.js).
//
// API: POST analyticsdata.googleapis.com/v1beta/properties/<id>:runReport con
// el día de AYER, dimensiones sessionCampaignName+sessionSource y métricas
// sessions / advertiserAdCost / advertiserAdClicks. El reporte viene por
// campaña×fuente-de-sesión y el unique de camp_metricas es por campaña → acá
// se AGREGA por campaña (suma) guardando el desglose por source en metricas.
//
// Doble fila: cada campaña va como fuente 'ga4'; las que tienen costo > 0
// (Google Ads linkeado a la propiedad) van ADEMÁS como fuente 'gads' — así el
// módulo Campañas tiene la vista de pauta paga sin otra API ni otra clave.

import { diasAtrasISO } from './comun.js';
import { tokenGoogle } from './googleAuth.js';

const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const round2 = (x) => Math.round(x * 100) / 100;

export async function sync() {
  const propertyId = process.env.GA4_PROPERTY_ID;
  const email = process.env.GOOGLE_SA_EMAIL;
  const key = process.env.GOOGLE_SA_KEY;
  if (!propertyId || !email || !key) return { skipped: 'sin clave' };

  const token = await tokenGoogle({ email, key, scope: SCOPE });
  const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dateRanges: [{ startDate: 'yesterday', endDate: 'yesterday' }],
      dimensions: [{ name: 'sessionCampaignName' }, { name: 'sessionSource' }],
      metrics: [{ name: 'sessions' }, { name: 'advertiserAdCost' }, { name: 'advertiserAdClicks' }],
    }),
  });
  if (!r.ok) throw new Error(`GA4 ${r.status} ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();

  // Agrega por campaña. GA4 no da un id de campaña en esta dimensión → el
  // NOMBRE hace de campana_ext_id ('(not set)' / '(direct)' son buckets válidos).
  const porCampana = new Map();
  for (const row of j.rows ?? []) {
    const campana = row.dimensionValues?.[0]?.value ?? '(not set)';
    const source = row.dimensionValues?.[1]?.value ?? '(not set)';
    const [sesiones = 0, costo = 0, clicsPago = 0] = (row.metricValues ?? []).map(v => Number(v?.value) || 0);
    const acc = porCampana.get(campana) ?? { sesiones: 0, costo: 0, clicsPago: 0, porFuente: {} };
    acc.sesiones += sesiones;
    acc.costo += costo;
    acc.clicsPago += clicsPago;
    acc.porFuente[source] = (acc.porFuente[source] || 0) + sesiones;
    porCampana.set(campana, acc);
  }

  const ayer = diasAtrasISO(1);
  const filas = [];
  for (const [campana, m] of porCampana) {
    filas.push({
      fuente: 'ga4',
      campana_ext_id: campana,
      campana_ext_nombre: campana,
      fecha: ayer,
      metricas: { sesiones: m.sesiones, costo: round2(m.costo), clicsPago: m.clicsPago, porFuente: m.porFuente },
    });
    if (m.costo > 0) {
      filas.push({
        fuente: 'gads',
        campana_ext_id: campana,
        campana_ext_nombre: campana,
        fecha: ayer,
        metricas: { costo: round2(m.costo), clics: m.clicsPago, sesiones: m.sesiones },
      });
    }
  }
  return { filas };
}
