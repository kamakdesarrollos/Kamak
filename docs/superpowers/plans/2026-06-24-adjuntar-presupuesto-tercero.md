# Adjuntar presupuesto de tercero → tareas + contrato MO — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adjuntar el presupuesto de un tercero a un rubro: la app lo lee (Excel gratis / PDF con Claude) y crea las tareas del rubro (venta+margen) + un contrato MO con el proveedor (costo), con varios adjuntos/contratos por rubro.

**Architecture:** Lógica pura testeable en `src/lib/presupuestoImport.js` (mapeo de columnas → tareas, monto/avance por contrato, match de proveedor). Lectura de PDF en una función serverless que reusa el patrón Claude del bot. Aplicación atómica vía `patchDetalle` de `ObrasContext`. UI nueva en `ObraPresupuesto.jsx` (botón + 2 modales). Integración con Contratos MO por `contratoId`.

**Tech Stack:** React 19, Vite, Context API, Supabase, `xlsx` (ya instalado), Anthropic API (Claude, ya configurado), Vercel serverless, vitest.

**Spec:** `docs/superpowers/specs/2026-06-24-adjuntar-presupuesto-tercero-design.md`

---

## File Structure

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `src/lib/presupuestoImport.js` | Crear | Helpers PUROS: detectar/mapear columnas, normalizar ítems, ítems→tareas, monto/avance por contrato, match de proveedor. |
| `src/lib/presupuestoImport.test.js` | Crear | Tests vitest de los helpers puros. |
| `api/whatsapp/jobs.js` | Crear | Fusión de los 2 crons (`?job=reminders\|followups`) para liberar 1 slot. |
| `api/whatsapp/payment-reminders.js` | Borrar | Movido a `jobs.js`. |
| `api/whatsapp/sales-followups.js` | Borrar | Movido a `jobs.js`. |
| `vercel.json` | Modificar | Apuntar los 2 crons a `jobs.js?job=...`. |
| `api/presupuesto/extraer.js` | Crear | Endpoint: PDF/imagen base64 → Claude → `{ proveedor, items[] }`. Con auth. |
| `src/store/ObrasContext.jsx` | Modificar | `importarPresupuesto(obraId, rubroId, payload)` atómico + resync de monto al editar costo de tarea importada. |
| `src/pages/obra/AdjuntarPresupuestoModal.jsx` | Crear | Modal: subir archivo + resolver proveedor + leer → entrega ítems. |
| `src/pages/obra/RevisarPresupuestoModal.jsx` | Crear | Modal: tabla editable de ítems + mapeo de columnas (Excel) / verificación (PDF). |
| `src/pages/obra/ObraPresupuesto.jsx` | Modificar | Botón "📎 Adjuntar presupuesto" + chips de adjuntos + wiring de los modales. |

---

## Phase 0 — Liberar un slot de Vercel (prerequisito del endpoint)

### Task 0: Fusionar los 2 crons de WhatsApp en `api/whatsapp/jobs.js`

**Files:**
- Create: `api/whatsapp/jobs.js`
- Delete: `api/whatsapp/payment-reminders.js`, `api/whatsapp/sales-followups.js`
- Modify: `vercel.json`

- [ ] **Step 1: Leer los dos archivos completos**

Run: abrir `api/whatsapp/payment-reminders.js` y `api/whatsapp/sales-followups.js`. Identificar: (a) los `const ENV` del tope, (b) los helpers `sbH/sbGet/...`, (c) el cuerpo del `export default async function handler(req,res)` de cada uno.

- [ ] **Step 2: Crear `api/whatsapp/jobs.js` que combina ambos bajo `?job=`**

```js
// Fusión de payment-reminders + sales-followups en una sola function (límite
// Vercel Hobby = 12). Se elige el job por query: ?job=reminders | ?job=followups.
// El cron de vercel.json llama a cada uno con su path.
//
// (Pegar acá: los const ENV compartidos + helpers sbH/sbGet de los archivos
//  originales — son idénticos, no duplicar.)

async function runReminders(req, res) {
  // ← mover acá el cuerpo COMPLETO y VERBATIM del handler de payment-reminders.js
}

async function runFollowups(req, res) {
  // ← mover acá el cuerpo COMPLETO y VERBATIM del handler de sales-followups.js
}

export default async function handler(req, res) {
  const job = req.query.job;
  if (job === 'reminders') return runReminders(req, res);
  if (job === 'followups') return runFollowups(req, res);
  return res.status(400).json({ error: 'job inválido (reminders|followups)' });
}
```

- [ ] **Step 3: Borrar los archivos viejos**

```bash
git rm api/whatsapp/payment-reminders.js api/whatsapp/sales-followups.js
```

- [ ] **Step 4: Actualizar `vercel.json` (los 2 crons apuntan al nuevo path)**

Buscar en `vercel.json` los crons que apuntaban a `/api/whatsapp/payment-reminders` y `/api/whatsapp/sales-followups`, y cambiarlos a `/api/whatsapp/jobs?job=reminders` y `/api/whatsapp/jobs?job=followups` (mismos `schedule`).

- [ ] **Step 5: Verificar el conteo de functions ≤ 12**

Run: `git ls-files "api/**/*.js" | grep -v "/_" | wc -l`
Expected: `12` (12 functions con jobs.js y sin los 2 viejos).

- [ ] **Step 6: Commit**

```bash
git add api/whatsapp/jobs.js vercel.json
git commit -m "refactor(api): fusiona crons reminders+followups en jobs.js (libera slot Vercel)"
```

---

## Phase 1 — Helpers puros de importación (TDD)

Diseño del módulo `src/lib/presupuestoImport.js` (todo puro, sin React ni red):

- `detectarColumnas(headerRow: string[]) → { nombre, costo, cantidad, unidad }` (índices, por keywords; -1 si no encontró).
- `mapearColumnas(rows: any[][], mapping) → Item[]` donde `Item = { nombre, costo, cantidad, unidad }`.
- `normalizarItems(items: Item[]) → Item[]` (coerce números, cantidad default 1, descarta filas sin nombre o sin costo).
- `itemsATareas(items, { contratoId, makeId }) → Tarea[]`.
- `montoContrato(contratoId, tareas) → number`.
- `avanceContrato(contratoId, tareas) → number`.
- `matchProveedor(nombre, cuit, proveedores) → proveedor | null`.

### Task 1: `detectarColumnas` + `mapearColumnas`

**Files:**
- Create: `src/lib/presupuestoImport.js`
- Test: `src/lib/presupuestoImport.test.js`

- [ ] **Step 1: Escribir los tests que fallan**

```js
import { describe, it, expect } from 'vitest';
import { detectarColumnas, mapearColumnas } from './presupuestoImport';

describe('detectarColumnas', () => {
  it('reconoce encabezados típicos en español', () => {
    const header = ['Descripción', 'Cant.', 'Precio Unitario', 'Unidad'];
    expect(detectarColumnas(header)).toEqual({ nombre: 0, cantidad: 1, costo: 2, unidad: 3 });
  });
  it('devuelve -1 para columnas que no encuentra', () => {
    const header = ['Item', 'Total'];
    const m = detectarColumnas(header);
    expect(m.nombre).toBe(0);
    expect(m.cantidad).toBe(-1);
    expect(m.unidad).toBe(-1);
  });
});

describe('mapearColumnas', () => {
  it('proyecta filas a items según el mapping', () => {
    const rows = [['Plancha Braf', '1', '185000', 'u'], ['Freidora Braf', '1', '210000', 'u']];
    const mapping = { nombre: 0, cantidad: 1, costo: 2, unidad: 3 };
    expect(mapearColumnas(rows, mapping)).toEqual([
      { nombre: 'Plancha Braf', cantidad: '1', costo: '185000', unidad: 'u' },
      { nombre: 'Freidora Braf', cantidad: '1', costo: '210000', unidad: 'u' },
    ]);
  });
  it('usa cadena vacía cuando un índice es -1', () => {
    const rows = [['Plancha', '185000']];
    const mapping = { nombre: 0, costo: 1, cantidad: -1, unidad: -1 };
    expect(mapearColumnas(rows, mapping)).toEqual([{ nombre: 'Plancha', costo: '185000', cantidad: '', unidad: '' }]);
  });
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npm test -- presupuestoImport`
Expected: FAIL (módulo/funciones no existen).

- [ ] **Step 3: Implementar `detectarColumnas` + `mapearColumnas`**

```js
// Helpers PUROS para importar un presupuesto de tercero (Excel/PDF) a tareas.
const norm = s => (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

const KEYS = {
  nombre:   ['descripcion', 'detalle', 'item', 'concepto', 'producto', 'nombre', 'articulo'],
  costo:    ['precio', 'p. unitario', 'p unitario', 'unitario', 'costo', 'importe', 'valor', 'monto', 'total'],
  cantidad: ['cant', 'cantidad', 'qty', 'unidades'],
  unidad:   ['unidad', 'um', 'u.m', 'medida'],
};

export function detectarColumnas(headerRow) {
  const cols = (headerRow || []).map(norm);
  const find = keys => cols.findIndex(c => c && keys.some(k => c.includes(k)));
  // nombre: si no matchea, default a la primera columna.
  const nombre = find(KEYS.nombre); 
  return {
    nombre:   nombre >= 0 ? nombre : 0,
    costo:    find(KEYS.costo),
    cantidad: find(KEYS.cantidad),
    unidad:   find(KEYS.unidad),
  };
}

export function mapearColumnas(rows, mapping) {
  const at = (row, i) => (i >= 0 && row[i] != null ? row[i] : '');
  return (rows || []).map(row => ({
    nombre:   at(row, mapping.nombre),
    costo:    at(row, mapping.costo),
    cantidad: at(row, mapping.cantidad),
    unidad:   at(row, mapping.unidad),
  }));
}
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npm test -- presupuestoImport`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/presupuestoImport.js src/lib/presupuestoImport.test.js
git commit -m "feat(presupuesto-import): detectar y mapear columnas (helpers puros + tests)"
```

### Task 2: `normalizarItems` + `itemsATareas`

**Files:**
- Modify: `src/lib/presupuestoImport.js`
- Test: `src/lib/presupuestoImport.test.js`

- [ ] **Step 1: Agregar tests que fallan**

```js
import { normalizarItems, itemsATareas } from './presupuestoImport';

describe('normalizarItems', () => {
  it('coerce números, cantidad default 1, parsea miles AR', () => {
    const out = normalizarItems([{ nombre: 'Plancha', costo: '185.000', cantidad: '', unidad: 'u' }]);
    expect(out).toEqual([{ nombre: 'Plancha', costo: 185000, cantidad: 1, unidad: 'u' }]);
  });
  it('descarta filas sin nombre o sin costo > 0', () => {
    const out = normalizarItems([
      { nombre: '', costo: '100', cantidad: '1', unidad: '' },
      { nombre: 'Subtotal', costo: '0', cantidad: '1', unidad: '' },
      { nombre: 'Horno', costo: '50000', cantidad: '2', unidad: 'u' },
    ]);
    expect(out).toEqual([{ nombre: 'Horno', costo: 50000, cantidad: 2, unidad: 'u' }]);
  });
});

describe('itemsATareas', () => {
  it('mapea costo→costoSub, costoMat 0, linkea contratoId', () => {
    let n = 0;
    const tareas = itemsATareas(
      [{ nombre: 'Plancha', costo: 185000, cantidad: 1, unidad: 'u' }],
      { contratoId: 'ct-9', makeId: () => `id-${++n}` }
    );
    expect(tareas).toEqual([{
      id: 'id-1', codigo: '', nombre: 'Plancha', unidad: 'u', cantidad: 1,
      costoMat: 0, costoSub: 185000, contratoId: 'ct-9', fuente: 'Presupuesto',
      receta: { materiales: [] }, avance: 0,
    }]);
  });
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npm test -- presupuestoImport`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```js
// Parsea un número en formato AR ("185.000,50" / "185000") a Number.
function parseNum(v) {
  if (typeof v === 'number') return v;
  const s = (v == null ? '' : String(v)).replace(/[^\d.,-]/g, '');
  if (!s) return 0;
  // Si tiene coma, la coma es decimal y el punto es de miles.
  const norm = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = Number(norm);
  return Number.isFinite(n) ? n : 0;
}

export function normalizarItems(items) {
  return (items || [])
    .map(it => ({
      nombre: (it.nombre || '').toString().trim(),
      costo: parseNum(it.costo),
      cantidad: parseNum(it.cantidad) || 1,
      unidad: (it.unidad || '').toString().trim() || 'u',
    }))
    .filter(it => it.nombre && it.costo > 0);
}

export function itemsATareas(items, { contratoId, makeId }) {
  return (items || []).map(it => ({
    id: makeId(),
    codigo: '',
    nombre: it.nombre,
    unidad: it.unidad || 'u',
    cantidad: it.cantidad || 1,
    costoMat: 0,
    costoSub: Math.round(it.costo),
    contratoId,
    fuente: 'Presupuesto',
    receta: { materiales: [] },
    avance: 0,
  }));
}
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npm test -- presupuestoImport`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/presupuestoImport.js src/lib/presupuestoImport.test.js
git commit -m "feat(presupuesto-import): normalizar items + items→tareas (costoSub, contratoId)"
```

### Task 3: `montoContrato`, `avanceContrato`, `matchProveedor`

**Files:**
- Modify: `src/lib/presupuestoImport.js`
- Test: `src/lib/presupuestoImport.test.js`

- [ ] **Step 1: Agregar tests que fallan**

```js
import { montoContrato, avanceContrato, matchProveedor } from './presupuestoImport';

const tareas = [
  { id: 't1', contratoId: 'A', costoSub: 100, cantidad: 2, avance: 50 }, // 200, ejecutado 100
  { id: 't2', contratoId: 'A', costoSub: 50,  cantidad: 1, avance: 0 },  // 50,  ejecutado 0
  { id: 't3', contratoId: 'B', costoSub: 999, cantidad: 1, avance: 100 },// otro contrato
  { id: 't4', costoSub: 30, cantidad: 1, avance: 100 },                  // manual, sin contrato
];

describe('montoContrato', () => {
  it('suma costoSub*cantidad solo de SU contrato (no se pisa con otros)', () => {
    expect(montoContrato('A', tareas)).toBe(250);
    expect(montoContrato('B', tareas)).toBe(999);
  });
});

describe('avanceContrato', () => {
  it('avance ponderado por costo de sus tareas', () => {
    expect(avanceContrato('A', tareas)).toBe(40); // 100/250
  });
  it('0 si el contrato no tiene tareas', () => {
    expect(avanceContrato('Z', tareas)).toBe(0);
  });
});

describe('matchProveedor', () => {
  const provs = [
    { id: 'p1', nombre: 'Grupo Braf SA', cuit: '30-11111111-1' },
    { id: 'p2', nombre: 'Turbo Blender', cuit: '30-22222222-2' },
  ];
  it('matchea por CUIT exacto', () => {
    expect(matchProveedor('cualquier cosa', '30-22222222-2', provs)?.id).toBe('p2');
  });
  it('matchea por nombre normalizado si no hay CUIT', () => {
    expect(matchProveedor('grupo braf sa', null, provs)?.id).toBe('p1');
  });
  it('null si no encuentra', () => {
    expect(matchProveedor('Otro Proveedor', null, provs)).toBeNull();
  });
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npm test -- presupuestoImport`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```js
export function montoContrato(contratoId, tareas) {
  return (tareas || [])
    .filter(t => t.contratoId === contratoId)
    .reduce((s, t) => s + (t.costoSub || 0) * (t.cantidad || 0), 0);
}

export function avanceContrato(contratoId, tareas) {
  const propias = (tareas || []).filter(t => t.contratoId === contratoId);
  let total = 0, ejec = 0;
  for (const t of propias) {
    const c = (t.costoSub || 0) * (t.cantidad || 0);
    total += c;
    ejec += c * ((t.avance || 0) / 100);
  }
  return total > 0 ? Math.round((ejec / total) * 100) : 0;
}

export function matchProveedor(nombre, cuit, proveedores) {
  const list = proveedores || [];
  const c = (cuit || '').replace(/[^\dkK]/g, '');
  if (c) {
    const porCuit = list.find(p => (p.cuit || '').replace(/[^\dkK]/g, '') === c);
    if (porCuit) return porCuit;
  }
  const n = norm(nombre);
  return (n && list.find(p => norm(p.nombre) === n)) || null;
}
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npm test -- presupuestoImport`
Expected: PASS (toda la suite de presupuestoImport en verde).

- [ ] **Step 5: Commit**

```bash
git add src/lib/presupuestoImport.js src/lib/presupuestoImport.test.js
git commit -m "feat(presupuesto-import): monto/avance por contrato (sin matchGremio) + match de proveedor"
```

---

## Phase 2 — Endpoint de extracción PDF (Claude)

### Task 4: `api/presupuesto/extraer.js`

**Files:**
- Create: `api/presupuesto/extraer.js`

- [ ] **Step 1: Crear el endpoint (espejo del patrón Claude del bot)**

Patrón base de `api/whatsapp/webhook.js:1680-1684` (mismo `x-api-key` / `anthropic-version`).

```js
// Lee un presupuesto de tercero (PDF/imagen en base64) con Claude y devuelve
// { proveedor, items: [{ nombre, costo, cantidad, unidad }] }. Reusa la
// ANTHROPIC_API_KEY ya configurada (misma cuenta que el bot). Excel NO pasa por
// acá (se parsea en el cliente). Requiere auth: este endpoint cuesta plata por
// llamada, no puede quedar abierto.
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY; // para validar el token del usuario

async function usuarioValido(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return false;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}` },
  });
  return r.ok;
}

const PROMPT = `Sos un extractor de presupuestos de obra. Te paso un presupuesto de un proveedor/subcontratista.
Devolvé SOLO un JSON con esta forma exacta, sin texto adicional:
{"proveedor": "<razón social o nombre, o null>", "cuit": "<cuit o null>", "items": [{"nombre": "<descripción del ítem>", "costo": <número, precio UNITARIO sin símbolos>, "cantidad": <número, 1 si no figura>, "unidad": "<u/m2/ml/gl/etc o 'u'>"}]}
El "costo" es siempre el precio unitario del ítem (si solo hay total de línea, poné cantidad 1 y el total como costo). No inventes ítems que no estén.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await usuarioValido(req))) return res.status(401).json({ error: 'no autorizado' });

  const { fileBase64, mediaType } = req.body || {};
  if (!fileBase64 || !mediaType) return res.status(400).json({ error: 'falta fileBase64/mediaType' });

  const isPdf = mediaType === 'application/pdf';
  const block = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileBase64 } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data: fileBase64 } };

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        messages: [{ role: 'user', content: [block, { type: 'text', text: PROMPT }] }],
      }),
    });
    const j = await r.json();
    const text = (j.content || []).map(c => c.text || '').join('').trim();
    const jsonStr = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    const data = JSON.parse(jsonStr);
    return res.status(200).json({
      proveedor: data.proveedor || null,
      cuit: data.cuit || null,
      items: Array.isArray(data.items) ? data.items : [],
    });
  } catch (e) {
    console.error('[presupuesto/extraer]', e.message);
    return res.status(500).json({ error: 'No se pudo leer el presupuesto: ' + e.message });
  }
}
```

- [ ] **Step 2: Verificar conteo de functions sigue ≤ 12**

Run: `git ls-files "api/**/*.js" | grep -v "/_" | wc -l`
Expected: `12` (se sumó extraer.js, ya se había liberado el slot en Task 0).

- [ ] **Step 3: Verificar sintaxis**

Run: `node --check api/presupuesto/extraer.js`
Expected: sin output (OK).

- [ ] **Step 4: Commit**

```bash
git add api/presupuesto/extraer.js
git commit -m "feat(api): endpoint extraer presupuesto PDF/imagen con Claude (auth + reusa ANTHROPIC_API_KEY)"
```

> **Verificación manual (post-deploy):** con un PDF real, `POST /api/presupuesto/extraer` con `{ fileBase64, mediaType }` + header `Authorization: Bearer <token de sesión>` devuelve los ítems. Sin token → 401.

---

## Phase 3 — Aplicación atómica en `ObrasContext`

### Task 5: `importarPresupuesto(obraId, rubroId, payload)` + resync de monto

**Files:**
- Modify: `src/store/ObrasContext.jsx`

- [ ] **Step 1: Agregar `importarPresupuesto` usando `patchDetalle` (atómico)**

Junto a `patchDetalle`/`getDetalle` (≈línea 508-553). `payload = { tareas, adjunto, contrato }`. `newId` ya se usa en este archivo.

```js
// Importa un presupuesto de tercero a un rubro: crea el contrato MO (borrador),
// agrega las tareas (ya con contratoId) y guarda el adjunto. Todo en un patch
// atómico del detalle (no reescribe el detalle entero).
const importarPresupuesto = useCallback((obraId, rubroId, { tareas, adjunto, contrato }) => {
  patchDetalle(obraId, d => ({
    ...d,
    rubros: (d.rubros || []).map(r => r.id === rubroId
      ? { ...r, tareas: [...(r.tareas || []), ...tareas], adjuntos: [...(r.adjuntos || []), adjunto] }
      : r),
    contratos: [...(d.contratos || []), contrato],
  }));
}, [patchDetalle]);
```

- [ ] **Step 2: Agregar `quitarAdjunto` (borrado atómico de adjunto + sus tareas + su contrato)**

```js
// Quita un adjunto y, atómicamente, sus tareas (por contratoId) y su contrato.
const quitarAdjunto = useCallback((obraId, rubroId, adjuntoId, contratoId) => {
  patchDetalle(obraId, d => ({
    ...d,
    rubros: (d.rubros || []).map(r => r.id === rubroId
      ? { ...r,
          adjuntos: (r.adjuntos || []).filter(a => a.id !== adjuntoId),
          tareas: (r.tareas || []).filter(t => t.contratoId !== contratoId) }
      : r),
    contratos: (d.contratos || []).filter(c => c.id !== contratoId),
  }));
}, [patchDetalle]);
```

- [ ] **Step 3: Exponer `importarPresupuesto` y `quitarAdjunto` en el value del provider**

Agregar ambos al objeto `value` y a su array de deps (≈línea 553-554), junto a `patchDetalle`.

- [ ] **Step 4: Verificar build**

Run: `npm run build`
Expected: `built in ...` sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/store/ObrasContext.jsx
git commit -m "feat(obras): importarPresupuesto + quitarAdjunto (atómico: contrato + tareas + adjunto)"
```

> Nota sobre el monto: se guarda un `contrato.monto` inicial al importar (correcto en ese momento), pero la UI de Contratos MO (Task 8) lo **deriva** de las tareas con `montoContrato(contrato.id, tareasObra)` para que nunca quede viejo si después se edita el costo de una tarea.

---

## Phase 4 — UI en el presupuesto

### Task 6: `AdjuntarPresupuestoModal` (subir + resolver proveedor + leer)

**Files:**
- Create: `src/pages/obra/AdjuntarPresupuestoModal.jsx`

- [ ] **Step 1: Crear el modal**

Recibe `{ proveedores, onAddProveedor, onReady, onClose }`. Lee el archivo: Excel → `xlsx` en el cliente; PDF/imagen → `fetch('/api/presupuesto/extraer')` con el archivo en base64 + el token de sesión (`supabase.auth.getSession()`). Resuelve proveedor con `matchProveedor`. Llama `onReady({ filas|items, columnas, proveedor })`.

```jsx
import { useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../../lib/supabase';
import { detectarColumnas, mapearColumnas, matchProveedor } from '../../lib/presupuestoImport';

const toBase64 = file => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1]);
  r.onerror = rej;
  r.readAsDataURL(file);
});

export default function AdjuntarPresupuestoModal({ proveedores, onAddProveedor, onReady, onClose }) {
  const [file, setFile] = useState(null);
  const [estado, setEstado] = useState('');
  const [provNombre, setProvNombre] = useState('');
  const [provDetectado, setProvDetectado] = useState(null); // { nombre, cuit } del documento

  const leer = async () => {
    if (!file) return;
    setEstado('Leyendo…');
    try {
      const esExcel = /\.(xlsx|xls|csv)$/i.test(file.name);
      if (esExcel) {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
        const header = aoa[0] || [];
        const columnas = detectarColumnas(header);
        onReady({ filas: aoa.slice(1), columnas, header, proveedorNombre: provNombre, file });
      } else {
        const { data: { session } } = await supabase.auth.getSession();
        const fileBase64 = await toBase64(file);
        const r = await fetch('/api/presupuesto/extraer', {
          method: 'POST',
          headers: { 'content-type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({ fileBase64, mediaType: file.type || 'application/pdf' }),
        });
        if (!r.ok) throw new Error('No se pudo leer el PDF');
        const { proveedor, cuit, items } = await r.json();
        const match = matchProveedor(proveedor, cuit, proveedores);
        setProvDetectado(proveedor ? { nombre: proveedor, cuit } : null);
        onReady({
          items, columnas: null, file,
          proveedorNombre: provNombre || match?.nombre || proveedor || '',
          proveedorId: match?.id || null,
          proveedorDetectado: proveedor ? { nombre: proveedor, cuit } : null,
        });
      }
    } catch (e) {
      setEstado('Error: ' + e.message + '. Podés cargar a mano.');
    }
  };

  return (
    <div className="k-modal-overlay" onClick={onClose}>
      <div className="k-modal" style={{ width: 'min(92vw, 440px)' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>Adjuntar presupuesto</div>
          <input type="file" accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.csv" onChange={e => setFile(e.target.files[0])} />
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280' }}>Proveedor (lo detecta del archivo si puede)</div>
            <input list="provs" value={provNombre} onChange={e => setProvNombre(e.target.value)} placeholder="Buscar o escribir…" style={{ width: '100%' }} />
            <datalist id="provs">{(proveedores || []).map(p => <option key={p.id} value={p.nombre} />)}</datalist>
          </div>
          {estado && <div style={{ fontSize: 12, color: '#b45309' }}>{estado}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button onClick={onClose}>Cancelar</button>
            <button disabled={!file} onClick={leer}>Leer presupuesto →</button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verificar build**

Run: `npm run build`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/pages/obra/AdjuntarPresupuestoModal.jsx
git commit -m "feat(presupuesto): modal adjuntar — lee Excel (xlsx) / PDF (Claude) + resuelve proveedor"
```

### Task 7: `RevisarPresupuestoModal` (tabla editable + mapeo) + wiring en `ObraPresupuesto`

**Files:**
- Create: `src/pages/obra/RevisarPresupuestoModal.jsx`
- Modify: `src/pages/obra/ObraPresupuesto.jsx`

- [ ] **Step 1: Crear `RevisarPresupuestoModal`**

Recibe `{ input, onConfirm, onClose }` donde `input` es lo que entregó el modal anterior (Excel: `{ filas, columnas, header }`; PDF: `{ items }`). Para Excel muestra selectores de columna por campo (mapeo); para PDF muestra los `items` ya estructurados. Tabla editable, descartar filas, subtotal por fila. Al confirmar emite la lista final de `items` normalizados.

```jsx
import { useState, useMemo } from 'react';
import { mapearColumnas, normalizarItems } from '../../lib/presupuestoImport';

export default function RevisarPresupuestoModal({ input, onConfirm, onClose }) {
  const esExcel = !!input.filas;
  const [mapping, setMapping] = useState(input.columnas || { nombre: 0, costo: 1, cantidad: -1, unidad: -1 });
  const baseItems = useMemo(
    () => esExcel ? mapearColumnas(input.filas, mapping) : (input.items || []),
    [esExcel, input, mapping]
  );
  const [items, setItems] = useState(baseItems);
  // re-derivar al cambiar el mapping (Excel)
  useMemo(() => setItems(baseItems), [baseItems]);

  const setCell = (i, k, v) => setItems(prev => prev.map((it, idx) => idx === i ? { ...it, [k]: v } : it));
  const quitar = i => setItems(prev => prev.filter((_, idx) => idx !== i));
  const finales = normalizarItems(items);

  const cols = ['nombre', 'costo', 'cantidad', 'unidad'];
  const header = input.header || [];

  return (
    <div className="k-modal-overlay" onClick={onClose}>
      <div className="k-modal" style={{ width: 'min(96vw, 760px)' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 10 }}>Revisar presupuesto</div>
          {esExcel && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              {cols.map(k => (
                <label key={k} style={{ fontSize: 11 }}>{k}:&nbsp;
                  <select value={mapping[k]} onChange={e => setMapping(m => ({ ...m, [k]: +e.target.value }))}>
                    <option value={-1}>—</option>
                    {header.map((h, i) => <option key={i} value={i}>{h || `col ${i}`}</option>)}
                  </select>
                </label>
              ))}
            </div>
          )}
          <div style={{ maxHeight: '50vh', overflow: 'auto' }}>
            <table style={{ width: '100%', fontSize: 12 }}>
              <thead><tr><th align="left">Nombre</th><th>Costo</th><th>Cant.</th><th>Unid.</th><th>Subtotal</th><th></th></tr></thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i}>
                    <td><input value={it.nombre} onChange={e => setCell(i, 'nombre', e.target.value)} style={{ width: '100%' }} /></td>
                    <td><input value={it.costo} onChange={e => setCell(i, 'costo', e.target.value)} style={{ width: 80 }} /></td>
                    <td><input value={it.cantidad} onChange={e => setCell(i, 'cantidad', e.target.value)} style={{ width: 50 }} /></td>
                    <td><input value={it.unidad} onChange={e => setCell(i, 'unidad', e.target.value)} style={{ width: 50 }} /></td>
                    <td align="right">{(Number(String(it.costo).replace(/[^\d.-]/g, '')) || 0) * (Number(it.cantidad) || 1)}</td>
                    <td><button onClick={() => quitar(i)}>✗</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
            <button onClick={onClose}>Cancelar</button>
            <button disabled={!finales.length} onClick={() => onConfirm(finales)}>Agregar {finales.length} tareas</button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wiring en `ObraPresupuesto.jsx` — botón + estado + confirmación**

En el componente: importar los dos modales, `uploadFoto`, `newId`, los hooks `useObras().importarPresupuesto` y `useProveedores()`. Agregar estado `adjuntando`/`revisando` y la confirmación que arma contrato+tareas+adjunto y llama `importarPresupuesto`.

```jsx
// imports
import AdjuntarPresupuestoModal from './AdjuntarPresupuestoModal';
import RevisarPresupuestoModal from './RevisarPresupuestoModal';
import { uploadFoto } from '../../lib/upload';
import { itemsATareas, montoContrato } from '../../lib/presupuestoImport';
// dentro del componente:
const { importarPresupuesto, quitarAdjunto } = useObras();
const { proveedores, addProveedor } = useProveedores();
const [adjReady, setAdjReady] = useState(null);   // payload del modal de adjuntar (incluye file + proveedor)
const [adjRubroId, setAdjRubroId] = useState(null);

const confirmarImport = async (itemsFinales) => {
  const contratoId = newId();
  const tareas = itemsATareas(itemsFinales, { contratoId, makeId: newId });
  // proveedor: usar el detectado/elegido; crear si no existe y hay datos
  let proveedorId = adjReady.proveedorId || null;
  let proveedorNombre = adjReady.proveedorNombre || adjReady.proveedorDetectado?.nombre || 'Proveedor';
  if (!proveedorId && adjReady.proveedorDetectado?.cuit) {
    proveedorId = addProveedor({ nombre: proveedorNombre, cuit: adjReady.proveedorDetectado.cuit });
  }
  const url = await uploadFoto(adjReady.file, `presupuestos/${obra.id}`);
  const adjuntoId = newId();
  const adjunto = { id: adjuntoId, nombre: adjReady.file.name, url, fecha: new Date().toISOString(), proveedor: proveedorNombre, proveedorId, contratoId };
  const rubro = detalle.rubros.find(r => r.id === adjRubroId);
  const contrato = {
    id: contratoId, gremio: rubro?.nombre || '', proveedor: proveedorNombre, proveedorId,
    monto: montoContrato(contratoId, tareas), estado: 'borrador', origen: 'adjunto',
    adjuntoId, rubroId: adjRubroId, fondoReparo: 5,
  };
  importarPresupuesto(obra.id, adjRubroId, { tareas, adjunto, contrato });
  setAdjReady(null); setAdjRubroId(null);
};
```

Y en el render del rubro, junto a "+ agregar tarea" (gateado a `puedeEditar`):

```jsx
{puedeEditar && <button onClick={() => setAdjRubroId(rubro.id)}>📎 Adjuntar presupuesto</button>}
{/* chips de adjuntos bajo el header del rubro (con quitar) */}
{(rubro.adjuntos || []).map(a => (
  <span key={a.id} style={{ fontSize: 11, marginRight: 8 }}>
    <a href={a.url} target="_blank" rel="noreferrer">📎 {a.nombre}</a>
    {puedeEditar && <button title="Quitar adjunto, sus tareas y su contrato"
      onClick={() => { if (confirm('¿Quitar el adjunto, sus tareas y su contrato?')) quitarAdjunto(obra.id, rubro.id, a.id, a.contratoId); }}>✗</button>}
  </span>
))}
{/* modales */}
{adjRubroId && !adjReady && (
  <AdjuntarPresupuestoModal proveedores={proveedores} onAddProveedor={addProveedor}
    onReady={setAdjReady} onClose={() => setAdjRubroId(null)} />
)}
{adjReady && (
  <RevisarPresupuestoModal input={adjReady} onConfirm={confirmarImport} onClose={() => { setAdjReady(null); setAdjRubroId(null); }} />
)}
```

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/pages/obra/RevisarPresupuestoModal.jsx src/pages/obra/ObraPresupuesto.jsx
git commit -m "feat(presupuesto): botón adjuntar + modal de revisión/mapeo + crea contrato/tareas/adjunto"
```

> **Verificación manual:** en una obra de prueba, en un rubro → "📎 Adjuntar presupuesto" → subir un Excel y un PDF → mapear/revisar → "Agregar N tareas". Verificar: aparecen las tareas con su margen, el chip del adjunto, y un contrato nuevo en Contratos MO.

---

## Phase 5 — Integración con Contratos MO

### Task 8: Mostrar contratos `origen:'adjunto'` con monto/avance de sus tareas

**Files:**
- Modify: el/los componentes de la sección Contratos MO (buscar dónde se listan `detalle.contratos`, ej. `src/pages/obra/tabs/*Contratos*` u `ObraGantt.jsx` para el avance).

- [ ] **Step 1: Localizar el render de contratos**

Run: `grep -rn "detalle.contratos\|contratos.map\|contrato.monto\|contrato.avancePct" src/pages/obra`
Identificar el componente que lista los contratos MO.

- [ ] **Step 2: Para contratos `origen:'adjunto'`, derivar monto y avance de las tareas**

Donde se lee `contrato.monto` / `contrato.avancePct`, para `origen:'adjunto'` usar los helpers (las tareas del rubro son la fuente de verdad):

```jsx
import { montoContrato, avanceContrato } from '../../lib/presupuestoImport';
// tareasObra = todas las tareas de todos los rubros del detalle:
const tareasObra = (detalle.rubros || []).flatMap(r => r.tareas || []);
const monto  = c.origen === 'adjunto' ? montoContrato(c.id, tareasObra) : c.monto;
const avance = c.origen === 'adjunto' ? avanceContrato(c.id, tareasObra) : (c.avancePct ?? 0);
```

Agregar un badge "desde presupuesto · borrador" cuando `c.origen === 'adjunto'`.

- [ ] **Step 3: Verificar build + tests**

Run: `npm run build && npm test`
Expected: build OK, 538+ tests en verde.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(contratos): contratos desde presupuesto — monto/avance derivados de sus tareas + badge borrador"
```

---

## Deploy final

- [ ] **Push** (deploya app vía Vercel; verificar build verde en el dashboard).

```bash
git push origin main
```

- [ ] **Verificación manual end-to-end** con el caso "Equipamiento gastronómico" de la spec: 1 rubro, 2 adjuntos (2 proveedores) → 2 contratos que no se pisan, cliente ve 1 rubro con los 4 ítems + margen.

---

## Notas de implementación

- **No tocar la matemática de venta** (`tareaVentaUnit`): las tareas importadas son tareas normales con `costoSub` + `margenMO` del rubro.
- **Escrituras atómicas**: todo pasa por `patchDetalle` (un solo patch por importación). Nunca reescribir el detalle entero.
- **Bot** ([[feedback_bot_siempre]]): por ahora NO. A futuro el bot podría recibir el PDF por WhatsApp y reusar `api/presupuesto/extraer.js`. Anotarlo, no implementarlo.
- **Riesgo SEC-09**: los adjuntos quedan en el bucket público (`kamak-fotos`). Aceptable por ahora; documentado en la spec.
