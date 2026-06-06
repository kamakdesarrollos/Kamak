// Cron comercial: (1) recordatorios de oportunidades 'cotizado'/'negociacion'
// estancadas, (4) reactivación de clientes inactivos. Avisa a los admins por WA.
// REGLA DE APAGADO (§8): una oportunidad se procesa solo si está abierta
// (en-presupuesto), etapa cotizado/negociacion, SIN ingreso, y > N días.
const META_TOKEN = process.env.META_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const DIAS_SIN_RESPUESTA = 5;
const MESES_INACTIVO = 6;

const sbH = () => ({ apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' });
async function sbGet(table, query = '') { const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, { headers: sbH() }); if (!r.ok) return []; return r.json(); }
async function loadSharedData(key) { const rows = await sbGet('shared_data', `?key=eq.${key}&select=data`); return rows[0]?.data ?? null; }
async function sendWA(to, body) { try { const r = await fetch(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${META_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }) }); return { ok: r.ok }; } catch (e) { return { ok: false, error: e.message }; } }

const diasDesde = (iso) => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null;

export default async function handler(req, res) {
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

    // Armar mensaje y mandar a los admins.
    const appUsers = await sbGet('app_users', '?select=id,nombre,rol');
    const waUsers = await sbGet('whatsapp_users', '?select=user_id,phone');
    const admins = (waUsers || []).filter(lu => (appUsers || []).find(u => u.id === lu.user_id)?.rol === 'Admin');

    let cuerpo = '📊 *Seguimiento comercial*\n';
    if (estancadas.length) cuerpo += `\n*Propuestas sin respuesta (${estancadas.length}):*\n` + estancadas.slice(0, 10).map(o => `• ${o.nombre} — ${o.venta?.etapa}, ${diasDesde(o.venta?.fechaCambioEtapa)}d`).join('\n');
    if (inactivos.length) cuerpo += `\n\n*Clientes a reactivar (${inactivos.length}):*\n` + inactivos.slice(0, 10).map(c => `• ${c.nombre}`).join('\n');

    const resultados = [];
    for (const a of admins) { const r = await sendWA(a.phone, cuerpo); resultados.push({ phone: a.phone, ok: r.ok }); }
    return res.status(200).json({ ok: true, estancadas: estancadas.length, inactivos: inactivos.length, enviados: resultados });
  } catch (e) { console.error('[sales-followups]', e.message); return res.status(500).json({ error: e.message }); }
}
