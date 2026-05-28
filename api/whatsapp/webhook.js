// Meta WhatsApp Cloud API — sin dependencias externas

import { extractSlots, mergeSlots, slotsCompletosPara, parseDictado } from './extractors.js';

const META_TOKEN      = process.env.META_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;
const VERIFY_TOKEN    = process.env.META_VERIFY_TOKEN;
const ANTHROPIC_KEY   = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL    = process.env.SUPABASE_URL;
const SUPABASE_KEY    = process.env.SUPABASE_SERVICE_KEY;

// ── Helpers Supabase ──────────────────────────────────────────────────────────
const sbH = () => ({
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

async function sbGet(table, params = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, { headers: sbH() });
  return res.json();
}

async function sbUpsert(table, data) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...sbH(), 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify(data),
  });
}

async function sbDelete(table, params) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, { method: 'DELETE', headers: sbH() });
}

async function loadSharedData(key) {
  const rows = await sbGet('shared_data', `?key=eq.${key}&select=data`);
  return rows[0]?.data ?? null;
}

async function saveSharedData(key, value) {
  await fetch(`${SUPABASE_URL}/rest/v1/shared_data`, {
    method: 'POST',
    headers: { ...sbH(), 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ key, data: value, updated_at: new Date().toISOString() }),
  });
  await broadcastChange(key);
}

// ── Helpers Meta API ──────────────────────────────────────────────────────────
// Botones estándar de confirmación. Los ids se mapean a texto cuando vuelven:
// 'confirmar'→"sí", 'cancelar'→"no", 'editar'→"editar". El "editar" deja la
// acción en curso y pide al user el dato a corregir (sin perder el resto).
const BOTONES_CONFIRMAR = [
  { id: 'confirmar', title: 'Confirmar ✅' },
  { id: 'editar',    title: 'Editar ✏️' },
  { id: 'cancelar',  title: 'Cancelar ❌' },
];

async function sendWA(to, body) {
  try {
    const r = await fetch(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${META_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }),
    });
    if (!r.ok) {
      const t = await r.text();
      console.error('sendWA error:', r.status, t);
    }
  } catch (e) {
    console.error('sendWA exception:', e.message);
  }
}

// Envía un mensaje con BOTONES de respuesta rápida (máx 3 botones).
// botones: [{ id: 'confirmar', title: 'Confirmar ✅' }, ...]
// Cuando el usuario toca un botón, Meta nos manda un mensaje interactivo
// cuyo button_reply.id es el id que mandamos. Lo parseamos en el handler.
// Fallback: si la API rechaza (algunos números no soportan interactive),
// reintenta como texto plano con instrucción numérica.
async function sendWAButtons(to, body, botones) {
  const buttons = botones.slice(0, 3).map(b => ({
    type: 'reply',
    reply: { id: b.id, title: b.title.slice(0, 20) }, // título máx 20 chars
  }));
  try {
    const r = await fetch(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${META_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp', to, type: 'interactive',
        interactive: { type: 'button', body: { text: body.slice(0, 1024) }, action: { buttons } },
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      console.error('sendWAButtons error:', r.status, t);
      // Fallback texto plano
      const txtFallback = `${body}\n\n${botones.map((b, i) => `${i + 1}. ${b.title}`).join('\n')}`;
      await sendWA(to, txtFallback);
    }
  } catch (e) {
    console.error('sendWAButtons exception:', e.message);
    await sendWA(to, body);
  }
}

// Envía un mensaje con LISTA desplegable (hasta 10 opciones). Útil para
// elegir obra/caja/proveedor cuando hay varias coincidencias.
// items: [{ id, title, description? }]
async function sendWAList(to, body, buttonLabel, items) {
  const rows = items.slice(0, 10).map(it => ({
    id: it.id,
    title: (it.title || '').slice(0, 24),
    description: (it.description || '').slice(0, 72),
  }));
  try {
    const r = await fetch(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${META_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp', to, type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: body.slice(0, 1024) },
          action: { button: (buttonLabel || 'Elegir').slice(0, 20), sections: [{ rows }] },
        },
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      console.error('sendWAList error:', r.status, t);
      const txtFallback = `${body}\n\n${items.map((it, i) => `${i + 1}. ${it.title}`).join('\n')}`;
      await sendWA(to, txtFallback);
    }
  } catch (e) {
    console.error('sendWAList exception:', e.message);
    await sendWA(to, body);
  }
}

// Envía un mensaje de plantilla (template). Necesario cuando se inicia
// conversación con un número que no escribió al bot en las últimas 24hs
// — la API rechaza texto libre fuera de esa ventana.
// La plantilla debe estar registrada y APROBADA en Meta Business Manager.
async function sendWATemplate(to, templateName, languageCode, bodyParams = []) {
  try {
    const r = await fetch(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${META_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: languageCode },
          components: bodyParams.length > 0 ? [{
            type: 'body',
            parameters: bodyParams.map(text => ({ type: 'text', text: String(text) })),
          }] : [],
        },
      }),
    });
    const json = await r.json();
    if (!r.ok) {
      console.error('sendWATemplate error:', r.status, JSON.stringify(json));
      const err = json?.error;
      // Errores comunes y sus causas:
      // 132001 = plantilla no existe / no aprobada / idioma incorrecto
      // 131026 = mensaje fuera de ventana 24h y sin plantilla
      // 100    = parámetros del template no coinciden
      const motivo = err?.code === 132001 ? `Plantilla "${templateName}" (${languageCode}) no existe o no está aprobada en Meta.`
                   : err?.code === 131026 ? `Fuera de ventana de 24hs y la plantilla no aplica.`
                   : err?.message || 'error desconocido';
      throw new Error(motivo);
    }
    return json;
  } catch (e) {
    console.error('sendWATemplate exception:', e.message);
    throw e;
  }
}

async function downloadMedia(mediaId) {
  try {
    const r1 = await fetch(`https://graph.facebook.com/v18.0/${mediaId}`, {
      headers: { 'Authorization': `Bearer ${META_TOKEN}` },
    });
    const info = await r1.json();
    if (!info.url) return null;
    const r2 = await fetch(info.url, { headers: { 'Authorization': `Bearer ${META_TOKEN}` } });
    const buf = await r2.arrayBuffer();
    return Buffer.from(buf).toString('base64');
  } catch (e) {
    console.error('downloadMedia error:', e.message);
    return null;
  }
}

async function broadcastChange(key) {
  try {
    await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'apikey': SUPABASE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{ topic: 'kamak-data-sync', event: 'changed', payload: { key } }],
      }),
    });
  } catch (e) {
    console.error('broadcastChange error:', e.message);
  }
}

async function uploadToStorage(base64Data, mimeType, filepath) {
  try {
    const buffer = Buffer.from(base64Data, 'base64');
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/kamak-fotos/${filepath}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': mimeType,
        'x-upsert': 'true',
      },
      body: buffer,
    });
    if (!r.ok) {
      console.error('uploadToStorage error:', r.status, await r.text());
      return null;
    }
    return `${SUPABASE_URL}/storage/v1/object/public/kamak-fotos/${filepath}`;
  } catch (e) {
    console.error('uploadToStorage exception:', e.message);
    return null;
  }
}

// ── Datos del sistema ─────────────────────────────────────────────────────────
async function getSystemContext() {
  const [movData, provData, obrasData, cliData] = await Promise.all([
    loadSharedData('movimientos'),
    loadSharedData('proveedores'),
    loadSharedData('obras'),
    loadSharedData('clientes'),
  ]);
  return {
    cajas:       movData?.cajas       || [],
    movimientos: movData?.movimientos || [],
    proveedores: provData?.proveedores || [],
    obras:       obrasData?.obras?.filter(o => o.estado === 'activa' || o.estado === 'en-presupuesto') || [],
    detalles:    obrasData?.detalles  || {},
    clientes:    Array.isArray(cliData) ? cliData : [],
  };
}

// ── Helpers cliente / telefono ────────────────────────────────────────────────
// Normaliza un teléfono al formato E.164 sin "+" que requiere Meta WA.
// Acepta varios formatos comunes Arg: "+54 11 5555-1234", "01155551234",
// "5491155551234". Devuelve null si no se puede normalizar razonablemente.
function normalizePhone(raw) {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, '');
  if (!d) return null;
  // 0xxxxxxxxxx (formato local arg con cero inicial) → quitar el 0
  if (d.startsWith('0')) d = d.slice(1);
  // Arg sin código país (10 dígitos): "1155551234" → "5491155551234"
  if (d.length === 10) d = '549' + d;
  // Arg con código país sin el 9 móvil: "541155551234" (12) → "5491155551234"
  else if (d.length === 12 && d.startsWith('54')) d = '549' + d.slice(2);
  // Arg formato "15" móvil viejo (11 dígitos): "1115551234" → ya está bien, +549
  else if (d.length === 11 && (d.startsWith('11') || d.startsWith('15'))) d = '549' + d.slice(d.startsWith('15') ? 2 : 0);
  // Validación final: E.164 → 11-15 dígitos
  if (d.length < 11 || d.length > 15) return null;
  return d;
}

// Busca el cliente vinculado a una obra por nombre. obra.cliente es texto
// libre — matcheamos por lowercase exacto primero, después por inclusión.
function findClienteByObra(obra, clientes) {
  if (!obra?.cliente || !clientes?.length) return null;
  const q = obra.cliente.toLowerCase().trim();
  const exacto = clientes.find(c => (c.nombre || '').toLowerCase().trim() === q);
  if (exacto) return exacto;
  return clientes.find(c => {
    const n = (c.nombre || '').toLowerCase().trim();
    return n && (n.includes(q) || q.includes(n));
  }) || null;
}

// Formatea un monto con moneda, igual al estilo del resto del bot.
function fmtMonto(monto, moneda) {
  const n = Math.round(monto).toLocaleString('es-AR');
  return moneda === 'USD' ? `U$S ${n}` : `$ ${n}`;
}

// Manda el WhatsApp de confirmación de cobro al cliente.
async function notifyClienteCobro({ telefono, clienteNombre, monto, moneda, obraNombre, recibidoPor }) {
  const msg =
    `Hola ${clienteNombre} 👋\n\n` +
    `Te confirmamos que recibimos ${fmtMonto(monto, moneda)} por la obra *${obraNombre}*.\n\n` +
    `Recibido por: ${recibidoPor}\n\n` +
    `¡Gracias por confiar en Kamak Desarrollos! 🙏`;
  await sendWA(telefono, msg);
}

// ── Cliente vinculado al portal ──────────────────────────────────────────────
// Busca si un numero de WA ya esta vinculado a un cliente.
// Matching robusto: prueba con whatsappActivo flag pero tambien acepta
// clientes cuyo telefono coincida aunque el flag falte (datos legacy o
// guardados pisados por otro proceso).
async function getLinkedCliente(phone) {
  const clientesData = await loadSharedData('clientes');
  const clientes = Array.isArray(clientesData) ? clientesData : [];
  // 1) Match preferido: whatsappActivo + telefono normalizado matchea.
  let match = clientes.find(c => c.whatsappActivo && normalizePhone(c.telefono) === phone);
  if (match) {
    console.log(`getLinkedCliente: match flag+phone cliente=${match.id} (${match.nombre})`);
    return match;
  }
  // 2) Match relajado: cualquier cliente con ese telefono (aunque whatsappActivo
  //    se haya perdido — guardado pisado por el frontend, datos legacy, etc.)
  match = clientes.find(c => normalizePhone(c.telefono) === phone);
  if (match) {
    console.log(`getLinkedCliente: match SOLO phone cliente=${match.id} (${match.nombre}) — flag whatsappActivo perdido`);
    return match;
  }
  console.log(`getLinkedCliente: NO match para phone=${phone}. Total clientes=${clientes.length}. Telefonos guardados:`,
    clientes.map(c => `${c.nombre}:${c.telefono}->${normalizePhone(c.telefono)}|act:${!!c.whatsappActivo}`).join(' / '));
  return null;
}

// Parsea el primer mensaje que el cliente manda desde el QR del presupuesto.
// Patron esperado: "Hola soy [cliente] obra [obra]"
// Devuelve { nombreCliente, nombreObra } o null si no matchea.
function parseClientePrimerMensaje(text) {
  if (!text) return null;
  const m = text.match(/hola\s+soy\s+(.+?)\s+obra\s+(.+?)$/i);
  if (!m) return null;
  return { nombreCliente: m[1].trim(), nombreObra: m[2].trim() };
}

// Match flexible de nombres (ignora mayusculas, tildes, espacios extra).
function nombreMatch(a, b) {
  const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  const A = norm(a), B = norm(b);
  if (!A || !B) return false;
  return A === B || A.includes(B) || B.includes(A);
}

// Crea (o renueva) un portal_token para una obra y devuelve la URL completa
// que el cliente puede abrir en el navegador.
async function generarPortalLink(obraId, obraNombre, clienteNombre, phone) {
  const baseUrl = process.env.PORTAL_BASE_URL || 'https://kamak.com.ar';
  const token = `pt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const tokens = (await loadSharedData('portal_tokens')) || {};
  tokens[token] = {
    obraId, obraNombre, cliente: clienteNombre,
    phone, expires,
    createdAt: new Date().toISOString(),
    source: 'qr-onboarding',
  };
  await saveSharedData('portal_tokens', tokens);
  return `${baseUrl}/portal/acceso/${token}`;
}

// Vincula al cliente (guarda phone + whatsappActivo en la ficha) y le manda
// el link al portal. Llamada cuando el cliente escanea el QR y envia el
// primer mensaje "Hola soy X obra Y" desde su telefono.
async function onboardCliente(phone, nombreCliente, nombreObra) {
  const [clientesData, obrasData] = await Promise.all([
    loadSharedData('clientes'),
    loadSharedData('obras'),
  ]);
  const clientes = Array.isArray(clientesData) ? clientesData : [];
  const obras = obrasData?.obras || [];

  // Buscar cliente y obra por nombre flexible.
  const cliente = clientes.find(c => nombreMatch(c.nombre, nombreCliente));
  const obra = obras.find(o => nombreMatch(o.nombre, nombreObra));

  if (!cliente || !obra) {
    await sendWA(phone,
      `Hola! No pude identificar tu obra automaticamente.\n\n` +
      `Por favor escribinos:\n` +
      `*${nombreCliente || '[tu nombre]'}* y la obra *${nombreObra || '[nombre obra]'}*\n\n` +
      `Un asesor te va a responder pronto. Tambien podes contactarnos al telefono de Kamak.`
    );
    return;
  }

  // Si la obra que dijo no coincide con el cliente registrado, avisamos pero
  // igual seguimos (porque la obra podria tener cliente como texto libre).
  // No bloqueamos.

  // Marcar el cliente como vinculado con su telefono.
  const updatedClientes = clientes.map(c =>
    c.id === cliente.id
      ? { ...c, telefono: '+' + phone, whatsappActivo: true, whatsappVinculadoAt: new Date().toISOString() }
      : c
  );
  const ok = await saveSharedData('clientes', updatedClientes);
  console.log(`onboardCliente: vinculado cliente=${cliente.id} (${cliente.nombre}) phone=+${phone} save_ok=${ok}`);
  // Re-leer para verificar que se persistio (defensa contra pisado por
  // frontend o por algun race condition).
  const verify = await loadSharedData('clientes');
  const verifyOk = Array.isArray(verify) && verify.find(c => c.id === cliente.id)?.whatsappActivo === true;
  console.log(`onboardCliente: verificacion post-save = ${verifyOk}`);

  // Generar link al portal y mandarselo.
  const portalUrl = await generarPortalLink(obra.id, obra.nombre, cliente.nombre, phone);
  await sendWA(phone,
    `Hola ${cliente.nombre} 👋\n\n` +
    `Bienvenido al portal de tu obra *${obra.nombre}*.\n\n` +
    `Aca podes ver el avance, las fotos, los documentos y el plan de pagos:\n${portalUrl}\n\n` +
    `Cualquier consulta escribime por aca. Tambien podes preguntarme cosas como:\n` +
    `• *saldo* — cuanto debes\n` +
    `• *proximo pago* — proxima cuota\n` +
    `• *avance* — como va la obra\n` +
    `• *ayuda* — ver todas las opciones`
  );
}

// ── Handler de consultas del cliente vinculado ──────────────────────────────
// Helpers de cuota (replicados aca; en frontend viven en src/lib y src/pages/obra/helpers.js).
function cuotaMontoFn(c, moneda, tc) {
  return (c._usd || moneda !== 'USD') ? (c.monto || 0) : Math.round((c.monto || 0) / tc);
}
function cuotaCobradoFn(c, moneda, tc) {
  return (c.pagos || []).reduce((s, p) => {
    if (moneda === 'USD') return s + (p.moneda === 'ARS' ? Math.round((p.monto || 0) / (p.tc || tc)) : (p.monto || 0));
    return s + (p.moneda === 'USD' ? Math.round((p.monto || 0) * (p.tc || tc)) : (p.monto || 0));
  }, 0);
}
function cuotaEstadoCalc(c, moneda, tc) {
  const cob = cuotaCobradoFn(c, moneda, tc);
  if (cob <= 0) return 'pendiente';
  if (cob >= cuotaMontoFn(c, moneda, tc)) return 'pagado';
  return 'parcial';
}

async function handleClienteFlow(phone, cliente, text) {
  const t = (text || '').toLowerCase().trim();

  // Cargar la(s) obra(s) del cliente.
  const obrasData = await loadSharedData('obras');
  const obras = obrasData?.obras || [];
  const detalles = obrasData?.detalles || {};

  const obrasDelCliente = obras.filter(o => nombreMatch(o.cliente, cliente.nombre));
  if (obrasDelCliente.length === 0) {
    await sendWA(phone,
      `Hola ${cliente.nombre} 👋\n\nNo encontre obras asociadas a tu cuenta. Si pensas que es un error, contactanos a Kamak.`
    );
    return;
  }
  // Por ahora trabajamos con la primera obra activa (o la primera).
  // Multi-obra se resuelve en una iteracion futura.
  const obra = obrasDelCliente.find(o => o.estado === 'activa') || obrasDelCliente[0];
  const detalle = detalles[obra.id] || {};
  const moneda = obra.moneda || 'ARS';

  // Cargar dolar para conversiones USD <-> ARS.
  const dolarData = await loadSharedData('dolar');
  const tc = dolarData?.venta || dolarData?.manualVal || 1070;

  // Calculos de pagos
  const cuotas = detalle.cuotas || [];
  const cuotaMonto = c => cuotaMontoFn(c, moneda, tc);
  const cuotaCobrado = c => cuotaCobradoFn(c, moneda, tc);
  const totalCuotas = cuotas.reduce((s, c) => s + cuotaMonto(c), 0);
  const totalCobrado = cuotas.reduce((s, c) => s + cuotaCobrado(c), 0);
  const saldoPendiente = Math.max(0, totalCuotas - totalCobrado);
  const pagadas = cuotas.filter(c => cuotaEstadoCalc(c, moneda, tc) === 'pagado').length;
  const proximaCuota = cuotas
    .filter(c => cuotaEstadoCalc(c, moneda, tc) !== 'pagado')
    .sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''))[0];

  const fmtFecha = (iso) => {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  };

  // Avance general (promedio de avance por tarea)
  const rubros = detalle.rubros || [];
  const tareas = rubros.flatMap(r => (r.tareas || []).filter(x => x.tipo !== 'seccion'));
  const avanceGeneral = tareas.length > 0
    ? Math.round(tareas.reduce((s, t) => s + (t.avance || 0), 0) / tareas.length)
    : 0;

  // Link al portal (genera uno nuevo cada vez para mayor seguridad)
  const portalUrl = await generarPortalLink(obra.id, obra.nombre, cliente.nombre, phone);

  // ── Routing por comando ───────────────────────────────────────────────────
  if (/^(hola|buen[ao]s|hi|hey|hello|saludos|portal|link|acceso)\b/.test(t)) {
    await sendWA(phone,
      `Hola ${cliente.nombre} 👋\n\nAca tenes el link al portal de tu obra *${obra.nombre}*:\n${portalUrl}\n\n` +
      `Tambien podes escribirme:\n• *saldo* — cuanto debes\n• *proximo pago* — proxima cuota\n• *avance* — como va la obra\n• *ayuda* — ver todas las opciones`
    );
    return;
  }

  if (/^(ayuda|help|menu|opciones|\?)/.test(t)) {
    await sendWA(phone,
      `🔹 *Opciones disponibles:*\n\n` +
      `• *saldo* — cuanto debes y cuanto va pagado\n` +
      `• *proximo pago* / *cuando pago* — proxima cuota a vencer\n` +
      `• *cuanto pague* / *cobrado* — total pagado hasta ahora\n` +
      `• *cuotas* / *plan de pagos* — lista completa de cuotas\n` +
      `• *avance* / *como va* — % de avance de tu obra\n` +
      `• *portal* / *link* — link al portal con toda la info\n` +
      `• *ayuda* — este menu`
    );
    return;
  }

  if (/(saldo|cuanto\s+debo|cuanto\s+falta|deuda)/.test(t)) {
    await sendWA(phone,
      `💰 *Saldo de tu obra ${obra.nombre}*\n\n` +
      `Total acordado: ${fmtMonto(totalCuotas, moneda)}\n` +
      `Pagaste: ${fmtMonto(totalCobrado, moneda)}\n` +
      `*Saldo pendiente: ${fmtMonto(saldoPendiente, moneda)}*\n\n` +
      `Detalle completo en el portal:\n${portalUrl}`
    );
    return;
  }

  if (/(proximo\s+pago|proxima\s+cuota|cuando\s+pago|siguiente\s+pago)/.test(t)) {
    if (!proximaCuota) {
      await sendWA(phone, `🎉 Ya pagaste todas las cuotas de tu obra *${obra.nombre}*. ¡Gracias!\n${portalUrl}`);
      return;
    }
    const monto = cuotaMonto(proximaCuota);
    const cobrado = cuotaCobrado(proximaCuota);
    const restante = Math.max(0, monto - cobrado);
    await sendWA(phone,
      `📅 *Proxima cuota de ${obra.nombre}*\n\n` +
      `Cuota N°${proximaCuota.n || '—'}: ${proximaCuota.descripcion || ''}\n` +
      `Vence: *${fmtFecha(proximaCuota.fecha)}*\n` +
      `Monto: ${fmtMonto(monto, moneda)}` +
      (cobrado > 0 ? `\nYa pagaste: ${fmtMonto(cobrado, moneda)}\nFalta: *${fmtMonto(restante, moneda)}*` : '') +
      `\n\nDetalle: ${portalUrl}`
    );
    return;
  }

  if (/(cuanto\s+pague|pagado|cobrado|que\s+va)/.test(t)) {
    const pct = totalCuotas > 0 ? Math.round((totalCobrado / totalCuotas) * 100) : 0;
    await sendWA(phone,
      `✅ *Pagos de ${obra.nombre}*\n\n` +
      `Pagaste: *${fmtMonto(totalCobrado, moneda)}* de ${fmtMonto(totalCuotas, moneda)} (${pct}%)\n` +
      `Cuotas cobradas: ${pagadas} de ${cuotas.length}\n\n` +
      `Ver todas: ${portalUrl}`
    );
    return;
  }

  if (/(cuotas|plan\s+de\s+pagos|plan\s+pagos)/.test(t)) {
    if (cuotas.length === 0) {
      await sendWA(phone, `Tu obra *${obra.nombre}* todavia no tiene un plan de pagos definido.\n${portalUrl}`);
      return;
    }
    const lineas = cuotas.slice(0, 10).map(c => {
      const estado = cuotaEstadoCalc(c, moneda, tc);
      const icon = estado === 'pagado' ? '✅' : estado === 'parcial' ? '🟡' : '⏳';
      return `${icon} N°${c.n} ${c.descripcion || ''} — ${fmtMonto(cuotaMonto(c), moneda)} — ${fmtFecha(c.fecha)}`;
    });
    await sendWA(phone,
      `📋 *Plan de pagos · ${obra.nombre}*\n\n${lineas.join('\n')}` +
      (cuotas.length > 10 ? `\n\n…y ${cuotas.length - 10} cuotas mas.` : '') +
      `\n\nDetalle completo: ${portalUrl}`
    );
    return;
  }

  if (/(avance|como\s+va|estado\s+obra|progreso)/.test(t)) {
    await sendWA(phone,
      `🏗 *Avance de ${obra.nombre}*\n\n` +
      `Avance general: *${avanceGeneral}%*\n` +
      `Estado: ${obra.estado || '—'}\n` +
      (obra.fechaFinEstim ? `Entrega estimada: ${fmtFecha(obra.fechaFinEstim)}\n` : '') +
      `\nVer fotos y detalle: ${portalUrl}`
    );
    return;
  }

  // Default: respuesta generica con link al portal.
  await sendWA(phone,
    `No pude entender tu consulta. Probá con *ayuda* para ver las opciones disponibles, o entrá al portal para ver el detalle de tu obra:\n${portalUrl}`
  );
}

async function getAllAdmins() {
  const users  = await sbGet('app_users', '?select=*');
  const linked = await sbGet('whatsapp_users', '?select=*');
  return linked.filter(lu => {
    const u = users.find(u => u.id === lu.user_id);
    return u?.rol === 'Admin';
  });
}

// ── Conversación ──────────────────────────────────────────────────────────────
// Estado persistido en tabla whatsapp_conversations:
//   { phone, state, data, history, slots, defaults, updated_at }
//
// - state:    'idle' | 'confirmando' | 'conversando' | 'linking_*' | etc.
// - data:     misc por estado (pendingMediaUrl, lastTareaId, etc).
// - history:  últimos N mensajes (texto) para contexto al LLM.
// - slots:    slots de la intención EN CURSO (intent, monto, obraId, tareaId,
//             cantidad, unidad, ...). Se vacía al ejecutar/cancelar.
// - defaults: persiste entre sesiones (lastObraId, lastCajaId, lastProveedorId).
//
// TTL: si la conversación lleva >20 min sin update y NO estamos en idle,
// reseteamos `state='idle'` y `slots={}` pero conservamos `defaults` y
// dejamos `history` (vale como recordatorio liviano).
const TTL_MIN = 20;
const HISTORY_MAX = 16; // antes era 8, corto para flujos con foto

async function loadConversation(phone) {
  const rows = await sbGet('whatsapp_conversations', `?phone=eq.${phone}`);
  const row = rows[0] || { phone, state: 'idle', data: {}, history: [], slots: {}, defaults: {} };
  // Defaults para filas viejas que no tienen las nuevas columnas
  row.slots = row.slots || {};
  row.defaults = row.defaults || {};
  // TTL
  if (row.updated_at && row.state !== 'idle') {
    const age = (Date.now() - new Date(row.updated_at).getTime()) / 60000;
    if (age > TTL_MIN) {
      row.state = 'idle';
      row.slots = {};
      // history y defaults se conservan
    }
  }
  return row;
}

// Save completo de la conversación. Permite pasar `opts` con campos parciales
// (state, data, history, slots, defaults). Lo que no se pase se conserva
// del estado actual — para evitar borradas accidentales tipo el bug previo
// donde pasar `[]` como history hacía un wipe.
async function saveConversation(phone, opts = {}) {
  // Cargar el estado actual para mergear (evita pisar slots/defaults si
  // el caller solo quiere actualizar history o state).
  const current = await loadConversation(phone);
  const next = {
    phone,
    state:    opts.state    !== undefined ? opts.state    : current.state,
    data:     opts.data     !== undefined ? opts.data     : current.data,
    history:  opts.history  !== undefined ? opts.history  : current.history,
    slots:    opts.slots    !== undefined ? opts.slots    : current.slots,
    defaults: opts.defaults !== undefined ? opts.defaults : current.defaults,
    updated_at: new Date().toISOString(),
  };
  next.history = (next.history || []).slice(-HISTORY_MAX);
  await sbUpsert('whatsapp_conversations', next);
}

// Reset de intent: vuelve a idle, vacía slots y data, PERO mantiene history
// y defaults. Antes el clearConversation borraba todo y el bot se olvidaba.
async function clearConversation(phone) {
  await saveConversation(phone, { state: 'idle', data: {}, slots: {} });
}

// ── Usuario vinculado ─────────────────────────────────────────────────────────
async function getLinkedUser(phone) {
  const rows = await sbGet('whatsapp_users', `?phone=eq.${phone}`);
  if (!rows[0]) return null;
  const linked = rows[0];
  const appUsers = await sbGet('app_users', `?id=eq.${linked.user_id}&select=*`);
  const appUser = appUsers[0];
  if (!appUser) return null;
  return { ...linked, email: appUser.email, user_rol: appUser.rol || linked.user_rol, permisos: appUser.permisos, cajasVisibles: appUser.cajas_visibles || [] };
}

// ── Flujo de vinculación ──────────────────────────────────────────────────────
async function handleLinkingFlow(phone, text, conv) {
  if (conv.state === 'idle' || conv.state === 'linking_awaiting_user') {
    if (conv.state === 'idle') {
      await saveConversation(phone, { state: 'linking_awaiting_user', data: {}, history: [] });
      await sendWA(phone,
        '👋 Hola! Soy el asistente de *Kamak Desarrollos*.\n\n' +
        'Para vincular tu número con tu cuenta, escribí tu *nombre completo* o tu *email* registrado en el sistema.'
      );
      return;
    }

    const query = text.trim().toLowerCase();
    const appUsers = await sbGet('app_users', '?select=*');
    const match = appUsers.find(u =>
      u.email?.toLowerCase() === query ||
      u.nombre?.toLowerCase().includes(query) ||
      query.includes(u.nombre?.toLowerCase())
    );

    if (!match) {
      await sendWA(phone,
        '❌ No encontré ningún usuario con ese nombre o email.\n\nIntentá nuevamente con tu email exacto o nombre completo.'
      );
      return;
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    await sbUpsert('whatsapp_verifications', {
      code,
      phone,
      user_email: match.email,
      expires_at: expiresAt,
    });

    await saveConversation(phone, { state: 'linking_awaiting_confirmation', data: { user_email: match.email, user_name: match.nombre }, history: [] });

    await sendWA(phone,
      `✅ Encontré tu cuenta: *${match.nombre}*\n\n` +
      `Tu código de verificación es: *${code}*\n\n` +
      `Ingresá a la app Kamak y confirmá la vinculación desde el aviso que aparece en pantalla. Tenés 15 minutos.`
    );
    return;
  }

  if (conv.state === 'linking_awaiting_confirmation') {
    const linked = await sbGet('whatsapp_users', `?phone=eq.${phone}`);
    if (linked[0]) {
      await clearConversation(phone);
      await sendWA(phone,
        `🎉 ¡Tu cuenta ya está vinculada! Bienvenido/a *${linked[0].user_name}*.\n\nEscribí *ayuda* para ver qué podés hacer desde acá.`
      );
    } else {
      await sendWA(phone,
        '⏳ Todavía no confirmaste en la app.\n\nAbrí Kamak y confirmá el aviso que aparece en pantalla.'
      );
    }
  }
}

// ── Detección de corrección de avance ────────────────────────────────────────
function extractCorreccion(text, obras, detalles) {
  if (!text) return null;
  const t = norm(text);

  const corrRE = /correg|corrijo|me equivoqu|error|en realidad|eran|era\b|no eran|no son|no era\b|cambiar avance|editar avance|modific/i;
  if (!corrRE.test(t)) return null;

  // Reutilizamos la extracción de avance para sacar obra, tarea y nueva cantidad
  const base = extractAvanceCompleto(text, obras, detalles);
  // Para corrección no requerimos la señal de avance, así que si no matcheó por eso
  // intentamos buscar obra + tarea + número directamente
  if (base?.obraId && base?.tareaId && base?.cantidadAvance != null) {
    return { ...base, esCorreccion: true };
  }

  // Intento directo: número + obra + tarea (sin palabras de avance)
  const cantRE = /(\d+(?:[.,]\d+)?)\s*(mts?2?|m2|m²|m3|m³|ml|u\b|kg|hs|unid(?:ades?)?)?/i;
  const cantMatch = text.match(cantRE);
  if (!cantMatch) return null;

  let obraEncontrada = null;
  for (const o of obras) {
    const oNorm = norm(o.nombre);
    if (t.includes(oNorm)) { obraEncontrada = o; break; }
    const pals = oNorm.split(/\s+/).filter(p => p.length > 3);
    if (pals.some(p => t.includes(p))) { obraEncontrada = o; break; }
  }

  let tareaEncontrada = null, rubroEncontrado = null;
  const buscar = obraEncontrada ? [obraEncontrada, ...obras.filter(o => o.id !== obraEncontrada.id)] : obras;
  outer2:
  for (const o of buscar) {
    for (const r of (detalles[o.id]?.rubros || []).filter(r => r.tipo !== 'seccion')) {
      for (const ta of (r.tareas || []).filter(ta => ta.tipo !== 'seccion')) {
        const taNorm = norm(ta.nombre);
        const pals = taNorm.split(/\s+/).filter(p => p.length > 2);
        if (t.includes(taNorm) || pals.some(p => t.includes(p))) {
          tareaEncontrada = ta; rubroEncontrado = r;
          if (!obraEncontrada) obraEncontrada = o;
          break outer2;
        }
      }
    }
  }

  if (!obraEncontrada || !tareaEncontrada || !cantMatch) return null;

  return {
    completo:       true,
    esCorreccion:   true,
    obraId:         obraEncontrada.id,
    rubroId:        rubroEncontrado?.id || null,
    tareaId:        tareaEncontrada.id,
    cantidadAvance: parseFloat(cantMatch[1].replace(',', '.')),
    unidad:         cantMatch[2] ? norm(cantMatch[2]) : (tareaEncontrada.unidad || 'u'),
    descripcion:    text.slice(0, 120),
    _obra:          obraEncontrada,
    _tarea:         tareaEncontrada,
  };
}

// ── Extracción directa de avance — bypasa Claude cuando todo está en el texto ──
const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function extractAvanceCompleto(text, obras, detalles) {
  if (!text) return null;
  const t = norm(text);

  // Señal explícita de avance (requerida para el bypass)
  const avanceRE = /avance\s*de\s*obra|avance|coloc[aó]|instal[aó]|termin[eéóa]|terminamos|colocamos|hicimos|pusimos|avanzamos|finaliz|pegamos|revoc|enyesamos/i;
  if (!avanceRE.test(t)) return null;

  // Extraer cantidad + unidad
  // Caso 1: número + unidad estándar ("440 mts2", "75 m²")
  const cantRE = /(\d+(?:[.,]\d+)?)\s*(mts?2?|m2|m²|m3|m³|ml|u\b|kg|hs|unid(?:ades?)?)/i;
  let cantMatch = text.match(cantRE);
  let rawQty = cantMatch ? parseFloat(cantMatch[1].replace(',', '.')) : null;
  let rawUnit = cantMatch ? norm(cantMatch[2]) : null;
  let extraQtyWord = null;

  // Caso 2: número + palabra ("50 tomas", "12 bocas") — la palabra puede ser el nombre de la tarea
  if (!cantMatch) {
    const numWordMatch = t.match(/\b(\d+)\s+([a-záéíóúñ]{3,})/);
    if (numWordMatch) {
      rawQty  = parseFloat(numWordMatch[1]);
      rawUnit = 'u';
      extraQtyWord = numWordMatch[2];
    }
  } else {
    // También guardar la palabra que sigue para ayudar a matchear la tarea ("50 mts2 de ceramicos")
    const after = t.substring(t.indexOf(cantMatch[0]) + cantMatch[0].length);
    const m = after.match(/\s+de\s+([a-záéíóúñ]{3,})/);
    if (m) extraQtyWord = m[1];
  }

  // Matchear obra por nombre (full match primero, luego por palabra significativa)
  let obraEncontrada = null;
  for (const o of obras) {
    const oNorm = norm(o.nombre);
    if (t.includes(oNorm)) { obraEncontrada = o; break; }
    const palabras = oNorm.split(/\s+/).filter(p => p.length > 3);
    if (palabras.length > 0 && palabras.some(p => t.includes(p))) { obraEncontrada = o; break; }
  }

  // Matchear tarea (busca en obra encontrada primero, luego en el resto)
  let tareaEncontrada = null, rubroEncontrado = null;
  const obrasBuscar = obraEncontrada
    ? [obraEncontrada, ...obras.filter(o => o.id !== obraEncontrada.id)]
    : obras;

  outer:
  for (const o of obrasBuscar) {
    const rubros = (detalles[o.id]?.rubros || []).filter(r => r.tipo !== 'seccion');
    for (const r of rubros) {
      for (const ta of (r.tareas || []).filter(ta => ta.tipo !== 'seccion')) {
        const taNorm = norm(ta.nombre);
        const taPals = taNorm.split(/\s+/).filter(p => p.length > 2);
        // Coincidencia: nombre completo, cualquier palabra significativa, o extraQtyWord
        const matchNombre = t.includes(taNorm);
        const matchPalabra = taPals.some(p => t.includes(p));
        const matchQtyWord = extraQtyWord && taPals.some(p =>
          p === extraQtyWord || p.startsWith(extraQtyWord) || extraQtyWord.startsWith(p)
        );
        if (matchNombre || matchPalabra || matchQtyWord) {
          tareaEncontrada = ta; rubroEncontrado = r;
          if (!obraEncontrada) obraEncontrada = o;
          break outer;
        }
      }
    }
  }

  if (!obraEncontrada && !tareaEncontrada) return null;

  return {
    completo:      !!(obraEncontrada && tareaEncontrada && rawQty != null),
    obraId:        obraEncontrada?.id || null,
    rubroId:       rubroEncontrado?.id || null,
    tareaId:       tareaEncontrada?.id || null,
    cantidadAvance: rawQty,
    unidad:        rawUnit || tareaEncontrada?.unidad || 'u',
    descripcion:   text.slice(0, 120),
    _obra:         obraEncontrada,
    _tarea:        tareaEncontrada,
  };
}

// ── Claude: interpretar mensaje ───────────────────────────────────────────────
async function callClaude(user, messageText, base64Media, mimeType, conv, ctx, mediaUrl = null) {
  const cajasUsuario = ctx.cajas.filter(c => user.cajasVisibles.length === 0 || user.cajasVisibles.includes(c.id));
  const cajasEfectivo = ctx.cajas.filter(c => c.tipo === 'efectivo' && c.usuarioId === user.email);
  const cajaEfectivoARS = cajasEfectivo.find(c => c.moneda === 'ARS');
  const cajaEfectivoUSD = cajasEfectivo.find(c => c.moneda === 'USD');

  // Última obra usada por este usuario (de movimientos aprobados)
  const userMovs = ctx.movimientos
    .filter(m => m.obraId && (m.creadoPor === user.user_name || m.creadoPorWA))
    .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  const ultimaObraId = userMovs[0]?.obraId || null;
  const ultimaObra = ultimaObraId ? ctx.obras.find(o => o.id === ultimaObraId) : null;

  // Rubros de la obra en contexto (conversación activa o última usada)
  const obraContextId = conv.data?.obraId || ultimaObraId;
  const obraContext = obraContextId ? ctx.obras.find(o => o.id === obraContextId) : null;
  const obraRubros = obraContextId
    ? (ctx.detalles[obraContextId]?.rubros || []).filter(r => r.tipo !== 'seccion')
    : [];

  // Pre-extracción parcial como hint (para cuando el bypass no activó)
  const preExtObj = extractAvanceCompleto(messageText, ctx.obras, ctx.detalles);
  const preExtracted = preExtObj ? [
    preExtObj.cantidadAvance != null ? `cantidadAvance=${preExtObj.cantidadAvance} unidad=${preExtObj.unidad}` : null,
    preExtObj._obra ? `obra="${preExtObj._obra.nombre}" obraId=${preExtObj.obraId}` : null,
    preExtObj._tarea ? `tarea="${preExtObj._tarea.nombre}" tareaId=${preExtObj.tareaId} rubroId=${preExtObj.rubroId}` : null,
  ].filter(Boolean).join(' · ') : null;

  // Rubros de TODAS las obras activas para que Claude siempre pueda matchear
  const allRubrosStr = ctx.obras.slice(0, 6).map(o => {
    const rubros = (ctx.detalles[o.id]?.rubros || []).filter(r => r.tipo !== 'seccion').slice(0, 6);
    if (rubros.length === 0) return null;
    const isCtx = o.id === obraContextId;
    const rubStr = rubros.map(r => {
      const ts = (r.tareas || []).filter(t => t.tipo !== 'seccion').slice(0, 12);
      const tsStr = ts.length > 0
        ? '\n' + ts.map(t => `      TAREA:${t.id}|${t.nombre}|total:${t.cantidad}${t.unidad}|av:${t.avance||0}%${isCtx ? `|costoSubUnit:${Math.round(t.costoSub||0)}` : ''}`).join('\n')
        : '';
      return `    RUBRO:${r.id}|${r.nombre}|prov:${r.proveedor||'—'}${tsStr}`;
    }).join('\n');
    return `  OBRA:${o.id}|${o.nombre}${isCtx ? ' ← CONTEXTO ACTUAL' : ''}\n${rubStr}`;
  }).filter(Boolean).join('\n') || 'sin rubros cargados';

  // ── SLOTS YA CONOCIDOS — bloque crítico anti-repreguntas ────────────────────
  // Si el caller cargó conv.slots (con valores extraídos por extractors.js),
  // los inyectamos al prompt con instrucción explícita de NO repreguntar.
  const slotsObj = conv?.slots || {};
  const slotsEntries = Object.entries(slotsObj).filter(([_, v]) => v != null && v !== '');
  const slotsBlock = slotsEntries.length > 0
    ? `\n\n🔑 SLOTS YA CONOCIDOS (NO REPREGUNTES POR ESTOS):\n${slotsEntries.map(([k, v]) => `  ${k}: ${v}`).join('\n')}\nUsalos directamente en la acción. Si falta algo, preguntá SOLO por lo que falta. Si el usuario corrige uno ("no, eran 60k"), mergealo sobre los slots ya conocidos sin pedir lo que ya tenías.`
    : '';

  // Defaults: última obra/caja/etc usada por el user (persiste entre sesiones).
  const defaultsObj = conv?.defaults || {};
  const defaultsEntries = Object.entries(defaultsObj).filter(([_, v]) => v != null && v !== '');
  const defaultsBlock = defaultsEntries.length > 0
    ? `\n\n📌 DEFAULTS DEL USUARIO (usá si el mensaje no especifica obra/caja/etc):\n${defaultsEntries.map(([k, v]) => `  ${k}: ${v}`).join('\n')}`
    : '';

  const systemPrompt = `Sos el asistente de WhatsApp de Kamak Desarrollos, una constructora argentina.
Ayudás al equipo interno a registrar información en el sistema de gestión.
${slotsBlock}${defaultsBlock}

USUARIO ACTUAL:
- Nombre: ${user.user_name}
- Rol: ${user.user_rol}
- Caja efectivo ARS propia: ${cajaEfectivoARS ? `${cajaEfectivoARS.id}|${cajaEfectivoARS.nombre}` : 'ninguna'}
- Caja efectivo USD propia: ${cajaEfectivoUSD ? `${cajaEfectivoUSD.id}|${cajaEfectivoUSD.nombre}` : 'ninguna'}
- Otras cajas accesibles: ${cajasUsuario.filter(c => c.tipo !== 'efectivo' || c.usuarioId !== user.email).map(c => `${c.id}|${c.nombre}(${c.tipo},${c.moneda})`).join(', ') || 'ninguna'}

OBRAS ACTIVAS:
${ctx.obras.map(o => `- ${o.id}|${o.nombre}`).join('\n') || 'No hay obras activas'}

ÚLTIMA OBRA DEL USUARIO:
${ultimaObra ? `${ultimaObra.id}|${ultimaObra.nombre}` : 'sin historial'}

OBRAS ACTIVAS CON RUBROS Y TAREAS (buscá aquí obra y tarea cuando el usuario las mencione):
${allRubrosStr}
→ Para AVANCE_OBRA: usá los IDs exactos RUBRO:id y TAREA:id de esta lista. Matcheá obra y tarea por nombre aunque el usuario escriba con errores o abreviado.

PROVEEDORES:
${ctx.proveedores.slice(0, 30).map(p => `- ${p.id}|${p.nombre}(${p.tipo})`).join('\n')}

MATCHING DE CAJAS Y OBRAS — MUY IMPORTANTE:
- Ignorá mayúsculas/minúsculas siempre. "baradero" = "Baradero", "franco" = "Franco".
- Usá matching parcial: si el usuario dice "caja franco" buscá la caja cuyo nombre contenga "franco".
- Si el usuario dice "obra baradero" buscá la obra cuyo nombre contenga "baradero".
- Si hay una sola coincidencia parcial, usala directamente sin preguntar.
- Solo preguntá si hay ambigüedad (2+ coincidencias) o ninguna.

CAJA EFECTIVO AUTOMÁTICA — MUY IMPORTANTE:
- Si el usuario dice "en efectivo", "de mi caja", "caja propia", "pagué en mano" o no especifica caja: usá automáticamente SU caja efectivo.
- Si el monto es en pesos ($, ARS, pesos): usá su "Caja efectivo ARS propia".
- Si el monto es en dólares (USD, u$s, dólares): usá su "Caja efectivo USD propia".
- Si el usuario especifica otra caja por nombre: buscala por matching parcial entre "Otras cajas accesibles".
- NUNCA preguntés qué caja si el pago es en efectivo y el usuario tiene su caja efectivo configurada.

OBRA — INFERENCIA Y CONFIRMACIÓN:
- Si el usuario no menciona obra pero hay "Última obra del usuario": proponé esa obra y pedí confirmación.
  Ejemplo: "¿Es para [nombre obra]?" — si confirma, usá ese obraId.
- Si el usuario confirma la obra sugerida (sí/dale/esa/correcto): usá esa obra.
- NUNCA uses una obra sin que el usuario la haya mencionado o confirmado.
- Si el usuario menciona una obra: buscala por matching parcial en la lista de obras activas.

RUBRO — SUGERENCIA INTELIGENTE:
- Cuando el usuario describe un MATERIAL o SERVICIO (ej: "tornillos", "pintura", "arena", "caños"), analizá qué rubros de la obra son compatibles con ese material.
- Descartá los rubros donde ese material claramente NO se usaría (ej: tornillos no van en Pintura, arena no va en Electricidad).
- Si quedan 2 o más rubros posibles, preguntá: "¿Para qué rubro?\n1) Albañilería\n2) Construcción en seco\n..." (solo los relevantes, máx 4 opciones)
- Si solo queda 1 rubro posible, usalo directamente sin preguntar.
- Si no hay obra seleccionada todavía, primero confirmá la obra, luego preguntás el rubro.
- El rubro se guarda en el campo "descripcion" del gasto junto al material: "Tornillos - Albañilería".

RAZONAMIENTO DE CATEGORÍA — INFERÍ SIN PREGUNTAR:
- Si el gasto NO corresponde a un material/servicio de obra (no matchea ningún rubro), inferí la categoría lógica por sentido común y poné una descripción clara. NO preguntes, asumí lo razonable:
  · comida, almuerzo, vianda, café, agua, asado, factura(panadería) → *Viáticos* (descripcion: "Viáticos - comida" o similar)
  · nafta, combustible, gasoil, peaje, estacionamiento, uber, remís, pasaje, colectivo → *Movilidad / Combustible*
  · herramienta, taladro, amoladora, alquiler de equipo, andamio → *Herramientas / Equipos*
  · librería, fotocopias, impresión, resma → *Gastos administrativos*
  · seguro, ART, sindicato, honorarios → *Gastos generales*
  · propina, adelanto, anticipo a alguien → *Anticipo / Varios*
- Ejemplo: "gasté en comida \$2.000 en Baradero" → gasto, monto:2000, obraId:baradero, descripcion:"Viáticos - comida", categoria:"general". Ejecutá directo si tenés obra + monto, no repreguntes.
- Cuando dudes entre 2 categorías muy distintas, ahí sí preguntá; pero para casos obvios (comida=viáticos, nafta=combustible) asumí y avisá en el resumen de confirmación qué asumiste.

FOTO EN ESTA CONVERSACIÓN:
- Foto en este mensaje: ${base64Media ? 'SÍ (recién recibida)' : 'NO'}
- Foto guardada de mensaje anterior: ${conv.data?.pendingMediaUrl ? 'SÍ (ya subida, disponible para usar)' : 'NO'}
→ Si hay foto guardada de antes, considerala como si fuera parte de este intercambio. NO pidas otra foto.

ROL DEL USUARIO — SESGO POR DEFECTO (no es una regla fija, cualquier rol puede hacer cualquier cosa):
- "Jefe de obra" / "Capataz": en caso de ambigüedad, asumí avance_obra. Si la foto no parece factura y no dice "compré" o "gasté" → avance. Si el usuario dice explícitamente "gasto", "pagué", "compré" → registrá como gasto.
- "Compras" / "Administración": en caso de ambigüedad, asumí gasto/factura. Si el usuario dice explícitamente "avance", "terminamos", "colocamos" → registrá como avance_obra.
- "Admin": sin sesgo. Seguí el flujo normal de preguntas.

TEXTO TIENE PRIORIDAD SOBRE LA IMAGEN:
- Si el texto del mensaje dice "avance de obra", "Avance de obra", "avancé", "foto del avance" → es SIEMPRE avance_obra. No importa lo que veas en la foto, el texto manda.
- Si el texto menciona una tarea ("revoque grueso", "cerámicos", "pintura"), usá ese texto para matchear con la lista de tareas. No analices la imagen para determinar la tarea.
- La foto es solo evidencia visual adjunta al registro, no es la fuente principal de interpretación.

EXTRACCIÓN DE CONTEXTO DEL HISTORIAL — MUY IMPORTANTE:
- Antes de hacer cualquier pregunta, revisá el HISTORIAL completo de la conversación.
- Si en algún mensaje anterior ya se mencionó la tarea, cantidad, obra o cualquier dato → usá ese dato directamente. NO lo vuelvas a pedir.
- Ejemplo: si el historial tiene "285 mts2 de revoque grueso en Baradero" → ya tenés cantidadAvance=285, unidad=m², tarea≈Revoque grueso, obra=Baradero. No preguntes nada de eso.
- Cuando el usuario confirma ("sí", "es avance", "para Baradero") → es una confirmación, no una nueva instrucción. Integrá esa confirmación con lo que ya tenés del historial y armá el registro completo.

AVANCE DE OBRA — PARSEO INTELIGENTE:
- REGLA CLAVE: si el mensaje (o el historial) tiene cantidad en unidades de obra (m², ml, m3, u, kg, hs) + nombre de trabajo + nombre de obra, y NO menciona precio → es avance_obra. Procesalo directo sin preguntar.
  Ejemplo: "285 mts2 de revoque grueso en obra Baradero" → avance_obra, obra=Baradero, tarea≈Revoque, cantidadAvance=285, unidad=m²
- Palabras que indican avance: "avance de obra", "avancé", "colocados", "instalados", "terminados", "terminé", "colocamos", "hicimos", "pusimos", "avanzamos", "quedó listo", "finalizado", "pegamos", "grueso", "revocamos".
- Matcheá obra y tarea por similitud: "revoque grueso" → tarea "Revoque", "ceramicos" → "Cerámicos". No importan mayúsculas ni tildes.
- Extraé cantidadAvance del número + unidad: "285 mts2" → 285 m², "20 metros lineales" → 20 ml.
- Mandá siempre los IDs exactos rubroId y tareaId. Calculá % automáticamente: cantidadAvance / total de la tarea.
- DISTINGUIR "hoy/se hizo" (suma) vs "total acumulado" (corrige):
  • "150 m² hoy", "hicimos 50 m² hoy", "se colocaron 30 m²" → es AVANCE DEL DIA: datos.esCorreccion=false (se SUMA al avance previo).
  • "ya van 850 m² en total", "llevamos 700 m² acumulados", "el total es 500 m²" → es CORRECCIÓN/SET: datos.esCorreccion=true (REEMPLAZA el avance, no suma).
- Si el usuario es ambiguo entre "hoy" vs "total", PREGUNTÁ explícitamente: "¿son los m² que hicieron hoy o el total acumulado de la tarea?".

ORDEN DE PREGUNTAS (nunca más de una a la vez):
0. SIEMPRE revisá el historial ANTES de hacer preguntas. Si la información ya fue dada, usala. No repitas preguntas.
1. Si llega FOTO:
   - Si el texto dice "avance de obra", "Avance de obra", o tiene cantidad+tarea → avance_obra DIRECTO, armá el registro con toda la info disponible (texto + historial).
   - Si parece factura (números, CUIT, totales, IVA) → factura_compra.
   - Si el texto dice "gasto"/"pagué"/"compré" → gasto con comprobante.
   - Si el texto tiene cantidad en unidades (m², ml, u, etc.) + trabajo + sin precio → avance_obra directo.
   - Si el texto dice "avancé"/"colocamos"/"terminamos"/"instalados"/"terminé" → avance_obra.
   - Si NO hay texto claro y rol es "Jefe de obra"/"Capataz" → asumí avance_obra, preguntá SOLO lo que no se sabe.
   - Si NO hay texto claro y rol es "Compras"/"Administración" → preguntá "¿Factura o gasto?"
   - Si NO hay texto claro y rol es "Admin" → preguntá "¿Avance, gasto o factura?"
2. Si llega FOTO + texto de gasto: procesá como gasto con comprobante=blanco automáticamente.
3. Si llega FOTO + texto de avance ("avancé", "foto de avance", "progreso", "terminé", "colocamos", "terminado", "avance de obra"): procesá como avance_obra directamente.
4. Si falta monto → preguntá el monto
5. Si falta obra → proponé la última o pedí que la indique
6. Si falta rubro → mostrá opciones relevantes al material
7. Si falta comprobante (y NO hay foto en esta conversación) → preguntá "¿Tiene factura? (sí/no)"
8. Con todo completo → mostrá resumen y pedí confirmación

ACCIONES DISPONIBLES:
1. GASTO: monto, descripción, obraId(opcional), cajaId, proveedorNombre(opcional), tipo(material/mano_de_obra/general), comprobante(blanco/negro), rubroId(opcional)
2. INGRESO: monto, descripción, obraId, cajaId
3. FACTURA_COMPRA: foto/PDF de factura de proveedor. Extraé: tipoFactura('A'/'B'/'C'), numeroFactura, proveedor, cuit, fecha(YYYY-MM-DD), monto(neto sin IVA), montoTotal(con IVA), concepto
4. AVANCE_OBRA: obraId(ID exacto de la lista), rubroId(ID del rubro), tareaId(ID de la tarea), cantidadAvance(unidades completadas, ej:75), unidad(ej:'m²'), porcentajeAvance(% a sumar si no hay cantidad), descripcion
5. CHEQUE_RECIBIDO: obraId, cajaDestinoId
6. COMANDOS: ayuda | saldo | pendientes | cheques | resumen [obraId] [fecha YYYY-MM-DD] | como_va_obra (datos.obra=nombre) | cc_proveedor (datos.proveedor=nombre) | contacto_proveedor (datos.proveedor=nombre)
7. TAREAS — comandos: tareas (lista mis pendientes), tarea_detalle (con datos.numero=N), completar_item (con datos.numero=N — marca item N de la última tarea vista)
8. NUEVA_TAREA (solo Admin): si el admin dice "creale tarea a Juan: comprar cemento" o similar, accion.tipo='nueva_tarea' con datos: { titulo, descripcion?, asignadoNombre (nombre del usuario destinatario), prioridad?('baja'|'media'|'alta'), fechaLimite?(YYYY-MM-DD), checklist?[textos] }. Si falta el asignado, preguntar a quién. Si no es admin, responder que solo el admin puede crear tareas para otros — pero cualquier user puede pedir "crear tarea para mí" (auto-asignación).
9. TRASPASO (solo Admin): si el admin dice "pasá $200k de Caja Franco a Banco Galicia" o similar, accion.tipo='traspaso' con datos: { monto, cajaId (ID de la caja origen), cajaDestinoId (ID de la caja destino), montoDestino?(opcional para cross-moneda con TC distinto), descripcion? }. Matchear nombre de caja por nombre parcial. Si las cajas son de moneda distinta y el user no aclaró tipo de cambio, preguntá.

REGLAS DE FLUJO:
- El usuario escribe corto y conciso. Interpretá la intención aunque falten datos.
- Si la caja se resuelve por efectivo automático, NO la preguntes.
- Si hay foto en esta conversación y es un gasto: comprobante = blanco automáticamente, no preguntes.
- Para AVANCE_OBRA: el obraId en datos DEBE ser el ID exacto de la lista de obras activas (ej: "obra-baradero"), no el nombre.
- Si el usuario confirma (sí/si/dale/ok/confirmo/correcto/s): estado = "ejecutar"
- Si el usuario cancela (no/cancelar/error/mal/n): estado = "cancelar"
- Para comprobante sin foto: "factura"/"con factura"/"blanco" = blanco; "sin factura"/"negro" = negro
- Respondé en español argentino, breve y directo.

HISTORIAL DE CONVERSACIÓN:
${conv.history.map(h => `${h.rol}: ${h.texto}`).join('\n') || 'Sin historial'}

${preExtracted ? `EXTRACCIÓN AUTOMÁTICA DEL MENSAJE ACTUAL (datos ya identificados — USÁ ESTOS DIRECTAMENTE, no preguntes por ellos):
→ ${preExtracted}
Si tenés obra+tarea+cantidad → ejecutá avance_obra directo con estado:"ejecutar".` : ''}

Respondé ÚNICAMENTE con JSON válido:
{
  "mensaje": "texto a enviar al usuario (máx 400 chars)",
  "estado": "conversando" | "confirmando" | "ejecutar" | "cancelar" | "comando",
  "accion": {
    "tipo": "gasto" | "ingreso" | "factura_compra" | "avance_obra" | "cheque_recibido" | "comando" | "nueva_tarea" | "traspaso" | null,
    "datos": {}
  }
}`;

  // Text FIRST so Claude reads it with priority before analyzing the image
  const userContent = [];
  userContent.push({ type: 'text', text: messageText || '(imagen adjunta)' });
  if (base64Media && mimeType) {
    if (mimeType === 'application/pdf') {
      userContent.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Media } });
    } else if (mimeType.startsWith('image/')) {
      userContent.push({ type: 'image', source: { type: 'base64', media_type: mimeType, data: base64Media } });
    }
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 2048, system: systemPrompt, messages: [{ role: 'user', content: userContent }] }),
  });
  const data = await res.json();

  try {
    const text = data.content[0].text.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    return JSON.parse(text);
  } catch {
    return { mensaje: 'Perdón, no entendí bien. ¿Podés repetirlo?', estado: 'conversando', accion: { tipo: null, datos: {} } };
  }
}

// ── Ejecutar acción ───────────────────────────────────────────────────────────
// Arma el texto de confirmación de una acción a partir de sus datos.
// Usado cuando el user edita un dato durante la confirmación, para re-mostrar
// el resumen actualizado sin volver a llamar a Claude.
function resumenAccion(accion, ctx) {
  const d = accion?.datos || {};
  const obra = ctx.obras.find(o => o.id === d.obraId);
  const caja = ctx.cajas.find(c => c.id === d.cajaId);
  const fmt = n => `$${Math.round(n || 0).toLocaleString('es-AR')}`;
  if (accion.tipo === 'gasto' || accion.tipo === 'ingreso') {
    return (
      `📋 *Confirmar ${accion.tipo}:*\n\n` +
      `💵 Monto: *${fmt(d.monto)}*\n` +
      (obra ? `🏗 Obra: *${obra.nombre}*\n` : '') +
      (d.descripcion ? `📝 ${d.descripcion}\n` : '') +
      (caja ? `🏦 Caja: ${caja.nombre}\n` : '')
    );
  }
  if (accion.tipo === 'avance_obra') {
    const obraA = ctx.obras.find(o => o.id === d.obraId);
    let tareaNombre = d.tareaNombre;
    if (!tareaNombre && obraA) {
      const det = ctx.detalles?.[obraA.id];
      for (const r of (det?.rubros || [])) {
        const t = (r.tareas || []).find(x => x.id === d.tareaId);
        if (t) { tareaNombre = t.nombre; break; }
      }
    }
    return (
      `📋 *Confirmar avance:*\n\n` +
      (obraA ? `🏗 Obra: *${obraA.nombre}*\n` : '') +
      (tareaNombre ? `📐 Tarea: *${tareaNombre}*\n` : '') +
      `📊 Cantidad: *${d.cantidadAvance ?? d.cantidad ?? '?'}${d.unidad || ''}*\n`
    );
  }
  if (accion.tipo === 'traspaso') {
    const co = ctx.cajas.find(c => c.id === d.cajaId);
    const cd = ctx.cajas.find(c => c.id === d.cajaDestinoId);
    return (
      `📋 *Confirmar traspaso:*\n\n` +
      `💵 Monto: *${fmt(d.monto)}*\n` +
      (co ? `↳ De: ${co.nombre}\n` : '') +
      (cd ? `↳ A: ${cd.nombre}\n` : '')
    );
  }
  // Genérico
  return `📋 *Confirmar ${accion.tipo}:*\n\n${JSON.stringify(d, null, 1)}`;
}

async function ejecutarAccion(tipo, datos, user, ctx, mediaUrl = null) {
  if (tipo === 'gasto' || tipo === 'ingreso') {
    const obra  = ctx.obras.find(o => o.id === datos.obraId);
    const caja  = ctx.cajas.find(c => c.id === datos.cajaId);
    const monto = Math.round(parseFloat(datos.monto) || 0);
    const tipoStr = tipo === 'gasto' ? 'gasto' : 'ingreso';
    const obraMoneda = obra?.moneda || 'ARS';
    const montoFmt = fmtMonto(monto, obraMoneda);

    const nuevoMov = {
      id:               `mov-${Date.now()}`,
      tipo:             tipo,
      descripcion:      datos.descripcion || '',
      monto,
      fecha:            datos.fecha || new Date().toISOString().split('T')[0],
      obraId:           datos.obraId || null,
      obraNombre:       obra?.nombre || 'General',
      cajaId:           datos.cajaId,
      cajaDestinoId:    null,
      proveedor:        datos.proveedorNombre || '',
      categoria:        datos.tipo === 'mano_de_obra' ? 'mano-de-obra' : datos.tipo === 'material' ? 'material' : 'general',
      medioPago:        'Transferencia',
      comprobante:      datos.comprobante || 'negro',
      comprobanteUrl:   mediaUrl || null,
      creadoPorWA:      true,
      creadoPor:        user.user_name,
    };

    // ── Rama Admin: auto-aplicar (sin pasar por Autorizaciones) ───────────────
    if (user.user_rol === 'Admin') {
      const movData = await loadSharedData('movimientos');
      const movs  = movData?.movimientos || [];
      const cajas = movData?.cajas || ctx.cajas;
      // Actualizar saldo de la caja en el momento.
      const delta = tipo === 'ingreso' ? monto : -monto;
      const updatedCajas = cajas.map(c =>
        c.id === datos.cajaId ? { ...c, saldo: (c.saldo || 0) + delta } : c
      );
      await saveSharedData('movimientos', {
        movimientos: [nuevoMov, ...movs],
        cajas:       updatedCajas,
      });

      // Si es gasto → confirmación seca y listo.
      if (tipo === 'gasto') {
        return `✅ Gasto de *${montoFmt}* aplicado a *${obra?.nombre || 'General'}* desde *${caja?.nombre || '—'}*.\nQueda editable desde la app.`;
      }

      // Es ingreso → ofrecer notificar al cliente.
      if (!obra) {
        return `✅ Ingreso de *${montoFmt}* aplicado a *${caja?.nombre || '—'}*.\n⚠️ Sin obra asignada, no puedo avisar a ningún cliente.`;
      }

      const cliente = findClienteByObra(obra, ctx.clientes || []);
      if (!cliente) {
        return `✅ Ingreso de *${montoFmt}* aplicado a *${obra.nombre}*.\n⚠️ No encontré a *"${obra.cliente}"* en clientes. Cargalo en la app cuando puedas para poder avisarle automáticamente.`;
      }

      const tel = normalizePhone(cliente.whatsapp || cliente.telefono);
      if (!tel) {
        // Cliente sin teléfono → pedirlo por WA.
        await saveConversation(user.phone, { state: 'awaiting_client_phone', data: {
          clienteId:     cliente.id,
          clienteNombre: cliente.nombre,
          obraNombre:    obra.nombre,
          monto,
          moneda:        obraMoneda,
          recibidoPor:   user.user_name,
        } });
        return `✅ Ingreso de *${montoFmt}* aplicado a *${obra.nombre}*.\n\n📱 *${cliente.nombre}* no tiene WhatsApp cargado. ¿Cuál es su número? (con cód. país, ej. 5491155551234)\n\nO escribí *no* para omitir el aviso.`;
      }

      // Cliente OK → preguntar antes de mandar.
      await saveConversation(user.phone, { state: 'awaiting_client_notice', data: {
        clienteId:     cliente.id,
        clienteNombre: cliente.nombre,
        clienteTel:    tel,
        obraNombre:    obra.nombre,
        monto,
        moneda:        obraMoneda,
        recibidoPor:   user.user_name,
      } });
      return `✅ Ingreso de *${montoFmt}* aplicado a *${obra.nombre}*.\n\n¿Aviso a *${cliente.nombre}* por WhatsApp? (sí/no)`;
    }

    // ── Rama no-Admin: flujo de aprobación (igual que antes) ──────────────────
    nuevoMov.estadoAprobacion = 'pendiente';

    const pendingRows = await sbGet('shared_data', '?key=eq.whatsapp_pending&select=data');
    const existing = Array.isArray(pendingRows[0]?.data) ? pendingRows[0].data : [];
    const newPending = [{
      id:            `wp-${Date.now()}`,
      tipoPendiente: 'movimiento',
      movimiento:    nuevoMov,
      from:          user.phone,
      creadoPor:     user.user_name,
      receivedAt:    new Date().toISOString(),
      status:        'pendiente',
    }, ...existing];

    await fetch(`${SUPABASE_URL}/rest/v1/shared_data`, {
      method: 'POST',
      headers: { ...sbH(), 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({ key: 'whatsapp_pending', data: newPending, updated_at: new Date().toISOString() }),
    });
    await broadcastChange('whatsapp_pending');

    const admins = await getAllAdmins();
    const msgAdmin =
      `📋 *Nueva solicitud de aprobación*\n\n` +
      `*${user.user_name}* registró un ${tipoStr}:\n` +
      `• Monto: *${montoFmt}*\n` +
      `• Concepto: ${datos.descripcion || '—'}\n` +
      `• Obra: ${obra?.nombre || 'General'}\n` +
      `• Caja: ${caja?.nombre || '—'}\n` +
      `• Comprobante: ${datos.comprobante === 'blanco' ? '✅ Con factura' : '⚠️ Sin factura'}` +
      `${mediaUrl ? '\n• Foto: adjunta' : ''}\n\n` +
      `Revisalo en la app Kamak → Buzón WhatsApp.`;

    for (const admin of admins) {
      await sendWA(admin.phone, msgAdmin);
    }

    return `✅ Listo. El ${tipoStr} de *${montoFmt}* fue enviado a aprobación.\nLos administradores recibirán una notificación.`;
  }

  if (tipo === 'factura_compra') {
    const pendingRows = await sbGet('shared_data', '?key=eq.whatsapp_pending&select=data');
    const existing = Array.isArray(pendingRows[0]?.data) ? pendingRows[0].data : [];
    const newPending = [{
      id:            `wp-${Date.now()}`,
      tipoPendiente: 'factura',
      tipoFactura:   datos.tipoFactura   || '',
      numeroFactura: datos.numeroFactura || '',
      proveedor:     datos.proveedor     || '',
      cuit:          datos.cuit          || '',
      fecha:         datos.fecha         || new Date().toISOString().split('T')[0],
      concepto:      datos.concepto      || '',
      monto:         datos.monto         != null ? Math.round(datos.monto) : null,
      montoTotal:    datos.montoTotal    != null ? Math.round(datos.montoTotal) : null,
      mediaType:     mediaUrl?.endsWith('.pdf') ? 'pdf' : 'image',
      mediaUrl:      mediaUrl || null,
      from:          user.phone,
      creadoPor:     user.user_name,
      receivedAt:    new Date().toISOString(),
      status:        'pendiente',
    }, ...existing];

    await fetch(`${SUPABASE_URL}/rest/v1/shared_data`, {
      method: 'POST',
      headers: { ...sbH(), 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({ key: 'whatsapp_pending', data: newPending, updated_at: new Date().toISOString() }),
    });
    await broadcastChange('whatsapp_pending');

    const admins = await getAllAdmins();
    const montoStr = datos.montoTotal != null ? `$${Math.round(datos.montoTotal).toLocaleString('es-AR')}` : '—';
    for (const admin of admins) {
      await sendWA(admin.phone,
        `📄 *Nueva factura recibida*\n\n` +
        `*${user.user_name}* envió una factura${datos.tipoFactura ? ` ${datos.tipoFactura}` : ''}:\n` +
        `• Proveedor: ${datos.proveedor || '—'}\n` +
        `• Monto: ${montoStr}\n` +
        `• N°: ${datos.numeroFactura || '—'}\n\n` +
        `Revisala en la app Kamak → Buzón WhatsApp.`
      );
    }

    return `✅ Factura${datos.tipoFactura ? ` ${datos.tipoFactura}` : ''} de *${datos.proveedor || 'proveedor'}* recibida.\n${datos.montoTotal != null ? `Monto: *${montoStr}*\n` : ''}Los administradores la revisarán para aprobarla.`;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TRASPASO entre cajas (FASE 2)
  // ─────────────────────────────────────────────────────────────────────────
  if (tipo === 'traspaso') {
    const cajaOrigen  = ctx.cajas.find(c => c.id === datos.cajaId);
    const cajaDestino = ctx.cajas.find(c => c.id === datos.cajaDestinoId);
    const monto = Math.round(parseFloat(datos.monto) || 0);
    if (!cajaOrigen || !cajaDestino) return '❌ No encontré alguna de las cajas. Verificá los nombres.';
    if (cajaOrigen.id === cajaDestino.id) return '❌ La caja origen y destino son la misma.';
    if (!monto || monto <= 0) return '❌ El monto del traspaso debe ser mayor a 0.';

    const montoDestino = parseFloat(datos.montoDestino) || monto;
    const fmt = (n, mon) => `${mon === 'USD' ? 'U$S' : '$'} ${Math.round(n).toLocaleString('es-AR')}`;

    if (user.user_rol === 'Admin') {
      const movData = await loadSharedData('movimientos');
      const movs    = movData?.movimientos || [];
      const cajas   = movData?.cajas || ctx.cajas;
      const nuevoMov = {
        id:           `mov-${Date.now()}`,
        tipo:         'traspaso',
        descripcion:  datos.descripcion || `Traspaso ${cajaOrigen.nombre} → ${cajaDestino.nombre}`,
        monto,
        montoDestino,
        fecha:        datos.fecha || new Date().toISOString().split('T')[0],
        obraId:       null,
        obraNombre:   'General',
        cajaId:       cajaOrigen.id,
        cajaDestinoId: cajaDestino.id,
        proveedor:    '',
        categoria:    'traspaso',
        medioPago:    'Interno',
        creadoPorWA:  true,
        creadoPor:    user.user_name,
      };
      // Actualizar saldos
      const updatedCajas = cajas.map(c => {
        if (c.id === cajaOrigen.id)  return { ...c, saldo: (c.saldo || 0) - monto };
        if (c.id === cajaDestino.id) return { ...c, saldo: (c.saldo || 0) + montoDestino };
        return c;
      });
      await saveSharedData('movimientos', { movimientos: [nuevoMov, ...movs], cajas: updatedCajas });
      return (
        `✅ *Traspaso registrado*\n\n` +
        `${fmt(monto, cajaOrigen.moneda)} de *${cajaOrigen.nombre}*\n` +
        `→ ${fmt(montoDestino, cajaDestino.moneda)} a *${cajaDestino.nombre}*` +
        (cajaOrigen.moneda !== cajaDestino.moneda ? ` _(cross-moneda)_` : '')
      );
    } else {
      return '⚠️ Los traspasos entre cajas los puede hacer solo un Admin.';
    }
  }

  if (tipo === 'avance_obra') {
    const obraQ = (datos.obraId || '').toLowerCase();
    const obra  = ctx.obras.find(o => o.id === datos.obraId) ||
                  ctx.obras.find(o => o.nombre?.toLowerCase().includes(obraQ));
    if (!obra) return '❌ Obra no encontrada. Indicá el nombre de la obra.';

    const [obrasData, provData] = await Promise.all([
      loadSharedData('obras'),
      loadSharedData('proveedores'),
    ]);
    const detalles = obrasData?.detalles || {};
    const detalle  = detalles[obra.id] || { rubros: [], fotos: [] };

    // Buscar rubro y tarea para actualizar avance
    let rubroIdx = -1, tareaIdx = -1, tarea = null, rubro = null;
    if (datos.tareaId) {
      for (let ri = 0; ri < detalle.rubros.length; ri++) {
        const r = detalle.rubros[ri];
        const ti = (r.tareas || []).findIndex(t => t.id === datos.tareaId);
        if (ti >= 0) { rubroIdx = ri; tareaIdx = ti; tarea = r.tareas[ti]; rubro = r; break; }
      }
    }
    if (!rubro && datos.rubroId) {
      rubroIdx = detalle.rubros.findIndex(r => r.id === datos.rubroId);
      if (rubroIdx >= 0) rubro = detalle.rubros[rubroIdx];
    }

    // Calcular avance y valor a certificar (costoMat + costoSub = valor total del trabajo)
    const esCorreccion = !!datos.esCorreccion;
    let avanceAgregado = 0;
    let valorCertificado = 0;
    const cantAvance = parseFloat(datos.cantidadAvance) || 0;
    if (tarea && cantAvance > 0) {
      const cantTotal   = tarea.cantidad || 1;
      const costoUnit   = (tarea.costoMat || 0) + (tarea.costoSub || 0);
      avanceAgregado    = Math.round((cantAvance / cantTotal) * 100);
      valorCertificado  = Math.round(costoUnit * cantAvance);
    } else if (datos.porcentajeAvance) {
      avanceAgregado = parseFloat(datos.porcentajeAvance) || 0;
      if (tarea) {
        const costoUnit  = (tarea.costoMat || 0) + (tarea.costoSub || 0);
        valorCertificado = Math.round(costoUnit * (tarea.cantidad || 0) * avanceAgregado / 100);
      }
    }
    // Para correcciones: SET en vez de ADD
    const avancePrevio = tarea?.avance || 0;
    const avanceFinalUncapped = esCorreccion
      ? Math.round((cantAvance / (tarea?.cantidad || 1)) * 100)
      : avancePrevio + avanceAgregado;
    const avanceFinal = Math.min(100, avanceFinalUncapped);
    if (esCorreccion && tarea) avanceAgregado = avanceFinal - avancePrevio;

    // Detectar exceso sobre presupuesto
    let excesoMsg = '';
    let nuevoAdicional = null;
    if (tarea && avanceAgregado !== 0) {
      const nuevoAvanceRaw = avanceFinalUncapped;
      if (nuevoAvanceRaw > 100) {
        const excesoPct  = nuevoAvanceRaw - 100;
        const costoUnit  = (tarea.costoMat || 0) + (tarea.costoSub || 0);
        const excesoQty  = parseFloat(((excesoPct / 100) * (tarea.cantidad || 0)).toFixed(3));
        const excesoValor = Math.round(costoUnit * excesoQty);
        const qtyStr     = cantAvance > 0
          ? `${excesoQty}${datos.unidad || tarea.unidad || ''} sobre presupuesto`
          : `${excesoPct.toFixed(0)}% sobre presupuesto`;
        nuevoAdicional = {
          id:            `adic-${Date.now()}`,
          descripcion:   `⚠️ Exceso ${tarea.nombre} — ${qtyStr} (vía WhatsApp por ${user.user_name})`,
          fecha:         new Date().toISOString().split('T')[0],
          estado:        'pendiente',
          tarea:         tarea.nombre,
          cantidad:      excesoQty,
          unidad:        datos.unidad || tarea.unidad || '',
          // Costo (lo que le pagamos al proveedor)
          costoUnit:     costoUnit,
          costoTotal:    excesoValor,
          // Venta (lo que le cobramos al cliente — a completar en la app, por defecto igual al costo)
          valorVentaUnit:  null,
          valorVentaTotal: null,
          // Resumen
          monto:           excesoValor,   // alias para compatibilidad
          montoProveedor:  null,          // null = pendiente de decidir si se le cobra al proveedor
        };
        const montoFmt = String(excesoValor).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        excesoMsg = `\n⚠️ *Exceso de presupuesto:* ${qtyStr}. Se creó un adicional pendiente por $${montoFmt}.`;
      }
    }

    // Actualizar avance en rubros — SET para correcciones, ADD para avances normales
    let updatedRubros = detalle.rubros;
    if (rubroIdx >= 0 && tareaIdx >= 0 && tarea && avanceFinal !== avancePrevio) {
      updatedRubros = detalle.rubros.map((r, ri) =>
        ri !== rubroIdx ? r : {
          ...r,
          tareas: r.tareas.map((t, ti) => ti === tareaIdx ? { ...t, avance: avanceFinal } : t),
        }
      );
    }

    // Sync al Gantt: la task del cronograma con tareaId === tarea.id se
    // actualiza con el nuevo avance. Sin esto, el % cargado por WA no se ve
    // reflejado en el Gantt visual hasta que el user toque el slider.
    let updatedGantt = detalle.gantt;
    if (tarea && detalle.gantt?.tasks && avanceFinal !== avancePrevio) {
      updatedGantt = {
        ...detalle.gantt,
        tasks: detalle.gantt.tasks.map(gt =>
          gt.tareaId === tarea.id ? { ...gt, avance: avanceFinal } : gt
        ),
      };
    }

    // Sync al contrato MO: recalcular avancePct PONDERADO por costo de
    // todas las tareas del rubro (mismo cálculo que hace el Gantt frontend).
    let updatedContratos = detalle.contratos || [];
    if (rubro && rubro.nombre && avanceFinal !== avancePrevio) {
      // Sumar costo total y costo ejecutado de todas las tareas del rubro
      // (usando los avances ya aplicados en updatedRubros).
      const rubroActualizado = updatedRubros.find(r => r.id === rubro.id);
      const tareasNoSec = (rubroActualizado?.tareas || []).filter(t => t.tipo !== 'seccion');
      let totalCosto = 0, ejecutado = 0;
      for (const t of tareasNoSec) {
        const costoUnit = (t.costoMat || 0) + (t.costoSub || 0);
        const costoTot = costoUnit * (t.cantidad || 0);
        totalCosto += costoTot;
        ejecutado  += costoTot * ((t.avance || 0) / 100);
      }
      const nuevoAvancePct = totalCosto > 0
        ? Math.round(ejecutado / totalCosto * 100)
        : Math.round(tareasNoSec.reduce((s, t) => s + (t.avance || 0), 0) / Math.max(1, tareasNoSec.length));
      // Aplicar el nuevo % a contratos cuyo gremio matchea el rubro.
      const matchGr = (rNom, gr) => {
        const r = (rNom || '').toUpperCase(), g = (gr || '').toUpperCase();
        return r.includes(g) || g.includes(r);
      };
      updatedContratos = updatedContratos.map(c =>
        matchGr(rubro.nombre, c.gremio) ? { ...c, avancePct: nuevoAvancePct } : c
      );
    }

    const nuevaFoto = mediaUrl ? {
      id:        `foto-${Date.now()}`,
      url:       mediaUrl,
      fecha:     new Date().toISOString().split('T')[0],
      label:     datos.descripcion || 'Avance de obra',
      rubro:     tarea?.nombre || datos.tareaId || '',
      creadoPor: user.user_name,
    } : null;

    const detalleActualizado = {
      ...detalle,
      rubros:     updatedRubros,
      gantt:      updatedGantt,
      contratos:  updatedContratos,
      fotos:      [...(detalle.fotos || []), ...(nuevaFoto ? [nuevaFoto] : [])],
      adicionales: esCorreccion
        ? [
            // Si la corrección ya no excede el 100%, quitar el adicional de exceso previo de esta tarea
            ...(detalle.adicionales || []).filter(a =>
              !(avanceFinalUncapped <= 100 && a.descripcion?.includes('Exceso') && a.tarea === tarea?.nombre)
            ),
            ...(nuevoAdicional ? [nuevoAdicional] : []),
          ]
        : [...(detalle.adicionales || []), ...(nuevoAdicional ? [nuevoAdicional] : [])],
    };
    await fetch(`${SUPABASE_URL}/rest/v1/shared_data`, {
      method: 'POST',
      headers: { ...sbH(), 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({ key: 'obras', data: { obras: obrasData?.obras || [], detalles: { ...detalles, [obra.id]: detalleActualizado } }, updated_at: new Date().toISOString() }),
    });
    await broadcastChange('obras');

    // Agregar certificación a cuenta corriente del proveedor
    let ccMsg = '';
    console.log(`CC check: rubro.proveedor="${rubro?.proveedor}" valorCertificado=${valorCertificado} tarea.costoMat=${tarea?.costoMat} tarea.costoSub=${tarea?.costoSub}`);
    if (!rubro) {
      ccMsg = '\n⚠️ No se encontró el rubro en el presupuesto, no se creó cert. en CC.';
    } else if (!rubro.proveedor) {
      ccMsg = `\n⚠️ El rubro *${rubro.nombre}* no tiene proveedor asignado. Asignalo en la app para que la cert. se registre automáticamente.`;
    } else if (valorCertificado === 0) {
      ccMsg = `\n⚠️ El presupuesto de la tarea tiene costo $0. Verificá los costos en el presupuesto.`;
    } else if (provData) {
      const provNomQ = rubro.proveedor.toLowerCase();
      const prov = (provData.proveedores || []).find(p => {
        const pNom = p.nombre?.toLowerCase() || '';
        return pNom.includes(provNomQ) || provNomQ.includes(pNom) || pNom.split(' ')[0] === provNomQ.split(' ')[0];
      });
      if (!prov) {
        ccMsg = `\n⚠️ Proveedor "*${rubro.proveedor}*" no encontrado en el sistema. Revisá el nombre en el rubro.`;
      } else {
        const ccEntries = provData.ccEntries || [];
        const cantStr = cantAvance > 0 ? `${cantAvance}${datos.unidad || ''}` : `${Math.abs(avanceAgregado)}%`;
        let updatedCCEntries;
        if (esCorreccion) {
          // Buscar la última cert de este proveedor + obra + tarea y actualizarla
          const tareaKey = (tarea?.nombre || '').toLowerCase();
          let lastIdx = -1;
          for (let i = ccEntries.length - 1; i >= 0; i--) {
            const e = ccEntries[i];
            if (e.obraId === obra.id && e.tipo === 'cert' && (e.concepto || '').toLowerCase().includes(tareaKey)) {
              lastIdx = i; break;
            }
          }
          if (lastIdx >= 0) {
            updatedCCEntries = ccEntries.map((e, i) => i !== lastIdx ? e : {
              ...e,
              fecha:    new Date().toISOString().split('T')[0],
              concepto: `Corrección: ${tarea?.nombre || 'Avance'} (${cantStr}) — por ${user.user_name}`,
              debe:     valorCertificado,
            });
          } else {
            updatedCCEntries = [...ccEntries, {
              id: `cc-${Date.now()}`, proveedorId: prov.id,
              obraId: obra.id, obraNombre: obra.nombre,
              fecha: new Date().toISOString().split('T')[0],
              concepto: `Corrección: ${tarea?.nombre || 'Avance'} (${cantStr})`,
              tipo: 'cert', debe: valorCertificado, haber: 0,
            }];
          }
        } else {
          updatedCCEntries = [...ccEntries, {
            id:          `cc-${Date.now()}`,
            proveedorId: prov.id,
            obraId:      obra.id,
            obraNombre:  obra.nombre,
            fecha:       new Date().toISOString().split('T')[0],
            concepto:    `Cert: ${datos.descripcion || tarea?.nombre || 'Avance'} (${cantStr})`,
            tipo:        'cert',
            debe:        valorCertificado,
            haber:       0,
          }];
        }
        await fetch(`${SUPABASE_URL}/rest/v1/shared_data`, {
          method: 'POST',
          headers: { ...sbH(), 'Prefer': 'resolution=merge-duplicates' },
          body: JSON.stringify({ key: 'proveedores', data: { proveedores: provData.proveedores, ccEntries: updatedCCEntries }, updated_at: new Date().toISOString() }),
        });
        await broadcastChange('proveedores');
        const montoFmt = String(valorCertificado).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        ccMsg = esCorreccion
          ? `\n💰 CC de *${prov.nombre}* actualizada → $${montoFmt}`
          : `\n💰 Cert. $${montoFmt} agregada a CC de *${prov.nombre}*`;
      }
    }

    // Alertas financieras solo van a admins, no al que reportó
    const alertasAdmin = [excesoMsg, ccMsg].filter(m => m && m.startsWith('\n⚠️')).map(m => m.trim());
    if (alertasAdmin.length > 0) {
      const admins = await getAllAdmins();
      const cantStr = cantAvance > 0 ? `${cantAvance}${datos.unidad || ''}` : `${avanceAgregado}%`;
      const msgAdmin =
        `📋 *Avance registrado en ${obra.nombre}*\n` +
        `Por: *${user.user_name}*\n` +
        `Tarea: ${tarea?.nombre || '—'} · ${cantStr}\n\n` +
        alertasAdmin.join('\n');
      for (const admin of admins) await sendWA(admin.phone, msgAdmin);

      // Guardar también en shared_data 'alertas' para el dashboard
      try {
        const alertasData = await loadSharedData('alertas');
        const existingAlertas = Array.isArray(alertasData) ? alertasData : [];
        const nuevasAlertas = alertasAdmin.map((msg, i) => ({
          id:        `alerta-${Date.now()}-${i}`,
          tipo:      msg.includes('Exceso') ? 'exceso' : 'proveedor_faltante',
          texto:     msg,
          obra:      obra.nombre,
          obraId:    obra.id,
          tarea:     tarea?.nombre || '',
          fecha:     new Date().toISOString(),
          leida:     false,
          fuente:    'whatsapp',
          creadoPor: user.user_name,
        }));
        await fetch(`${SUPABASE_URL}/rest/v1/shared_data`, {
          method: 'POST',
          headers: { ...sbH(), 'Prefer': 'resolution=merge-duplicates' },
          body: JSON.stringify({ key: 'alertas', data: [...nuevasAlertas, ...existingAlertas.slice(0, 50)], updated_at: new Date().toISOString() }),
        });
        await broadcastChange('alertas');
      } catch (e) { console.error('saveAlertas error:', e.message); }
    }

    const tareaMsg  = tarea ? ` · ${tarea.nombre}` : '';
    const avanceMsg = esCorreccion
      ? ` · ${avancePrevio}% → ${avanceFinal}%`
      : avanceAgregado > 0 ? ` · +${Math.min(avanceAgregado, 100 - avancePrevio)}%` : '';
    // Al que reportó: solo confirmación limpia (sin precios ni alertas)
    const ccOkMsg = ccMsg && ccMsg.startsWith('\n💰') ? ccMsg : '';
    const accionMsg = esCorreccion ? '🔧 Corrección guardada' : '✅ Avance guardado';
    return `${accionMsg} en *${obra.nombre}*${tareaMsg}${avanceMsg}${mediaUrl ? ' · con foto' : ''}${ccOkMsg}`;
  }

  if (tipo === 'comando') {
    return await ejecutarComando(datos.comando, datos, user, ctx);
  }

  // ── Nueva tarea desde WhatsApp ──────────────────────────────────────────────
  // Admin puede crear y asignar a cualquiera. No-admin solo puede auto-asignarse.
  // Por la ventana de 24h de WA, NO notificamos por WhatsApp al asignado — el
  // sistema lo notifica via badge in-app cuando entra a la app web.
  if (tipo === 'nueva_tarea') {
    const esAdmin = user.user_rol === 'Admin';
    const appUsers = await sbGet('app_users', '?select=*');
    const creadorId = user.user_id || user.id;

    // Resolver asignado: si admin, busca por nombre; si no admin, fuerza self.
    let asignadoId = creadorId;
    let asignadoNombre = appUsers.find(u => u.id === creadorId)?.nombre || 'vos';
    if (esAdmin && datos.asignadoNombre) {
      const q = String(datos.asignadoNombre).toLowerCase().trim();
      const match = appUsers.find(u =>
        u.nombre?.toLowerCase() === q ||
        u.nombre?.toLowerCase().includes(q) ||
        u.email?.toLowerCase() === q
      );
      if (!match) return `❌ No encontré un usuario con nombre/email "${datos.asignadoNombre}".`;
      asignadoId = match.id;
      asignadoNombre = match.nombre;
    } else if (!esAdmin && datos.asignadoNombre) {
      const q = String(datos.asignadoNombre).toLowerCase().trim();
      const selfNombre = (appUsers.find(u => u.id === creadorId)?.nombre || '').toLowerCase();
      if (!selfNombre.includes(q) && q !== 'mi' && q !== 'a mi' && q !== 'self') {
        return '❌ Solo el Admin puede crear tareas para otros usuarios. Podés crear tareas para vos mismo.';
      }
    }

    if (!datos.titulo || !String(datos.titulo).trim()) {
      return '❌ Falta el título de la tarea. Probá: "crear tarea: comprar cemento para Juan, mañana, prioridad alta".';
    }

    const newId = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const nowIso = new Date().toISOString();
    const checklistItems = (datos.checklist || []).map(texto => ({
      id: newId('item'),
      texto: String(texto).trim(),
      completado: false,
      completadoPor: null,
      completadoAt: null,
    }));
    const nueva = {
      id: newId('tarea'),
      titulo: String(datos.titulo).trim(),
      descripcion: String(datos.descripcion || '').trim(),
      asignadoA: [asignadoId],
      creadoPor: creadorId,
      obraId: datos.obraId || null,
      estado: 'pendiente',
      prioridad: datos.prioridad || 'media',
      fechaLimite: datos.fechaLimite || null,
      checklist: checklistItems,
      comentarios: [],
      vistaPor: [creadorId],
      creadoAt: nowIso,
      actualizadoAt: nowIso,
      completadoAt: null,
    };

    const tareas = (await loadSharedData('tareas')) || [];
    await saveSharedData('tareas', [nueva, ...tareas]);

    const items = checklistItems.length > 0
      ? `\n📋 ${checklistItems.length} item${checklistItems.length === 1 ? '' : 's'} en el checklist`
      : '';
    const venc = nueva.fechaLimite ? `\n📅 Vence: ${nueva.fechaLimite.split('-').reverse().join('/')}` : '';
    const prio = nueva.prioridad === 'alta' ? ' 🔴' : nueva.prioridad === 'media' ? ' 🟡' : '';
    const destino = asignadoId === creadorId ? 'para vos' : `para *${asignadoNombre}*`;
    const notifInfo = asignadoId === creadorId ? '' : '\n\n_(Verá la notificación cuando entre a la app — WhatsApp no puede notificar fuera de la ventana de 24h.)_';
    return `✅ Tarea creada ${destino}:\n*${nueva.titulo}*${prio}${venc}${items}${notifInfo}`;
  }

  return '✅ Acción registrada correctamente.';
}

async function ejecutarComando(comando, datos, user, ctx) {
  if (comando === 'ayuda') {
    const esAdmin = user.user_rol === 'Admin';
    return (
      `👋 *Hola ${user.user_name?.split(' ')[0] || ''}, así me podés hablar:*\n\n` +
      `*◆ AVANCE DE OBRA* (foto + texto)\n` +
      `Indicá *qué tarea*, *en qué obra* y cuánto se hizo. Tres formas:\n` +
      ` ✓ Cuanto se hizo HOY (se suma a lo que ya había):\n` +
      `    _"150 m² de revoque grueso en Baradero"_\n` +
      ` ✓ TOTAL acumulado (corrige el avance):\n` +
      `    _"van 850 m² de revoque en total en Baradero"_\n` +
      ` ✓ Porcentaje directo:\n` +
      `    _"30% de pintura en Belgrano"_\n` +
      `Mandá foto del trabajo y el bot registra avance + sube la foto al portal del cliente.\n\n` +

      `*◆ GASTO* (foto de factura o texto)\n` +
      `Ej: _"pagué $50.000 de materiales en Baradero"_\n` +
      `O mandá foto/PDF de factura — el bot extrae proveedor, monto, CUIT.\n` +
      `📋 *Varios juntos:* _"cargá: 50k cemento baradero, 12k flete, 3k comida"_\n\n` +

      `*◆ INGRESO / COBRO*\n` +
      `Ej: _"cobré U$S 5.000 de cuota 2 en Baradero"_\n` +
      `La cuota se marca pagada automáticamente.\n\n` +

      `*◆ CHEQUE RECIBIDO*\n` +
      `Mandá foto del cheque, el bot lo registra en cartera.\n\n` +

      `*◆ TAREAS ASIGNADAS*\n` +
      `• *tareas* — ver tus pendientes\n` +
      `• *tarea N* — detalle de la tarea N\n` +
      `• *hice el item X* — marca un item completado\n` +
      (esAdmin ? `• _"crear tarea para Juan: comprar cemento"_ — asignar nueva\n` : '') +

      `\n*◆ CONSULTAS RÁPIDAS*\n` +
      `• *saldo* — saldo de tus cajas\n` +
      `• *pendientes* — aprobaciones pendientes\n` +
      (esAdmin ? `• *cheques* — cheques por vencer\n` : '') +
      (esAdmin ? `• *resumen [obra] [fecha]* — resumen del día\n` : '') +
      `• _"como va [obra]"_ — KPIs: avance, gastado, próx. cuota, top gastos\n` +
      (esAdmin ? `• _"cuánto le debo a [proveedor]"_ — CC + últimas certs/pagos\n` : '') +
      `• _"contacto [proveedor]"_ — tel/wa/email\n` +
      (esAdmin ? `• _"aprobar N"_ / _"rechazar N"_ — sobre pendientes (escribí *pendientes* para verlos)\n` : '') +
      (esAdmin ? `• _"pasá $200k de Caja X a Caja Y"_ — traspaso entre cajas\n` : '') +
      `• *deshacer* — revierte tu último movimiento cargado\n` +

      `\n_Escribí *ayuda* cuando quieras volver a ver este menú._`
    );
  }

  // ── Tareas ────────────────────────────────────────────────────────────────
  // Listado de tareas pendientes del usuario, numeradas. Guarda el mapping
  // numero→tareaId en la conversación para que despues pueda decir "tarea 2".
  if (comando === 'tareas') {
    const tareas = (await loadSharedData('tareas')) || [];
    const mias = tareas.filter(t =>
      Array.isArray(t.asignadoA) &&
      t.asignadoA.includes(user.user_id || user.id) &&
      t.estado !== 'completada' &&
      t.estado !== 'cancelada'
    );
    if (!mias.length) return '✅ No tenés tareas pendientes. ¡Buen trabajo!';

    const prioRank = { alta: 0, media: 1, baja: 2 };
    mias.sort((a, b) => {
      const va = a.fechaLimite ? 0 : 1, vb = b.fechaLimite ? 0 : 1;
      if (va !== vb) return va - vb;
      if (a.fechaLimite && b.fechaLimite && a.fechaLimite !== b.fechaLimite) return a.fechaLimite < b.fechaLimite ? -1 : 1;
      return (prioRank[a.prioridad] ?? 9) - (prioRank[b.prioridad] ?? 9);
    });

    // Guardar mapping para referencia posterior por numero.
    if (user.phone) {
      const conv = await loadConversation(user.phone);
      await saveConversation(user.phone, {
        state: conv.state || 'idle',
        data: { ...(conv.data || {}), lastTareasList: mias.map(t => t.id) },
      });
    }

    const lineas = mias.slice(0, 10).map((t, i) => {
      const totalItems = (t.checklist || []).length;
      const completos = (t.checklist || []).filter(it => it.completado).length;
      const progress = totalItems > 0 ? ` (${completos}/${totalItems})` : '';
      const venc = t.fechaLimite ? ` · vence ${t.fechaLimite.split('-').reverse().join('/')}` : '';
      const prio = t.prioridad === 'alta' ? '🔴' : t.prioridad === 'media' ? '🟡' : '⚪';
      return `${i + 1}. ${prio} *${t.titulo}*${progress}${venc}`;
    });

    const extra = mias.length > 10 ? `\n\n_…y ${mias.length - 10} más. Vé la lista completa en la app._` : '';
    return `📋 *Tus tareas pendientes (${mias.length}):*\n\n${lineas.join('\n')}${extra}\n\nEscribí *tarea N* para ver el detalle.`;
  }

  // Detalle de una tarea por numero (1-based desde la última lista).
  if (comando === 'tarea_detalle') {
    const num = parseInt(datos.numero, 10);
    if (!num || num < 1) return 'Decime qué tarea querés ver. Ej: *tarea 2*';

    const conv = user.phone ? await loadConversation(user.phone) : { data: {} };
    const tareaId = (conv.data?.lastTareasList || [])[num - 1];
    if (!tareaId) return 'No encontré esa tarea. Escribí *tareas* primero para ver la lista.';

    const tareas = (await loadSharedData('tareas')) || [];
    const t = tareas.find(x => x.id === tareaId);
    if (!t) return 'La tarea ya no existe.';

    // Guardar la última tarea vista para que despues pueda decir "completé item 3"
    if (user.phone) {
      await saveConversation(user.phone, {
        state: conv.state || 'idle',
        data: { ...(conv.data || {}), lastTareaId: tareaId },
      });
    }

    const totalItems = (t.checklist || []).length;
    const completos = (t.checklist || []).filter(it => it.completado).length;
    const progressBar = totalItems > 0 ? ` (${completos}/${totalItems})` : '';
    const venc = t.fechaLimite ? `\n📅 Vence: ${t.fechaLimite.split('-').reverse().join('/')}` : '';
    const prio = t.prioridad === 'alta' ? '🔴 Alta' : t.prioridad === 'media' ? '🟡 Media' : '⚪ Baja';
    const desc = t.descripcion ? `\n\n${t.descripcion}` : '';
    const items = (t.checklist || []).length === 0
      ? '\n\n_Sin items en el checklist._'
      : '\n\n*Checklist:*\n' + (t.checklist || []).map((it, i) =>
          `${i + 1}. ${it.completado ? '✅' : '⬜'} ${it.texto}`
        ).join('\n');

    return `*${t.titulo}*${progressBar}\n${prio}${venc}${desc}${items}\n\n_Para marcar un item: "hice el item 2"_`;
  }

  // Completar un item del checklist por numero (de la ultima tarea vista).
  if (comando === 'completar_item') {
    const num = parseInt(datos.numero, 10);
    if (!num || num < 1) return 'Decime qué item querés marcar. Ej: *hice el item 2*';

    const conv = user.phone ? await loadConversation(user.phone) : { data: {} };
    const tareaId = conv.data?.lastTareaId;
    if (!tareaId) return 'No sé de qué tarea hablás. Escribí *tareas* y luego *tarea N* primero.';

    const tareas = (await loadSharedData('tareas')) || [];
    const t = tareas.find(x => x.id === tareaId);
    if (!t) return 'La tarea ya no existe.';
    const item = (t.checklist || [])[num - 1];
    if (!item) return `Esa tarea solo tiene ${(t.checklist || []).length} item${(t.checklist || []).length === 1 ? '' : 's'}.`;
    if (item.completado) return `Ese item ya estaba marcado: "${item.texto}". ✅`;

    // Actualizar tarea
    const userId = user.user_id || user.id;
    const nowIso = new Date().toISOString();
    const newTareas = tareas.map(x => {
      if (x.id !== tareaId) return x;
      const newChecklist = (x.checklist || []).map((it, i) =>
        i === num - 1 ? { ...it, completado: true, completadoPor: userId, completadoAt: nowIso } : it
      );
      const completosAhora = newChecklist.filter(it => it.completado).length;
      const totalAhora = newChecklist.length;
      let estado = 'pendiente';
      if (completosAhora === totalAhora && totalAhora > 0) estado = 'completada';
      else if (completosAhora > 0) estado = 'en_progreso';
      return {
        ...x,
        checklist: newChecklist,
        estado,
        actualizadoAt: nowIso,
        completadoAt: estado === 'completada' ? nowIso : null,
      };
    });
    await saveSharedData('tareas', newTareas);

    const tareaActualizada = newTareas.find(x => x.id === tareaId);
    const totalItems = tareaActualizada.checklist.length;
    const completos = tareaActualizada.checklist.filter(it => it.completado).length;
    const allDone = completos === totalItems && totalItems > 0;

    return allDone
      ? `✅ Item "${item.texto}" marcado.\n\n🎉 *¡Tarea completa!* "${t.titulo}" — ${completos}/${totalItems} items.`
      : `✅ Item "${item.texto}" marcado.\n\nProgreso: *${completos}/${totalItems}* items.`;
  }

  if (comando === 'saldo') {
    const cajasUsuario = ctx.cajas.filter(c =>
      user.cajasVisibles.length === 0 || user.cajasVisibles.includes(c.id)
    );
    if (!cajasUsuario.length) return 'No tenés cajas asignadas.';
    const lineas = cajasUsuario.map(c =>
      `• ${c.nombre}: *$${Math.round(c.saldo || 0).toLocaleString('es-AR')}* ${c.moneda}`
    );
    return `💰 *Saldo de tus cajas:*\n\n${lineas.join('\n')}`;
  }

  if (comando === 'pendientes') {
    const pendingRows = await sbGet('shared_data', '?key=eq.whatsapp_pending&select=data');
    const pending = Array.isArray(pendingRows[0]?.data) ? pendingRows[0].data : [];
    const activos = pending.filter(p => p.status !== 'confirmed' && p.status !== 'rejected');
    if (!activos.length) return '✅ No hay pendientes de aprobación.';

    // Guardar IDs para que el admin pueda decir "aprobar 1" / "rechazar 2".
    if (user.phone) {
      const conv = await loadConversation(user.phone);
      await saveConversation(user.phone, {
        state: conv.state || 'idle',
        data: { ...(conv.data || {}), lastPendientesList: activos.slice(0, 10).map(p => p.id) },
      });
    }

    const lineas = activos.slice(0, 10).map((p, i) => {
      const num = `*${i + 1}.*`;
      if (p.tipoPendiente === 'factura') {
        return `${num} 🧾 Factura ${p.proveedor || '—'} · $${Math.round(p.montoTotal || 0).toLocaleString('es-AR')}`;
      }
      const mov = p.movimiento || {};
      const icono = mov.tipo === 'ingreso' ? '🔺' : '🔻';
      return `${num} ${icono} ${p.creadoPor}: $${Math.round(mov.monto || 0).toLocaleString('es-AR')} — ${mov.descripcion || '—'}`;
    });
    const esAdmin = user.user_rol === 'Admin';
    const ayuda = esAdmin
      ? `\n\nPara aprobar/rechazar: *aprobar N* o *rechazar N*`
      : '';
    return `⏳ *Pendientes (${activos.length}):*\n\n${lineas.join('\n')}${ayuda}`;
  }

  // Admin: aprobar pendiente por número de la última lista vista.
  if (comando === 'aprobar_pendiente' || comando === 'rechazar_pendiente') {
    if (user.user_rol !== 'Admin') return '❌ Solo un admin puede aprobar/rechazar pendientes.';
    const num = parseInt(datos.numero, 10);
    if (!num || num < 1) return 'Decime qué número. Ej: *aprobar 1*. Escribí *pendientes* primero para ver la lista.';
    const conv = user.phone ? await loadConversation(user.phone) : { data: {} };
    const pendienteId = (conv.data?.lastPendientesList || [])[num - 1];
    if (!pendienteId) return 'No encontré ese pendiente. Escribí *pendientes* primero para ver la lista.';

    const pendingRows = await sbGet('shared_data', '?key=eq.whatsapp_pending&select=data');
    const pending = Array.isArray(pendingRows[0]?.data) ? pendingRows[0].data : [];
    const item = pending.find(p => p.id === pendienteId);
    if (!item) return 'El pendiente ya no existe (quizás fue resuelto desde la app).';

    const accion = comando === 'aprobar_pendiente' ? 'confirmed' : 'rejected';
    const updated = pending.map(p => p.id === pendienteId
      ? { ...p, status: accion, resolvedBy: user.user_name, resolvedAt: new Date().toISOString() }
      : p
    );
    await saveSharedData('whatsapp_pending', updated);

    // Si es aprobación de movimiento → aplicarlo de verdad
    if (accion === 'confirmed' && item.tipoPendiente === 'movimiento' && item.movimiento) {
      const movData = await loadSharedData('movimientos');
      const movs  = movData?.movimientos || [];
      const cajas = movData?.cajas || ctx.cajas;
      const mov = { ...item.movimiento, id: `mov-${Date.now()}`, creadoPorWA: true };
      const delta = mov.tipo === 'ingreso' ? mov.monto : -mov.monto;
      const updatedCajas = cajas.map(c =>
        c.id === mov.cajaId ? { ...c, saldo: (c.saldo || 0) + delta } : c
      );
      await saveSharedData('movimientos', { movimientos: [mov, ...movs], cajas: updatedCajas });
    }

    const verbo = accion === 'confirmed' ? '✅ Aprobado' : '❌ Rechazado';
    return `${verbo} pendiente #${num}.`;
  }

  if (comando === 'cheques') {
    if (user.user_rol !== 'Admin') return '❌ Este comando es solo para administradores.';
    const chequesData = await loadSharedData('cheques');
    const cheques = chequesData?.cheques || [];
    const hoy = new Date();
    const en7dias = new Date(hoy.getTime() + 7 * 24 * 60 * 60 * 1000);
    const proximos = cheques.filter(c => {
      if (c.estado !== 'cartera') return false;
      const venc = new Date(c.fechaVencimiento);
      return venc <= en7dias && venc >= hoy;
    });
    if (!proximos.length) return '✅ No hay cheques por vencer en los próximos 7 días.';
    const lineas = proximos.map(c =>
      `• ${c.banco} N°${c.numero} — $${Math.round(c.monto).toLocaleString('es-AR')} — Vence: ${c.fechaVencimiento}`
    );
    return `⚠️ *Cheques por vencer (próximos 7 días):*\n\n${lineas.join('\n')}`;
  }

  if (comando === 'resumen') {
    if (user.user_rol !== 'Admin') return '❌ Este comando es solo para administradores.';
    const obraId = datos.obraId;
    const fecha  = datos.fecha || new Date().toISOString().split('T')[0];
    const obra   = ctx.obras.find(o => o.id === obraId || o.nombre?.toLowerCase().includes(obraId?.toLowerCase()));
    if (!obra) return '❌ No encontré esa obra. Escribí el nombre completo.';
    const movData = await loadSharedData('movimientos');
    const movs    = (movData?.movimientos || []).filter(m => m.obraId === obra.id && m.fecha === fecha);
    if (!movs.length) return `📊 Sin movimientos en *${obra.nombre}* el ${fecha}.`;
    const gastos  = movs.filter(m => m.tipo === 'gasto');
    const ingresos = movs.filter(m => m.tipo === 'ingreso');
    const totalG  = gastos.reduce((s, m) => s + (m.monto || 0), 0);
    const totalI  = ingresos.reduce((s, m) => s + (m.monto || 0), 0);
    return (
      `📊 *Resumen ${obra.nombre} — ${fecha}*\n\n` +
      `Gastos (${gastos.length}): *$${Math.round(totalG).toLocaleString('es-AR')}*\n` +
      `Ingresos (${ingresos.length}): *$${Math.round(totalI).toLocaleString('es-AR')}*\n\n` +
      gastos.slice(0, 5).map(m => `• ${m.descripcion}: $${Math.round(m.monto).toLocaleString('es-AR')}`).join('\n')
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FASE 2 — Comandos de consulta y operación
  // ─────────────────────────────────────────────────────────────────────────

  // "Cómo va [obra]" → KPIs en texto: avance, presupuesto vs gastado,
  // saldo cuotas, próxima cuota, top gastos del mes, tareas pendientes.
  if (comando === 'como_va_obra') {
    const obraQuery = (datos.obra || '').toLowerCase().trim();
    if (!obraQuery) return '🤔 ¿De qué obra? Ej: *cómo va Baradero*';
    const obra = ctx.obras.find(o =>
      o.id?.toLowerCase() === obraQuery ||
      o.nombre?.toLowerCase().includes(obraQuery) ||
      obraQuery.includes(o.nombre?.toLowerCase())
    );
    if (!obra) return `❌ No encontré una obra con "${datos.obra}". Obras activas: ${ctx.obras.slice(0,5).map(o => o.nombre).join(', ')}`;

    const det = ctx.detalles?.[obra.id] || {};
    const rubros = (det.rubros || []).filter(r => r.tipo !== 'seccion');
    // Avance ponderado por costo (mismo cálculo que el Gantt)
    let totalCosto = 0, ejecutado = 0;
    for (const r of rubros) {
      for (const t of (r.tareas || []).filter(t => t.tipo !== 'seccion')) {
        const c = ((t.costoMat || 0) + (t.costoSub || 0)) * (t.cantidad || 0);
        totalCosto += c;
        ejecutado  += c * ((t.avance || 0) / 100);
      }
    }
    const avancePct = totalCosto > 0 ? Math.round((ejecutado / totalCosto) * 100) : 0;

    // Movimientos de la obra
    const movs = (ctx.movimientos || []).filter(m => m.obraId === obra.id);
    const gastado = movs.filter(m => m.tipo === 'gasto').reduce((s, m) => s + (m.monto || 0), 0);
    const cobrado = movs.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + (m.monto || 0), 0);
    const presupuesto = (totalCosto || obra.presupuesto || 0);

    // Cuotas
    const cuotas = det.cuotas || [];
    const cuotasPagadas = cuotas.filter(c => c.cobrado || c.pagado).length;
    const proximaCuota = cuotas
      .filter(c => !(c.cobrado || c.pagado) && c.fecha)
      .sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''))[0];

    // Top 3 gastos del mes en curso
    const mesActual = new Date().toISOString().slice(0, 7); // YYYY-MM
    const gastosMes = movs
      .filter(m => m.tipo === 'gasto' && (m.fecha || '').startsWith(mesActual))
      .sort((a, b) => (b.monto || 0) - (a.monto || 0))
      .slice(0, 3);

    // Tareas pendientes vinculadas a la obra
    const tareasData = (await loadSharedData('tareas')) || [];
    const tareasPend = tareasData.filter(t =>
      t.obraId === obra.id && t.estado !== 'completada' && t.estado !== 'cancelada'
    );

    const fmt = n => `$${Math.round(n).toLocaleString('es-AR')}`;
    const dateF = iso => iso ? iso.split('-').reverse().join('/') : '—';

    let r = `📊 *${obra.nombre}*`;
    if (obra.cliente) r += ` · ${obra.cliente}`;
    r += `\n\n`;
    r += `🏗 Avance: *${avancePct}%*\n`;
    r += `💸 Gastado: *${fmt(gastado)}*`;
    if (presupuesto > 0) r += ` / ${fmt(presupuesto)} (${Math.round(gastado/presupuesto*100)}%)`;
    r += `\n`;
    r += `💰 Cobrado: *${fmt(cobrado)}*\n`;
    if (cuotas.length) r += `🧾 Cuotas: ${cuotasPagadas}/${cuotas.length} pagadas\n`;
    if (proximaCuota) r += `📅 Próx. cuota: ${dateF(proximaCuota.fecha)} · ${fmt(proximaCuota.monto || proximaCuota.montoARS || 0)}\n`;
    if (gastosMes.length) {
      r += `\n*Top gastos del mes:*\n`;
      gastosMes.forEach(m => { r += `• ${m.descripcion || m.proveedor || '—'}: ${fmt(m.monto)}\n`; });
    }
    if (tareasPend.length) r += `\n☑ Tareas pendientes: *${tareasPend.length}*`;
    return r;
  }

  // "Cuánto le debo a [proveedor]" → saldo + últimas certs/pagos.
  if (comando === 'cc_proveedor') {
    const query = (datos.proveedor || '').toLowerCase().trim();
    if (!query) return '🤔 ¿De qué proveedor? Ej: *cuánto le debo a Pérez*';
    const prov = ctx.proveedores.find(p =>
      p.nombre?.toLowerCase().includes(query) || query.includes(p.nombre?.toLowerCase())
    );
    if (!prov) return `❌ No encontré "${datos.proveedor}". Proveedores: ${ctx.proveedores.slice(0,5).map(p => p.nombre).join(', ')}`;

    // Movimientos del proveedor
    const movs = (ctx.movimientos || []).filter(m =>
      m.proveedor === prov.nombre || m.proveedorId === prov.id
    );
    const gastos = movs.filter(m => m.tipo === 'gasto');
    const pagado = gastos.reduce((s, m) => s + (m.monto || 0), 0);

    // Certificaciones contra contratos MO de todas las obras (sumadas)
    let certTotal = 0;
    Object.values(ctx.detalles || {}).forEach(d => {
      (d.contratos || []).forEach(c => {
        if (c.gremio?.toLowerCase().includes(prov.nombre?.toLowerCase())
         || prov.nombre?.toLowerCase().includes(c.gremio?.toLowerCase())) {
          (c.certificaciones || []).forEach(cert => { certTotal += cert.monto || 0; });
        }
      });
    });

    const saldo = certTotal - pagado;
    const fmt = n => `$${Math.round(n).toLocaleString('es-AR')}`;

    let r = `🏢 *${prov.nombre}*${prov.tipo ? ` · ${prov.tipo}` : ''}\n\n`;
    if (saldo > 0) r += `💸 Saldo a favor del proveedor: *${fmt(saldo)}*\n`;
    else if (saldo < 0) r += `💰 Está a favor nuestro: *${fmt(-saldo)}*\n`;
    else r += `✓ Al día\n`;
    if (certTotal > 0) r += `Certificado: ${fmt(certTotal)} · Pagado: ${fmt(pagado)}\n`;

    // Últimos 3 movimientos
    const recientes = movs.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '')).slice(0, 3);
    if (recientes.length) {
      r += `\n*Últimos movs:*\n`;
      recientes.forEach(m => {
        const d = (m.fecha || '').split('-').reverse().join('/');
        r += `• ${d} ${m.tipo === 'gasto' ? '🔻' : '🔺'} ${fmt(m.monto)} ${m.obraNombre ? `· ${m.obraNombre}` : ''}\n`;
      });
    }
    return r;
  }

  // "Deshacer" — revierte el último movimiento que el usuario cargó por WA.
  // Útil cuando se equivocó (monto, obra, etc.) — borra el mov y restaura saldo.
  if (comando === 'deshacer') {
    const movData = await loadSharedData('movimientos');
    const movs    = movData?.movimientos || [];
    const cajas   = movData?.cajas || ctx.cajas;
    // Último movimiento creado por WA por este usuario (los ids llevan timestamp).
    const mio = movs
      .filter(m => m.creadoPorWA && m.creadoPor === user.user_name)
      .sort((a, b) => (b.id || '').localeCompare(a.id || ''))[0];
    if (!mio) return '🤷 No encontré ningún movimiento reciente tuyo para deshacer.';

    // Revertir el efecto en cajas según tipo.
    const updatedCajas = cajas.map(c => {
      if (mio.tipo === 'ingreso'  && c.id === mio.cajaId)        return { ...c, saldo: (c.saldo || 0) - (mio.monto || 0) };
      if (mio.tipo === 'gasto'    && c.id === mio.cajaId)        return { ...c, saldo: (c.saldo || 0) + (mio.monto || 0) };
      if (mio.tipo === 'traspaso') {
        if (c.id === mio.cajaId)        return { ...c, saldo: (c.saldo || 0) + (mio.monto || 0) };
        if (c.id === mio.cajaDestinoId) return { ...c, saldo: (c.saldo || 0) - (mio.montoDestino ?? mio.monto ?? 0) };
      }
      return c;
    });
    const sinMov = movs.filter(m => m.id !== mio.id);
    await saveSharedData('movimientos', { movimientos: sinMov, cajas: updatedCajas });

    const fmt = n => `$${Math.round(n).toLocaleString('es-AR')}`;
    return `↩️ Deshecho: *${mio.tipo}* de ${fmt(mio.monto)}${mio.obraNombre && mio.obraNombre !== 'General' ? ` en ${mio.obraNombre}` : ''}.\n_${mio.descripcion || ''}_`;
  }

  // "Teléfono/contacto de [proveedor]"
  if (comando === 'contacto_proveedor') {
    const query = (datos.proveedor || '').toLowerCase().trim();
    if (!query) return '🤔 ¿De qué proveedor? Ej: *contacto Pérez*';
    const prov = ctx.proveedores.find(p =>
      p.nombre?.toLowerCase().includes(query) || query.includes(p.nombre?.toLowerCase())
    );
    if (!prov) return `❌ No encontré "${datos.proveedor}".`;
    let r = `🏢 *${prov.nombre}*\n`;
    if (prov.tipo)     r += `${prov.tipo}\n`;
    if (prov.cuit)     r += `CUIT: ${prov.cuit}\n`;
    if (prov.telefono) r += `📱 ${prov.telefono}  →  wa.me/${prov.telefono.replace(/\D/g, '')}\n`;
    if (prov.email)    r += `✉ ${prov.email}\n`;
    if (prov.direccion) r += `📍 ${prov.direccion}\n`;
    return r;
  }

  return '❓ Comando no reconocido. Escribí *ayuda* para ver los disponibles.';
}

// ── Detectores de comandos en lenguaje natural ────────────────────────────────

// "Como va Baradero" / "Cómo está Sismat" / "Estado de Pilar" → como_va_obra.
// Devuelve la query del nombre de obra o null si no matchea.
function pideEstadoObra(texto) {
  const t = (texto || '').toLowerCase().trim().replace(/[¡!¿?.,]/g, '');
  if (!t) return null;
  const patrones = [
    /^(como|cómo)\s+va\s+(.+)$/,
    /^(como|cómo)\s+(esta|está)\s+(.+)$/,
    /^(estado|status)\s+(de\s+)?(.+)$/,
  ];
  for (const re of patrones) {
    const m = t.match(re);
    if (m) {
      const obra = (m[m.length - 1] || '').trim();
      if (obra && obra.length > 1 && !/^(la\s+)?obra$/.test(obra)) return obra;
    }
  }
  return null;
}

// "Cuanto le debo a Perez" / "saldo Juancito" / "que le debo a..." → cc_proveedor.
function pideCCProveedor(texto) {
  const t = (texto || '').toLowerCase().trim().replace(/[¡!¿?.,]/g, '');
  if (!t) return null;
  const patrones = [
    /^(cuanto|cuánto)\s+(le\s+)?debo\s+(a\s+)?(.+)$/,
    /^saldo\s+(de\s+)?(.+)$/,
    /^que\s+le\s+debo\s+(a\s+)?(.+)$/,
    /^cc\s+(.+)$/,
  ];
  for (const re of patrones) {
    const m = t.match(re);
    if (m) {
      const prov = (m[m.length - 1] || '').trim();
      if (prov && prov.length > 1) return prov;
    }
  }
  return null;
}

// "aprobar 1" / "aprobar pendiente 2" → aprobar_pendiente con datos.numero=N.
// Devuelve { accion, numero } o null.
function pideAprobacion(texto) {
  const t = (texto || '').toLowerCase().trim().replace(/[¡!¿?.,]/g, '');
  if (!t) return null;
  const m = t.match(/^(aprobar|aprobá|approve|ok)\s+(?:pendiente\s+)?(\d+)$/i)
        || t.match(/^(rechazar|rechazá|reject|no)\s+(?:pendiente\s+)?(\d+)$/i);
  if (m) {
    const accion = /^(aprobar|aprobá|approve|ok)/i.test(m[1]) ? 'aprobar_pendiente' : 'rechazar_pendiente';
    return { accion, numero: parseInt(m[2], 10) };
  }
  return null;
}

// "Telefono de Perez" / "contacto del electricista" / "wa de..." → contacto_proveedor.
function pideContactoProveedor(texto) {
  const t = (texto || '').toLowerCase().trim().replace(/[¡!¿?.,]/g, '');
  if (!t) return null;
  const patrones = [
    /^(telefono|teléfono|tel|wa|whatsapp|contacto)\s+(de\s+|del\s+)?(.+)$/,
  ];
  for (const re of patrones) {
    const m = t.match(re);
    if (m) {
      const prov = (m[m.length - 1] || '').trim();
      if (prov && prov.length > 1) return prov;
    }
  }
  return null;
}

// Detecta si el mensaje es un saludo simple (sin contenido extra).
function esSaludo(texto) {
  const t = (texto || '').toLowerCase().trim().replace(/[!¡¿?.,]/g, '');
  if (!t) return false;
  const exactos = ['hola', 'holaa', 'hi', 'buen dia', 'buenas', 'buen día', 'buenos dias', 'buenos días',
                   'buenas tardes', 'buenas noches', 'que tal', 'qué tal', 'que onda', 'qué onda',
                   'hey', 'ey', 'che', 'saludos', 'ola', 'hello'];
  if (exactos.includes(t)) return true;
  const primera = t.split(/\s+/)[0];
  return ['hola', 'buenas', 'hey', 'che', 'saludos'].includes(primera) && t.length < 12;
}

// Detecta si el mensaje pregunta por tareas pendientes — en lenguaje natural.
// Cubre: "tareas", "tareas pendientes", "que tareas tengo", "mis tareas",
// "hola tareas pendientes", "que tengo pendiente", etc.
function pideTareas(texto) {
  const t = (texto || '').toLowerCase().trim().replace(/[!¡¿?.,]/g, '');
  if (!t) return false;
  // Mencion directa a "tarea(s)"
  if (/\btareas?\b/.test(t)) return true;
  // "pendientes" o "que tengo pendiente" sin la palabra tarea
  if (/\b(mis pendientes|que tengo pendiente|pendientes que tengo|que hago hoy|que tengo hoy)\b/.test(t)) return true;
  return false;
}

async function handleMainFlow(phone, user, messageText, mediaId, mimeType, conv) {
  const ctx = await getSystemContext();

  let base64Media = null;
  let mediaUrl    = conv.data?.pendingMediaUrl || null;

  if (mediaId) {
    base64Media = await downloadMedia(mediaId);
    if (base64Media) {
      const ext      = mimeType === 'application/pdf' ? 'pdf' : 'jpg';
      const filepath = `${phone.replace(/\D/g, '')}-${Date.now()}.${ext}`;
      mediaUrl = await uploadToStorage(base64Media, mimeType, filepath);
      console.log(`MEDIA uploaded: ${mediaUrl}`);
    }
  }

  // ── El usuario pide ver sus tareas (en lenguaje natural) ───────────────────
  // Detecta "tareas", "tareas pendientes", "que tareas tengo", "hola tareas
  // pendientes", etc., y responde con la lista. Esto evita que el usuario
  // tenga que escribir el comando exacto.
  if (!mediaId && conv.state === 'idle' && pideTareas(messageText)) {
    const respuesta = await ejecutarComando('tareas', {}, { ...user, phone }, ctx);
    await sendWA(phone, respuesta);
    return;
  }

  // ── Atajos de consulta en lenguaje natural ─────────────────────────────────
  // Estos shortcuts evitan pasar por Claude (más rápido, más barato, sin
  // riesgo de que el LLM repregunte algo trivial).
  if (!mediaId && conv.state === 'idle') {
    const obraQuery = pideEstadoObra(messageText);
    if (obraQuery) {
      const respuesta = await ejecutarComando('como_va_obra', { obra: obraQuery }, { ...user, phone }, ctx);
      await sendWA(phone, respuesta);
      return;
    }
    const ccQuery = pideCCProveedor(messageText);
    if (ccQuery) {
      const respuesta = await ejecutarComando('cc_proveedor', { proveedor: ccQuery }, { ...user, phone }, ctx);
      await sendWA(phone, respuesta);
      return;
    }
    const contactoQuery = pideContactoProveedor(messageText);
    if (contactoQuery) {
      const respuesta = await ejecutarComando('contacto_proveedor', { proveedor: contactoQuery }, { ...user, phone }, ctx);
      await sendWA(phone, respuesta);
      return;
    }
    const aprob = pideAprobacion(messageText);
    if (aprob) {
      const respuesta = await ejecutarComando(aprob.accion, { numero: aprob.numero }, { ...user, phone }, ctx);
      await sendWA(phone, respuesta);
      return;
    }
    // "deshacer" / "deshacé" / "borrá lo último" → revierte el último mov.
    const tDesh = (messageText || '').toLowerCase().trim().replace(/[¡!¿?.,]/g, '');
    if (/^(deshacer|deshace|deshacé|borra lo ultimo|borrá lo último|undo|me equivoque|me equivoqué)$/.test(tDesh)) {
      const respuesta = await ejecutarComando('deshacer', {}, { ...user, phone }, ctx);
      await sendWA(phone, respuesta);
      return;
    }

    // ── MODO DICTADO: gastos múltiples ──────────────────────────────────────
    // "cargá: 50k cemento baradero, 12k flete, 3k almuerzo"
    const dictado = parseDictado(messageText, { obras: ctx.obras });
    if (dictado && dictado.items.length > 0) {
      // Caja efectivo del usuario para los gastos sin caja explícita.
      const cajaEfectivo = ctx.cajas.find(c =>
        c.tipo === 'efectivo' && c.usuarioId === user.email && c.moneda === 'ARS'
      );
      // Completar items: si no tienen obra, usar el default del usuario.
      const items = dictado.items.map(it => ({
        ...it,
        obraId:     it.obraId || conv.defaults?.lastObraId || null,
        cajaId:     cajaEfectivo?.id || null,
      }));
      const fmt = n => `$${Math.round(n).toLocaleString('es-AR')}`;
      const total = items.reduce((s, it) => s + it.monto, 0);
      const resumen =
        `📝 *Voy a cargar ${items.length} gasto${items.length === 1 ? '' : 's'}:*\n\n` +
        items.map((it, i) => {
          const obraN = it.obraId ? (ctx.obras.find(o => o.id === it.obraId)?.nombre || '') : '';
          return `${i + 1}. ${fmt(it.monto)} — ${it.descripcion}${obraN ? ` · ${obraN}` : ' · ⚠️ sin obra'}`;
        }).join('\n') +
        `\n\n*Total: ${fmt(total)}*`;
      await saveConversation(phone, {
        state: 'dictado_confirmando',
        data: { dictadoItems: items },
        history: updatedHistory,
        slots: conv.slots || {},
      });
      await sendWAButtons(phone, resumen, BOTONES_CONFIRMAR);
      return;
    }
  }

  // ── Estado: confirmando gastos múltiples del modo dictado ──────────────────
  if (conv.state === 'dictado_confirmando' && Array.isArray(conv.data?.dictadoItems)) {
    const respLower = (messageText || '').trim().toLowerCase();
    const confirma  = ['sí', 'si', 'dale', 'ok', 'confirmo', 'correcto', 's'].some(p => respLower.startsWith(p));
    const cancela   = ['no', 'cancelar', 'mal', 'n'].some(p => respLower.startsWith(p));
    if (confirma) {
      let creados = 0;
      for (const it of conv.data.dictadoItems) {
        if (!it.monto) continue;
        await ejecutarAccion('gasto', {
          monto:       it.monto,
          descripcion: it.descripcion,
          obraId:      it.obraId,
          cajaId:      it.cajaId,
          comprobante: 'negro',
        }, { ...user, phone }, ctx, null);
        creados++;
      }
      await clearConversation(phone);
      await sendWA(phone, `✅ Cargué *${creados}* gasto${creados === 1 ? '' : 's'}. Escribí *deshacer* si te equivocaste en alguno.`);
      return;
    }
    if (cancela) {
      await clearConversation(phone);
      await sendWA(phone, '❌ Cancelado, no cargué nada.');
      return;
    }
    await sendWAButtons(phone, 'Tocá *Confirmar* para cargar los gastos o *Cancelar* para descartar.', BOTONES_CONFIRMAR);
    return;
  }

  // ── Saludo solo (sin pedir tareas): respuesta cortés breve ─────────────────
  // No invadimos con info que el usuario no pidio. Si quiere ver tareas,
  // escribe "tareas" o cualquier variante (manejado arriba).
  if (!mediaId && conv.state === 'idle' && esSaludo(messageText)) {
    const nombre = (user.nombre || '').split(' ')[0] || '';
    await sendWA(phone, `👋 ¡Hola${nombre ? ' ' + nombre : ''}! ¿En qué te ayudo?\n\n_Escribí *ayuda* para ver los comandos o *tareas* para tus pendientes._`);
    return;
  }

  if (conv.state === 'confirmando' && conv.data?.accion) {
    const respLower = messageText.trim().toLowerCase();
    const confirma  = ['sí', 'si', 'dale', 'ok', 'confirmo', 'correcto', 's'].some(p => respLower.startsWith(p));
    const cancela   = ['no', 'cancelar', 'error', 'mal', 'n'].some(p => respLower.startsWith(p));
    const editar    = respLower === 'editar' || respLower === 'corregir' || respLower === 'cambiar';

    if (confirma) {
      const resultado = await ejecutarAccion(conv.data.accion.tipo, conv.data.accion.datos, { ...user, phone }, ctx, mediaUrl || conv.data.pendingMediaUrl);
      // Si la acción dejó la conv en un estado posterior (ej. awaiting_client_notice
      // tras un ingreso de admin), respetarlo en vez de limpiar.
      const newConv = await loadConversation(phone);
      if (newConv.state === 'idle' || newConv.state === 'confirmando') {
        await clearConversation(phone);
      }
      await sendWA(phone, resultado);
      return;
    }
    if (cancela) {
      await clearConversation(phone);
      await sendWA(phone, '❌ Cancelado. ¿En qué más te puedo ayudar?');
      return;
    }
    if (editar) {
      await sendWA(phone,
        '✏️ ¿Qué corregís? Mandame el dato nuevo, ej:\n' +
        '• _"monto 60000"_ o _"60k"_\n' +
        '• _"obra Sismat"_\n' +
        '• _"30 m²"_ (para avances)\n' +
        '• _"tarea revoque grueso"_\n\n' +
        'Lo demás queda igual.'
      );
      return; // sigue en 'confirmando'
    }
    // ── CORRECCIÓN: el user mandó un dato distinto a sí/no/editar ────────────
    // Extraemos lo que cambió y lo mergeamos sobre la acción en curso, sin
    // perder lo que ya estaba. Re-mostramos la confirmación actualizada.
    const ext = extractSlots(messageText || '', {
      obras: ctx.obras, cajas: ctx.cajas, proveedores: ctx.proveedores,
      detalles: ctx.detalles, defaults: conv.defaults || {},
    });
    const datos = { ...(conv.data.accion.datos || {}) };
    let cambios = 0;
    if (ext.monto != null)    { datos.monto = ext.monto; cambios++; }
    if (ext.obraId)           { datos.obraId = ext.obraId; cambios++; }
    if (ext.cajaId)           { datos.cajaId = ext.cajaId; cambios++; }
    if (ext.cantidad != null) { datos.cantidadAvance = ext.cantidad; cambios++; }
    if (ext.unidad)           { datos.unidad = ext.unidad; cambios++; }
    if (ext.tareaId)          { datos.tareaId = ext.tareaId; datos.rubroId = ext.rubroId || datos.rubroId; cambios++; }
    if (ext.proveedorId)      { datos.proveedorNombre = ext.proveedorNombre; cambios++; }

    if (cambios > 0) {
      const accionAct = { ...conv.data.accion, datos };
      await saveConversation(phone, {
        state: 'confirmando',
        data: { ...conv.data, accion: accionAct },
        slots: mergeSlots(conv.slots || {}, ext),
      });
      const resumen = resumenAccion(accionAct, ctx);
      await sendWAButtons(phone, `🔁 Actualicé:\n\n${resumen}`, BOTONES_CONFIRMAR);
      return;
    }
    // Si no detectó ninguna corrección concreta, recordá las opciones.
    await sendWAButtons(phone, 'No entendí la corrección. Tocá *Confirmar*, *Editar* (y mandá el dato), o *Cancelar*.', BOTONES_CONFIRMAR);
    return;
  }

  // ── Estado: esperando confirmación para avisar al cliente del cobro ─────────
  if (conv.state === 'awaiting_client_notice' && conv.data?.clienteTel) {
    const respLower = (messageText || '').trim().toLowerCase();
    const confirma  = ['sí', 'si', 'dale', 'ok', 'confirmo', 'correcto', 's', 'avisa', 'avisale'].some(p => respLower.startsWith(p));
    const cancela   = ['no', 'cancelar', 'mal', 'n', 'omiti'].some(p => respLower.startsWith(p));

    if (confirma) {
      const { clienteTel, clienteNombre, monto, moneda, obraNombre, recibidoPor } = conv.data;
      try {
        await notifyClienteCobro({ telefono: clienteTel, clienteNombre, monto, moneda, obraNombre, recibidoPor });
        await clearConversation(phone);
        await sendWA(phone, `✅ Listo. Le confirmé el cobro a *${clienteNombre}*.`);
      } catch (e) {
        await clearConversation(phone);
        await sendWA(phone, `⚠️ No pude enviarle el mensaje a *${clienteNombre}*. El ingreso ya quedó cargado igual. (Detalle: ${e.message})`);
      }
      return;
    }
    if (cancela) {
      await clearConversation(phone);
      await sendWA(phone, `👌 No le avisé al cliente. El ingreso quedó cargado igual.`);
      return;
    }
    await sendWA(phone, `Respondeme *sí* para avisarle a ${conv.data.clienteNombre} o *no* para omitir.`);
    return;
  }

  // ── Estado: esperando teléfono del cliente que no estaba cargado ────────────
  if (conv.state === 'awaiting_client_phone' && conv.data?.clienteId) {
    const respLower = (messageText || '').trim().toLowerCase();
    const cancela = ['no', 'omiti', 'omitir', 'despues', 'después', 'luego', 'cancelar', 'n'].some(p => respLower === p || respLower.startsWith(p));

    if (cancela) {
      await clearConversation(phone);
      await sendWA(phone, `👌 No le avisé. Cargá el WhatsApp en la ficha del cliente cuando puedas para que sea automático la próxima vez.`);
      return;
    }

    const tel = normalizePhone(messageText || '');
    if (!tel) {
      await sendWA(phone, `🤔 No reconozco ese número. Mandame solo los dígitos con código país (ej. *5491155551234*), o escribí *no* para omitir.`);
      return;
    }

    // Guardar el teléfono en la ficha del cliente (persistente).
    // Se guarda con "+" para que el campo telefono de la app conserve formato
    // legible (ej. "+5491155551234"). El bot normaliza antes de enviar.
    try {
      const clientesData = await loadSharedData('clientes');
      const clientes = Array.isArray(clientesData) ? clientesData : [];
      const updated = clientes.map(c =>
        c.id === conv.data.clienteId ? { ...c, telefono: '+' + tel } : c
      );
      await saveSharedData('clientes', updated);
    } catch (e) {
      console.error('save cliente phone error:', e.message);
    }

    // Mandar el aviso al cliente.
    const { clienteNombre, monto, moneda, obraNombre, recibidoPor } = conv.data;
    try {
      await notifyClienteCobro({ telefono: tel, clienteNombre, monto, moneda, obraNombre, recibidoPor });
      await clearConversation(phone);
      await sendWA(phone, `✅ Listo. Guardé el WhatsApp en la ficha de *${clienteNombre}* y le confirmé el cobro.`);
    } catch (e) {
      await clearConversation(phone);
      await sendWA(phone, `📱 Guardé el WhatsApp en la ficha, pero no pude enviarle el mensaje. (${e.message})`);
    }
    return;
  }

  const updatedHistory = [
    ...conv.history,
    { rol: 'usuario', texto: messageText || '(foto)', ts: Date.now() },
  ];

  // ── PRE-EXTRACCIÓN DE SLOTS (anti-repreguntas) ──────────────────────────────
  // Antes de llamar a Claude, extraemos lo más posible del mensaje con regex.
  // El resultado se mergea con los slots ya conocidos de turnos previos. Si
  // tenemos todo lo necesario, podemos saltear preguntas redundantes.
  // Esto cubre el caso: "AGENDA AVANCE DE OBRA 25 MTS2 DE COLOCACION DE PISOS"
  // → extrae intent=avance, cantidad=25, unidad=m², tarea=colocacion de pisos
  // → si todo matchea, va directo a confirmar sin preguntar nada.
  const ctxExt = {
    obras:        ctx.obras,
    cajas:        ctx.cajas,
    proveedores:  ctx.proveedores,
    detalles:     ctx.detalles,
    defaults:     conv.defaults || {},
  };
  const extractedSlots = extractSlots(messageText || '', ctxExt);
  const mergedSlots = mergeSlots(conv.slots || {}, extractedSlots);
  conv.slots = mergedSlots;

  // ── BYPASS CORRECCIÓN: "me equivoqué", "corregir avance", etc. ──────────────
  const correccionDetectada = extractCorreccion(messageText || '', ctx.obras, ctx.detalles);
  if (correccionDetectada?.completo) {
    const { _obra, _tarea, cantidadAvance, unidad } = correccionDetectada;
    const pctNuevo = _tarea.cantidad ? Math.round((cantidadAvance / _tarea.cantidad) * 100) : null;
    const pctActual = _tarea.avance || 0;
    const confMsg =
      `🔧 *Corrección de avance:*\n\n` +
      `🏗 Obra: *${_obra.nombre}*\n` +
      `📐 Tarea: *${_tarea.nombre}*\n` +
      `📊 Avance actual: *${pctActual}%*\n` +
      `✏️ Nuevo valor: *${cantidadAvance}${unidad}*${pctNuevo != null ? ` → *${Math.min(pctNuevo, 100)}%*` : ''}\n\n` +
      `Esto *reemplaza* el avance anterior. ¿Confirmás? (sí/no)`;
    const newHist = [...updatedHistory, { rol: 'asistente', texto: confMsg, ts: Date.now() }];
    await saveConversation(phone, { state: 'confirmando', data: { accion: { tipo: 'avance_obra', datos: correccionDetectada }, pendingMediaUrl: mediaUrl }, history: newHist, slots: conv.slots || {} });
    await sendWAButtons(phone, confMsg, BOTONES_CONFIRMAR);
    return;
  }

  // ── BYPASS CLAUDE: extracción directa cuando todo está en el texto ──────────
  // Si detectamos avance + obra + tarea + cantidad del propio mensaje, vamos directo
  // a confirmación sin preguntarle nada al usuario.
  const avanceDetectado = extractAvanceCompleto(messageText || '', ctx.obras, ctx.detalles);
  if (avanceDetectado?.completo && conv.state !== 'conversando') {
    const { _obra, _tarea, cantidadAvance, unidad } = avanceDetectado;
    const cantStr  = `${cantidadAvance}${unidad}`;
    const totalStr = _tarea.cantidad ? ` de ${_tarea.cantidad}${_tarea.unidad || unidad} total` : '';
    const avPct    = _tarea.cantidad ? ` (+${Math.round((cantidadAvance / _tarea.cantidad) * 100)}%)` : '';
    const confMsg  =
      `📋 *Confirmar avance:*\n\n` +
      `🏗 Obra: *${_obra.nombre}*\n` +
      `📐 Tarea: *${_tarea.nombre}*\n` +
      `📊 Cantidad: *${cantStr}*${totalStr}${avPct}\n` +
      (mediaUrl ? `📷 Con foto adjunta\n` : '') +
      `\n¿Confirmás? (sí/no)`;
    const newHist = [...updatedHistory, { rol: 'asistente', texto: confMsg, ts: Date.now() }];
    await saveConversation(phone, { state: 'confirmando', data: { accion: { tipo: 'avance_obra', datos: avanceDetectado }, pendingMediaUrl: mediaUrl }, history: newHist, slots: conv.slots || {} });
    await sendWAButtons(phone, confMsg, BOTONES_CONFIRMAR);
    return;
  }

  const claudeRes = await callClaude(user, messageText, base64Media, mimeType, { ...conv, history: updatedHistory }, ctx, mediaUrl);

  const newHistory = [
    ...updatedHistory,
    { rol: 'asistente', texto: claudeRes.mensaje, ts: Date.now() },
  ];

  if (claudeRes.estado === 'ejecutar') {
    const resultado = await ejecutarAccion(claudeRes.accion.tipo, claudeRes.accion.datos, { ...user, phone }, ctx, mediaUrl);
    // ejecutarAccion puede dejar la conv en un estado posterior (ej.
    // awaiting_client_notice tras un ingreso de admin). Solo limpiamos
    // si quedo en idle/confirmando.
    const afterExec = await loadConversation(phone);
    if (afterExec.state === 'idle' || afterExec.state === 'confirmando') {
      // Persist defaults: lo último usado queda como sugerencia para próxima
      // sesión. Así "cargá otro gasto" infiere obra/caja sin pedir.
      const accionDatos = claudeRes.accion.datos || {};
      const nuevosDefaults = mergeSlots(conv.defaults || {}, {
        lastObraId:      accionDatos.obraId      || conv.slots?.obraId,
        lastCajaId:      accionDatos.cajaId      || conv.slots?.cajaId,
        lastProveedorId: accionDatos.proveedorId || conv.slots?.proveedorId,
        lastRubroId:     accionDatos.rubroId     || conv.slots?.rubroId,
      });
      // Mantener defaults y history para "y otro gasto más"; limpiar slots
      // de la intención que acaba de ejecutarse.
      await saveConversation(phone, {
        state: 'idle', data: {}, slots: {},
        defaults: nuevosDefaults, history: newHistory,
      });
    }
    await sendWA(phone, resultado);
    return;
  }

  if (claudeRes.estado === 'confirmando') {
    await saveConversation(phone, { state: 'confirmando', data: { accion: claudeRes.accion, pendingMediaUrl: mediaUrl }, history: newHistory, slots: conv.slots || {} });
    await sendWAButtons(phone, claudeRes.mensaje, BOTONES_CONFIRMAR);
    return;
  }

  if (claudeRes.estado === 'cancelar') {
    await clearConversation(phone);
    await sendWA(phone, '❌ Cancelado. ¿En qué más te puedo ayudar?');
    return;
  }

  if (claudeRes.estado === 'comando') {
    const resultado = await ejecutarComando(claudeRes.accion?.datos?.comando, claudeRes.accion?.datos || {}, { ...user, phone }, ctx);
    await saveConversation(phone, { state: 'idle', data: {}, slots: {}, history: newHistory });
    await sendWA(phone, resultado);
    return;
  }

  await saveConversation(phone, { state: 'conversando', data: { ...(conv.data || {}), pendingMediaUrl: mediaUrl }, history: newHistory, slots: conv.slots || {} });
  await sendWA(phone, claudeRes.mensaje);
}

// ── Handler principal ─────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // Verificación del webhook (GET de Meta) — solo si vienen los query params
  // tipicos del verify de Meta. Sin esos params, devolvemos el endpoint
  // diagnostico para chequear que las env vars esten OK.
  if (req.method === 'GET') {
    const mode      = req.query['hub.mode'];
    const token     = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode || token || challenge) {
      // Es un intento de verify de Meta — validar token.
      if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        return res.status(200).send(challenge);
      }
      return res.status(403).json({ error: 'Forbidden' });
    }
    // GET sin params → endpoint diagnostico publico (no sensible).
    return res.status(200).json({
      ok: true,
      vars: {
        meta:           !!META_TOKEN,
        phoneId:        !!PHONE_NUMBER_ID,
        verifyToken:    !!VERIFY_TOKEN,
        anthropic:      !!ANTHROPIC_KEY,
        supabase:       !!SUPABASE_URL,
        // META_PHONE_NUMBER es el numero humano del bot (no sensible).
        metaPhoneNumber: process.env.META_PHONE_NUMBER || '(no seteado)',
        portalBaseUrl:   process.env.PORTAL_BASE_URL || '(no seteado, usa fallback kamak.com.ar)',
      },
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;
    if (body?.object !== 'whatsapp_business_account') return res.status(200).json({ ok: true });

    const entry   = body.entry?.[0];
    const change  = entry?.changes?.[0];
    if (change?.field !== 'messages') return res.status(200).json({ ok: true });

    const value   = change.value;

    // Delivery status updates (sent/delivered/read/failed)
    const statusEntry = value?.statuses?.[0];
    if (statusEntry) {
      const { id: wamid, status, errors } = statusEntry;
      console.log(`STATUS wamid=${wamid} status=${status} errors=${JSON.stringify(errors)}`);
      if (wamid && ['sent', 'delivered', 'read', 'failed'].includes(status)) {
        try {
          const tokens = await loadSharedData('portal_tokens');
          if (tokens) {
            const key = Object.keys(tokens).find(k => tokens[k].wamid === wamid);
            if (key) {
              const errMsg = status === 'failed' ? (errors?.[0]?.message || 'No entregado') : null;
              tokens[key] = { ...tokens[key], waStatus: status, ...(errMsg ? { waError: errMsg } : {}) };
              await saveSharedData('portal_tokens', tokens);
            }
          }
        } catch (e) {
          console.error('status update error:', e.message);
        }
      }
      return res.status(200).json({ ok: true });
    }

    const message = value?.messages?.[0];
    if (!message) return res.status(200).json({ ok: true });

    const phone       = message.from;
    const messageType = message.type;

    let text    = '';
    let mediaId = null;
    let mimeType = null;

    if (messageType === 'text') {
      text = message.text?.body || '';
    } else if (messageType === 'image') {
      mediaId  = message.image?.id;
      mimeType = message.image?.mime_type || 'image/jpeg';
      text     = message.image?.caption || '';
    } else if (messageType === 'document') {
      mediaId  = message.document?.id;
      mimeType = message.document?.mime_type || 'application/pdf';
      text     = message.document?.filename || '';
    } else if (messageType === 'interactive') {
      // Respuesta a botón o lista. El id que mandamos vuelve acá. Lo
      // tratamos como texto para que el resto del flujo lo procese igual:
      // - botones de confirmación usan ids 'confirmar'/'cancelar' → mapeamos
      //   a "sí"/"no" para reutilizar la lógica de confirmación existente.
      // - listas de selección usan ids con formato "pick:<valor>".
      const btn  = message.interactive?.button_reply;
      const lst  = message.interactive?.list_reply;
      const rawId = btn?.id || lst?.id || '';
      if (rawId === 'confirmar') text = 'sí';
      else if (rawId === 'cancelar') text = 'no';
      else if (rawId === 'editar') text = 'editar';
      else if (rawId.startsWith('pick:')) text = rawId.slice(5);
      else text = btn?.title || lst?.title || rawId;
    } else {
      return res.status(200).json({ ok: true });
    }

    console.log(`MSG phone=${phone} type=${messageType} text=${text?.slice(0,30)}`);

    const conv = await loadConversation(phone);
    const user = await getLinkedUser(phone);
    const cliente = !user ? await getLinkedCliente(phone) : null;
    console.log(`USER linked=${!!user} cliente=${!!cliente} state=${conv?.state}`);

    if (user) {
      // Usuario interno (Admin, Compras, Capataz, etc.)
      await handleMainFlow(phone, user, text, mediaId, mimeType, conv);
    } else if (cliente) {
      // Cliente vinculado al portal (read-only, comandos limitados)
      await handleClienteFlow(phone, cliente, text);
    } else {
      // Numero desconocido. Primero ver si esta haciendo onboarding desde el QR.
      const parsedQR = parseClientePrimerMensaje(text);
      if (parsedQR) {
        await onboardCliente(phone, parsedQR.nombreCliente, parsedQR.nombreObra);
      } else {
        // Detectar comandos tipicos de cliente. Si escribe "saldo", "avance",
        // "hola", etc. NO mandar al flujo de vinculacion de admin — ese flujo
        // pide nombre/email de empleado y confunde al cliente.
        const t = (text || '').toLowerCase().trim();
        const esComandoCliente = /^(hola|buen[ao]s|hi|hey|saludos|saldo|cuanto|deuda|avance|como\s+va|estado|proximo|cuota|portal|link|acceso|pago|ayuda|help|\?)/.test(t);
        if (esComandoCliente) {
          await sendWA(phone,
            `Hola 👋\n\nNo te tengo registrado todavia. Si sos cliente de Kamak Desarrollos, ` +
            `tu obra deberia haberte enviado un *codigo QR* en el presupuesto.\n\n` +
            `Escanealo y te vinculo automaticamente.\n\n` +
            `Si no tenes el QR a mano, contactanos al equipo de Kamak para que te lo envien.`
          );
        } else {
          // Caso restante: flujo de vinculacion de usuario interno (empleados).
          await handleLinkingFlow(phone, text, conv);
        }
      }
    }

    console.log('DONE');
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ ok: true });
  }
}
