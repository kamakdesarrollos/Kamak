// Sin dependencias externas — solo fetch nativo de Node.js 18+

const ACCOUNT_SID    = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN     = process.env.TWILIO_AUTH_TOKEN;
const FROM_NUMBER    = process.env.TWILIO_WHATSAPP_NUMBER;
const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL   = process.env.SUPABASE_URL;
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_KEY;

const twilioAuth  = () => 'Basic ' + Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64');

// ── Twilio ────────────────────────────────────────────────────────────────────
async function sendMessage(to, body) {
  try {
    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: twilioAuth(), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ From: FROM_NUMBER, To: to, Body: body }).toString(),
    });
  } catch (e) {
    console.error('sendMessage error:', e.message);
  }
}

async function downloadMedia(url) {
  const res = await fetch(url, { headers: { Authorization: twilioAuth() } });
  const buffer = await res.arrayBuffer();
  return Buffer.from(buffer).toString('base64');
}

// ── Supabase ──────────────────────────────────────────────────────────────────
const sbHeaders = () => ({
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=minimal',
});

async function loadPending() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/shared_data?key=eq.whatsapp_pending&select=data`, {
    headers: sbHeaders(),
  });
  const rows = await res.json();
  return Array.isArray(rows[0]?.data) ? rows[0].data : [];
}

async function savePending(items) {
  await fetch(`${SUPABASE_URL}/rest/v1/shared_data`, {
    method: 'POST',
    headers: { ...sbHeaders(), 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify({ key: 'whatsapp_pending', data: items, updated_at: new Date().toISOString() }),
  });
}

// ── Claude ────────────────────────────────────────────────────────────────────
const INVOICE_PROMPT = `Analizá esta factura argentina y extraé los datos. Respondé ÚNICAMENTE con JSON válido, sin texto adicional:
{
  "proveedor": "nombre del proveedor o empresa emisora",
  "cuit": "CUIT del proveedor (formato XX-XXXXXXXX-X)",
  "tipoFactura": "A, B o C",
  "numeroFactura": "número completo (ej: 0001-00012345)",
  "fecha": "fecha de emisión en formato YYYY-MM-DD",
  "concepto": "descripción breve del servicio o producto",
  "monto": importe_neto_sin_iva_como_numero,
  "montoTotal": importe_total_con_iva_como_numero,
  "moneda": "ARS o USD"
}
Si algún campo no aparece en la factura usá null. Los montos deben ser números, sin signos ni puntos de miles.`;

async function extractInvoice(base64, mimeType) {
  const isPDF    = mimeType === 'application/pdf';
  const content  = isPDF
    ? [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }, { type: 'text', text: INVOICE_PROMPT }]
    : [{ type: 'image',    source: { type: 'base64', media_type: mimeType,            data: base64 } }, { type: 'text', text: INVOICE_PROMPT }];

  const res  = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1024, messages: [{ role: 'user', content }] }),
  });
  const data = await res.json();

  try {
    const text = data.content[0].text.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    return JSON.parse(text);
  } catch {
    return { concepto: 'No se pudo extraer automáticamente', monto: null, montoTotal: null, proveedor: null, fecha: null };
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, vars: { sid: !!ACCOUNT_SID, token: !!AUTH_TOKEN, from: !!FROM_NUMBER, anthropic: !!ANTHROPIC_KEY, supabase: !!SUPABASE_URL } });
  }

  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send('<Response></Response>');

  try {
    const body     = req.body;
    const from     = body.From;
    const numMedia = parseInt(body.NumMedia || '0', 10);

    if (numMedia === 0) {
      await sendMessage(from, '📄 *Kamak · Procesador de facturas*\n\nEnviame una foto o PDF de la factura y la proceso automáticamente.\nEn unos segundos te confirmo los datos extraídos.');
      return;
    }

    await sendMessage(from, '⏳ Recibí la factura, procesando con IA...');

    const mediaUrl  = body.MediaUrl0;
    const mimeType  = body.MediaContentType0 || 'image/jpeg';
    const mediaType = mimeType.startsWith('image/') ? 'image' : 'document';
    const base64    = await downloadMedia(mediaUrl);
    const extracted = await extractInvoice(base64, mimeType);

    const newItem = {
      id:            `wp-${Date.now()}`,
      from:          from.replace('whatsapp:', ''),
      mediaType,
      mimeType,
      receivedAt:    new Date().toISOString(),
      status:        'pendiente',
      proveedor:     extracted.proveedor     ?? null,
      cuit:          extracted.cuit          ?? null,
      tipoFactura:   extracted.tipoFactura   ?? null,
      numeroFactura: extracted.numeroFactura ?? null,
      fecha:         extracted.fecha         ?? null,
      concepto:      extracted.concepto      ?? null,
      monto:         extracted.monto         ?? null,
      montoTotal:    extracted.montoTotal     ?? null,
      moneda:        extracted.moneda        ?? 'ARS',
    };

    const existing = await loadPending();
    await savePending([newItem, ...existing]);

    const montoStr = newItem.montoTotal ? `$ ${Math.round(newItem.montoTotal).toLocaleString('es-AR')}` : '(monto no detectado)';
    await sendMessage(from,
      `✅ *Factura procesada*\n\n*Proveedor:* ${newItem.proveedor || 'no detectado'}\n*Tipo:* Factura ${newItem.tipoFactura || '?'} · ${newItem.numeroFactura || ''}\n*Fecha:* ${newItem.fecha || 'no detectada'}\n*Monto total:* ${montoStr}\n*Concepto:* ${newItem.concepto || '—'}\n\nQuedó en el buzón del app para que la revises y confirmes como gasto.`
    );
  } catch (err) {
    console.error('Webhook error:', err);
  }
}
