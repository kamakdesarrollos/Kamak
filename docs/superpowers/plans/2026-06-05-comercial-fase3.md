# Módulo Comercial — Fase 3 (Contrato + Firma electrónica) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps usan checkbox (`- [ ]`).

**Goal:** El cliente **firma un contrato** desde el portal con **firma electrónica simple** (OTP + audit trail, art. 5 Ley 25.506). La firma confirma la obra (→ Ganado) y registra una actividad en el timeline.

**Architecture:** El contrato vive en `detalle.contrato`; las plantillas en `shared_data['crm_plantillas_contrato']`. Dos endpoints serverless nuevos (`solicitar-otp`, `firmar`) siguen el patrón de `api/portal/data.js` (SERVICE_KEY, CORS restringido a kamak, validación de token). El OTP se guarda **hasheado** (scrypt+salt, `node:crypto`) en un blob **server-only** `portal_otp_codes`. El portal gana una pestaña "Contrato". Toda la lógica sensible (firma, conversión a Ganado) corre **server-side**.

**Tech Stack:** Vercel serverless (Node) + `node:crypto` (sin deps nuevas) · Supabase `shared_data` + RPC `patch_detalle_obra`/`patch_item_in_shared_array` · React (portal) · Vitest (lógica pura). Reusa de Fase 1/2: `setVentaEtapa`, `obraConfirmada`, `ComercialContext.addActividad`.

**Referencia:** spec §9, §4.4, §4.5, §7.1, §12, §13.

**Dependencias externas (NO bloquean el código; se prueban en vivo):** el envío del OTP por WhatsApp requiere una **plantilla Meta aprobada `otp_firma`** (crearla en Meta Business Manager). No hay email fallback en el repo → v1 es **WhatsApp-only** (el endpoint devuelve el canal; si falla, error claro). Documentado para verificación manual.

**Antes de empezar:** `git checkout -b feat/comercial-fase3` (desde main con Fase 1+2 ya mergeadas).

---

### Task 0: Pre-requisito de seguridad (BLOQUEANTE)

**Files:** Modify `api/portal/validate-token.js` (CORS)

- [ ] **Step 1: Corregir el CORS wildcard de validate-token**

En `api/portal/validate-token.js`, reemplazar el header `Access-Control-Allow-Origin: '*'` por el mismo CORS restringido que `api/portal/data.js:87-91`:

```javascript
  const origin = req.headers.origin || '';
  const corsOk = /^https:\/\/([a-z0-9-]+\.)?kamak\.com\.ar$/.test(origin);
  res.setHeader('Access-Control-Allow-Origin', corsOk ? origin : 'https://kamak.com.ar');
  res.setHeader('Vary', 'Origin');
```

(quitar la línea `res.setHeader('Access-Control-Allow-Origin', '*')`.)

- [ ] **Step 2: Confirmar que data.js NO filtra costos** (ya hecho en `sanitizeDetalle`): grep rápido — `grep -n "costoMat\|margenMat\|costoSub" api/portal/data.js` no debe aparecer en lo que se devuelve al cliente.

- [ ] **Step 3: Build + commit**

```bash
npm run build
git add api/portal/validate-token.js
git commit -m "fix(portal/seguridad): CORS restringido en validate-token (pre-firma)"
```

---

### Task 1: Estados de contrato + plantilla legal (seed)

**Files:**
- Modify: `src/lib/constants.js` (estados de contrato)
- Create: `scripts/seed_plantilla_contrato.mjs` (siembra 1 plantilla default, idempotente, con backup)

- [ ] **Step 1: Constante de estados**

En `src/lib/constants.js`, agregar:

```javascript
// Estados del contrato firmable (módulo Comercial, Fase 3).
export const ESTADOS_CONTRATO = ['borrador', 'enviado', 'firmado', 'rechazado'];
```

- [ ] **Step 2: Script de seed de la plantilla** (idempotente, dry-run/--apply)

Crear `scripts/seed_plantilla_contrato.mjs` (patrón de `scripts/backfill_venta_etapa.mjs`: lee `.env.local`, dry-run por defecto, `--apply` escribe con backup). Siembra UNA plantilla en `shared_data['crm_plantillas_contrato']` si no hay ninguna:

```javascript
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(resolve(__dirname, '../.env.local'), 'utf8');
const pick = (k) => { const m = env.match(new RegExp('^' + k + '=(.*)$', 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : null; };
const supabase = createClient(pick('SUPABASE_URL') || pick('VITE_SUPABASE_URL'), pick('SUPABASE_SERVICE_KEY'));
const APPLY = process.argv.includes('--apply');

const get = async (key) => { const { data: row } = await supabase.from('shared_data').select('*').eq('key', key).single(); if (!row) return { row: null, col: 'data', val: null }; const col = row.data !== undefined ? 'data' : 'value'; return { row, col, val: row[col] }; };

const PLANTILLA_DEFAULT = {
  id: 'plc-default',
  nombre: 'Contrato de obra (estándar)',
  html: `<h2 style="text-align:center">CONTRATO DE OBRA</h2>
<p>Entre <b>KAMAK DESARROLLOS</b> y <b>{{cliente.nombre}}</b> (CUIT {{cliente.cuit}}), en adelante "El Cliente", se acuerda la ejecución de la obra <b>{{obra.nombre}}</b> sita en {{obra.direccion}}.</p>
<p><b>Alcance:</b> {{alcance}}</p>
<p><b>Precio total:</b> U$S {{montoUSD}} + IVA, según el siguiente plan de pagos:</p>
{{planCuotas}}
<p>El Cliente declara aceptar el presente contrato mediante firma electrónica.</p>
<p>Fecha: {{fecha}}</p>`,
  placeholders: ['cliente.nombre', 'cliente.cuit', 'obra.nombre', 'obra.direccion', 'alcance', 'montoUSD', 'planCuotas', 'fecha'],
};

const cur = await get('crm_plantillas_contrato');
const arr = Array.isArray(cur.val) ? cur.val : [];
const yaTiene = arr.some(p => p.id === 'plc-default');
console.log(`Modo: ${APPLY ? 'APPLY' : 'DRY-RUN'} · plantillas actuales: ${arr.length} · default ya existe: ${yaTiene}`);
if (yaTiene) { console.log('Nada para hacer (idempotente).'); process.exit(0); }
if (!APPLY) { console.log('(DRY-RUN: correr con --apply para sembrar la plantilla default.)'); process.exit(0); }

if (cur.row) writeFileSync(resolve(__dirname, `_backup_PRE_PLANTILLA_CONTRATO_${Date.now()}.json`), JSON.stringify(cur.val));
const nuevo = [...arr, PLANTILLA_DEFAULT];
if (cur.row) await supabase.from('shared_data').update({ [cur.col]: nuevo }).eq('key', 'crm_plantillas_contrato');
else await supabase.from('shared_data').insert({ key: 'crm_plantillas_contrato', data: nuevo });
console.log('✅ Plantilla default sembrada.');
```

> El `--apply` lo corre el humano después de revisar el dry-run (muta prod). El agente sólo crea el script + corre el dry-run.

- [ ] **Step 3: Dry-run + commit (sin --apply)**

```bash
node scripts/seed_plantilla_contrato.mjs      # dry-run
git add src/lib/constants.js scripts/seed_plantilla_contrato.mjs
git commit -m "feat(comercial): estados de contrato + seed de plantilla legal default"
```

---

### Task 2: Generación server-side del contrato (TDD lógica pura)

**Files:**
- Create: `api/_lib/contrato.js` (helper puro: render de placeholders con escaping + plan de cuotas + sha256)
- Test: `api/_lib/contrato.test.js`

- [ ] **Step 1: Test que falla**

Crear `api/_lib/contrato.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { escapeHtml, renderPlantilla, hashDocumento } from './contrato.js';

describe('escapeHtml', () => {
  it('escapa caracteres peligrosos (anti-XSS en placeholders)', () => {
    expect(escapeHtml('<b>x</b> & "y"')).toBe('&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;');
  });
});

describe('renderPlantilla', () => {
  it('resuelve placeholders escapando los valores', () => {
    const html = renderPlantilla('Hola {{cliente.nombre}} ({{cliente.cuit}})', { 'cliente.nombre': 'Juan <script>', 'cliente.cuit': '20-1-3' });
    expect(html).toBe('Hola Juan &lt;script&gt; (20-1-3)');
  });
  it('un placeholder sin valor queda vacío', () => {
    expect(renderPlantilla('a{{falta}}b', {})).toBe('ab');
  });
  it('NO escapa el placeholder planCuotas (es HTML de tabla generado por nosotros)', () => {
    expect(renderPlantilla('{{planCuotas}}', { planCuotas: '<table><tr><td>1</td></tr></table>' })).toContain('<table>');
  });
});

describe('hashDocumento', () => {
  it('sha256 estable e idéntico para el mismo input', () => {
    expect(hashDocumento('abc')).toBe(hashDocumento('abc'));
    expect(hashDocumento('abc')).toMatch(/^[a-f0-9]{64}$/);
  });
});
```

- [ ] **Step 2: Correr → falla**

Run: `npm test -- api/_lib/contrato.test.js` → FAIL (módulo ausente).

- [ ] **Step 3: Implementar `api/_lib/contrato.js`**

```javascript
import crypto from 'node:crypto';

// Escapa valores antes de inyectarlos en el HTML del contrato (anti-XSS): la
// plantilla es de confianza (la edita el admin), pero los VALORES (nombre, cuit)
// vienen de datos y pueden traer HTML malicioso.
export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Resuelve {{placeholder}} con los valores dados. Escapa todos los valores SALVO
// 'planCuotas' (que es HTML de tabla generado por nosotros, no input del usuario).
export function renderPlantilla(htmlPlantilla, valores) {
  return String(htmlPlantilla || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const v = valores[key];
    if (v == null) return '';
    return key === 'planCuotas' ? String(v) : escapeHtml(v);
  });
}

// SHA-256 hex del documento renderizado: ata la firma a ESTA versión exacta.
export function hashDocumento(html) {
  return crypto.createHash('sha256').update(String(html), 'utf8').digest('hex');
}

// Construye la tabla HTML del plan de cuotas (USD) desde detalle.cuotas.
export function planCuotasHtml(cuotas, toUSD) {
  const filas = (cuotas || []).map(c =>
    `<tr><td>${escapeHtml(c.descripcion || ('Cuota ' + (c.n ?? '')))}</td><td style="text-align:right">U$S ${toUSD(c)}</td></tr>`
  ).join('');
  return `<table style="width:100%;border-collapse:collapse" border="1" cellpadding="4">${filas || '<tr><td>—</td></tr>'}</table>`;
}
```

- [ ] **Step 4: Correr → pasa**

Run: `npm test -- api/_lib/contrato.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add api/_lib/contrato.js api/_lib/contrato.test.js
git commit -m "feat(comercial): generacion server-side del contrato (placeholders escapados + sha256)"
```

---

### Task 3: Endpoint `POST /api/portal/solicitar-otp`

**Files:** Create `api/portal/solicitar-otp.js`

- [ ] **Step 1: Crear el endpoint**

```javascript
// Genera un OTP para firmar el contrato y lo manda por WhatsApp. El OTP se guarda
// HASHEADO (scrypt+salt) en shared_data['portal_otp_codes'] (server-only, sin RLS
// para el browser). Mismo gate que data.js: CORS kamak + token mágico válido.
import crypto from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const sbH = () => ({ apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' });

async function loadSharedData(key) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/shared_data?key=eq.${key}&select=data`, { headers: sbH() });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows[0]?.data ?? null;
}
async function saveSharedData(key, data) {
  // upsert simple (portal_otp_codes es un objeto pequeño; sin contención real).
  await fetch(`${SUPABASE_URL}/rest/v1/shared_data?on_conflict=key`, {
    method: 'POST',
    headers: { ...sbH(), Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ key, data }),
  });
}
const hashOtp = (otp, salt) => crypto.scryptSync(otp, salt, 32).toString('hex');

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const corsOk = /^https:\/\/([a-z0-9-]+\.)?kamak\.com\.ar$/.test(origin);
  res.setHeader('Access-Control-Allow-Origin', corsOk ? origin : 'https://kamak.com.ar');
  res.setHeader('Vary', 'Origin');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });

  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: 'token' });

    const tokens = await loadSharedData('portal_tokens');
    const entry = tokens?.[token];
    if (!entry) return res.status(404).json({ error: 'invalid' });
    if (entry.expires && new Date(entry.expires) < new Date()) return res.status(410).json({ error: 'expired' });

    const obraId = entry.obraId;
    // OTP de 6 dígitos.
    const otp = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const salt = crypto.randomBytes(16).toString('hex');
    const otpId = `otp-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    const codes = (await loadSharedData('portal_otp_codes')) || {};
    // Limpieza: descartar los expirados de ese token.
    const now = Date.now();
    for (const k of Object.keys(codes)) { if (codes[k].expiresAt && new Date(codes[k].expiresAt).getTime() < now) delete codes[k]; }
    codes[otpId] = {
      hashOTP: hashOtp(otp, salt), salt, obraId, token,
      canal: 'whatsapp', expiresAt: new Date(now + 10 * 60 * 1000).toISOString(),
      intentos: 0, maxIntentos: 3, verificadoAt: null, usado: false,
    };
    await saveSharedData('portal_otp_codes', codes);

    // Enviar por WhatsApp (plantilla Meta 'otp_firma'). entry.phone debe existir.
    let enviado = false;
    try {
      if (entry.phone) {
        const r = await fetch(`https://graph.facebook.com/v18.0/${process.env.META_PHONE_NUMBER_ID}/messages`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messaging_product: 'whatsapp', to: entry.phone, type: 'template',
            template: { name: 'otp_firma', language: { code: 'es_AR' }, components: [{ type: 'body', parameters: [{ type: 'text', text: otp }] }] },
          }),
        });
        enviado = r.ok;
        if (!r.ok) console.error('[solicitar-otp] Meta error', await r.text());
      }
    } catch (e) { console.error('[solicitar-otp] envío falló', e.message); }

    // No revelamos el OTP. Si no se pudo enviar, igual devolvemos otpId (el cliente
    // verá el aviso); el front muestra "no pudimos enviar el código" si enviado=false.
    return res.status(200).json({ otpId, enviado, canal: 'whatsapp', expiraEnSeg: 600 });
  } catch (e) {
    console.error('[solicitar-otp] error', e.message);
    return res.status(500).json({ error: e.message });
  }
}
```

- [ ] **Step 2: Build + commit**

```bash
npm run build
git add api/portal/solicitar-otp.js
git commit -m "feat(portal/firma): endpoint solicitar-otp (OTP hasheado scrypt + envio WhatsApp)"
```

---

### Task 4: Endpoint `POST /api/portal/firmar`

**Files:** Create `api/portal/firmar.js`

- [ ] **Step 1: Crear el endpoint** (valida OTP con `timingSafeEqual`, persiste firma, convierte a Ganado idempotente, registra actividad)

```javascript
import crypto from 'node:crypto';
import { hashDocumento } from '../_lib/contrato.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const sbH = () => ({ apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' });
async function loadSharedData(key) { const r = await fetch(`${SUPABASE_URL}/rest/v1/shared_data?key=eq.${key}&select=data`, { headers: sbH() }); if (!r.ok) return null; const rows = await r.json(); return rows[0]?.data ?? null; }
async function saveSharedData(key, data) { await fetch(`${SUPABASE_URL}/rest/v1/shared_data?on_conflict=key`, { method: 'POST', headers: { ...sbH(), Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ key, data }) }); }
async function rpc(fn, args) { const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: sbH(), body: JSON.stringify(args) }); return r.ok; }
const hashOtp = (otp, salt) => crypto.scryptSync(otp, salt, 32).toString('hex');
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
    if (detalle.contrato.estado === 'firmado') return res.status(200).json({ success: true, yaFirmado: true, fechaFirmado: detalle.contrato.fechaFirmado });

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
    const nuevoDetalle = { ...detalle, contrato: { ...detalle.contrato, estado: 'firmado', fechaFirmado: fecha, firma } };

    // Conversión a Ganado (idempotente, espejo de setVentaEtapa).
    const nuevoEstado = obra.estado === 'finalizada' ? 'finalizada' : 'activa';
    const ventaPrev = obra.venta || {};
    const cambios = {
      estado: nuevoEstado,
      venta: { ...ventaPrev, etapa: 'ganado', fechaCambioEtapa: fecha.slice(0, 10), changelog: [...(ventaPrev.changelog || []), { etapa: 'ganado', fecha: fecha.slice(0, 10), usuario: 'sistema' }] },
    };
    if (nuevoEstado === 'activa' && !obra.fechaInicio) cambios.fechaInicio = fecha.slice(0, 10);

    // Persistir: detalle (con la firma) + obra (Ganado) vía RPC atómicos.
    await rpc('patch_detalle_obra', { p_obra_id: obraId, p_detalle: nuevoDetalle });
    await rpc('patch_item_in_shared_object', { p_key: 'obras', p_field: 'obras', p_id: obraId, p_patch: cambios });

    // Consumir OTP.
    c.usado = true; c.verificadoAt = fecha; await saveSharedData('portal_otp_codes', codes);

    // Actividad de firma en el timeline.
    const actividades = (await loadSharedData('crm_actividades')) || [];
    actividades.unshift({ id: `act-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`, clienteId: obra.clienteId || null, obraId, tipo: 'firma', texto: `Contrato firmado por ${firma.nombre}`, fecha, usuario: 'sistema', adjuntos: [], creadoAt: fecha, actualizadoAt: fecha });
    await saveSharedData('crm_actividades', actividades);

    return res.status(200).json({ success: true, fechaFirmado: fecha });
  } catch (e) {
    console.error('[firmar] error', e.message);
    return res.status(500).json({ error: e.message });
  }
}
```

> **Nota para el implementador:** verificá los nombres reales de los RPC en `supabase/migrations/0002/0003` (`patch_detalle_obra`, y el de patch por id en objeto — puede llamarse `patch_item_in_shared_object` o similar; usá el que exista, o caé a read-modify-write con `saveSharedData('obras', ...)` si no hay RPC). El `crm_actividades` lo escribe con read-modify-write (no hay RPC server para append de array desde fetch directo; aceptable, es server-only y poco concurrente).

- [ ] **Step 2: Build + commit**

```bash
npm run build
git add api/portal/firmar.js
git commit -m "feat(portal/firma): endpoint firmar (valida OTP timingSafe, persiste firma, convierte a Ganado, actividad)"
```

---

### Task 5: data.js expone el contrato (sin costos) + UI ContratoFirma

**Files:**
- Modify: `api/portal/data.js` (`sanitizeDetalle`: agregar `contrato` sin costos)
- Create: `src/pages/portal/ContratoFirma.jsx`
- Modify: `src/pages/portal/PortalCliente.jsx` (tab Contrato)

- [ ] **Step 1: `sanitizeDetalle` devuelve el contrato (whitelist, sin costos)**

En `api/portal/data.js`, dentro de `sanitizeDetalle`, agregar al objeto retornado:

```javascript
    contrato: detalle.contrato ? {
      estado: detalle.contrato.estado,
      version: detalle.contrato.version,
      htmlRenderizado: detalle.contrato.htmlRenderizado,   // ya sanitizado al generar
      fechaEnviado: detalle.contrato.fechaEnviado || null,
      fechaFirmado: detalle.contrato.fechaFirmado || null,
      firma: detalle.contrato.firma ? { nombre: detalle.contrato.firma.nombre, fecha: detalle.contrato.firma.fecha } : null,
    } : null,
```

(NO incluir hashDocumento, ip, dni, ni nada de costos.)

- [ ] **Step 2: Crear `src/pages/portal/ContratoFirma.jsx`**

```jsx
import { useState } from 'react';
import { T } from '../../theme';
import { Btn } from '../../components/ui';

// Pantalla de firma del contrato en el portal. Recibe el contrato (sanitizado) y
// el token. Flujo: ver contrato → Firmar → nombre+DNI → pedir OTP → ingresar OTP.
export default function ContratoFirma({ contrato, token }) {
  const [paso, setPaso] = useState('ver');   // ver | datos | otp | hecho
  const [datos, setDatos] = useState({ nombre: '', dni: '' });
  const [otpId, setOtpId] = useState(null);
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  const firmado = contrato?.estado === 'firmado';

  const pedirOtp = async () => {
    if (!datos.nombre.trim()) { setError('Ingresá tu nombre.'); return; }
    setCargando(true); setError('');
    try {
      const r = await fetch('/api/portal/solicitar-otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'No se pudo enviar el código');
      setOtpId(d.otpId); setPaso('otp');
      if (!d.enviado) setError('No pudimos enviar el código por WhatsApp. Avisá al equipo de Kamak.');
    } catch (e) { setError(e.message); } finally { setCargando(false); }
  };

  const firmar = async () => {
    if (otp.length < 4) { setError('Ingresá el código.'); return; }
    setCargando(true); setError('');
    try {
      const r = await fetch('/api/portal/firmar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, otpId, otp, nombre: datos.nombre.trim(), dni: datos.dni.trim() }) });
      const d = await r.json();
      if (!r.ok) throw new Error(({ otp_incorrecto: 'Código incorrecto.', otp_expirado: 'El código venció, pedí uno nuevo.', otp_intentos: 'Demasiados intentos, pedí un código nuevo.' })[d.error] || d.error || 'Error al firmar');
      setPaso('hecho');
    } catch (e) { setError(e.message); } finally { setCargando(false); }
  };

  if (!contrato || !['enviado', 'firmado', 'rechazado'].includes(contrato.estado)) {
    return <div style={{ padding: 40, textAlign: 'center', color: T.ink3 }}>Todavía no hay un contrato disponible para firmar.</div>;
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 16 }}>
      <div style={{ background: '#fff', border: `1.5px solid ${T.faint2}`, borderRadius: 8, padding: 24 }}
        dangerouslySetInnerHTML={{ __html: contrato.htmlRenderizado || '' }} />

      <div style={{ marginTop: 10, fontSize: 11, color: T.ink3, fontStyle: 'italic' }}>
        Firma electrónica simple (art. 5, Ley 25.506): tiene valor probatorio. No es firma digital.
      </div>

      {firmado ? (
        <div style={{ marginTop: 16, padding: '12px 16px', background: '#f0faf2', borderLeft: `3px solid ${T.ok}`, borderRadius: 6, color: '#166534', fontWeight: 600 }}>
          ✓ Firmado{contrato.firma?.nombre ? ` por ${contrato.firma.nombre}` : ''}{contrato.fechaFirmado ? ` el ${new Date(contrato.fechaFirmado).toLocaleDateString('es-AR')}` : ''}.
        </div>
      ) : paso === 'hecho' ? (
        <div style={{ marginTop: 16, padding: '12px 16px', background: '#f0faf2', borderLeft: `3px solid ${T.ok}`, borderRadius: 6, color: '#166534', fontWeight: 600 }}>✓ ¡Contrato firmado! Gracias.</div>
      ) : (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 360 }}>
          {paso === 'ver' && <Btn fill onClick={() => setPaso('datos')}>Firmar contrato</Btn>}
          {paso === 'datos' && <>
            <input placeholder="Nombre y apellido" value={datos.nombre} onChange={e => setDatos(d => ({ ...d, nombre: e.target.value }))} style={inp} />
            <input placeholder="DNI / CUIT" value={datos.dni} onChange={e => setDatos(d => ({ ...d, dni: e.target.value }))} style={inp} />
            <Btn fill onClick={pedirOtp} disabled={cargando}>{cargando ? 'Enviando…' : 'Recibir código por WhatsApp'}</Btn>
          </>}
          {paso === 'otp' && <>
            <div style={{ fontSize: 12, color: T.ink2 }}>Te enviamos un código por WhatsApp. Ingresalo:</div>
            <input placeholder="Código de 6 dígitos" value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} style={inp} />
            <Btn fill onClick={firmar} disabled={cargando}>{cargando ? 'Firmando…' : 'Confirmar firma'}</Btn>
          </>}
          {error && <div style={{ fontSize: 12, color: '#b91c1c' }}>{error}</div>}
        </div>
      )}
    </div>
  );
}

const inp = { padding: '8px 12px', border: '1.5px solid #d4cfbf', borderRadius: 6, fontSize: 14, fontFamily: 'inherit', outline: 'none' };
```

- [ ] **Step 3: Integrar en `PortalCliente.jsx`**

Importar: `import ContratoFirma from './ContratoFirma';`
Cambiar el array de tabs (línea ~292) a incluir "Contrato" **solo si hay contrato**:

```javascript
  const tabs = ['Resumen', 'Avance', 'Cuenta corriente', 'Documentos', ...(detalle.contrato ? ['Contrato'] : [])];
```

Y agregar el render del tab (después del tab Documentos):

```jsx
        {tabs[tab] === 'Contrato' && (
          <ContratoFirma contrato={detalle.contrato} token={(() => { try { return sessionStorage.getItem(`kamak_portal_${id}`); } catch { return null; } })()} />
        )}
```

(usar `tabs[tab] === 'Contrato'` por si el índice varía según haya o no contrato.)

- [ ] **Step 4: Build + commit**

```bash
npm run build
git add api/portal/data.js src/pages/portal/ContratoFirma.jsx src/pages/portal/PortalCliente.jsx
git commit -m "feat(portal/firma): tab Contrato en el portal + data.js expone el contrato (sin costos)"
```

---

### Task 6: Generar/enviar contrato desde la app + actividad portal_abierto

**Files:**
- Modify: `src/pages/obra/ObraPresupuesto.jsx` (botón "Generar/Enviar contrato" en TabFinanciacion)
- Modify: `api/portal/data.js` (registrar actividad `portal_abierto` al cargar — opcional, server-side)

- [ ] **Step 1: Botón "Generar contrato" en la app**

En `ObraPresupuesto.jsx` (TabFinanciacion ~2046, donde está `propuestaEnviada`), agregar un botón **"Generar contrato"** (admin) que:
1. Toma la plantilla `plc-default` de `useCatalog`/un nuevo hook o lee `crm_plantillas_contrato` (cargarlo vía un provider chico o `loadSharedData`).
2. Resuelve los placeholders con `renderPlantilla` (import desde `api/_lib/contrato.js` — **mover ese helper a `src/lib/contrato.js`** para que lo use el front también; el endpoint lo importa desde ahí con `.js`).
3. Setea `detalle.contrato = { plantillaId:'plc-default', htmlRenderizado, version:1, estado:'enviado', fechaEnviado, hashDocumento }` vía `patch(d => ({ ...d, contrato }))`.

> **Refactor:** mové `escapeHtml/renderPlantilla/hashDocumento/planCuotasHtml` de `api/_lib/contrato.js` a `src/lib/contrato.js` (.js explícito) y que `api/portal/firmar.js` lo importe desde `../../src/lib/contrato.js`. Así el front (generar) y el server (firmar/hash) comparten la misma lógica. Ajustá los imports de la Task 2/4.

Código del handler (dentro del componente, con `calcTotalClienteUSD`, `detalle.cuotas`, `cliente`):

```javascript
  const generarContrato = async () => {
    const plantillas = (await loadSharedData('crm_plantillas_contrato')) || [];
    const plantilla = plantillas.find(p => p.id === 'plc-default') || plantillas[0];
    if (!plantilla) { window.alert('No hay plantilla de contrato. Sembrala primero.'); return; }
    const { venta } = calcObra(detalle.rubros || []);
    const totalUSD = calcTotalClienteUSD(detalle, venta, 0, parseFloat(detalle.financiacion?.interes) || 0, dolarVenta || 1070);
    const cuotasHtml = planCuotasHtml(detalle.cuotas || [], (c) => fmtN(Math.round((c.monto || 0) * (c._usd || obra.moneda === 'USD' ? 1 : 1 / (dolarVenta || 1070)))));
    const valores = {
      'cliente.nombre': clienteNombre || obra.cliente || '', 'cliente.cuit': clienteActual?.cuit || '',
      'obra.nombre': obra.nombre, 'obra.direccion': obra.direccion || '',
      alcance: `${(detalle.rubros || []).length} rubros`, montoUSD: fmtN(totalUSD),
      planCuotas: cuotasHtml, fecha: new Date().toLocaleDateString('es-AR'),
    };
    const html = renderPlantilla(plantilla.html, valores);
    patch(d => ({ ...d, contrato: { plantillaId: plantilla.id, htmlRenderizado: html, version: ((d.contrato?.version) || 0) + 1, estado: 'enviado', fechaEnviado: new Date().toISOString(), hashDocumento: hashDocumento(html) } }));
    window.alert('Contrato generado. El cliente ya puede firmarlo desde el portal.');
  };
```

(agregar el botón `<Btn sm onClick={generarContrato}>Generar contrato</Btn>` en TabFinanciacion; importar `renderPlantilla, planCuotasHtml, hashDocumento` de `../../lib/contrato` y `loadSharedData` de `../../lib/dbHelpers`.)

- [ ] **Step 2: Actividad `portal_abierto`** (opcional, server-side en data.js): al validar el token en `data.js`, hacer un append best-effort a `crm_actividades` con `{ tipo:'portal_abierto', clienteId, obraId, usuario:'sistema' }` — pero **sólo una vez por día por obra** (chequear que no haya ya un `portal_abierto` de hoy) para no inundar el timeline. Si agrega complejidad, **diferir a Fase 4** (el aviso de visita es de la automatización del bot).

- [ ] **Step 3: Build + commit**

```bash
npm run build
git add src/lib/contrato.js src/pages/obra/ObraPresupuesto.jsx api/portal/firmar.js api/portal/data.js
git commit -m "feat(comercial): generar/enviar contrato desde la app (TabFinanciacion) + helper compartido"
```

---

### Task 7: Tests + verificación final

- [ ] **Step 1: Suite completa**

Run: `npm test` (incluye `contrato.test.js` + los de Fase 1/2). Expected: todo verde.

- [ ] **Step 2: Build**

Run: `npm run build`. Expected: exitoso.

- [ ] **Step 3: Verificación E2E manual (la hace el humano, requiere Meta + portal en vivo)**

Documentar en el commit/PR: (1) sembrar plantilla (`node scripts/seed_plantilla_contrato.mjs --apply`), (2) crear la plantilla Meta `otp_firma` aprobada, (3) generar contrato desde la app, (4) abrir el portal con token, tab Contrato, Firmar → OTP por WhatsApp → confirmar, (5) verificar que la obra pasa a Ganado/activa y aparece la actividad 'firma'. Confirmar que ningún costo viaja al browser.

- [ ] **Step 4: Integrar** (superpowers:finishing-a-development-branch): merge `feat/comercial-fase3` a `main`.

**Dependencias externas / verificación humana (NO bloquean el merge del código):** plantilla Meta `otp_firma`; correr el seed `--apply`; email fallback no implementado (WhatsApp-only v1). **Fuera de alcance:** firma digital avanzada / DocuSign (`proveedorExterno` reservado); el cron de aviso de firma/visita es Fase 4.
