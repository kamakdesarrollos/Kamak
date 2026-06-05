# Módulo Comercial — Fase 2 (Clientes 360 + Timeline) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar a cada cliente una **ficha 360** (sus oportunidades, cuenta corriente en USD, y un **timeline de actividades** consolidado) y enriquecer el cliente con responsable comercial, tags, próximo contacto y estado derivado.

**Architecture:** Overlay sobre lo existente, mismo stack. Un **blob nuevo** `shared_data['crm_actividades']` (array atómico, clon del patrón de `TareasContext`) guarda el timeline; el cliente gana 4 campos (patch atómico, sin romper el sync del bot); una función **pura** deriva `cliente.estado`; y la **ficha 360** vive en un modal nuevo enganchado en `Clientes.jsx`. El Kanban registra automáticamente una actividad al mover de etapa.

**Tech Stack:** React 19 + Vite · Context API (`src/store/*`) · Supabase `shared_data` atómico (`appendItem/patchItem/removeItemInSharedArray`) · Vitest (lógica pura).

**Referencia de diseño:** `docs/superpowers/specs/2026-06-05-comercial-crm-design.md` §4.2, §4.3, §7.3, §11. Reusa de Fase 1: `ETAPAS_VENTA`, `DEFAULT_MESES_INACTIVO` (constants.js:30), `etapaEfectiva` (`src/lib/ventaEtapa.js`), `setVentaEtapa` (ObrasContext).

**Nota TDD:** sólo la lógica pura (`derivaClienteEstado`) es TDD estricto (Vitest, `environment:node`). El provider/UI se verifican con build + `npm test`. No importar React desde libs puras.

**Antes de empezar:** estás en `main`. Branch: `git checkout -b feat/comercial-fase2`.

---

### Task 1: `derivaClienteEstado` — lógica pura (TDD)

**Files:**
- Create: `src/lib/derivaClienteEstado.js`
- Test: `src/lib/derivaClienteEstado.test.js`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/lib/derivaClienteEstado.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { derivaClienteEstado } from './derivaClienteEstado';

const HOY = new Date('2026-06-05T00:00:00Z');

describe('derivaClienteEstado', () => {
  it("'cliente' si tiene al menos una obra ganada (activa/finalizada/pausada)", () => {
    expect(derivaClienteEstado({}, [{ estado: 'activa' }], null, { hoy: HOY })).toBe('cliente');
    expect(derivaClienteEstado({}, [{ estado: 'en-presupuesto' }, { estado: 'finalizada' }], null, { hoy: HOY })).toBe('cliente');
  });

  it("'prospecto' si sólo tiene obras en-presupuesto (oportunidades abiertas)", () => {
    expect(derivaClienteEstado({}, [{ estado: 'en-presupuesto' }], null, { hoy: HOY })).toBe('prospecto');
  });

  it("'prospecto' si no tiene obras pero hay actividad reciente", () => {
    expect(derivaClienteEstado({}, [], '2026-05-20', { hoy: HOY })).toBe('prospecto');
  });

  it("'inactivo' si no tiene obra ganada ni abierta y la última señal es vieja (> meses)", () => {
    // obra archivada (perdida) hace 1 año, sin actividad
    expect(derivaClienteEstado({}, [{ estado: 'archivada', createdAt: '2025-05-01' }], null, { hoy: HOY })).toBe('inactivo');
  });

  it("un inactivo vuelve a 'prospecto' al recibir actividad reciente", () => {
    expect(derivaClienteEstado({}, [{ estado: 'archivada', createdAt: '2025-05-01' }], '2026-06-01', { hoy: HOY })).toBe('prospecto');
  });

  it('sin obras ni actividad => prospecto (cliente nuevo)', () => {
    expect(derivaClienteEstado({}, [], null, { hoy: HOY })).toBe('prospecto');
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- src/lib/derivaClienteEstado.test.js`
Expected: FAIL — "Failed to resolve import './derivaClienteEstado'".

- [ ] **Step 3: Implementar `src/lib/derivaClienteEstado.js`**

```javascript
// Estado comercial DERIVADO de un cliente (spec §7.3). Lógica PURA, sin React.
// .js explícito: la pueden importar scripts/bot en Node ESM.
import { DEFAULT_MESES_INACTIVO } from './constants.js';

// Una obra "ganada" (cliente real) está activa/finalizada/pausada; 'en-presupuesto'
// es oportunidad abierta; 'archivada' es perdida/cerrada (ni ganada ni abierta).
const esGanada = (o) => !!o && (o.estado === 'activa' || o.estado === 'finalizada' || o.estado === 'pausada');
const esAbierta = (o) => !!o && o.estado === 'en-presupuesto';

/**
 * derivaClienteEstado(cliente, obrasCliente, ultimaActividadISO?, opts?) →
 *   'prospecto' | 'cliente' | 'inactivo'
 * obrasCliente: obras YA filtradas de ese cliente. ultimaActividadISO: fecha ISO
 * de la última actividad CRM del cliente (o null).
 */
export function derivaClienteEstado(cliente, obrasCliente, ultimaActividadISO = null, { mesesInactivo = DEFAULT_MESES_INACTIVO, hoy = new Date() } = {}) {
  const obras = obrasCliente || [];
  if (obras.some(esGanada)) return 'cliente';
  if (obras.some(esAbierta)) return 'prospecto';

  // Sin obra ganada ni abierta: depende de cuán reciente sea la última señal.
  const fechas = [];
  for (const o of obras) {
    if (o && o.fechaFin) fechas.push(o.fechaFin);
    if (o && o.createdAt) fechas.push(o.createdAt);
  }
  if (ultimaActividadISO) fechas.push(ultimaActividadISO);
  const ultima = fechas.filter(Boolean).sort().slice(-1)[0];
  if (!ultima) return 'prospecto'; // cliente nuevo, sin historia
  const meses = (hoy.getTime() - new Date(ultima).getTime()) / (1000 * 60 * 60 * 24 * 30);
  return meses > mesesInactivo ? 'inactivo' : 'prospecto';
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- src/lib/derivaClienteEstado.test.js`
Expected: PASS (6 tests verdes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/derivaClienteEstado.js src/lib/derivaClienteEstado.test.js
git commit -m "feat(comercial): derivaClienteEstado puro (prospecto/cliente/inactivo)"
```

---

### Task 2: Enriquecer el modelo de cliente

**Files:**
- Modify: `src/store/ClientesContext.jsx` (SEED_CLIENTES ~13-17, addCliente default ~28)

- [ ] **Step 1: Agregar los 4 campos al SEED**

En `src/store/ClientesContext.jsx`, a cada objeto de `SEED_CLIENTES` agregarle `tags: [], responsableComercial: null, fechaProximoContacto: null, estado: 'prospecto'`. Ejemplo del primero:

```javascript
  { id: 'cl-familia-perez', nombre: 'Familia Pérez',  empresa: '',                      cuit: '',              condicionIVA: 'CF', telefono: '+54 11 5555-1234', email: 'perez@gmail.com',    notas: '', tags: [], responsableComercial: null, fechaProximoContacto: null, estado: 'prospecto' },
```

(hacer lo mismo en los 3 clientes del seed).

- [ ] **Step 2: Agregar los defaults en `addCliente`**

Cambiar la línea del `const nuevo` en `addCliente`:

```javascript
    const nuevo = { nombre: '', empresa: '', cuit: '', condicionIVA: 'CF', telefono: '', email: '', notas: '', tags: [], responsableComercial: null, fechaProximoContacto: null, estado: 'prospecto', ...data, id: newId('cl') };
```

(los defaults van **antes** de `...data` para que el caller pueda overridear; `id` queda al final.)

> **No tocar** `updateCliente`/`removeCliente`/`useSyncedSharedData`: el sync atómico ya manda el patch íntegro (incluidos los campos nuevos) sin pisar al bot.

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 4: Commit**

```bash
git add src/store/ClientesContext.jsx
git commit -m "feat(comercial): cliente con tags/responsable/proximoContacto/estado"
```

---

### Task 3: Provider `crm_actividades` (timeline)

**Files:**
- Create: `src/store/ComercialContext.jsx`
- Modify: `src/App.jsx` (import + montar dentro de `ClientesProvider`)

- [ ] **Step 1: Crear `src/store/ComercialContext.jsx`** (clon del patrón atómico de TareasContext)

```jsx
import { createContext, useContext, useCallback, useMemo, useRef, useEffect } from 'react';
import useSyncedSharedData from '../lib/useSyncedSharedData';
import { appendItemInSharedArray, patchItemInSharedArray, removeItemInSharedArray } from '../lib/dbHelpers';
import { newId } from '../lib/id';

const CTX = createContext(null);

// Timeline de actividades del CRM (spec §4.3). Blob 'crm_actividades' atómico:
// el bot también escribe actividades (cambio_etapa/portal_abierto/firma) desde el
// server, así que atomic:true evita que el save del blob entero las pise (LWW).
export function ComercialProvider({ children }) {
  const [actividades, setActividades] = useSyncedSharedData('crm_actividades', [], {
    lsKey: 'kamak_crm_actividades_v1',
    skipMarkReady: true,
    atomic: true,
  });

  const ref = useRef(actividades);
  useEffect(() => { ref.current = actividades; }, [actividades]);

  const aplicarActividad = useCallback((id, transform) => {
    const cur = ref.current.find(a => a.id === id);
    if (!cur) return;
    const updated = transform(cur);
    setActividades(prev => prev.map(a => a.id === id ? updated : a));
    patchItemInSharedArray('crm_actividades', id, updated);
  }, [setActividades]);

  const addActividad = useCallback((data) => {
    const now = new Date().toISOString();
    const nueva = {
      id: newId('act'),
      clienteId: data.clienteId || null,
      obraId: data.obraId || null,
      tipo: data.tipo || 'nota',          // llamada|mail|reunion|whatsapp|nota|propuesta_enviada|cambio_etapa|portal_abierto|firma
      texto: data.texto || '',
      fecha: data.fecha || now,
      usuario: data.usuario || null,      // userId | 'sistema' | 'bot'
      adjuntos: Array.isArray(data.adjuntos) ? data.adjuntos : [],
      creadoAt: now,
      actualizadoAt: now,
    };
    setActividades(prev => [nueva, ...prev]);
    appendItemInSharedArray('crm_actividades', nueva);
    return nueva.id;
  }, [setActividades]);

  const updateActividad = useCallback((id, changes) => {
    aplicarActividad(id, a => ({ ...a, ...changes, actualizadoAt: new Date().toISOString() }));
  }, [aplicarActividad]);

  const deleteActividad = useCallback((id) => {
    setActividades(prev => prev.filter(a => a.id !== id));
    removeItemInSharedArray('crm_actividades', id);
  }, [setActividades]);

  const value = useMemo(
    () => ({ actividades, addActividad, updateActividad, deleteActividad }),
    [actividades, addActividad, updateActividad, deleteActividad]
  );
  return <CTX.Provider value={value}>{children}</CTX.Provider>;
}

// Tolerante a estar fuera del provider (rutas públicas): devuelve defaults no-op.
export function useComercial() {
  return useContext(CTX) ?? { actividades: [], addActividad: () => {}, updateActividad: () => {}, deleteActividad: () => {} };
}
```

- [ ] **Step 2: Montar `ComercialProvider` en `src/App.jsx`**

Importar arriba (junto a los otros store): `import { ComercialProvider } from './store/ComercialContext';`

En el stack de `DataProviders`, envolver **dentro** de `<ClientesProvider>` (para que las actividades crucen con clientes):

```jsx
    <ClientesProvider>
    <ComercialProvider>
    <ComprobantesProvider>
      ...
    </ComprobantesProvider>
    </ComercialProvider>
    </ClientesProvider>
```

(agregar `<ComercialProvider>` después de `<ClientesProvider>` y su cierre `</ComercialProvider>` antes de `</ClientesProvider>`.)

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: build exitoso (resuelve ComercialContext + el provider monta).

- [ ] **Step 4: Commit**

```bash
git add src/store/ComercialContext.jsx src/App.jsx
git commit -m "feat(comercial): ComercialContext (blob atomico crm_actividades) + provider"
```

---

### Task 4: Form de cliente — tags, responsable, próximo contacto, estado

**Files:**
- Modify: `src/pages/Clientes.jsx` (NuevoClienteModal: form default ~25 + inputs ~36-69)

- [ ] **Step 1: Default del form**

En `NuevoClienteModal`, agregar los campos al estado inicial del form:

```javascript
  const [form, setForm] = useState(initial || { nombre: '', empresa: '', cuit: '', condicionIVA: 'CF', telefono: '', email: '', notas: '', tags: [], responsableComercial: null, fechaProximoContacto: null, estado: 'prospecto' });
```

- [ ] **Step 2: Inputs nuevos en el modal**

Dentro del cuerpo del form de `NuevoClienteModal` (después de los campos existentes), agregar (necesita `useUsuarios` — importarlo si no está: `import { useUsuarios } from '../store/UsuariosContext';` y `const { usuarios } = useUsuarios();` dentro del componente):

```jsx
        <div>
          <div style={labelSt}>Responsable comercial</div>
          <select style={inputSt} value={form.responsableComercial || ''}
            onChange={e => setForm(f => ({ ...f, responsableComercial: e.target.value || null }))}>
            <option value="">— Sin asignar —</option>
            {(usuarios || []).map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
        </div>
        <div>
          <div style={labelSt}>Próximo contacto</div>
          <input type="date" style={inputSt} value={form.fechaProximoContacto || ''}
            onChange={e => setForm(f => ({ ...f, fechaProximoContacto: e.target.value || null }))} />
        </div>
        <div>
          <div style={labelSt}>Tags (separados por coma)</div>
          <input style={inputSt}
            value={(form.tags || []).join(', ')}
            onChange={e => setForm(f => ({ ...f, tags: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))}
            placeholder="VIP, Puma, recompra…" />
        </div>
```

(El `estado` del cliente se **muestra derivado** en la tabla — Task 6 —, no hace falta input manual; si querés override manual, agregá un `<select>` análogo con prospecto/cliente/inactivo.)

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Clientes.jsx
git commit -m "feat(comercial): form de cliente con responsable/proximo contacto/tags"
```

---

### Task 5: Ficha 360 del cliente

**Files:**
- Create: `src/pages/Clientes/ClienteFicha360Modal.jsx`
- Modify: `src/pages/Clientes.jsx` (engancharla + un botón "Ver ficha 360" por fila)

- [ ] **Step 1: Crear `src/pages/Clientes/ClienteFicha360Modal.jsx`**

```jsx
import { useState, useMemo } from 'react';
import Modal from '../../components/ui/Modal';
import { Btn, Chip } from '../../components/ui';
import { T } from '../../theme';
import { useObras } from '../../store/ObrasContext';
import { useMovimientos } from '../../store/MovimientosContext';
import { useDolar } from '../../store/DolarContext';
import { useUsuarios } from '../../store/UsuariosContext';
import { useClientes } from '../../store/ClientesContext';
import { useComercial } from '../../store/ComercialContext';
import { ccObra, cobradoObraUSD } from '../obra/helpers';
import { ETAPA_META, etapaEfectiva } from '../../lib/ventaEtapa';
import { derivaClienteEstado } from '../../lib/derivaClienteEstado';
import { fmtN, fmtFecha } from '../../lib/format';

const TIPO_ICON = {
  llamada: '📞', mail: '✉️', reunion: '🤝', whatsapp: '💬', nota: '📝',
  propuesta_enviada: '📤', cambio_etapa: '↔️', portal_abierto: '👁️', firma: '✍️',
};
const ESTADO_CHIP = {
  cliente: { label: 'Cliente', color: T.ok }, prospecto: { label: 'Prospecto', color: T.accent }, inactivo: { label: 'Inactivo', color: T.ink3 },
};

export default function ClienteFicha360Modal({ cliente, onClose }) {
  const { obras, getDetalle } = useObras();
  const { movimientos, cajas } = useMovimientos();
  const { dolarVenta } = useDolar();
  const { usuarios } = useUsuarios();
  const { updateCliente } = useClientes();
  const { actividades, addActividad } = useComercial();
  const tc = dolarVenta || 1070;

  const [nuevaAct, setNuevaAct] = useState({ tipo: 'llamada', texto: '' });

  // Obras del cliente (por clienteId con fallback a nombre, como obrasCount).
  const obrasCliente = useMemo(
    () => obras.filter(o => o.clienteId === cliente.id || o.cliente === cliente.nombre),
    [obras, cliente]
  );

  // Actividades del cliente, más nuevas primero.
  const acts = useMemo(
    () => (actividades || []).filter(a => a.clienteId === cliente.id)
      .sort((a, b) => String(b.fecha || b.creadoAt).localeCompare(String(a.fecha || a.creadoAt))),
    [actividades, cliente.id]
  );

  // Cuenta corriente real (USD) sumando todas las obras del cliente.
  const cc = useMemo(() => obrasCliente.reduce((acc, o) => {
    const det = getDetalle(o.id);
    const r = ccObra(o, det, movimientos, cajas, tc);
    return { totalUSD: acc.totalUSD + r.totalUSD, cobradoUSD: acc.cobradoUSD + r.cobradoUSD, saldoUSD: acc.saldoUSD + r.saldoUSD };
  }, { totalUSD: 0, cobradoUSD: 0, saldoUSD: 0 }), [obrasCliente, movimientos, cajas, tc, getDetalle]);

  const estado = derivaClienteEstado(cliente, obrasCliente, acts[0]?.fecha || acts[0]?.creadoAt || null);
  const ec = ESTADO_CHIP[estado] || ESTADO_CHIP.prospecto;
  const respNombre = (usuarios || []).find(u => u.id === cliente.responsableComercial)?.nombre;
  const nombreUsuario = (id) => (usuarios || []).find(u => u.id === id)?.nombre || (id === 'bot' ? 'Bot' : id === 'sistema' ? 'Sistema' : '—');

  const registrarActividad = () => {
    if (!nuevaAct.texto.trim()) return;
    addActividad({ clienteId: cliente.id, tipo: nuevaAct.tipo, texto: nuevaAct.texto.trim(), usuario: null });
    setNuevaAct({ tipo: 'llamada', texto: '' });
  };

  const fmtU = (n) => `U$S ${fmtN(n)}`;

  return (
    <Modal title={cliente.nombre} subtitle={cliente.empresa || cliente.email || ''} onClose={onClose} width={680} maxHeight="88vh">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Cabecera: estado + responsable + tags + próximo contacto */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <span style={{ background: ec.color, color: '#fff', borderRadius: 12, padding: '2px 10px', fontSize: 11, fontWeight: 700 }}>{ec.label}</span>
          {respNombre && <span style={{ fontSize: 12, color: T.ink2 }}>· Resp: <b>{respNombre}</b></span>}
          {(cliente.tags || []).map(t => <Chip key={t} accent style={{ fontSize: 10 }}>{t}</Chip>)}
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: T.ink3 }}>Próx. contacto</span>
            <input type="date" value={cliente.fechaProximoContacto || ''}
              onChange={e => updateCliente(cliente.id, { fechaProximoContacto: e.target.value || null })}
              style={{ padding: '3px 6px', border: `1px solid ${T.faint2}`, borderRadius: 4, fontSize: 12, fontFamily: T.font }} />
          </div>
        </div>

        {/* Cuenta corriente */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {[['Total', cc.totalUSD, T.accent], ['Cobrado', cc.cobradoUSD, T.ok], ['Saldo', cc.saldoUSD, cc.saldoUSD > 0 ? T.warn : T.ok]].map(([l, v, c]) => (
            <div key={l} style={{ background: T.faint, borderRadius: 8, padding: '10px 14px', border: `1px solid ${T.faint2}` }}>
              <div style={{ fontSize: 9.5, color: T.ink3, fontFamily: T.fontMono, letterSpacing: 1, fontWeight: 700, textTransform: 'uppercase' }}>{l}</div>
              <div style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 18, color: c }}>{fmtU(v)}</div>
            </div>
          ))}
        </div>

        {/* Oportunidades (obras del cliente) */}
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, color: T.ink }}>Oportunidades ({obrasCliente.length})</div>
          {obrasCliente.length === 0 && <div style={{ fontSize: 12, color: T.ink3 }}>Sin obras.</div>}
          {obrasCliente.map(o => {
            const det = getDetalle(o.id);
            const cobr = cobradoObraUSD(movimientos, cajas, o.id, tc);
            const et = etapaEfectiva(o, { cobradoUSD: cobr });
            const meta = ETAPA_META[et] || {};
            const { totalUSD } = ccObra(o, det, movimientos, cajas, tc);
            return (
              <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderBottom: `1px solid ${T.faint2}` }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: meta.color || T.ink3, flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: T.ink, flex: 1 }}>{o.nombre}</span>
                <span style={{ fontSize: 10.5, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.4 }}>{meta.label || et}</span>
                <span style={{ fontFamily: T.fontMono, fontSize: 12.5, fontWeight: 700, color: meta.color || T.ink }}>{fmtU(totalUSD)}</span>
              </div>
            );
          })}
        </div>

        {/* Registrar actividad */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <select value={nuevaAct.tipo} onChange={e => setNuevaAct(a => ({ ...a, tipo: e.target.value }))}
            style={{ padding: '6px 8px', border: `1px solid ${T.faint2}`, borderRadius: 5, fontSize: 12, fontFamily: T.font }}>
            {['llamada', 'mail', 'reunion', 'whatsapp', 'nota'].map(t => <option key={t} value={t}>{TIPO_ICON[t]} {t}</option>)}
          </select>
          <input value={nuevaAct.texto} onChange={e => setNuevaAct(a => ({ ...a, texto: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Enter') registrarActividad(); }}
            placeholder="Registrar actividad…" style={{ flex: 1, padding: '6px 10px', border: `1px solid ${T.faint2}`, borderRadius: 5, fontSize: 13, fontFamily: T.font, outline: 'none' }} />
          <Btn sm accent onClick={registrarActividad}>+ Registrar</Btn>
        </div>

        {/* Timeline */}
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, color: T.ink }}>Actividad ({acts.length})</div>
          {acts.length === 0 && <div style={{ fontSize: 12, color: T.ink3 }}>Sin actividad registrada.</div>}
          {acts.map(a => (
            <div key={a.id} style={{ display: 'flex', gap: 10, padding: '7px 4px', borderBottom: `1px solid ${T.faint2}` }}>
              <span style={{ fontSize: 14, flexShrink: 0 }}>{TIPO_ICON[a.tipo] || '•'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: T.ink }}>{a.texto}</div>
                <div style={{ fontSize: 10.5, color: T.ink3, fontFamily: T.fontMono }}>
                  {fmtFecha(a.fecha || a.creadoAt)} · {nombreUsuario(a.usuario)}{a.obraId ? ` · ${(obras.find(o => o.id === a.obraId)?.nombre) || ''}` : ''}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Enganchar la ficha en `Clientes.jsx`**

Importar: `import ClienteFicha360Modal from './Clientes/ClienteFicha360Modal';`
Agregar estado: `const [ficha, setFicha] = useState(null);`
En cada fila de cliente agregar un botón **"360"** (junto al `✏` de editar): `<Btn sm onClick={() => setFicha(c)}>360</Btn>`
Y al final del render (junto al modal de edición, ~línea 287):

```jsx
      {ficha && <ClienteFicha360Modal cliente={ficha} onClose={() => setFicha(null)} />}
```

- [ ] **Step 3: Verificar build + dev pipeline**

Run: `npm run build`
Expected: build exitoso (emite el chunk de Clientes con la ficha).

- [ ] **Step 4: Verificación manual (dev)**

`npm run dev` → /clientes con un Admin → abrir la ficha 360 de un cliente con obras: ver oportunidades con etapa+monto, CC en USD, registrar una actividad y verla en el timeline.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Clientes/ClienteFicha360Modal.jsx src/pages/Clientes.jsx
git commit -m "feat(comercial): ficha 360 del cliente (oportunidades + CC USD + timeline + registrar actividad)"
```

---

### Task 6: Auto-alimentar el timeline desde el Kanban + estado en la tabla

**Files:**
- Modify: `src/pages/comercial/Pipeline.jsx` (en `onDrop`, registrar actividad `cambio_etapa`)
- Modify: `src/pages/Clientes.jsx` (mostrar `cliente.estado` derivado en la tabla)

- [ ] **Step 1: Pipeline emite actividad al mover de etapa**

En `src/pages/comercial/Pipeline.jsx`, importar `useComercial`: `import { useComercial } from '../../store/ComercialContext';` y dentro del componente `const { addActividad } = useComercial();`.
En `onDrop`, después de `setVentaEtapa(obraId, etapaDestino, { usuario: currentUser?.id || null });`, agregar:

```jsx
    addActividad({
      clienteId: op.obra.clienteId || null,
      obraId,
      tipo: 'cambio_etapa',
      texto: `Movida a ${ (ETAPA_META[etapaDestino]?.label) || etapaDestino } — ${op.obra.nombre}`,
      usuario: currentUser?.id || null,
    });
```

(El caso 'perdido' abre el modal; registrá la actividad también al confirmar la pérdida, dentro del `onConfirm` del `PerdidaModal`, con `texto: 'Perdida: ' + motivo`.)

- [ ] **Step 2: Mostrar el estado derivado en la tabla de clientes**

En `src/pages/Clientes.jsx`, importar `derivaClienteEstado` y, por cada cliente al renderizar la fila, computar `const estado = derivaClienteEstado(c, obras.filter(o => o.clienteId === c.id || o.cliente === c.nombre), null);` y mostrar un chip de color (cliente=verde, prospecto=accent, inactivo=gris) en una columna. (No hace falta persistirlo; se deriva en vivo.)

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 4: Commit**

```bash
git add src/pages/comercial/Pipeline.jsx src/pages/Clientes.jsx
git commit -m "feat(comercial): timeline registra cambios de etapa del Kanban + estado derivado en tabla clientes"
```

---

## Cierre de la Fase 2

- [ ] **Toda la suite + build**

Run: `npm test` (incluye `derivaClienteEstado.test.js`) → todo verde. Luego `npm run build` → exitoso.

- [ ] **Integrar** (superpowers:finishing-a-development-branch): merge `feat/comercial-fase2` a `main` (o PR).

**Riesgos a respetar (del recon):** ComercialContext **debe** ser `atomic:true` (el bot escribe actividades); clientes legacy sin los 4 campos nuevos → tolerar con `|| []` / `?? 'prospecto'`; vínculo obra↔cliente dual (clienteId con fallback a nombre); no duplicar la actividad `cambio_etapa` (emitir sólo en el flujo del Kanban); adjuntos sólo URLs en v1 (sin bucket/subida).

**Fases siguientes (fuera de alcance):** Fase 3 (contrato + firma OTP en portal), Fase 4 (bot comercial + KPIs completos). Ver spec §8, §9, §10.
