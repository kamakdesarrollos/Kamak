// Helper de notificaciones SERVER-SIDE — lo usan webhook.js, jobs.js y
// portal/firmar.js. Crea una notificación desde el servidor: resuelve
// destinatarios por rol/userIds, escribe el feed (si el tipo NO es legacy) y
// manda push web. Best-effort: NUNCA rompe el flujo que lo invoca.
//
// NO es una function de Vercel (prefijo `_`, igual que _extractors.js).
// Reutiliza el catálogo y los helpers PUROS del cliente como fuente única —
// Vercel bundlea imports de src/ en las functions (igual que firmar.js importa
// src/lib/contrato.js).
import webpush from 'web-push';
import { EVENTOS, resolverDestinatarios, TIPOS_LEGACY } from '../../src/lib/notificaciones.js';

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:fgeespinoza@gmail.com';
if (VAPID_PUBLIC && VAPID_PRIVATE) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

const sbH = () => ({ apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' });

async function sbGet(table, query = '') {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, { headers: sbH() });
    if (!r.ok) return [];
    return r.json();
  } catch (e) { console.error('[notif] sbGet', table, e.message); return []; }
}
async function loadSharedData(key) {
  const rows = await sbGet('shared_data', `?key=eq.${key}&select=data`);
  return rows[0]?.data ?? null;
}
async function saveSharedData(key, data) {
  await fetch(`${SUPABASE_URL}/rest/v1/shared_data?on_conflict=key`, {
    method: 'POST', headers: { ...sbH(), Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ key, data }),
  });
}

// id resistente a colisiones (sin importar src/lib/id).
const newId = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// Agrega la notif al feed 'notificaciones' atómicamente (espejo del cliente:
// RPC append_item_in_shared_array; si falla, read-modify-write con prepend).
async function appendNotif(notif) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/append_item_in_shared_array`, {
      method: 'POST', headers: sbH(), body: JSON.stringify({ p_key: 'notificaciones', p_item: notif }),
    });
    if (!r.ok) throw new Error(`rpc ${r.status}`);
  } catch (e) {
    console.error('[notif] appendNotif fallback RMW:', e.message);
    const data = await loadSharedData('notificaciones');
    const arr = Array.isArray(data) ? data : [];
    await saveSharedData('notificaciones', [notif, ...arr]);
  }
}

// Manda push web a todos los devices de los userIds. Limpia subs muertas (404/410)
// por endpoint; loguea fallos no-404/410 (ej. 403 por VAPID desalineada). Devuelve
// conteo { enviados, muertas, fallidos }.
export async function enviarPushAUsuarios(userIds, { titulo, cuerpo, link } = {}) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) { console.warn('[notif] VAPID no configurado'); return { enviados: 0, muertas: 0, fallidos: 0 }; }
  if (!Array.isArray(userIds) || !userIds.length || !titulo) return { enviados: 0, muertas: 0, fallidos: 0 };
  const subs = (await loadSharedData('push_subscriptions')) || [];
  const objetivo = subs.filter(s => userIds.includes(s.userId));
  const payload = JSON.stringify({ titulo, cuerpo: cuerpo || '', link: link || '/' });
  const muertas = []; let fallidos = 0;
  await Promise.all(objetivo.map(async (s) => {
    try { await webpush.sendNotification(s.sub, payload); }
    catch (e) {
      const code = e.statusCode;
      if ((code === 404 || code === 410) && s.sub?.endpoint) muertas.push(s.sub.endpoint);
      else { fallidos++; console.error('[notif/push] envío falló', code, String(e.body || e.message || '').slice(0, 200)); }
    }
  }));
  if (muertas.length) {
    try {
      const limpio = subs.filter(s => !muertas.includes(s.sub?.endpoint));
      await saveSharedData('push_subscriptions', limpio);
    } catch (e) { console.error('[notif/push] limpieza de subs muertas falló:', e?.message); }
  }
  return { enviados: objetivo.length - muertas.length - fallidos, muertas: muertas.length, fallidos };
}

// Crea una notificación desde el servidor. Resuelve destinatarios (roles→app_users
// + userIds explícitos − actor), escribe el feed SOLO si el tipo NO es legacy
// (los legacy ya se ven in-app), y SIEMPRE manda push. Best-effort: cualquier
// error se loguea, nunca tira.
// datos: { userIds?, actorId?, cuerpo?, link?, titulo?, ...campos para titulo() }.
export async function crearNotifServidor(tipo, datos = {}) {
  try {
    const cfg = EVENTOS[tipo];
    if (!cfg) { console.warn('[notif] tipo desconocido', tipo); return { enviados: 0 }; }
    const titulo = datos.titulo || cfg.titulo(datos);
    const cuerpo = datos.cuerpo || '';
    const link   = datos.link || cfg.link;

    const appUsers = await sbGet('app_users', '?select=id,rol');
    const usuarios = (appUsers || []).map(u => ({ id: u.id, rol: u.rol }));
    const destino  = { roles: cfg.roles || [], userIds: datos.userIds || [] };
    const userIds  = resolverDestinatarios(destino, usuarios, datos.actorId || null);
    if (!userIds.length) return { enviados: 0 };

    if (!TIPOS_LEGACY.includes(tipo)) {
      await appendNotif({
        id: newId('ntf'), tipo, titulo, cuerpo, link,
        rolesDestino: cfg.roles || [], userIds: datos.userIds || [],
        actorId: datos.actorId || null, creadoAt: new Date().toISOString(), leidaPor: [],
      });
    }
    return await enviarPushAUsuarios(userIds, { titulo, cuerpo, link });
  } catch (e) {
    console.error('[notif] crearNotifServidor falló', tipo, e?.message);
    return { enviados: 0, error: e?.message };
  }
}
