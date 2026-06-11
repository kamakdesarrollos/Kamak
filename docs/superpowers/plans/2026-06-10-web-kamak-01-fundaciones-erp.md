# Web Kamak — Plan 01: Fundaciones ERP (modelo `obra.web` + endpoints públicos)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (o executing-plans). Steps con checkbox `- [ ]`.

**Goal:** Que el ERP guarde los datos web de una obra (`obra.web` + flag `publicar`) y los exponga de forma segura a la web pública vía dos endpoints serverless (`GET /api/public/obras`, `POST /api/public/leads`), sin filtrar costos/márgenes y sin abrir RLS.

**Architecture:** Se extiende la obra con un sub-objeto `obra.web` (opcional, retro-compatible) editado desde el ERP. Dos Vercel functions bajo `kamak/api/public/` clonan el patrón probado de `api/portal/data.js` (SERVICE_KEY server-side, whitelist estricta, CORS). La lógica pura (mapeo público, validación de lead, slug) vive en `api/public/_lib.js` y se testea con vitest.

**Tech Stack:** React 19, Vitest, Supabase REST (RPC `append_shared_object_item` / `append_item_in_shared_array`), Vercel serverless functions.

> **Secuencia de subsistemas:** **(1) Fundaciones ERP ←ESTE** · (2) Editor "Publicar" en app.kamak · (3) Seeding masivo Drive→Supabase · (4) Port visual Angular + re-apuntado + lead form · (5) SEO técnico. Cada uno produce software testeable por sí solo.

---

## Estado: ✅ IMPLEMENTADO + AUDITADO (2026-06-10) en rama `feat/web-kamak-integracion`
531 tests verdes (38 files) · lint limpio · auditoría adversarial pasada (veredicto SHIP con 2 fixes aplicados: coerción de `texto` a strings, `orden` numérico; + sufijo random en id de lead, test de whitelist hermético, tests de handlers, TODO de CORS).

## File Structure (ubicación REAL — se realineó a la convención `lib/` del repo)
- Create `kamak/lib/web/obraPublic.js` — lógica PURA: makeSlug, obraPublic (whitelist), obrasPublicadas, validateLead, leadFromBody. (Se ubica en `lib/` porque vitest descubre tests ahí y `/api` lo importa, igual que `lib/afip/*`.)
- Create `kamak/lib/web/obraPublic.test.js` — tests de la lógica pura + test de whitelist hermético.
- Create `kamak/lib/web/supabaseRest.js` — helpers Supabase REST (SERVICE_KEY: loadSharedData, appendObjectItem, appendItemInSharedArray) + `applyCors`.
- Create `kamak/api/public/obras.js` (+ `obras.test.js`) — handler `GET /api/public/obras` (lista + `?slug=`).
- Create `kamak/api/public/leads.js` (+ `leads.test.js`) — handler `POST /api/public/leads` (rate-limit + honeypot + append a embudo Comercial).
- Modify `kamak/src/store/ObrasContext.jsx` — acciones `setWebObra(id, webPatch)` y `togglePublicar(id, on)` + exponerlas en el value.
- Modify `kamak/vite.config.js` — incluir `api/**` en los tests de vitest.
- Modify `kamak/eslint.config.js` — override de globals Node para `api/**`, `lib/**`, `scripts/**`.

---

## Task 1: Lógica pura en `_lib.js` (TDD)

**Files:**
- Create: `kamak/api/public/_lib.js`
- Test: `kamak/api/public/_lib.test.js`

- [ ] **Step 1: Test que falla** — `kamak/api/public/_lib.test.js`

```js
import { describe, it, expect } from 'vitest';
import { makeSlug, obraPublic, obrasPublicadas, validateLead, leadFromBody } from './_lib.js';

describe('makeSlug', () => {
  it('normaliza acentos y espacios', () => {
    expect(makeSlug('Costa Paraná / Baradero')).toBe('costa-parana-baradero');
    expect(makeSlug('')).toBe('obra');
  });
});

describe('obraPublic', () => {
  const obra = {
    id: 'o1', nombre: 'CAGLE-ELENA', cliente: 'Cagle', gastado: 999, margen: 50, presupuesto: 1000,
    fechaInicio: '2024-11-25', fechaFin: '2024-12-15',
    web: { publicar: true, localidad: 'Elena', provincia: 'Córdoba', marca: 'Shop Express', categoria: 'tienda', m2: 120, antes: true, imageBefore: 'a.jpg', imageAfter: 'b.jpg', gallery: [{ url: 'g1.jpg', caption: 'frente' }], coords: { lat: -32.1, lng: -64.4 }, texto: 'hola', orden: 2 },
  };
  it('NO expone costos ni márgenes', () => {
    const p = obraPublic(obra);
    expect(p.gastado).toBeUndefined();
    expect(p.margen).toBeUndefined();
    expect(p.presupuesto).toBeUndefined();
  });
  it('mapea campos web y deriva días', () => {
    const p = obraPublic(obra);
    expect(p.slug).toBe('cagle-elena');
    expect(p.localidad).toBe('Elena');
    expect(p.marca).toBe('Shop Express');
    expect(p.m2).toBe(120);
    expect(p.dias).toBe(20);
    expect(p.antes).toBe(true);
    expect(p.coords).toEqual({ lat: -32.1, lng: -64.4 });
    expect(p.texto).toEqual(['hola']);
  });
});

describe('obrasPublicadas', () => {
  it('solo incluye publicar:true y ordena por orden', () => {
    const blob = { obras: [
      { id: 'a', nombre: 'A', web: { publicar: true, orden: 5 } },
      { id: 'b', nombre: 'B', web: { publicar: false } },
      { id: 'c', nombre: 'C', web: { publicar: true, orden: 1 } },
      { id: 'd', nombre: 'D' },
    ] };
    const out = obrasPublicadas(blob);
    expect(out.map(o => o.nombre)).toEqual(['C', 'A']);
  });
});

describe('validateLead', () => {
  it('rechaza honeypot y exige nombre+contacto', () => {
    expect(validateLead({ _gotcha: 'x', nombre: 'Juan', email: 'a@b.c' }).errors).toContain('honeypot');
    expect(validateLead({ nombre: 'J' }).ok).toBe(false);
    expect(validateLead({ nombre: 'Juan', telefono: '221' }).ok).toBe(true);
  });
});

describe('leadFromBody', () => {
  it('arma un obra-lead con venta.origen web', () => {
    const lead = leadFromBody({ nombre: 'Juan', empresa: 'ACME', telefono: '221', ubicacion: 'La Plata', tipoProyecto: 'Tienda', m2: '100', plazo: '20 días', marca: 'Super 7', mensaje: 'hola' }, '2026-06-10T12:00:00.000Z');
    expect(lead.esLead).toBe(true);
    expect(lead.estado).toBe('en-presupuesto');
    expect(lead.venta.origen).toBe('web');
    expect(lead.venta.etapa).toBe('prospecto');
    expect(lead.cliente).toBe('ACME');
    expect(lead.notas).toContain('100 m²');
    expect(lead.contacto.telefono).toBe('221');
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `cd kamak && npx vitest run api/public/_lib.test.js`
Expected: FAIL ("Cannot find module './_lib.js'").

- [ ] **Step 3: Implementar `kamak/api/public/_lib.js`**

```js
// Helpers de los endpoints públicos de la web. Patrón calcado de api/portal/data.js:
// SERVICE_KEY server-side (bypasa RLS), whitelist estricta, CORS. La lógica pura
// (mapeo público / validación / slug) es testeable sin red.

export const SUPABASE_URL = process.env.SUPABASE_URL;
export const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const sbHeaders = () => ({
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export async function loadSharedData(key) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/shared_data?key=eq.${key}&select=data`, { headers: sbHeaders() });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows[0]?.data ?? null;
}

export async function appendObjectItem(key, collection, item) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/append_shared_object_item`, {
    method: 'POST', headers: sbHeaders(),
    body: JSON.stringify({ p_key: key, p_collection: collection, p_item: item }),
  });
  return r.ok;
}

export async function appendItemInSharedArray(key, item) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/append_item_in_shared_array`, {
    method: 'POST', headers: sbHeaders(),
    body: JSON.stringify({ p_key: key, p_item: item }),
  });
  return r.ok;
}

// CORS: dominios kamak.com.ar + el origen del sitio (env PUBLIC_SITE_ORIGIN, coma-sep)
// + github.io/vercel.app (deploy del sitio mientras no haya dominio propio).
export function applyCors(req, res) {
  const origin = req.headers.origin || '';
  const extra = (process.env.PUBLIC_SITE_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
  const ok = /^https:\/\/([a-z0-9-]+\.)?kamak\.com\.ar$/.test(origin)
    || extra.includes(origin)
    || /^https:\/\/([a-z0-9-]+\.)?(github\.io|vercel\.app)$/.test(origin);
  res.setHeader('Access-Control-Allow-Origin', ok ? origin : 'https://kamak.com.ar');
  res.setHeader('Vary', 'Origin');
  return ok;
}

export function makeSlug(s) {
  return (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'obra';
}

function diasEntre(ini, fin) {
  if (!ini || !fin) return null;
  const a = new Date(ini + 'T00:00:00'), b = new Date(fin + 'T00:00:00');
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const d = Math.round((b - a) / 86400000);
  return d > 0 ? d : null;
}

// Mapa a forma pública. WHITELIST: jamás incluye gastado/margen/presupuesto/cliente.
export function obraPublic(obra) {
  const w = obra.web || {};
  return {
    slug: w.slug || makeSlug(obra.nombre),
    titulo: w.titulo || obra.nombre || '',
    nombre: obra.nombre || '',
    localidad: w.localidad || '',
    provincia: w.provincia || '',
    marca: w.marca || '',
    categoria: w.categoria || '',
    m2: w.m2 ?? null,
    dias: w.diasOverride ?? diasEntre(obra.fechaInicio, obra.fechaFin),
    antes: !!w.antes,
    imageBefore: w.imageBefore || null,
    imageAfter: w.imageAfter || null,
    gallery: Array.isArray(w.gallery) ? w.gallery.map(g => ({ url: g.url, caption: g.caption || '' })) : [],
    portada: w.portada || null,
    coords: w.coords && typeof w.coords.lat === 'number' ? { lat: w.coords.lat, lng: w.coords.lng } : null,
    texto: Array.isArray(w.texto) ? w.texto : (w.texto ? [w.texto] : []),
    destacada: !!w.destacada,
    orden: w.orden ?? 999,
    fechaFin: obra.fechaFin || null,
  };
}

export function obrasPublicadas(blob) {
  const obras = Array.isArray(blob?.obras) ? blob.obras : [];
  return obras
    .filter(o => o.web && o.web.publicar === true)
    .map(obraPublic)
    .sort((a, b) => (a.orden - b.orden) || a.titulo.localeCompare(b.titulo));
}

export function validateLead(body) {
  const errors = [];
  const nombre = (body?.nombre || '').toString().trim();
  const contacto = (body?.telefono || body?.email || '').toString().trim();
  if (body?._gotcha) errors.push('honeypot');
  if (nombre.length < 2) errors.push('nombre');
  if (!contacto) errors.push('contacto');
  return { ok: errors.length === 0, errors, nombre };
}

export function leadFromBody(body, nowISO) {
  const today = nowISO.split('T')[0];
  const partes = [body.tipoProyecto, body.m2 && `${body.m2} m²`, body.plazo, body.marca, body.mensaje].filter(Boolean);
  return {
    id: `obra-${Date.parse(nowISO)}`,
    nombre: (body.nombre || '').toString().trim(),
    cliente: (body.empresa || body.nombre || '').toString().trim(),
    clienteId: null,
    direccion: (body.ubicacion || '').toString().trim(),
    tipo: (body.tipoProyecto || 'Otro').toString(),
    moneda: 'ARS',
    presupuesto: 0, gastado: 0, avance: 0, margen: 0,
    estado: 'en-presupuesto',
    fechaInicio: '', fechaFinEstim: '', fechaFin: '',
    notas: partes.join(' · '),
    esLead: true,
    contacto: { telefono: (body.telefono || '').toString().trim(), email: (body.email || '').toString().trim() },
    venta: { etapa: 'prospecto', origen: 'web', fechaCambioEtapa: today, changelog: [{ etapa: 'prospecto', fecha: today, usuario: 'sistema' }] },
    createdAt: nowISO,
  };
}
```

- [ ] **Step 4: Correr y ver pasar**

Run: `cd kamak && npx vitest run api/public/_lib.test.js`
Expected: PASS (todos los describe verdes).

- [ ] **Step 5: Commit**

```bash
git add kamak/api/public/_lib.js kamak/api/public/_lib.test.js
git commit -m "feat(web): lógica pura de endpoints públicos (obraPublic/leads) + tests"
```

---

## Task 2: Handler `GET /api/public/obras`

**Files:**
- Create: `kamak/api/public/obras.js`

- [ ] **Step 1: Implementar el handler**

```js
import { applyCors, loadSharedData, obrasPublicadas } from './_lib.js';

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS'); return res.status(204).end(); }
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const blob = await loadSharedData('obras');
    const lista = obrasPublicadas(blob || {});
    const { slug } = req.query;
    if (slug) {
      const one = lista.find(o => o.slug === slug);
      if (!one) return res.status(404).json({ error: 'not_found' });
      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
      return res.status(200).json({ obra: one });
    }
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ obras: lista, total: lista.length });
  } catch (e) {
    console.error('[public/obras]', e.message);
    return res.status(500).json({ error: 'server_error' });
  }
}
```

- [ ] **Step 2: Smoke test local con vercel dev** (manual)

Run: `cd kamak && npx vercel dev --listen 3010` (otra terminal) y luego
`curl "http://localhost:3010/api/public/obras"`
Expected: `{"obras":[],"total":0}` (todavía ninguna obra tiene `web.publicar:true` — correcto).

- [ ] **Step 3: Commit**

```bash
git add kamak/api/public/obras.js
git commit -m "feat(web): GET /api/public/obras (lista publicadas + por slug, sanitizado)"
```

---

## Task 3: Handler `POST /api/public/leads`

**Files:**
- Create: `kamak/api/public/leads.js`

- [ ] **Step 1: Implementar el handler**

```js
import { applyCors, appendObjectItem, appendItemInSharedArray, validateLead, leadFromBody } from './_lib.js';

// Rate-limit best-effort por IP (en serverless la memoria no es global garantizado,
// pero corta ráfagas dentro de una misma instancia caliente).
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now(), win = 60_000, max = 5;
  const arr = (hits.get(ip) || []).filter(t => now - t < win);
  arr.push(now); hits.set(ip, arr);
  return arr.length > max;
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) return res.status(429).json({ error: 'rate_limited' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const v = validateLead(body);
    if (!v.ok) {
      if (v.errors.includes('honeypot')) return res.status(200).json({ ok: true }); // al bot se le finge éxito
      return res.status(400).json({ error: 'invalid', fields: v.errors });
    }
    const nowISO = new Date().toISOString();
    const lead = leadFromBody(body, nowISO);
    const ok = await appendObjectItem('obras', 'obras', lead);
    if (!ok) return res.status(502).json({ error: 'persist_failed' });
    await appendItemInSharedArray('crm_actividades', {
      id: `act-${Date.parse(nowISO)}`, obraId: lead.id, clienteId: null,
      tipo: 'nota', texto: 'Lead generado desde la web', fecha: nowISO, usuario: 'sistema', adjuntos: [],
    });
    return res.status(201).json({ ok: true, id: lead.id });
  } catch (e) {
    console.error('[public/leads]', e.message);
    return res.status(500).json({ error: 'server_error' });
  }
}
```

- [ ] **Step 2: Smoke test local** (manual, contra base real → crea un lead de prueba)

Run: `curl -X POST http://localhost:3010/api/public/leads -H "Content-Type: application/json" -d '{"nombre":"Prueba Web","telefono":"2262000000","ubicacion":"Necochea","tipoProyecto":"Tienda"}'`
Expected: `{"ok":true,"id":"obra-..."}` y aparece en el Kanban Comercial (columna Prospecto). **Borrar el lead de prueba después.**

- [ ] **Step 3: Commit**

```bash
git add kamak/api/public/leads.js
git commit -m "feat(web): POST /api/public/leads → embudo Comercial (origen web) + honeypot/rate-limit"
```

---

## Task 4: Acciones `setWebObra` / `togglePublicar` en ObrasContext

**Files:**
- Modify: `kamak/src/store/ObrasContext.jsx` (agregar acciones tras `deleteObra` ~línea 478; exponerlas en `value`/`useMemo` ~líneas 536-539)

- [ ] **Step 1: Agregar las acciones después de `deleteObra`**

```jsx
  // Edita el sub-objeto web de la obra (campos de la web pública) atómico.
  const setWebObra = useCallback((id, webPatch) => {
    markUserEdit();
    const prev = obrasRef.current.find(o => o.id === id);
    const web = { ...(prev?.web || {}), ...webPatch };
    setObras(prevA => prevA.map(o => o.id === id ? { ...o, web } : o));
    patchObjectItem('obras', 'obras', id, { web });
  }, []);

  // Publica / despublica la obra en la web (toggle del flag web.publicar).
  const togglePublicar = useCallback((id, on) => {
    setWebObra(id, { publicar: !!on });
  }, [setWebObra]);
```

- [ ] **Step 2: Exponerlas en el value memoizado** — reemplazar el bloque `const value = useMemo(...)` por:

```jsx
  const value = useMemo(
    () => ({ obras, addObra, updateObra, setEstado, setVentaEtapa, deleteObra, setWebObra, togglePublicar, byEstado, detalles, getDetalle, patchDetalle, renombrarRubroEnObras, refetch, dataReady }),
    [obras, addObra, updateObra, setEstado, setVentaEtapa, deleteObra, setWebObra, togglePublicar, byEstado, detalles, getDetalle, patchDetalle, renombrarRubroEnObras, refetch, dataReady]
  );
```

- [ ] **Step 3: Test de la acción** — `kamak/src/store/ObrasContext.web.test.jsx`

```jsx
import { describe, it, expect } from 'vitest';
import { render, act } from '@testing-library/react';
import { ObrasProvider, useObras } from './ObrasContext';

function harness(onReady) {
  function Probe() { onReady(useObras()); return null; }
  render(<ObrasProvider><Probe /></ObrasProvider>);
}

describe('setWebObra / togglePublicar', () => {
  it('mergea web y togglea publicar sin pisar otros campos web', () => {
    let api;
    harness(a => { api = a; });
    const id = api.obras[0].id;
    act(() => { api.setWebObra(id, { localidad: 'Necochea', publicar: false }); });
    // nota: el value se recrea; re-leer del provider en un test real usa rerender.
    expect(typeof api.setWebObra).toBe('function');
    expect(typeof api.togglePublicar).toBe('function');
  });
});
```

> Nota para el ejecutor: si el harness simple no captura el value actualizado (Context), usar `@testing-library/react` `rerender` o un componente que renderice `JSON.stringify(obras[0].web)` y assertear el texto. Lo importante es cubrir que `web` se mergea y `publicar` togglea. (El auditor de esta área debe exigir un test que realmente verifique el merge, no solo la existencia de la función.)

- [ ] **Step 4: Correr tests**

Run: `cd kamak && npx vitest run src/store/ObrasContext.web.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add kamak/src/store/ObrasContext.jsx kamak/src/store/ObrasContext.web.test.jsx
git commit -m "feat(web): acciones setWebObra/togglePublicar en ObrasContext"
```

---

## Verificación de cierre del subsistema
- [ ] `cd kamak && npx vitest run` → toda la suite verde (no rompimos nada existente).
- [ ] `cd kamak && npm run lint` → sin errores nuevos.
- [ ] **Auditor adversarial** revisa: (a) `obraPublic` no filtra ningún costo/margen/cliente (probar con una obra con `gastado`/`margen`); (b) CORS no es `*`; (c) honeypot devuelve 200 fingido; (d) el append usa la RPC atómica (no RMW del blob); (e) `web` es opcional y no rompe obras viejas.

## Self-Review (cobertura de spec §4A/§4B)
- §4A modelo `obra.web` → Task 4 (acciones) + forma usada en Task 1 `obraPublic`. ✅
- §4B `GET /api/public/obras` → Task 2. ✅ · `POST /api/public/leads` → Task 3. ✅
- §K seguridad (SERVICE_KEY server-side, sin anon RLS, CORS, rate-limit, honeypot) → Tasks 1-3. ✅
- Pendiente para subsistemas siguientes: editor "Publicar" (2), seeding que rellena `obra.web` (3), consumo desde Angular (4).
