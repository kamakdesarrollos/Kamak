// Recordatorios de cuota al CLIENTE por WhatsApp.
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
//
// TEMPLATE A CREAR EN META (Business Manager → WhatsApp → Plantillas):
//   nombre: recordatorio_cuota · idioma: Español (ARG) · categoría: UTILITY
//   cuerpo:
//     Hola {{1}} 👋
//
//     {{2}}
//
//     Cualquier duda, escribinos. ¡Gracias!
//     Kamak Desarrollos
//
// Seguridad: si CRON_SECRET está seteado, exige ?secret= o header x-cron-secret.

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

export default async function handler(req, res) {
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
