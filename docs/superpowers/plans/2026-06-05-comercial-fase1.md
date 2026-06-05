# Módulo Comercial — Fase 1 (Embudo / Kanban) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar a Kamak una sección **Comercial** con un **embudo de ventas Kanban** (5 etapas) que reusa las obras existentes, sin entidad nueva ni migración disruptiva.

**Architecture:** Overlay sobre obras. La etapa de venta es un campo `obra.venta` (separado de `obra.estado`). Toda la lógica de mapeo/derivación vive en un módulo PURO (`src/lib/ventaEtapa.js`) con tests; el store (`ObrasContext`) gana un `setVentaEtapa` atómico (mismo patrón que `setEstado`); el Kanban (`src/pages/comercial/Pipeline.jsx`) usa HTML5 drag&drop nativo (no hay librería de DnD en el repo). Un backfill one-time setea `obra.venta` en las obras viejas, y un reconciliador global mueve a "Ganado" las obras que reciben un pago.

**Tech Stack:** React 19 + Vite · Context API (`src/store/*`) · Supabase `shared_data` con escritura atómica por ítem (`patchObjectItem`) · Vitest (funciones puras) · theme `T` + `src/components/ui`.

**Referencia de diseño:** `docs/superpowers/specs/2026-06-05-comercial-crm-design.md` (§4.1, §5, §6, §7).

**Nota sobre TDD:** el repo solo testea **funciones puras** (Vitest `environment: 'node'`, sin jsdom ni component tests). Por eso las Tareas 1 y 8 son TDD estricto sobre la lógica pura; las tareas de UI/store/script (2–7) se verifican con **build** (`npm run build`) y, en el backfill, **dry-run**. Toda decisión no trivial se extrae a la lib pura para poder testearla.

**Antes de empezar:** estás en la branch `main`. Creá una branch de trabajo: `git checkout -b feat/comercial-fase1`.

---

### Task 1: Lógica pura del embudo (`src/lib/ventaEtapa.js`) + constantes

**Files:**
- Modify: `src/lib/constants.js` (después de `ESTADOS_OBRA`, línea 23)
- Create: `src/lib/ventaEtapa.js`
- Test: `src/lib/ventaEtapa.test.js`

- [ ] **Step 1: Agregar las constantes del embudo**

En `src/lib/constants.js`, justo debajo de la línea `export const ESTADOS_OBRA = [...]` (línea 23), agregar:

```javascript
// ── Embudo de ventas (módulo Comercial) ─────────────────────────────────
export const ETAPAS_VENTA = ['prospecto', 'cotizado', 'negociacion', 'ganado', 'perdido'];
// Probabilidad de cierre por etapa (para el pipeline ponderado de los KPIs).
export const PROBABILIDAD_POR_ETAPA = { prospecto: 0.10, cotizado: 0.40, negociacion: 0.70, ganado: 1.0, perdido: 0.0 };
// Meses sin obra/actividad para considerar a un cliente "inactivo" (Fase 2).
export const DEFAULT_MESES_INACTIVO = 6;
```

- [ ] **Step 2: Escribir el test que falla**

Crear `src/lib/ventaEtapa.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import {
  obraEstadoParaEtapa, etapaEfectiva, etapaInicialBackfill,
  necesitaGanarPorPago, resumenEmbudo, ETAPA_META,
} from './ventaEtapa';

describe('obraEstadoParaEtapa', () => {
  it('ganado -> activa (salvo que ya estuviera finalizada)', () => {
    expect(obraEstadoParaEtapa('ganado', 'en-presupuesto')).toBe('activa');
    expect(obraEstadoParaEtapa('ganado', 'finalizada')).toBe('finalizada');
  });
  it('perdido -> archivada', () => {
    expect(obraEstadoParaEtapa('perdido', 'activa')).toBe('archivada');
  });
  it('etapas abiertas -> en-presupuesto (reabre si venía cerrada)', () => {
    expect(obraEstadoParaEtapa('cotizado', 'activa')).toBe('en-presupuesto');
    expect(obraEstadoParaEtapa('prospecto', 'en-presupuesto')).toBe('en-presupuesto');
  });
});

describe('etapaEfectiva', () => {
  it('obra activa => ganado', () => {
    expect(etapaEfectiva({ estado: 'activa' })).toBe('ganado');
  });
  it('en-presupuesto con pago => ganado', () => {
    expect(etapaEfectiva({ estado: 'en-presupuesto' }, { cobradoUSD: 500 })).toBe('ganado');
  });
  it('en-presupuesto sin pago usa la etapa guardada', () => {
    expect(etapaEfectiva({ estado: 'en-presupuesto', venta: { etapa: 'negociacion' } })).toBe('negociacion');
  });
  it('en-presupuesto sin etapa => prospecto', () => {
    expect(etapaEfectiva({ estado: 'en-presupuesto' })).toBe('prospecto');
  });
  it('archivada sin etapa => perdido; con etapa guardada la respeta', () => {
    expect(etapaEfectiva({ estado: 'archivada' })).toBe('perdido');
    expect(etapaEfectiva({ estado: 'archivada', venta: { etapa: 'ganado' } })).toBe('ganado');
  });
  it('activa marcada perdido se respeta como perdido', () => {
    expect(etapaEfectiva({ estado: 'activa', venta: { etapa: 'perdido' } })).toBe('perdido');
  });
  it('obra nula => prospecto', () => {
    expect(etapaEfectiva(null)).toBe('prospecto');
  });
});

describe('etapaInicialBackfill', () => {
  it('activa/finalizada => ganado', () => {
    expect(etapaInicialBackfill({ estado: 'activa' })).toBe('ganado');
    expect(etapaInicialBackfill({ estado: 'finalizada' })).toBe('ganado');
  });
  it('archivada con ingreso => ganado; sin ingreso => perdido', () => {
    expect(etapaInicialBackfill({ estado: 'archivada' }, { tieneIngreso: true })).toBe('ganado');
    expect(etapaInicialBackfill({ estado: 'archivada' }, { tieneIngreso: false })).toBe('perdido');
  });
  it('en-presupuesto: cotizado si propuesta enviada, sino prospecto', () => {
    expect(etapaInicialBackfill({ estado: 'en-presupuesto' }, { propuestaEnviada: true })).toBe('cotizado');
    expect(etapaInicialBackfill({ estado: 'en-presupuesto' }, { propuestaEnviada: false })).toBe('prospecto');
  });
});

describe('necesitaGanarPorPago', () => {
  it('true si hay pago y la etapa no es ganado/perdido', () => {
    expect(necesitaGanarPorPago({ venta: { etapa: 'cotizado' } }, 100)).toBe(true);
    expect(necesitaGanarPorPago({ estado: 'en-presupuesto' }, 100)).toBe(true);
  });
  it('false si no hay pago, o ya es ganado/perdido', () => {
    expect(necesitaGanarPorPago({ venta: { etapa: 'cotizado' } }, 0)).toBe(false);
    expect(necesitaGanarPorPago({ venta: { etapa: 'ganado' } }, 100)).toBe(false);
    expect(necesitaGanarPorPago({ venta: { etapa: 'perdido' } }, 100)).toBe(false);
  });
});

describe('resumenEmbudo', () => {
  it('cuenta por etapa y calcula conversión = ganado / (ganado+perdido)', () => {
    const r = resumenEmbudo(['prospecto', 'cotizado', 'ganado', 'ganado', 'perdido']);
    expect(r.conteo.ganado).toBe(2);
    expect(r.conteo.perdido).toBe(1);
    expect(r.cerradas).toBe(3);
    expect(r.conversion).toBe(67); // 2/3
    expect(r.abiertas).toBe(2);
  });
  it('sin cerradas, conversión = 0', () => {
    expect(resumenEmbudo(['prospecto']).conversion).toBe(0);
  });
});

describe('ETAPA_META', () => {
  it('tiene label y color para las 5 etapas', () => {
    for (const e of ['prospecto', 'cotizado', 'negociacion', 'ganado', 'perdido']) {
      expect(ETAPA_META[e].label).toBeTruthy();
      expect(ETAPA_META[e].color).toMatch(/^#/);
    }
  });
});
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `npm test -- src/lib/ventaEtapa.test.js`
Expected: FAIL — "Failed to resolve import './ventaEtapa'".

- [ ] **Step 4: Implementar `src/lib/ventaEtapa.js`**

```javascript
// Etapas del embudo de ventas (módulo Comercial). Lógica PURA, sin React,
// para poder testearla y reusarla en scripts. Ver spec §7.
// IMPORTANTE: extensión .js explícita — este módulo lo importa también el script
// Node del backfill (Task 3), y Node ESM no resuelve imports sin extensión.
import { ETAPAS_VENTA } from './constants.js';

// Metadatos por etapa para el Kanban (color en hex del theme T).
export const ETAPA_META = {
  prospecto:   { label: 'Prospecto',   color: '#9a9892' }, // T.ink3
  cotizado:    { label: 'Cotizado',    color: '#1a9b9c' }, // T.accent
  negociacion: { label: 'Negociación', color: '#d4923a' }, // T.warn
  ganado:      { label: 'Ganado',      color: '#3d7a4a' }, // T.ok
  perdido:     { label: 'Perdido',     color: '#b91c1c' }, // rojo
};

// Estado de obra que corresponde a una etapa de venta (spec §7.1).
export function obraEstadoParaEtapa(etapa, estadoActual) {
  if (etapa === 'ganado')  return estadoActual === 'finalizada' ? 'finalizada' : 'activa';
  if (etapa === 'perdido') return 'archivada';
  return 'en-presupuesto'; // prospecto / cotizado / negociacion (reabre si venía cerrada)
}

// Etapa EFECTIVA para mostrar: reconcilia la etapa guardada con la realidad de la
// obra. Un pago, o estado activa/finalizada, fuerza 'ganado' aunque no se haya
// guardado todavía (el Kanban nunca muestra una obra cobrada como "cotizado").
export function etapaEfectiva(obra, { cobradoUSD = 0 } = {}) {
  if (!obra) return 'prospecto';
  const guardada = obra.venta && obra.venta.etapa;
  if (obra.estado === 'activa' || obra.estado === 'finalizada' || cobradoUSD > 0) {
    return guardada === 'perdido' ? 'perdido' : 'ganado';
  }
  if (obra.estado === 'archivada') return guardada || 'perdido';
  // en-presupuesto:
  if (guardada && guardada !== 'ganado' && ETAPAS_VENTA.includes(guardada)) return guardada;
  return 'prospecto';
}

// Etapa inicial para el backfill one-time de las obras existentes (spec §7.4).
export function etapaInicialBackfill(obra, { propuestaEnviada = false, tieneIngreso = false } = {}) {
  const e = obra && obra.estado;
  if (e === 'activa' || e === 'finalizada') return 'ganado';
  if (e === 'archivada') return tieneIngreso ? 'ganado' : 'perdido';
  return propuestaEnviada ? 'cotizado' : 'prospecto';
}

// ¿La obra debería pasar a 'ganado' por haber recibido un pago? (reconciler global).
export function necesitaGanarPorPago(obra, cobradoUSD) {
  if (!obra || !(cobradoUSD > 0)) return false;
  const etapa = obra.venta && obra.venta.etapa;
  return etapa !== 'ganado' && etapa !== 'perdido';
}

// Resumen del embudo desde las etapas efectivas de las oportunidades.
export function resumenEmbudo(etapas) {
  const conteo = { prospecto: 0, cotizado: 0, negociacion: 0, ganado: 0, perdido: 0 };
  for (const e of etapas || []) if (e in conteo) conteo[e]++;
  const cerradas = conteo.ganado + conteo.perdido;
  const conversion = cerradas > 0 ? Math.round((conteo.ganado / cerradas) * 100) : 0;
  const abiertas = conteo.prospecto + conteo.cotizado + conteo.negociacion;
  return { conteo, cerradas, conversion, abiertas };
}
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npm test -- src/lib/ventaEtapa.test.js`
Expected: PASS (todos los `describe` en verde).

- [ ] **Step 6: Commit**

```bash
git add src/lib/constants.js src/lib/ventaEtapa.js src/lib/ventaEtapa.test.js
git commit -m "feat(comercial): logica pura del embudo (etapas, mapeo, derivacion, KPIs)"
```

---

### Task 2: `setVentaEtapa` en ObrasContext

**Files:**
- Modify: `src/store/ObrasContext.jsx` (agregar función cerca de `setEstado`, líneas 348-358; y exponerla en el `value` del Provider)

- [ ] **Step 1: Importar el helper de mapeo**

En el bloque de imports de `src/store/ObrasContext.jsx`, agregar:

```javascript
import { obraEstadoParaEtapa } from '../lib/ventaEtapa';
```

- [ ] **Step 2: Implementar `setVentaEtapa` (después de `setEstado`, ~línea 358)**

Pegar esta función justo después de la definición de `setEstado`:

```javascript
  // Mueve una obra de etapa de venta (embudo Comercial) atómicamente. Mismo
  // patrón que setEstado: persiste con patchObjectItem y aplica los side-effects
  // de estado que correspondan a la etapa (ganado->activa, perdido->archivada).
  const setVentaEtapa = useCallback((obraId, etapa, { usuario = null, motivoPerdida } = {}) => {
    markUserEdit();
    const prevObra = obrasRef.current.find(o => o.id === obraId);
    if (!prevObra) return;
    const today = new Date().toISOString().split('T')[0];
    const prevVenta = prevObra.venta || {};
    const venta = {
      ...prevVenta,
      etapa,
      fechaCambioEtapa: today,
      changelog: [...(prevVenta.changelog || []), { etapa, fecha: today, usuario }],
    };
    if (etapa === 'perdido') venta.motivoPerdida = motivoPerdida || prevVenta.motivoPerdida || '';
    const ch = { venta };
    // Side-effects de estado, alineados con setEstado.
    const nuevoEstado = obraEstadoParaEtapa(etapa, prevObra.estado);
    if (nuevoEstado && nuevoEstado !== prevObra.estado) {
      ch.estado = nuevoEstado;
      if (nuevoEstado === 'activa') {
        if (prevObra.estado !== 'activa') emitAlertaObraIniciada(prevObra, obrasYaAlertadas.current);
        if (!prevObra.fechaInicio) ch.fechaInicio = today;
      }
      if (nuevoEstado === 'finalizada') { ch.avance = 100; ch.fechaFin = today; }
    }
    setObras(prev => prev.map(o => o.id === obraId ? { ...o, ...ch } : o));
    patchObjectItem('obras', 'obras', obraId, ch);
  }, []);
```

- [ ] **Step 3: Exponer `setVentaEtapa` en el `value` del Provider**

Buscar el objeto que se pasa a `<ObrasContext.Provider value={{ ... }}>` (donde están `updateObra`, `setEstado`, `getDetalle`, `patchDetalle`, etc.) y agregar `setVentaEtapa,` a la lista.

- [ ] **Step 4: Verificar que compila**

Run: `npm run build`
Expected: build exitoso (`✓ built in ...`), sin errores de import ni de sintaxis.

- [ ] **Step 5: Commit**

```bash
git add src/store/ObrasContext.jsx
git commit -m "feat(comercial): setVentaEtapa atomico en ObrasContext (etapa + estado)"
```

---

### Task 3: Backfill de `obra.venta` en las obras existentes

**Files:**
- Create: `scripts/backfill_venta_etapa.mjs`

- [ ] **Step 1: Escribir el script (dry-run por defecto, `--apply` para escribir)**

Crear `scripts/backfill_venta_etapa.mjs`:

```javascript
// Backfill one-time de obra.venta.etapa en las obras existentes (spec §7.4).
// Idempotente: si una obra ya tiene `venta`, NO la pisa.
// Uso:  node scripts/backfill_venta_etapa.mjs           (dry-run, no escribe)
//       node scripts/backfill_venta_etapa.mjs --apply   (respalda y escribe)
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { etapaInicialBackfill } from '../src/lib/ventaEtapa.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(resolve(__dirname, '../.env.local'), 'utf8');
// Lee KEY=value de .env.local, tolera comillas alrededor del valor.
const pick = (k) => {
  const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
};
const SUPABASE_URL = pick('SUPABASE_URL') || pick('VITE_SUPABASE_URL');
const SUPABASE_KEY = pick('SUPABASE_SERVICE_KEY');
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('Faltan SUPABASE_URL / SUPABASE_SERVICE_KEY en .env.local'); process.exit(1); }
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const APPLY = process.argv.includes('--apply');

const get = async (key) => {
  const { data: row, error } = await supabase.from('shared_data').select('*').eq('key', key).single();
  if (error || !row) return { row: null, col: 'data', val: null };
  const col = row.data !== undefined ? 'data' : 'value';
  return { row, col, val: row[col] };
};

const obr = await get('obras');
const mov = await get('movimientos');
if (!obr.row) { console.error('No existe el blob "obras".'); process.exit(1); }

const blob = obr.val || {};
const obras = blob.obras || [];
const detalles = blob.detalles || {};
const movimientos = (mov.val && mov.val.movimientos) || [];
const tieneIngreso = (obraId) => movimientos.some(m => m.obraId === obraId && m.tipo === 'ingreso');

let cambiadas = 0;
const plan = [];
for (const o of obras) {
  if (o.venta && o.venta.etapa) continue; // idempotente
  const det = detalles[o.id] || {};
  const propuestaEnviada = !!(det.financiacion && det.financiacion.propuestaEnviada);
  const etapa = etapaInicialBackfill(o, { propuestaEnviada, tieneIngreso: tieneIngreso(o.id) });
  // Jerarquía de fechaCambioEtapa (spec §7.4).
  const primerIngreso = movimientos
    .filter(m => m.obraId === o.id && m.tipo === 'ingreso')
    .map(m => m.fecha).filter(Boolean).sort()[0];
  const fechaCambioEtapa =
    etapa === 'cotizado' ? (det.financiacion?.fechaPropuesta || o.createdAt) :
    etapa === 'ganado'   ? (primerIngreso || o.fechaInicio || o.createdAt) :
    etapa === 'perdido'  ? (o.fechaFin || o.createdAt) :
    o.createdAt;
  o.venta = {
    etapa,
    responsable: null,
    origen: null,
    fechaProximoContacto: null,
    motivoPerdida: etapa === 'perdido' ? '(migración)' : null,
    fechaCambioEtapa: fechaCambioEtapa || null,
    changelog: [],
  };
  cambiadas++;
  plan.push(`${o.id} (${o.estado}) -> ${etapa}`);
}

console.log(`Modo: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
console.log(`Obras totales: ${obras.length} · a setear venta: ${cambiadas}`);
plan.slice(0, 50).forEach(l => console.log('  ' + l));
if (plan.length > 50) console.log(`  …(+${plan.length - 50})`);

if (!APPLY) { console.log('\n(DRY-RUN: no se escribió. Corré con --apply.)'); process.exit(0); }
if (cambiadas === 0) { console.log('\nNada para hacer.'); process.exit(0); }

const bk = resolve(__dirname, `_backup_PRE_VENTA_ETAPA_${Date.now()}.json`);
writeFileSync(bk, JSON.stringify(obr.val));
console.log('\nBackup:', bk);

blob.obras = obras;
const { error: upErr } = await supabase.from('shared_data').update({ [obr.col]: blob }).eq('key', 'obras');
if (upErr) { console.error('Error guardando:', upErr.message); process.exit(1); }

// Verificación post-escritura.
const { val: val2 } = await get('obras');
const sinVenta = (val2.obras || []).filter(o => !(o.venta && o.venta.etapa)).length;
console.log(`\n✅ Guardado. Obras sin venta.etapa restantes: ${sinVenta}`);
```

- [ ] **Step 2: Correr el dry-run y revisar el plan**

Run: `node scripts/backfill_venta_etapa.mjs`
Expected: imprime "Modo: DRY-RUN", el total de obras y la lista `id (estado) -> etapa` (ej. `baradero (activa) -> ganado`). NO escribe nada.

> **Pausa para revisión humana:** revisá que el mapeo tenga sentido (activas->ganado, en-presupuesto->prospecto/cotizado, archivadas->perdido/ganado). Si está OK, seguí.

- [ ] **Step 3: Aplicar el backfill**

Run: `node scripts/backfill_venta_etapa.mjs --apply`
Expected: imprime el Backup path y "✅ Guardado. Obras sin venta.etapa restantes: 0".

- [ ] **Step 4: Verificar idempotencia (correr de nuevo)**

Run: `node scripts/backfill_venta_etapa.mjs`
Expected: "a setear venta: 0" (porque todas ya tienen `venta`).

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill_venta_etapa.mjs
git commit -m "feat(comercial): script de backfill de obra.venta.etapa (one-time, idempotente)"
```

---

### Task 4: Sección "Comercial" en el Sidebar (+ mover Clientes)

**Files:**
- Modify: `src/components/layout/Sidebar.jsx` (array `ALL_ITEMS`, líneas 9-31)

- [ ] **Step 1: Agregar la sección Comercial y mover Clientes**

Reemplazar este fragmento de `ALL_ITEMS`:

```javascript
  { icon: '☑', label: 'Tareas',         path: '/tareas' },
  { section: 'Administración' },
  { icon: '◉', label: 'Proveedores',    path: '/proveedores',  allowedRoles: ['Admin', 'Administración', 'Logística y compras'] },
  { icon: '◎', label: 'Clientes',       path: '/clientes',     allowedRoles: ['Admin', 'Administración'] },
```

por:

```javascript
  { icon: '☑', label: 'Tareas',         path: '/tareas' },
  { section: 'Comercial' },
  { icon: '📊', label: 'Embudo',        path: '/comercial',    allowedRoles: ['Admin', 'Administración'] },
  { icon: '◎', label: 'Clientes',       path: '/clientes',     allowedRoles: ['Admin', 'Administración'] },
  { section: 'Administración' },
  { icon: '◉', label: 'Proveedores',    path: '/proveedores',  allowedRoles: ['Admin', 'Administración', 'Logística y compras'] },
```

- [ ] **Step 2: Verificar que compila**

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/Sidebar.jsx
git commit -m "feat(comercial): seccion Comercial en el sidebar (Embudo + Clientes)"
```

---

### Task 5: Ruta `/comercial` en App.jsx

**Files:**
- Modify: `src/App.jsx` (lazy imports ~líneas 33-60; rutas autenticadas ~líneas 238-265)

> **Nota:** `Pipeline.jsx` se crea en la Task 7. Esta tarea solo deja la ruta enganchada; el build de esta tarea fallaría si `Pipeline` no existe, así que **el commit de esta tarea va junto al de la Task 7** (o creá un stub mínimo primero). Para mantener el orden, hacé esta tarea y la 6/7 antes de buildear.

- [ ] **Step 1: Agregar el lazy import**

Junto a los otros `const X = lazy(() => import('./pages/...'))` (ej. después de `Clientes`, línea 38), agregar:

```javascript
const Pipeline           = lazy(() => import('./pages/comercial/Pipeline'));
```

- [ ] **Step 2: Agregar la ruta autenticada**

Después de `<Route path="/clientes" element={<Clientes />} />` (línea 243), agregar:

```javascript
                  <Route path="/comercial" element={<Pipeline />} />
```

- [ ] **Step 3: NO commitear todavía**

No corras `npm run build` ni commitees en esta tarea: `Pipeline.jsx` aún no existe y el build fallaría. El cambio de `App.jsx` se commitea en la **Task 7** (junto con `Pipeline.jsx` y `PerdidaModal.jsx`), cuando ya compila.

---

### Task 6: Modal de "Perdida" (motivo obligatorio)

**Files:**
- Create: `src/pages/comercial/PerdidaModal.jsx`

> Usa el componente genérico `Modal` (`src/components/ui/Modal.jsx`), que ya maneja overlay, header oscuro, footer y cierre con Escape.

- [ ] **Step 1: Crear `src/pages/comercial/PerdidaModal.jsx`**

```jsx
import { useState } from 'react';
import Modal from '../../components/ui/Modal';
import { Btn } from '../../components/ui';
import { T } from '../../theme';

// Modal que pide el motivo (obligatorio) al marcar una oportunidad como Perdida.
export default function PerdidaModal({ nombre, onClose, onConfirm }) {
  const [motivo, setMotivo] = useState('');
  const ok = motivo.trim().length > 0;
  return (
    <Modal
      title="Marcar como Perdida"
      subtitle={nombre}
      onClose={onClose}
      width={420}
      footer={<>
        <Btn sm onClick={onClose}>Cancelar</Btn>
        <Btn sm accent onClick={() => ok && onConfirm(motivo.trim())}
             style={ok ? undefined : { opacity: 0.5, pointerEvents: 'none' }}>
          Confirmar pérdida
        </Btn>
      </>}
    >
      <div style={{ fontSize: 12, color: T.ink2, marginBottom: 8 }}>
        ¿Por qué se perdió esta oportunidad? (obligatorio)
      </div>
      <textarea
        value={motivo}
        onChange={e => setMotivo(e.target.value)}
        placeholder="Ej: precio, eligió otro proveedor, no había presupuesto…"
        autoFocus
        style={{ width: '100%', minHeight: 80, padding: 10, fontFamily: T.font, fontSize: 13,
                 border: `1.5px solid ${T.faint2}`, borderRadius: 6, resize: 'vertical', outline: 'none' }}
      />
    </Modal>
  );
}
```

- [ ] **Step 2: NO commitear todavía**

Se commitea en la **Task 7**, junto con `Pipeline.jsx` y la ruta de `App.jsx` (así el commit ya compila como conjunto).

---

### Task 7: Pipeline / Kanban (`src/pages/comercial/Pipeline.jsx`)

**Files:**
- Create: `src/pages/comercial/Pipeline.jsx`

- [ ] **Step 1: Crear `src/pages/comercial/Pipeline.jsx`**

```jsx
import { useState, useMemo } from 'react';
import PageLayout from '../../components/layout/PageLayout';
import PageHero from '../../components/ui/PageHero';
import { T } from '../../theme';
import { useObras } from '../../store/ObrasContext';
import { useMovimientos } from '../../store/MovimientosContext';
import { useDolar } from '../../store/DolarContext';
import { useUsuarios } from '../../store/UsuariosContext';
import { ccObra, cobradoObraUSD } from '../obra/helpers';
import { ETAPAS_VENTA } from '../../lib/constants';
import { ETAPA_META, etapaEfectiva, resumenEmbudo } from '../../lib/ventaEtapa';
import { fmtN } from '../../lib/format';
import PerdidaModal from './PerdidaModal';

export default function Pipeline() {
  const { obras, getDetalle, setVentaEtapa } = useObras();
  const { movimientos, cajas } = useMovimientos();
  const { dolarVenta } = useDolar();
  const { currentUser } = useUsuarios();
  const tc = dolarVenta || 1070;

  const [drag, setDrag] = useState(null);        // obraId arrastrándose
  const [perdida, setPerdida] = useState(null);  // { obraId, nombre } -> abre modal

  // Una oportunidad por obra, con su etapa efectiva y su monto USD.
  const oportunidades = useMemo(() => obras.map(o => {
    const det = getDetalle(o.id);
    const cobradoUSD = cobradoObraUSD(movimientos, cajas, o.id, tc);
    const etapa = etapaEfectiva(o, { cobradoUSD });
    const { totalUSD } = ccObra(o, det, movimientos, cajas, tc);
    return { obra: o, etapa, montoUSD: totalUSD };
  }), [obras, movimientos, cajas, tc, getDetalle]);

  const resumen = useMemo(() => resumenEmbudo(oportunidades.map(o => o.etapa)), [oportunidades]);
  const porEtapa = (etapa) => oportunidades.filter(o => o.etapa === etapa);

  const onDrop = (etapaDestino) => {
    const obraId = drag;
    setDrag(null);
    if (!obraId) return;
    const op = oportunidades.find(o => o.obra.id === obraId);
    if (!op || op.etapa === etapaDestino) return;
    if (etapaDestino === 'perdido') { setPerdida({ obraId, nombre: op.obra.nombre }); return; }
    setVentaEtapa(obraId, etapaDestino, { usuario: currentUser?.id || null });
  };

  return (
    <PageLayout breadcrumb={[{ label: 'Inicio', to: '/' }, 'Comercial']} active="Embudo">
      <PageHero
        label="COMERCIAL"
        title="Embudo de ventas"
        subtitle={`${resumen.abiertas} oportunidades abiertas · conversión ${resumen.conversion}%`}
        kpis={ETAPAS_VENTA.map(e => ({
          label: ETAPA_META[e].label,
          value: resumen.conteo[e],
          color: ETAPA_META[e].color,
        }))}
      />

      <div style={{ display: 'flex', gap: 12, overflowX: 'auto', padding: '16px 0', alignItems: 'flex-start' }}>
        {ETAPAS_VENTA.map(etapa => {
          const items = porEtapa(etapa);
          const totalUSD = items.reduce((s, o) => s + o.montoUSD, 0);
          const meta = ETAPA_META[etapa];
          return (
            <div
              key={etapa}
              onDragOver={e => e.preventDefault()}
              onDrop={() => onDrop(etapa)}
              style={{ flex: '0 0 240px', background: T.faint, borderRadius: 8, padding: 10, minHeight: 220 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            marginBottom: 10, paddingLeft: 6, borderLeft: `3px solid ${meta.color}` }}>
                <span style={{ fontWeight: 800, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: T.ink }}>{meta.label}</span>
                <span style={{ fontFamily: T.fontMono, fontSize: 10.5, color: T.ink2 }}>{items.length} · U$S {fmtN(totalUSD)}</span>
              </div>

              {items.map(({ obra, montoUSD }) => (
                <div
                  key={obra.id}
                  draggable
                  onDragStart={() => setDrag(obra.id)}
                  onDragEnd={() => setDrag(null)}
                  style={{ background: '#fff', border: `1.5px solid ${T.faint2}`, borderRadius: 6,
                           padding: '8px 10px', marginBottom: 8, cursor: 'grab',
                           opacity: drag === obra.id ? 0.4 : 1, transition: 'opacity .15s' }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>{obra.nombre}</div>
                  <div style={{ fontSize: 11, color: T.ink2, marginTop: 2 }}>{obra.cliente || '—'}</div>
                  <div style={{ fontFamily: T.fontMono, fontSize: 12, color: meta.color, fontWeight: 700, marginTop: 4 }}>U$S {fmtN(montoUSD)}</div>
                </div>
              ))}

              {items.length === 0 && (
                <div style={{ fontSize: 11, color: T.ink3, textAlign: 'center', padding: '24px 0' }}>—</div>
              )}
            </div>
          );
        })}
      </div>

      {perdida && (
        <PerdidaModal
          nombre={perdida.nombre}
          onClose={() => setPerdida(null)}
          onConfirm={(motivo) => {
            setVentaEtapa(perdida.obraId, 'perdido', { motivoPerdida: motivo, usuario: currentUser?.id || null });
            setPerdida(null);
          }}
        />
      )}
    </PageLayout>
  );
}
```

- [ ] **Step 2: Verificar que compila (incluye Tasks 5 y 6)**

Run: `npm run build`
Expected: build exitoso. `Pipeline`, `PerdidaModal` y la ruta `/comercial` resuelven.

- [ ] **Step 3: Verificación manual en dev**

Run: `npm run dev` → abrir `http://localhost:5173/comercial` con un usuario Admin.
Verificar: se ven 5 columnas con las obras; arrastrar una card de "Prospecto" a "Negociación" la mueve y persiste (recargar y sigue ahí); arrastrar a "Perdido" abre el modal y exige motivo; los KPIs del hero cuentan por etapa y muestran la conversión.

- [ ] **Step 4: Commit**

```bash
git add src/pages/comercial/Pipeline.jsx src/pages/comercial/PerdidaModal.jsx src/App.jsx
git commit -m "feat(comercial): Kanban del embudo con drag&drop + modal de perdida + ruta"
```

---

### Task 8: Reconciliador global "pago → Ganado"

> Cierra el hallazgo de la revisión: hoy el auto-confirm al cobrar vive en un `useEffect` local de `ObraPresupuesto.jsx` (PIEZA 2) que solo corre con esa página montada. Este componente lo hace global: cualquier obra que reciba un pago (desde Movimientos, el bot, etc.) pasa a `venta.etapa='ganado'` (y `estado='activa'`). NO genera tareas (eso lo sigue haciendo `aprobarPresupuesto`), así que no hay doble generación.

**Files:**
- Create: `src/components/VentaSync.jsx`
- Modify: `src/App.jsx` (montarlo una vez dentro del área autenticada)
- Test: ya cubierto por `necesitaGanarPorPago` en `src/lib/ventaEtapa.test.js` (Task 1).

- [ ] **Step 1: Confirmar que el test de la decisión pura pasa**

Run: `npm test -- src/lib/ventaEtapa.test.js`
Expected: PASS (incluye el `describe('necesitaGanarPorPago')`).

- [ ] **Step 2: Crear `src/components/VentaSync.jsx`**

```jsx
import { useEffect, useRef } from 'react';
import { useObras } from '../store/ObrasContext';
import { useMovimientos } from '../store/MovimientosContext';
import { useDolar } from '../store/DolarContext';
import { cobradoObraUSD } from '../pages/obra/helpers';
import { necesitaGanarPorPago } from '../lib/ventaEtapa';

// Reconciliador global del embudo: si una obra recibió un pago pero su etapa de
// venta no es ganado/perdido, la mueve a 'ganado'. Centraliza la regla que antes
// solo corría dentro de ObraPresupuesto (PIEZA 2). No renderiza nada.
export default function VentaSync() {
  const { obras, setVentaEtapa } = useObras();
  const { movimientos, cajas } = useMovimientos();
  const { dolarVenta } = useDolar();
  const enProceso = useRef(new Set()); // evita re-disparos mientras propaga el state

  useEffect(() => {
    const tc = dolarVenta || 1070;
    for (const o of obras) {
      if (enProceso.current.has(o.id)) continue;
      const cobrado = cobradoObraUSD(movimientos, cajas, o.id, tc);
      if (necesitaGanarPorPago(o, cobrado)) {
        enProceso.current.add(o.id);
        setVentaEtapa(o.id, 'ganado', { usuario: 'sistema' });
      }
    }
  }, [obras, movimientos, cajas, dolarVenta, setVentaEtapa]);

  return null;
}
```

- [ ] **Step 3: Montar `<VentaSync />` una vez en el área autenticada de `src/App.jsx`**

Importar arriba: `import VentaSync from './components/VentaSync';`
Y dentro del `element` del `<Route path="*">` autenticado (donde vive el layout con los providers, ~línea 235-238), renderizarlo una vez junto al layout, por ejemplo antes de `<Routes>`:

```jsx
                <VentaSync />
```

(Debe quedar dentro de los Providers de Obras/Movimientos/Dolar, que ya envuelven el área autenticada.)

- [ ] **Step 4: Verificar build**

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 5: Verificación manual**

En dev, registrar un ingreso para una obra que esté en "Cotizado"/"Negociación" (desde Movimientos) → al volver al Embudo, la obra aparece en "Ganado". Registrar un segundo pago no la duplica ni la mueve de nuevo.

- [ ] **Step 6: Commit**

```bash
git add src/components/VentaSync.jsx src/App.jsx
git commit -m "feat(comercial): reconciliador global pago->Ganado (centraliza PIEZA 2)"
```

---

## Cierre de la Fase 1

- [ ] **Correr toda la suite de tests**

Run: `npm test`
Expected: todo verde (incluye `ventaEtapa.test.js`).

- [ ] **Build final**

Run: `npm run build`
Expected: build exitoso.

- [ ] **Integrar** (usar superpowers:finishing-a-development-branch): merge de `feat/comercial-fase1` a `main` o PR, según preferencia del usuario.

**Qué queda para fases siguientes (NO en esta fase):** Clientes 360 + timeline (`crm_actividades`), contrato+firma en el portal (OTP), bot comercial (cron `sales-followups` + intents) y la página completa de KPIs (`VentasReportes.jsx`). Ver spec §8–§11 y §15.
