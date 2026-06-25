// Fusión de payment-reminders + sales-followups en una sola function (límite
// Vercel Hobby = 12 functions). Se elige el job por query: ?job=reminders | ?job=followups.
//
// CRONS: el plan Hobby también limita la CANTIDAD de cron jobs, así que en
// vercel.json sólo está agendado ?job=reminders (+ sync-sanfrancisco = 2 crons,
// el máximo que deploya OK). ?job=followups (seguimiento comercial) se dispara
// A MANO — `vercel crons run` / llamada directa al endpoint — hasta pasar a Pro;
// agregarlo como 3er cron rompía el deploy en la etapa de config (ver c798a71).
//
// --- ENV compartido + helpers idénticos de ambos archivos originales ---
const META_TOKEN      = process.env.META_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;
const SUPABASE_URL    = process.env.SUPABASE_URL;
const SUPABASE_KEY    = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET     = process.env.CRON_SECRET;

import webpush from 'web-push';

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:fgeespinoza@gmail.com';
if (VAPID_PUBLIC && VAPID_PRIVATE) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

const sbH = () => ({
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

async function sbGet(table, query = '') {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, { headers: sbH() });
  if (!r.ok) { console.error('sbGet', table, r.status); return []; }
  return r.json();
}

async function loadSharedData(key) {
  const rows = await sbGet('shared_data', `?key=eq.${key}&select=data`);
  return rows[0]?.data ?? null;
}

async function saveSharedData(key, data) {
  await fetch(`${SUPABASE_URL}/rest/v1/shared_data?on_conflict=key`, {
    method: 'POST',
    headers: { ...sbH(), Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ key, data }),
  });
}

async function sendWA(to, body) {
  try {
    const r = await fetch(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${META_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }),
    });
    const json = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, json };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function sendWATemplate(to, name, lang, bodyParams = []) {
  try {
    const r = await fetch(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${META_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp', to, type: 'template',
        template: {
          name, language: { code: lang },
          components: bodyParams.length ? [{ type: 'body', parameters: bodyParams.map(t => ({ type: 'text', text: String(t) })) }] : [],
        },
      }),
    });
    const json = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, json };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Helpers de moneda/fecha (inline: no podemos importar src/ en serverless) ──
function cuotaMontoUSD(c, obraMoneda, dolarVenta) {
  const monto = c.monto || 0;
  const esUSD = obraMoneda === 'USD' || !!c._usd;
  return Math.round(esUSD ? monto : monto / (dolarVenta || 1));
}

function cobradoObraUSD(movs, cajas, obraId, dolarVenta) {
  return (movs || [])
    .filter(m => m.obraId === obraId && m.tipo === 'ingreso')
    .reduce((s, m) => {
      if (m.montoDolar) return s + Math.round(m.montoDolar);
      const caja = (cajas || []).find(c => c.id === m.cajaId);
      return s + (caja?.moneda === 'USD' ? Math.round(m.monto || 0) : Math.round((m.monto || 0) / (dolarVenta || 1)));
    }, 0);
}

// Reparte el cobrado (USD) sobre las cuotas EN ORDEN → { [cuotaId]: cubiertoUSD }.
// Igual que repartirCobroEnCuotas del front: respeta cuotas pagadas a mano
// (estado 'pagado' sin pagos) sin consumir cobros.
function repartirCobro(cuotas, cobradoUSD, obraMoneda, dolarVenta) {
  let rest = Math.max(0, Math.round(cobradoUSD || 0));
  const out = {};
  for (const c of (cuotas || [])) {
    const m = cuotaMontoUSD(c, obraMoneda, dolarVenta);
    if (c.estado === 'pagado' && !((c.pagos || []).length)) { out[c.id] = m; continue; }
    const ap = Math.min(m, rest);
    out[c.id] = ap;
    rest -= ap;
  }
  return out;
}

const fmtUSD = n => `U$S ${Math.round(n || 0).toLocaleString('es-AR')}`;
const fmtFecha = iso => !iso ? '' : String(iso).slice(0, 10).split('-').reverse().join('/');
const diasHasta = (fecha) => {
  if (!fecha) return null;
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const d = new Date(fecha); d.setHours(0, 0, 0, 0);
  return Math.round((d - hoy) / 86400000);
};
const diasDesde = (iso) => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null;

function normalizePhone(raw) {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = '549' + d;
  else if (d.length === 12 && d.startsWith('54')) d = '549' + d.slice(2);
  else if (d.length === 11 && (d.startsWith('11') || d.startsWith('15'))) d = '549' + d.slice(d.startsWith('15') ? 2 : 0);
  if (d.length < 11 || d.length > 15) return null;
  return d;
}

function findClienteByObra(obra, clientes) {
  if (!obra?.clienteId && !obra?.cliente) return null;
  if (obra.clienteId) {
    const byId = (clientes || []).find(c => c.id === obra.clienteId);
    if (byId) return byId;
  }
  const q = (obra.cliente || '').toLowerCase().trim();
  if (!q) return null;
  const exacto = (clientes || []).find(c => (c.nombre || '').toLowerCase().trim() === q);
  if (exacto) return exacto;
  return (clientes || []).find(c => {
    const n = (c.nombre || '').toLowerCase().trim();
    return n && (n.includes(q) || q.includes(n));
  }) || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// JOB 1: recordatorios de cuota al CLIENTE (ex payment-reminders.js)
//
// Disparado por Vercel Cron (ver vercel.json) todos los días a las 10am ARG
// (13:00 UTC). Para cada obra activa y cada cuota IMPAGA:
//   - 48 hs antes del vencimiento (diasHasta === 2): aviso preventivo.
//   - 72 hs después del vencimiento (diasHasta === -3): aviso de cuota vencida.
//
// "IMPAGA" se DERIVA de los movimientos de ingreso (libro único): repartimos lo
// cobrado de la obra sobre las cuotas en orden; una cuota está paga si quedó
// cubierta. NO usamos campos viejos (c.cobrado/c.pagado).
//
// ENVÍO Y VENTANA DE 24h:
// El cliente casi nunca escribió al bot en las últimas 24h, así que el aviso
// necesita un TEMPLATE aprobado en Meta. Intentamos:
//   1) free-form (por si el cliente escribió hace poco)
//   2) template 'recordatorio_cuota' (es_AR) con 2 parámetros:
//        {{1}} = nombre del cliente
//        {{2}} = detalle (qué cuota, obra, monto, vencimiento)
// Si no hay template aprobado y la ventana está cerrada, queda logeado (no rompe).
// ─────────────────────────────────────────────────────────────────────────────
async function runReminders(req, res) {
  if (CRON_SECRET) {
    const got = req.query?.secret || req.headers?.['x-cron-secret'];
    if (got !== CRON_SECRET) return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const [obrasData, clientesData, dolarData, movData, convs] = await Promise.all([
      loadSharedData('obras'),
      loadSharedData('clientes'),
      loadSharedData('dolar'),
      loadSharedData('movimientos'),
      sbGet('whatsapp_conversations', '?select=phone,updated_at'),
    ]);

    const obras    = obrasData?.obras || [];
    const detalles = obrasData?.detalles || {};
    const clientes = Array.isArray(clientesData) ? clientesData : [];
    const movs     = movData?.movimientos || [];
    const cajas    = movData?.cajas || [];
    const dolarVenta = dolarData?.manual ? (dolarData.manualVal || 1070) : (dolarData?.venta || 1070);

    const resultados = [];

    for (const obra of obras) {
      // Solo obras CONFIRMADAS: el plan de pagos de una propuesta (en-presupuesto)
      // NO genera recordatorios de cobro al cliente. Recibir un pago la confirma.
      if (obra.estado !== 'activa' && obra.estado !== 'finalizada') continue;
      const det = detalles[obra.id];
      const cuotas = det?.cuotas || [];
      if (!cuotas.length) continue;

      const obraMoneda = obra.moneda || 'ARS';
      const cobUSD = cobradoObraUSD(movs, cajas, obra.id, dolarVenta);
      const reparto = repartirCobro(cuotas, cobUSD, obraMoneda, dolarVenta);

      for (const c of cuotas) {
        const montoUSD = cuotaMontoUSD(c, obraMoneda, dolarVenta);
        if (montoUSD <= 0) continue;                       // sin monto: nada que recordar
        const cubierto = reparto[c.id] || 0;
        if (cubierto >= montoUSD) continue;                // ya está paga (derivado): no recordar

        const d = diasHasta(c.fecha);
        if (d === null) continue;

        let detalle = null;
        if (d === 2) {
          detalle = `Te recordamos que en 48 hs vence la cuota ${c.n ?? ''}${c.descripcion ? ` (${c.descripcion})` : ''} de la obra ${obra.nombre} por ${fmtUSD(montoUSD)}. Vence el ${fmtFecha(c.fecha)}.`;
        } else if (d === -3) {
          detalle = `Te recordamos que la cuota ${c.n ?? ''}${c.descripcion ? ` (${c.descripcion})` : ''} de la obra ${obra.nombre} por ${fmtUSD(montoUSD)} venció el ${fmtFecha(c.fecha)} y figura impaga.`;
        }
        if (!detalle) continue;

        const cliente = findClienteByObra(obra, clientes);
        const tel = normalizePhone(cliente?.whatsapp || cliente?.telefono);
        if (!tel) {
          resultados.push({ obra: obra.nombre, cuota: c.n, enviado: false, motivo: 'cliente sin WhatsApp' });
          continue;
        }

        // ¿El cliente escribió en las últimas 24h? → texto libre. Sino → template.
        const conv = (convs || []).find(x => x.phone === tel);
        const activo24h = conv?.updated_at && (Date.now() - new Date(conv.updated_at).getTime()) < 24 * 60 * 60 * 1000;

        let envio;
        if (activo24h) {
          envio = await sendWA(tel, `Hola ${cliente.nombre} 👋\n\n${detalle}\n\nCualquier duda, escribinos. ¡Gracias!\nKamak Desarrollos`);
        } else {
          envio = await sendWATemplate(tel, 'recordatorio_cuota', 'es_AR', [cliente.nombre || 'cliente', detalle]);
          if (!envio.ok) {
            const ff = await sendWA(tel, `Hola ${cliente.nombre} 👋\n\n${detalle}\n\nCualquier duda, escribinos. ¡Gracias!\nKamak Desarrollos`);
            if (ff.ok) envio = ff;
          }
        }
        resultados.push({ obra: obra.nombre, cuota: c.n, tipo: d === 2 ? 'preventivo' : 'vencida', enviado: !!envio.ok, status: envio.status });
      }
    }

    return res.status(200).json({ ok: true, fecha: new Date().toISOString(), enviados: resultados.filter(r => r.enviado).length, resultados });
  } catch (e) {
    console.error('payment-reminders error:', e);
    return res.status(500).json({ error: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// JOB 2: seguimiento comercial a los ADMINS (ex sales-followups.js)
// (1) recordatorios de oportunidades 'cotizado'/'negociacion' estancadas,
// (4) reactivación de clientes inactivos. Avisa a los admins por WA.
// REGLA DE APAGADO (§8): una oportunidad se procesa solo si está abierta
// (en-presupuesto), etapa cotizado/negociacion, SIN ingreso, y > N días.
// ─────────────────────────────────────────────────────────────────────────────
const DIAS_SIN_RESPUESTA = 5;
const MESES_INACTIVO = 6;

async function runFollowups(req, res) {
  if (CRON_SECRET) { const got = req.query?.secret || req.headers?.['x-cron-secret']; if (got !== CRON_SECRET) return res.status(401).json({ error: 'unauthorized' }); }
  try {
    const obrasData = await loadSharedData('obras');
    const movData = await loadSharedData('movimientos');
    const clientes = (await loadSharedData('clientes')) || [];
    const obras = obrasData?.obras || [];
    const movs = movData?.movimientos || [];
    const tieneIngreso = (obraId) => movs.some(m => m.obraId === obraId && m.tipo === 'ingreso');

    // (1) Oportunidades estancadas (regla de apagado).
    const estancadas = obras.filter(o => {
      if (o.estado !== 'en-presupuesto') return false;
      const etapa = o.venta?.etapa;
      if (etapa !== 'cotizado' && etapa !== 'negociacion') return false;
      if (tieneIngreso(o.id)) return false;
      const d = diasDesde(o.venta?.fechaCambioEtapa);
      return d != null && d > DIAS_SIN_RESPUESTA;
    });

    // (4) Clientes inactivos: sin obra activa NI oportunidad abierta, última señal vieja.
    const inactivos = clientes.filter(cl => {
      const obrasCl = obras.filter(o => o.clienteId === cl.id || o.cliente === cl.nombre);
      const tieneActiva = obrasCl.some(o => o.estado === 'activa' || o.estado === 'finalizada' || o.estado === 'pausada');
      const tieneAbierta = obrasCl.some(o => o.estado === 'en-presupuesto');
      if (tieneActiva || tieneAbierta) return false;
      const fechas = obrasCl.flatMap(o => [o.fechaFin, o.createdAt]).filter(Boolean).sort();
      const ult = fechas.slice(-1)[0];
      const d = diasDesde(ult);
      return d != null && d > MESES_INACTIVO * 30;
    });

    if (estancadas.length === 0 && inactivos.length === 0) return res.status(200).json({ ok: true, nada: true });

    // Dedup/throttle: si el set de oportunidades/clientes es idéntico al último
    // aviso y pasaron < 24h, no reenviamos (evita el spam diario a los admins).
    const idsActual = [...estancadas.map(o => o.id), ...inactivos.map(c => 'cl:' + c.id)].sort();
    const prevState = (await loadSharedData('sales_followups_state')) || {};
    const sinCambios = JSON.stringify(prevState.ids || []) === JSON.stringify(idsActual);
    const horasDesdeUltimo = prevState.ts ? (Date.now() - new Date(prevState.ts).getTime()) / 3600000 : Infinity;
    if (sinCambios && horasDesdeUltimo < 24) return res.status(200).json({ ok: true, skip: 'sin-cambios' });

    // Armar mensaje y mandar a los admins.
    const appUsers = await sbGet('app_users', '?select=id,nombre,rol');
    const waUsers = await sbGet('whatsapp_users', '?select=user_id,phone');
    const admins = (waUsers || []).filter(lu => (appUsers || []).find(u => u.id === lu.user_id)?.rol === 'Admin');

    let cuerpo = '📊 *Seguimiento comercial*\n';
    if (estancadas.length) cuerpo += `\n*Propuestas sin respuesta (${estancadas.length}):*\n` + estancadas.slice(0, 10).map(o => `• ${o.nombre} — ${o.venta?.etapa}, ${diasDesde(o.venta?.fechaCambioEtapa)}d`).join('\n');
    if (inactivos.length) cuerpo += `\n\n*Clientes a reactivar (${inactivos.length}):*\n` + inactivos.slice(0, 10).map(c => `• ${c.nombre}`).join('\n');

    const resultados = [];
    for (const a of admins) { const r = await sendWA(a.phone, cuerpo); resultados.push({ phone: a.phone, ok: r.ok }); }
    // Registrar el estado de esta corrida para deduplicar la próxima.
    await saveSharedData('sales_followups_state', { ts: new Date().toISOString(), ids: idsActual });
    return res.status(200).json({ ok: true, estancadas: estancadas.length, inactivos: inactivos.length, enviados: resultados });
  } catch (e) { console.error('[sales-followups]', e.message); return res.status(500).json({ error: e.message }); }
}

// Valida que el que llama sea un usuario logueado (cualquier app_user). El push
// lo dispara el cliente al crear una notif, con el token de sesión Supabase.
async function usuarioLogueado(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return false;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` } });
  return r.ok;
}

// Envía un push web a todos los dispositivos de los userIds dados. Lee las
// subscriptions de shared_data 'push_subscriptions' y borra las muertas (404/410).
async function runPush(req, res) {
  if (!(await usuarioLogueado(req))) return res.status(403).json({ error: 'no autorizado' });
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return res.status(500).json({ error: 'VAPID no configurado' });
  const { userIds, titulo, cuerpo, link } = req.body || {};
  if (!Array.isArray(userIds) || !userIds.length || !titulo) return res.status(400).json({ error: 'falta userIds/titulo' });

  const subs = (await loadSharedData('push_subscriptions')) || [];
  const objetivo = subs.filter(s => userIds.includes(s.userId));
  const payload = JSON.stringify({ titulo, cuerpo: cuerpo || '', link: link || '/' });

  const muertas = [];
  await Promise.all(objetivo.map(async (s) => {
    try { await webpush.sendNotification(s.sub, payload); }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) muertas.push(s.id); }
  }));

  if (muertas.length) {
    const limpio = subs.filter(s => !muertas.includes(s.id));
    await saveSharedData('push_subscriptions', limpio);
  }
  return res.status(200).json({ ok: true, enviados: objetivo.length - muertas.length, limpiadas: muertas.length });
}

export default async function handler(req, res) {
  const job = req.query.job;
  if (job === 'reminders') return runReminders(req, res);
  if (job === 'followups') return runFollowups(req, res);
  if (job === 'push') return runPush(req, res);
  return res.status(400).json({ error: 'job inválido (reminders|followups|push)' });
}
