// Microsoft Clarity (comportamiento en la web pública) → camp_metricas.
// Enchufable sin clave: sin CLARITY_TOKEN devuelve {skipped:'sin clave'}.
//
// API: GET clarity.ms/export-data/api/v1/project-live-insights?numOfDays=1
// (Bearer, token de API del proyecto). Devuelve las métricas del SITIO entero
// del último día (array de {metricName, information[]}): no hay noción de
// campaña → UNA fila global (campana_ext_id null → '' en el upsert) con las
// métricas crudas tal como vienen. Límite de Clarity: 10 requests/día por
// proyecto — con el sync 1x/día sobra.

import { hoyISO } from './comun.js';

export async function sync() {
  const token = process.env.CLARITY_TOKEN;
  if (!token) return { skipped: 'sin clave' };

  const r = await fetch('https://www.clarity.ms/export-data/api/v1/project-live-insights?numOfDays=1', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`Clarity ${r.status} ${(await r.text()).slice(0, 200)}`);
  const cruda = await r.json();

  return {
    filas: [{
      fuente: 'clarity',
      campana_ext_id: null,          // métricas globales de la fuente
      campana_ext_nombre: null,
      fecha: hoyISO(),
      // jsonb de la tabla espera objeto: la API devuelve array → se envuelve.
      metricas: Array.isArray(cruda) ? { insights: cruda } : cruda,
    }],
  };
}
