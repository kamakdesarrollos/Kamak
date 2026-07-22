// Meta Ads (Facebook/Instagram, campañas click-to-WhatsApp) → camp_metricas.
// Enchufable sin clave: sin META_SYSTEM_TOKEN + META_AD_ACCOUNT_ID → skipped.
//
// API: GET graph.facebook.com/v21.0/act_<id>/insights?level=campaign&
// date_preset=yesterday → una fila por campaña con las métricas de AYER
// (fecha de la fila = date_start del insight). OJO: Graph devuelve los números
// COMO STRING ("15423.87") → parseFloat/parseInt acá. Las conversaciones de
// WhatsApp iniciadas vienen dentro de `actions` con action_type
// 'onsite_conversion.messaging_conversation_started_7d'.

import { clampFechaISO, diasAtrasISO } from './comun.js';

const ACTION_CONVERSACION = 'onsite_conversion.messaging_conversation_started_7d';

export async function sync() {
  const token = process.env.META_SYSTEM_TOKEN;      // system user token (no expira)
  const cuenta = process.env.META_AD_ACCOUNT_ID;    // con o sin prefijo act_
  if (!token || !cuenta) return { skipped: 'sin clave' };

  const act = `act_${String(cuenta).replace(/^act_/, '')}`;
  const qs = new URLSearchParams({
    level: 'campaign',
    fields: 'campaign_id,campaign_name,spend,impressions,clicks,actions',
    date_preset: 'yesterday',
  });
  // El token va por header (no en la URL: las URLs quedan en logs).
  const r = await fetch(`https://graph.facebook.com/v21.0/${act}/insights?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`Meta Ads ${r.status} ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();

  const ayer = diasAtrasISO(1);
  const filas = (Array.isArray(j.data) ? j.data : []).map((c) => ({
    fuente: 'meta_ads',
    campana_ext_id: c.campaign_id != null ? String(c.campaign_id) : null,
    campana_ext_nombre: c.campaign_name ?? null,
    fecha: clampFechaISO(c.date_start, ayer),
    metricas: {
      gasto: parseFloat(c.spend) || 0,
      impresiones: parseInt(c.impressions, 10) || 0,
      clics: parseInt(c.clicks, 10) || 0,
      conversaciones: Number((c.actions ?? []).find(a => a.action_type === ACTION_CONVERSACION)?.value) || 0,
    },
  }));
  return { filas };
}
