// Firma del contrato desde el portal (firma electrónica SIMPLE, art. 5 Ley 25.506).
// Valida el OTP (hasheado scrypt+salt) con timingSafeEqual, persiste la firma en
// detalle.contrato, convierte la obra a Ganado (idempotente, espejo de
// setVentaEtapa) y registra una actividad 'firma' en el timeline. Toda la lógica
// sensible corre server-side. Mismo gate que data.js: CORS kamak + token válido.
import crypto from 'node:crypto';
import { hashDocumento } from '../../src/lib/contrato.js';
// Notificación interna (campanita + push) cuando el cliente firma. Best-effort.
import { crearNotifServidor } from '../whatsapp/_notif.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const META_TOKEN = process.env.META_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN; // bot interno: admins en Telegram (phone "tg:<chatId>")
const sbH = () => ({ apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' });

// GET genérico a una tabla REST (para app_users / whatsapp_users).
async function sbGet(table, query = '') {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, { headers: sbH() });
    if (!r.ok) return [];
    return r.json();
  } catch (e) { console.error('[firmar] sbGet', table, e.message); return []; }
}

// Mensaje de WhatsApp (texto libre) — molde de payment-reminders/sales-followups.
// Si el destinatario es "tg:<chatId>" (admin en Telegram) ruta a la Bot API.
async function sendWA(to, body) {
  if (typeof to === 'string' && to.startsWith('tg:')) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: to.slice(3), text: String(body).slice(0, 4096), disable_web_page_preview: true }),
      });
      return { ok: r.ok };
    } catch (e) { return { ok: false, error: e.message }; }
  }
  try {
    const r = await fetch(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${META_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }),
    });
    return { ok: r.ok };
  } catch (e) { return { ok: false, error: e.message }; }
}

// Avisa a los admins (app_users rol Admin + whatsapp_users vinculados) por WA.
// Best-effort: NUNCA rompe el flujo de firma (cualquier error se loguea y sigue).
async function avisarAdmins(texto) {
  try {
    const appUsers = await sbGet('app_users', '?select=id,rol');
    const waUsers = await sbGet('whatsapp_users', '?select=user_id,phone');
    const admins = (waUsers || []).filter(lu => (appUsers || []).find(u => u.id === lu.user_id)?.rol === 'Admin');
    for (const a of admins) { if (a.phone) await sendWA(a.phone, texto); }
  } catch (e) { console.error('[firmar] avisarAdmins', e.message); }
}

async function loadSharedData(key) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/shared_data?key=eq.${key}&select=data`, { headers: sbH() });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows[0]?.data ?? null;
}
async function saveSharedData(key, data) {
  await fetch(`${SUPABASE_URL}/rest/v1/shared_data?on_conflict=key`, {
    method: 'POST',
    headers: { ...sbH(), Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ key, data }),
  });
}
// Llama a un RPC de Postgres (atómico server-side). Devuelve true si salió OK.
async function rpc(fn, args) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: sbH(), body: JSON.stringify(args) });
    return r.ok;
  } catch (e) { console.error(`[firmar] rpc ${fn} falló`, e.message); return false; }
}

// Mergea { contrato } en obras.detalles[obraId] sin pisar las demás obras.
// Preferimos el RPC atómico patch_detalle_obra (ya desplegado, lo usa el bot);
// si falla, caemos a read-modify-write del blob 'obras'. Espejo de
// sbPatchDetalleObra (api/whatsapp/webhook.js).
async function patchDetalleObra(obraId, patch) {
  const ok = await rpc('patch_detalle_obra', { p_obra_id: obraId, p_patch: patch });
  if (ok) return;
  console.error('[firmar] patch_detalle_obra fallback RMW');
  const data = await loadSharedData('obras');
  const detalles = data?.detalles || {};
  const cur = detalles[obraId] || {};
  await saveSharedData('obras', { obras: data?.obras || [], detalles: { ...detalles, [obraId]: { ...cur, ...patch } } });
}

// Mergea `patch` en el ítem (por id) de obras.obras (array) sin pisar los demás.
// Usa el RPC patch_shared_object_item que SÍ existe (migración 0002); si falla,
// read-modify-write del blob 'obras'. Espejo de sbPatchObjectItem (webhook.js).
// (El plan mencionaba patch_item_in_shared_object — NO existe; el real es éste.)
async function patchObraItem(obraId, patch) {
  const ok = await rpc('patch_shared_object_item', { p_key: 'obras', p_collection: 'obras', p_id: obraId, p_patch: patch });
  if (ok) return;
  console.error('[firmar] patch_shared_object_item fallback RMW');
  const data = await loadSharedData('obras');
  const arr = Array.isArray(data?.obras) ? data.obras : [];
  await saveSharedData('obras', { obras: arr.map(o => o.id === obraId ? { ...o, ...patch } : o), detalles: data?.detalles || {} });
}

// Conversión a Ganado idempotente (espejo de setVentaEtapa). Si la obra ya está
// ganada/activa no hace nada (evita changelog duplicado); si un intento previo
// firmó pero no convirtió, un reintento la reasegura.
async function asegurarGanado(obraId, obra, fechaISO) {
  if (obra.venta?.etapa === 'ganado' && (obra.estado === 'activa' || obra.estado === 'finalizada')) return;
  const fecha = fechaISO || new Date().toISOString();
  const nuevoEstado = obra.estado === 'finalizada' ? 'finalizada' : 'activa';
  const ventaPrev = obra.venta || {};
  const cambios = {
    estado: nuevoEstado,
    venta: { ...ventaPrev, etapa: 'ganado', fechaCambioEtapa: fecha.slice(0, 10), changelog: [...(ventaPrev.changelog || []), { etapa: 'ganado', fecha: fecha.slice(0, 10), usuario: 'sistema' }] },
  };
  if (nuevoEstado === 'activa' && !obra.fechaInicio) cambios.fechaInicio = fecha.slice(0, 10);
  await patchObraItem(obraId, cambios);
}

const hashOtp = (otp, salt) => crypto.scryptSync(otp, salt, 32).toString('hex');
// Comparación en tiempo constante (no '==='): evita timing attacks sobre el hash.
const eqHash = (a, b) => { const ba = Buffer.from(a, 'hex'), bb = Buffer.from(b, 'hex'); return ba.length === bb.length && crypto.timingSafeEqual(ba, bb); };

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const corsOk = /^https:\/\/([a-z0-9-]+\.)?kamak\.com\.ar$/.test(origin);
  res.setHeader('Access-Control-Allow-Origin', corsOk ? origin : 'https://kamak.com.ar');
  res.setHeader('Vary', 'Origin');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });

  try {
    const { token, otpId, otp, nombre, dni } = req.body || {};
    if (!token || !otpId || !otp || !nombre) return res.status(400).json({ error: 'faltan_datos' });

    const tokens = await loadSharedData('portal_tokens');
    const entry = tokens?.[token];
    if (!entry) return res.status(404).json({ error: 'invalid' });
    if (entry.expires && new Date(entry.expires) < new Date()) return res.status(410).json({ error: 'expired' });
    const obraId = entry.obraId;

    // Validar OTP.
    const codes = (await loadSharedData('portal_otp_codes')) || {};
    const c = codes[otpId];
    if (!c || c.token !== token || c.obraId !== obraId) return res.status(400).json({ error: 'otp_invalido' });
    if (c.usado) return res.status(409).json({ error: 'otp_usado' });
    if (new Date(c.expiresAt) < new Date()) { delete codes[otpId]; await saveSharedData('portal_otp_codes', codes); return res.status(410).json({ error: 'otp_expirado' }); }
    if (c.intentos >= c.maxIntentos) { delete codes[otpId]; await saveSharedData('portal_otp_codes', codes); return res.status(429).json({ error: 'otp_intentos' }); }
    if (!eqHash(hashOtp(otp, c.salt), c.hashOTP)) {
      c.intentos += 1; await saveSharedData('portal_otp_codes', codes);
      return res.status(401).json({ error: 'otp_incorrecto', intentosRestantes: Math.max(0, c.maxIntentos - c.intentos) });
    }

    // OTP OK. Cargar obra + detalle.
    const obras = await loadSharedData('obras');
    const obra = obras?.obras?.find(o => o.id === obraId);
    const detalle = obras?.detalles?.[obraId];
    if (!obra || !detalle?.contrato) return res.status(404).json({ error: 'sin_contrato' });
    if (detalle.contrato.estado === 'firmado') {
      // Ya firmado: reasegurar la conversión a Ganado por si un intento previo
      // persistió la firma pero falló la conversión (idempotente, no duplica).
      await asegurarGanado(obraId, obra, detalle.contrato.fechaFirmado);
      return res.status(200).json({ success: true, yaFirmado: true, fechaFirmado: detalle.contrato.fechaFirmado });
    }

    // Verificar que el documento no cambió desde que se envió.
    const hashActual = hashDocumento(detalle.contrato.htmlRenderizado || '');
    // (el front no manda el hash; comparamos contra el guardado al generar, si existe)
    if (detalle.contrato.hashDocumento && detalle.contrato.hashDocumento !== hashActual) {
      return res.status(409).json({ error: 'documento_cambiado' });
    }

    const fecha = new Date().toISOString();
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '';
    const firma = {
      nombre: String(nombre).slice(0, 120), dni: String(dni || '').slice(0, 30),
      fecha, ip, userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
      hashDocumento: hashActual, otp: { canal: c.canal, verificadoAt: fecha }, proveedorExterno: null,
    };
    const nuevoContrato = { ...detalle.contrato, estado: 'firmado', fechaFirmado: fecha, firma };

    // Persistir la firma; luego convertir a Ganado (idempotente). Si la conversión
    // fallara, un reintento de firma la reasegura (ver early-return de arriba).
    await patchDetalleObra(obraId, { contrato: nuevoContrato });
    await asegurarGanado(obraId, obra, fecha);

    // Consumir OTP.
    c.usado = true; c.verificadoAt = fecha; await saveSharedData('portal_otp_codes', codes);

    // Actividad de firma en el timeline (read-modify-write: no hay RPC de append
    // de array desde fetch directo; es server-only y poco concurrente).
    const actividades = (await loadSharedData('crm_actividades')) || [];
    actividades.unshift({ id: `act-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`, clienteId: obra.clienteId || null, obraId, tipo: 'firma', texto: `Contrato firmado por ${firma.nombre}`, fecha, usuario: 'sistema', adjuntos: [], creadoAt: fecha, actualizadoAt: fecha });
    await saveSharedData('crm_actividades', actividades);

    // Aviso a los admins por WhatsApp (best-effort, no rompe la firma).
    await avisarAdmins(`✍️ ${firma.nombre} firmó el contrato de ${obra.nombre}`);

    // Campanita + push a Admin/Administración (evento nuevo → feed + push).
    await crearNotifServidor('cliente_firmo', {
      cliente: firma.nombre,
      cuerpo: `Contrato de ${obra.nombre}`,
      link: `/obras/${obraId}/presupuesto`,
    });

    return res.status(200).json({ success: true, fechaFirmado: fecha });
  } catch (e) {
    console.error('[firmar] error', e.message);
    return res.status(500).json({ error: e.message });
  }
}
