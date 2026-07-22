// Instantly (cold email) → camp_metricas. Analytics agregadas por campaña.
// Enchufable sin clave: sin INSTANTLY_API_KEY devuelve {skipped:'sin clave'}.
//
// API: GET https://api.instantly.ai/api/v2/campaigns/analytics (Bearer) —
// devuelve un array con las analytics ACUMULADAS de cada campaña (no por día),
// por eso la fecha del snapshot es HOY: la serie diaria sale de comparar
// snapshots consecutivos.

import { hoyISO } from './comun.js';

export async function sync() {
  const apiKey = process.env.INSTANTLY_API_KEY;
  if (!apiKey) return { skipped: 'sin clave' };

  const r = await fetch('https://api.instantly.ai/api/v2/campaigns/analytics', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!r.ok) throw new Error(`Instantly ${r.status} ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  const campanas = Array.isArray(data) ? data : [];

  const fecha = hoyISO();
  const filas = campanas.map((c) => {
    // Claves core traducidas + TODO lo demás que devuelva la API tal cual
    // (jsonb flexible: campos nuevos de Instantly entran solos).
    const { campaign_id, campaign_name, emails_sent_count, open_count, reply_count, bounced_count, ...resto } = c;
    return {
      fuente: 'instantly',
      campana_ext_id: campaign_id != null ? String(campaign_id) : null,
      campana_ext_nombre: campaign_name ?? null,
      fecha,
      metricas: {
        enviados: emails_sent_count ?? 0,
        abiertos: open_count ?? 0,
        respondieron: reply_count ?? 0,
        bounces: bounced_count ?? 0,
        ...resto,
      },
    };
  });
  return { filas };
}
