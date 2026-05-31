// Resumen diario proactivo por WhatsApp (FASE 3).
//
// Disparado por Vercel Cron (ver vercel.json → crons). A las 7am arma para
// cada admin vinculado un resumen del día:
//   - Cuotas que vencen hoy/mañana (obras activas)
//   - Cheques que vencen en ≤3 días
//   - Tareas vencidas asignadas al admin
//   - Obras con presupuesto excedido (gastado > 90%)
//
// ENVÍO Y VENTANA DE 24h:
// WhatsApp solo permite texto libre (free-form) a quien escribió al bot en
// las últimas 24h. A las 7am es improbable, así que el push real necesita
// un TEMPLATE aprobado en Meta. El código intenta:
//   1) free-form (por si el admin escribió hace poco)
//   2) template 'resumen_diario' (es:AR) con 1 parámetro {{1}} = el cuerpo
// Si no hay template aprobado, queda logeado y no se envía (no rompe).
//
// TEMPLATE A CREAR EN META (Business Manager → WhatsApp → Plantillas):
//   nombre: resumen_diario · idioma: Español (ARG) · categoría: UTILITY
//   cuerpo: "📋 Resumen Kamak\n\n{{1}}"
//
// Seguridad: si CRON_SECRET está seteado, exige ?secret= o header.

const META_TOKEN      = process.env.META_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;
const SUPABASE_URL    = process.env.SUPABASE_URL;
const SUPABASE_KEY    = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET     = process.env.CRON_SECRET;

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

const fmt = n => `$${Math.round(n || 0).toLocaleString('es-AR')}`;
const diasHasta = (fecha) => {
  if (!fecha) return null;
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const d = new Date(fecha); d.setHours(0, 0, 0, 0);
  return Math.round((d - hoy) / 86400000);
};

// Arma el cuerpo del resumen para un admin dado.
function armarResumen(adminUserId, ctx) {
  const { obras, detalles, cheques, tareas } = ctx;
  const lineas = [];

  // ── Cuotas que vencen hoy/mañana ──
  const cuotasUrg = [];
  (obras || []).forEach(o => {
    if (o.estado !== 'activa' && o.estado !== 'en-presupuesto') return;
    const det = detalles?.[o.id];
    (det?.cuotas || []).forEach(c => {
      if (c.cobrado || c.pagado) return;
      const d = diasHasta(c.fecha);
      if (d !== null && d >= 0 && d <= 1) {
        cuotasUrg.push({ obra: o.nombre, dias: d, monto: c.monto || c.montoARS || 0 });
      }
    });
  });
  if (cuotasUrg.length) {
    lineas.push('💰 *Cuotas a cobrar:*');
    cuotasUrg.slice(0, 6).forEach(c =>
      lineas.push(`  • ${c.obra} — ${c.dias === 0 ? 'HOY' : 'mañana'} · ${fmt(c.monto)}`)
    );
  }

  // ── Cheques que vencen en ≤3 días ──
  const chequesUrg = (cheques || []).filter(c => {
    if (c.estado !== 'cartera') return false;
    const d = diasHasta(c.fechaVencimiento);
    return d !== null && d >= 0 && d <= 3;
  });
  if (chequesUrg.length) {
    lineas.push('\n🧾 *Cheques por vencer:*');
    chequesUrg.slice(0, 6).forEach(c =>
      lineas.push(`  • ${c.banco || ''} N°${c.numero || '—'} · ${fmt(c.monto)} · vence ${diasHasta(c.fechaVencimiento) === 0 ? 'HOY' : `en ${diasHasta(c.fechaVencimiento)}d`}`)
    );
  }

  // ── Tareas vencidas del admin ──
  const hoyStr = new Date().toISOString().slice(0, 10);
  const tareasVenc = (tareas || []).filter(t =>
    (t.asignadoA || []).includes(adminUserId) &&
    t.estado !== 'completada' && t.estado !== 'cancelada' &&
    t.fechaLimite && t.fechaLimite < hoyStr
  );
  if (tareasVenc.length) {
    lineas.push('\n☑ *Tareas vencidas:*');
    tareasVenc.slice(0, 6).forEach(t => lineas.push(`  • ${t.titulo}`));
  }

  // ── Obras con presupuesto excedido (>90%) ──
  const excedidas = [];
  (obras || []).forEach(o => {
    if (o.estado !== 'activa') return;
    const det = detalles?.[o.id];
    const rubros = (det?.rubros || []).filter(r => r.tipo !== 'seccion');
    let presupuesto = 0;
    rubros.forEach(r => (r.tareas || []).forEach(t => {
      presupuesto += ((t.costoMat || 0) + (t.costoSub || 0)) * (t.cantidad || 0);
    }));
    presupuesto = presupuesto || o.presupuesto || 0;
    const gastado = (ctx.movimientos || [])
      .filter(m => m.obraId === o.id && m.tipo === 'gasto')
      .reduce((s, m) => s + (m.monto || 0), 0);
    if (presupuesto > 0 && gastado / presupuesto >= 0.9) {
      excedidas.push({ obra: o.nombre, pct: Math.round(gastado / presupuesto * 100) });
    }
  });
  if (excedidas.length) {
    lineas.push('\n⚠️ *Presupuesto al límite:*');
    excedidas.slice(0, 6).forEach(e => lineas.push(`  • ${e.obra} — ${e.pct}% consumido`));
  }

  return lineas.length ? lineas.join('\n') : null;
}

export default async function handler(req, res) {
  // Seguridad opcional
  if (CRON_SECRET) {
    const got = req.query?.secret || req.headers?.['x-cron-secret'];
    if (got !== CRON_SECRET) return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    // Cargar contexto. Nota: obras y detalles vienen juntos en la key 'obras'
    // ({ obras: [...], detalles: {...} }), igual que en webhook.js.
    const [obrasData, chequesData, tareas, movData, appUsers, waUsers, convs] = await Promise.all([
      loadSharedData('obras'),
      loadSharedData('cheques'),
      loadSharedData('tareas'),
      loadSharedData('movimientos'),
      sbGet('app_users', '?select=*'),
      sbGet('whatsapp_users', '?select=*'),
      sbGet('whatsapp_conversations', '?select=phone,updated_at'),
    ]);

    const ctx = {
      obras:    obrasData?.obras || [],
      detalles: obrasData?.detalles || {},
      cheques:  Array.isArray(chequesData) ? chequesData : (chequesData?.cheques || []),
      tareas:   Array.isArray(tareas) ? tareas : [],
      movimientos: movData?.movimientos || [],
    };

    // Admins vinculados a WhatsApp
    const adminLinks = (waUsers || []).filter(lu => {
      const u = (appUsers || []).find(x => x.id === lu.user_id);
      return u?.rol === 'Admin';
    });

    const resultados = [];
    for (const link of adminLinks) {
      const cuerpo = armarResumen(link.user_id, ctx);
      if (!cuerpo) { resultados.push({ phone: link.phone, enviado: false, motivo: 'sin novedades' }); continue; }

      const texto = `📋 *Resumen Kamak — ${new Date().toLocaleDateString('es-AR')}*\n\n${cuerpo}`;

      // ¿Escribió en las últimas 24h? → free-form. Sino → template.
      const conv = (convs || []).find(c => c.phone === link.phone);
      const activo24h = conv?.updated_at &&
        (Date.now() - new Date(conv.updated_at).getTime()) < 24 * 60 * 60 * 1000;

      let envio;
      if (activo24h) {
        envio = await sendWA(link.phone, texto);
      } else {
        // Fuera de ventana: intentar template. Si no existe/aprobado, falla
        // y se registra (el user tiene que crear 'resumen_diario' en Meta).
        envio = await sendWATemplate(link.phone, 'resumen_diario', 'es_AR', [cuerpo.slice(0, 1000)]);
        if (!envio.ok) {
          // Fallback free-form por las dudas (puede que sí esté en ventana)
          const ff = await sendWA(link.phone, texto);
          if (ff.ok) envio = ff;
        }
      }
      resultados.push({ phone: link.phone, enviado: !!envio.ok, status: envio.status });
    }

    return res.status(200).json({ ok: true, fecha: new Date().toISOString(), admins: adminLinks.length, resultados });
  } catch (e) {
    console.error('daily-summary error:', e);
    return res.status(500).json({ error: e.message });
  }
}
