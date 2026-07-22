// Instantly (cold email) → camp_metricas. Lista de campañas + analytics.
// Enchufable sin clave: sin INSTANTLY_API_KEY devuelve {skipped:'sin clave'}.
//
// API (Bearer en ambas):
// - GET /api/v2/campaigns?limit=100 → {items:[{id,name,status,timestamp_created,…}],
//   next_starting_after} — la lista REAL de campañas, incluso las que nunca se
//   lanzaron (borradores). Cursor: se repite con ?starting_after=<cursor> hasta
//   agotar o tope de 200 campañas (sanity cap).
// - GET /api/v2/campaigns/analytics → array con analytics ACUMULADAS por
//   campaña… pero devuelve [] cuando las campañas nunca se lanzaron (verificado
//   contra la API real). Por eso la fuente de verdad de QUÉ campañas existen es
//   la LISTA y analytics solo enriquece: sin esto, 0 filas y el dueño no ve nada.
//
// Las analytics son acumuladas (no por día) → la fecha del snapshot es HOY:
// la serie diaria sale de comparar snapshots consecutivos.

import { hoyISO } from './comun.js';

const API = 'https://api.instantly.ai/api/v2';
const MAX_CAMPANAS = 200;

// status numérico → texto. Códigos desconocidos quedan como número (jsonb flexible).
const ESTADOS = {
  0: 'borrador',
  1: 'activa',
  2: 'pausada',
  3: 'completada',
  4: 'corriendo subsecuencias',
};

async function getJSON(url, apiKey) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!r.ok) throw new Error(`Instantly ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

// Lista completa de campañas paginando por cursor (next_starting_after →
// ?starting_after=). Corta si no hay cursor, si la página vino vacía o al cap.
async function listarCampanas(apiKey) {
  const items = [];
  let cursor = null;
  do {
    const qs = new URLSearchParams({ limit: '100' });
    if (cursor) qs.set('starting_after', cursor);
    const j = await getJSON(`${API}/campaigns?${qs}`, apiKey);
    const pagina = Array.isArray(j?.items) ? j.items : [];
    items.push(...pagina);
    cursor = pagina.length > 0 ? (j?.next_starting_after ?? null) : null;
  } while (cursor && items.length < MAX_CAMPANAS);
  return items.slice(0, MAX_CAMPANAS);
}

// Analytics de una campaña → claves core traducidas + TODO lo demás que
// devuelva la API tal cual (jsonb flexible: campos nuevos entran solos).
function metricasDeAnalytics(a) {
  const { emails_sent_count, open_count, reply_count, bounced_count, ...resto } = a;
  delete resto.campaign_id;   // identidad de la fila, no métricas
  delete resto.campaign_name;
  return {
    enviados: emails_sent_count ?? 0,
    abiertos: open_count ?? 0,
    respondieron: reply_count ?? 0,
    bounces: bounced_count ?? 0,
    ...resto,
  };
}

export async function sync() {
  const apiKey = process.env.INSTANTLY_API_KEY;
  if (!apiKey) return { skipped: 'sin clave' };

  const lista = await listarCampanas(apiKey);
  const dataAnalytics = await getJSON(`${API}/campaigns/analytics`, apiKey);
  const analytics = Array.isArray(dataAnalytics) ? dataAnalytics : [];

  // Analytics indexadas por id de campaña (en analytics la key es campaign_id;
  // id como resguardo por si la API cambia).
  const porId = new Map();
  for (const a of analytics) {
    const id = a?.campaign_id ?? a?.id;
    if (id != null) porId.set(String(id), a);
  }

  const fecha = hoyISO();
  const filas = [];
  let conAnalytics = 0;

  // UNA fila por campaña de la LISTA — con o sin analytics: los borradores
  // nunca lanzados también tienen que verse en el ERP.
  for (const c of lista) {
    const id = c?.id != null ? String(c.id) : null;
    const a = id != null ? porId.get(id) : undefined;
    if (a) { conAnalytics += 1; porId.delete(id); }
    filas.push({
      fuente: 'instantly',
      campana_ext_id: id,
      campana_ext_nombre: c?.name ?? null,
      fecha,
      metricas: {
        estado: ESTADOS[c?.status] ?? c?.status ?? null,
        creada: c?.timestamp_created ?? null,
        ...(a ? metricasDeAnalytics(a) : {}),
      },
    });
  }

  // Edge raro: campañas con analytics que no vinieron en la lista → fila igual
  // (como antes, sin estado/creada porque no hay datos de lista).
  for (const a of porId.values()) {
    conAnalytics += 1;
    const id = a.campaign_id ?? a.id;
    filas.push({
      fuente: 'instantly',
      campana_ext_id: id != null ? String(id) : null,
      campana_ext_nombre: a.campaign_name ?? null,
      fecha,
      metricas: metricasDeAnalytics(a),
    });
  }

  return { ok: true, filas, campanas: lista.length, conAnalytics };
}
