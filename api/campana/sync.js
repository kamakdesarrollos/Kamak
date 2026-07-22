// Sync de métricas de campaña → camp_metricas (Fase 2 del módulo Campañas).
//
// UNA function despacha TODAS las fuentes (límite de funciones del plan Hobby,
// mismo criterio que api/portal/[kind].js): ?src=instantly|meta_ads|ga4|gsc|
// gads|clarity|all (default all; acepta lista separada por coma). Cada fuente
// vive en lib/campana-sync/<fuente>.js y es ENCHUFABLE SIN CLAVES: si su env
// key no está seteada devuelve {skipped:'sin clave'} y el resto sigue — se
// deploya hoy y cada pata se enciende sola cuando se cargue su clave en Vercel.
// 'gads' sale del MISMO reporte GA4 (campañas con costo > 0) → alias de ga4.
//
// El error de UNA fuente NO tumba el resto: se anota en el summary y sigue.
// Responde 200 con {ok, summary: {fuente: {ok,filas} | {skipped} | {error}}}.
//
// Seguridad: exige secret (Authorization: Bearer / x-cron-secret / ?secret=)
// que matchee CRON_SECRET **o** SYNC_SECRET (cualquiera vale: CRON_SECRET lo
// manda Vercel Cron; SYNC_SECRET permite dispararlo desde un scheduler externo
// sin regalar el secret de los crons). Sin match — o sin ningún secret
// configurado — 401: este endpoint escribe en la DB, no queda abierto jamás.
//
// NO está en vercel.json: el plan Hobby ya usa sus 2 crons (ver
// api/vercel-crons.test.js) → se dispara a mano o desde un scheduler externo.

import { upsertMetricas } from '../../lib/campana-sync/comun.js';
import * as instantly from '../../lib/campana-sync/instantly.js';
import * as metaAds from '../../lib/campana-sync/meta_ads.js';
import * as ga4 from '../../lib/campana-sync/ga4.js';
import * as gsc from '../../lib/campana-sync/gsc.js';
import * as clarity from '../../lib/campana-sync/clarity.js';

// Varias APIs externas en serie pueden pasar los 10s default de Hobby.
// 60s = máximo de Hobby (mismo criterio que api/presupuesto/extraer.js).
export const config = { maxDuration: 60 };

const MODULOS = { instantly, meta_ads: metaAds, ga4, gsc, clarity, gads: ga4 };
const TODAS = ['instantly', 'meta_ads', 'ga4', 'gsc', 'clarity']; // sin 'gads': alias de ga4

function autorizado(req) {
  const dado = req.query?.secret
    || req.headers['x-cron-secret']
    || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const { CRON_SECRET, SYNC_SECRET } = process.env;
  return Boolean(dado)
    && ((Boolean(CRON_SECRET) && dado === CRON_SECRET) || (Boolean(SYNC_SECRET) && dado === SYNC_SECRET));
}

export default async function handler(req, res) {
  if (!autorizado(req)) return res.status(401).json({ error: 'unauthorized' });

  const src = String(req.query?.src || 'all');
  const pedidas = src === 'all' ? TODAS : src.split(',').map(s => s.trim()).filter(Boolean);

  const summary = {};
  const corridos = new Map(); // módulo → resultado (ga4 y gads comparten corrida)
  for (const nombre of pedidas) {
    const mod = MODULOS[nombre];
    if (!mod) { summary[nombre] = { error: 'fuente desconocida' }; continue; }
    if (!corridos.has(mod)) {
      let resultado;
      try {
        const r = await mod.sync();
        resultado = r.skipped
          ? { skipped: r.skipped }
          : {
              ok: true,
              filas: await upsertMetricas(r.filas ?? []),
              // Extras informativos que reporte el módulo (ej. instantly:
              // campanas/conAnalytics) — pasan al summary del endpoint.
              ...(r.campanas !== undefined ? { campanas: r.campanas } : {}),
              ...(r.conAnalytics !== undefined ? { conAnalytics: r.conAnalytics } : {}),
            };
      } catch (e) {
        // Aislamiento: la fuente que falla queda anotada y el resto sigue.
        console.error(`[campana/sync] ${nombre}:`, e.message);
        resultado = { error: e.message };
      }
      corridos.set(mod, resultado);
    }
    summary[nombre] = corridos.get(mod);
  }

  console.log('[campana/sync]', JSON.stringify(summary));
  return res.status(200).json({ ok: true, summary });
}
