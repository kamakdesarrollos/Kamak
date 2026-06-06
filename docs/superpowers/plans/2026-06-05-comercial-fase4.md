# Módulo Comercial — Fase 4 (Bot comercial + KPIs) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps usan checkbox (`- [ ]`).

**Goal:** Cerrar el CRM con (a) un **tablero de KPIs de ventas** (`/comercial/reportes`) y (b) las **4 automatizaciones del bot** de WhatsApp (recordar propuestas sin respuesta, reactivar inactivos, cargar/mover oportunidades por chat, avisar firma/visita al portal), con la **regla de apagado** del spec §8.

**Architecture:** KPIs como funciones **puras** en `src/lib/ventaKpis.js` (testeadas), renderizadas en `VentasReportes.jsx` (usa `etapaEfectiva`/`ccObra`/`PROBABILIDAD_POR_ETAPA` ya existentes). El bot: un **cron** nuevo `api/whatsapp/sales-followups.js` (self-contained, helpers inline) y un módulo `api/whatsapp/intents-comercial.js` para los intents, sin inflar `webhook.js`. Los avisos de firma/visita se enganchan en los endpoints de portal de Fase 3.

**Tech Stack:** Vercel serverless (crons) + WhatsApp (Meta) · Supabase RPC atómicos · React + Vitest. Reusa: `ETAPAS_VENTA`/`PROBABILIDAD_POR_ETAPA`/`DEFAULT_MESES_INACTIVO` (constants), `etapaEfectiva`/`resumenEmbudo`/`visibleEnEmbudo` (ventaEtapa.js), `ccObra`/`cobradoObraUSD` (helpers.js), `ComercialContext` (Fase 2), endpoints de portal (Fase 3).

**Referencia:** spec §8, §10.

**Notas de arquitectura (decisiones tomadas):**
- **Conversión pago→Ganado YA resuelta:** `VentaSync` (Fase 1) la hace global, y `etapaEfectiva` la reconcilia en el display. Los KPIs y el cron usan `etapaEfectiva`/chequeo directo de ingresos — **no** se centraliza nada nuevo en MovimientosContext.
- **Los serverless de `api/` NO pueden importar `src/`** (los crons declaran helpers inline). La **regla de apagado** se reimplementa en JS plano dentro del cron, espejo de `debeAvisarFollowup` de `ventaKpis.js`.
- **Escrituras del bot a `obras`:** atómicas (RPC `patch_item_in_shared_array` / `append_item_in_shared_array`, molde `appendMovimiento` en webhook.js) — nunca blob entero (LWW).

**Dependencias externas (NO bloquean el código; verificación en vivo):** templates Meta aprobados para los avisos fuera de ventana 24h; los intents y el cron se prueban con el bot real.

**Antes de empezar:** `git checkout -b feat/comercial-fase4` (desde main con Fase 1+2+3 mergeadas).

---

### Task 1: KPIs puros (`src/lib/ventaKpis.js`) — TDD

**Files:**
- Create: `src/lib/ventaKpis.js`
- Test: `src/lib/ventaKpis.test.js`

- [ ] **Step 1: Test que falla**

Crear `src/lib/ventaKpis.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { pipelinePonderado, agingDias, debeAvisarFollowup, motivosPerdida, winRatePorResponsable } from './ventaKpis';

const HOY = new Date('2026-06-05T00:00:00Z');

describe('pipelinePonderado', () => {
  it('suma monto × probabilidad por etapa (solo abiertas suman peso)', () => {
    const ops = [{ etapa: 'cotizado', montoUSD: 1000 }, { etapa: 'negociacion', montoUSD: 2000 }, { etapa: 'ganado', montoUSD: 5000 }];
    // 1000*0.40 + 2000*0.70 + 5000*1.0 = 400 + 1400 + 5000 = 6800
    expect(pipelinePonderado(ops)).toBe(6800);
  });
});

describe('agingDias', () => {
  it('días desde fechaCambioEtapa', () => {
    expect(agingDias({ venta: { fechaCambioEtapa: '2026-06-01' } }, HOY)).toBe(4);
  });
  it('sin fecha → null (no se cuenta)', () => {
    expect(agingDias({ venta: {} }, HOY)).toBe(null);
  });
});

describe('debeAvisarFollowup (regla de apagado §8)', () => {
  const base = { estado: 'en-presupuesto', venta: { etapa: 'cotizado', fechaCambioEtapa: '2026-05-01' } };
  it('avisa: cotizado, en-presupuesto, sin ingreso, > N días', () => {
    expect(debeAvisarFollowup(base, { tieneIngreso: false, hoy: HOY, dias: 5 })).toBe(true);
  });
  it('NO avisa si hay ingreso', () => {
    expect(debeAvisarFollowup(base, { tieneIngreso: true, hoy: HOY, dias: 5 })).toBe(false);
  });
  it('NO avisa si la obra ya no es en-presupuesto', () => {
    expect(debeAvisarFollowup({ ...base, estado: 'activa' }, { tieneIngreso: false, hoy: HOY, dias: 5 })).toBe(false);
  });
  it('NO avisa si la etapa es ganado/perdido', () => {
    expect(debeAvisarFollowup({ ...base, venta: { etapa: 'ganado' } }, { tieneIngreso: false, hoy: HOY, dias: 5 })).toBe(false);
  });
  it('NO avisa si lleva pocos días', () => {
    expect(debeAvisarFollowup({ ...base, venta: { etapa: 'cotizado', fechaCambioEtapa: '2026-06-03' } }, { tieneIngreso: false, hoy: HOY, dias: 5 })).toBe(false);
  });
});

describe('motivosPerdida', () => {
  it('rankea los motivos de las perdidas', () => {
    const obras = [
      { estado: 'archivada', venta: { etapa: 'perdido', motivoPerdida: 'precio' } },
      { estado: 'archivada', venta: { etapa: 'perdido', motivoPerdida: 'precio' } },
      { estado: 'archivada', venta: { etapa: 'perdido', motivoPerdida: 'otro proveedor' } },
    ];
    const r = motivosPerdida(obras);
    expect(r[0]).toEqual({ motivo: 'precio', count: 2 });
  });
});

describe('winRatePorResponsable', () => {
  it('cuenta ganadas/cerradas por responsable', () => {
    const ops = [
      { responsable: 'u1', etapa: 'ganado' }, { responsable: 'u1', etapa: 'perdido' },
      { responsable: 'u2', etapa: 'ganado' },
    ];
    const r = winRatePorResponsable(ops);
    expect(r.u1).toEqual({ ganadas: 1, perdidas: 1, winRate: 50 });
    expect(r.u2.winRate).toBe(100);
  });
});
```

- [ ] **Step 2: Correr → falla.** `npm test -- src/lib/ventaKpis.test.js` → FAIL.

- [ ] **Step 3: Implementar `src/lib/ventaKpis.js`**

```javascript
// KPIs del embudo de ventas (módulo Comercial). Lógica PURA, sin React.
import { PROBABILIDAD_POR_ETAPA } from './constants.js';

// Pipeline ponderado = Σ(montoUSD × probabilidad[etapa]) sobre las oportunidades.
export function pipelinePonderado(oportunidades) {
  return Math.round((oportunidades || []).reduce((s, op) => s + (op.montoUSD || 0) * (PROBABILIDAD_POR_ETAPA[op.etapa] || 0), 0));
}

// Días que una obra lleva en su etapa actual (desde venta.fechaCambioEtapa).
export function agingDias(obra, hoy = new Date()) {
  const f = obra?.venta?.fechaCambioEtapa;
  if (!f) return null;
  return Math.floor((hoy.getTime() - new Date(f).getTime()) / (1000 * 60 * 60 * 24));
}

// Regla de apagado (§8): avisar follow-up SOLO si la oportunidad está abierta,
// en-presupuesto, sin ingreso, en cotizado/negociación y lleva > N días.
export function debeAvisarFollowup(obra, { tieneIngreso = false, hoy = new Date(), dias = 5 } = {}) {
  if (!obra || obra.estado !== 'en-presupuesto') return false;
  const etapa = obra.venta?.etapa;
  if (etapa !== 'cotizado' && etapa !== 'negociacion') return false;
  if (tieneIngreso) return false;
  const aging = agingDias(obra, hoy);
  return aging != null && aging > dias;
}

// Ranking de motivos de pérdida (de las obras perdidas).
export function motivosPerdida(obras) {
  const m = {};
  for (const o of obras || []) {
    if (o?.venta?.etapa === 'perdido') {
      const mot = (o.venta.motivoPerdida || '(sin motivo)').trim() || '(sin motivo)';
      m[mot] = (m[mot] || 0) + 1;
    }
  }
  return Object.entries(m).map(([motivo, count]) => ({ motivo, count })).sort((a, b) => b.count - a.count);
}

// Win rate por responsable comercial (ganadas / cerradas).
export function winRatePorResponsable(oportunidades) {
  const r = {};
  for (const op of oportunidades || []) {
    const k = op.responsable || '(sin responsable)';
    r[k] = r[k] || { ganadas: 0, perdidas: 0, winRate: 0 };
    if (op.etapa === 'ganado') r[k].ganadas++;
    else if (op.etapa === 'perdido') r[k].perdidas++;
  }
  for (const k of Object.keys(r)) { const cerradas = r[k].ganadas + r[k].perdidas; r[k].winRate = cerradas > 0 ? Math.round((r[k].ganadas / cerradas) * 100) : 0; }
  return r;
}
```

- [ ] **Step 4: Correr → pasa.** `npm test -- src/lib/ventaKpis.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ventaKpis.js src/lib/ventaKpis.test.js
git commit -m "feat(comercial): KPIs puros de ventas (pipeline ponderado, aging, regla de apagado, motivos, win rate)"
```

---

### Task 2: Página de KPIs `VentasReportes.jsx` + ruta + sidebar

**Files:**
- Create: `src/pages/comercial/VentasReportes.jsx`
- Modify: `src/App.jsx` (lazy + Route), `src/components/layout/Sidebar.jsx` (item)

- [ ] **Step 1: Crear `src/pages/comercial/VentasReportes.jsx`**

```jsx
import { useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import PageLayout from '../../components/layout/PageLayout';
import PageHero from '../../components/ui/PageHero';
import { Box } from '../../components/ui';
import { T } from '../../theme';
import { useObras } from '../../store/ObrasContext';
import { useMovimientos } from '../../store/MovimientosContext';
import { useDolar } from '../../store/DolarContext';
import { useUsuarios } from '../../store/UsuariosContext';
import { useClientes } from '../../store/ClientesContext';
import { useComercial } from '../../store/ComercialContext';
import { ccObra, cobradoObraUSD } from '../obra/helpers';
import { etapaEfectiva, resumenEmbudo, visibleEnEmbudo, ETAPA_META } from '../../lib/ventaEtapa';
import { ETAPAS_VENTA } from '../../lib/constants';
import { pipelinePonderado, agingDias, motivosPerdida, winRatePorResponsable } from '../../lib/ventaKpis';
import { derivaClienteEstado } from '../../lib/derivaClienteEstado';
import { fmtN } from '../../lib/format';

const fmtU = (n) => `U$S ${fmtN(n)}`;
const Kpi = ({ label, value, sub, color }) => (
  <Box style={{ padding: '12px 16px' }}>
    <div style={{ fontSize: 9.5, color: T.ink3, fontFamily: T.fontMono, letterSpacing: 1, fontWeight: 700, textTransform: 'uppercase' }}>{label}</div>
    <div style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 22, color: color || T.ink, lineHeight: 1.1, marginTop: 2 }}>{value}</div>
    {sub && <div style={{ fontSize: 10.5, color: T.ink3, marginTop: 2 }}>{sub}</div>}
  </Box>
);

export default function VentasReportes() {
  const navigate = useNavigate();
  const { obras, getDetalle } = useObras();
  const { movimientos, cajas } = useMovimientos();
  const { dolarVenta } = useDolar();
  const { currentUser, usuarios } = useUsuarios();
  const { clientes } = useClientes();
  const { actividades } = useComercial();
  const tc = dolarVenta || 1070;

  const isAdmin = currentUser?.rol === 'Admin' || currentUser?.rol === 'Administración';
  useEffect(() => { if (currentUser && !isAdmin) navigate('/', { replace: true }); }, [currentUser, isAdmin, navigate]);

  const oportunidades = useMemo(() => obras.filter(visibleEnEmbudo).map(o => {
    const det = getDetalle(o.id);
    const cobradoUSD = cobradoObraUSD(movimientos, cajas, o.id, tc);
    const etapa = etapaEfectiva(o, { cobradoUSD });
    const { totalUSD, saldoUSD } = ccObra(o, det, movimientos, cajas, tc);
    return { obra: o, etapa, montoUSD: totalUSD, saldoUSD, responsable: o.venta?.responsable || null };
  }), [obras, movimientos, cajas, tc, getDetalle]);

  const resumen = useMemo(() => resumenEmbudo(oportunidades.map(o => o.etapa)), [oportunidades]);
  const abiertas = useMemo(() => oportunidades.filter(o => ['prospecto', 'cotizado', 'negociacion'].includes(o.etapa)), [oportunidades]);
  const pondUSD = useMemo(() => pipelinePonderado(abiertas), [abiertas]);
  const valorAbierto = useMemo(() => abiertas.reduce((s, o) => s + o.montoUSD, 0), [abiertas]);
  const ganadasUSD = useMemo(() => oportunidades.filter(o => o.etapa === 'ganado').reduce((s, o) => s + o.montoUSD, 0), [oportunidades]);
  const ticket = resumen.conteo.ganado > 0 ? Math.round(ganadasUSD / resumen.conteo.ganado) : 0;
  const motivos = useMemo(() => motivosPerdida(obras), [obras]);
  const winResp = useMemo(() => winRatePorResponsable(oportunidades), [oportunidades]);
  const agingTop = useMemo(() => abiertas.map(o => ({ nombre: o.obra.nombre, dias: agingDias(o.obra) })).filter(x => x.dias != null).sort((a, b) => b.dias - a.dias).slice(0, 6), [abiertas]);

  const estadosCliente = useMemo(() => {
    const c = { prospecto: 0, cliente: 0, inactivo: 0 };
    for (const cl of clientes) {
      const obrasCl = obras.filter(o => o.clienteId === cl.id || o.cliente === cl.nombre);
      const ult = (actividades || []).filter(a => a.clienteId === cl.id).map(a => a.fecha || a.creadoAt).sort().slice(-1)[0] || null;
      c[derivaClienteEstado(cl, obrasCl, ult)]++;
    }
    return c;
  }, [clientes, obras, actividades]);

  const nombreResp = (id) => (usuarios || []).find(u => u.id === id)?.nombre || id;

  return (
    <PageLayout breadcrumb={[{ label: 'Inicio', to: '/' }, { label: 'Comercial', to: '/comercial' }, 'KPIs Ventas']} active="KPIs Ventas">
      <PageHero label="COMERCIAL" title="KPIs de ventas"
        subtitle={`${abiertas.length} oportunidades abiertas · conversión ${resumen.conversion}% · pipeline U$S ${fmtN(valorAbierto)}`} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 16 }}>
        <Kpi label="Conversión" value={`${resumen.conversion}%`} sub={`${resumen.conteo.ganado} ganadas / ${resumen.cerradas} cerradas`} color={T.ok} />
        <Kpi label="Tasa de pérdida" value={`${resumen.cerradas > 0 ? Math.round(resumen.conteo.perdido / resumen.cerradas * 100) : 0}%`} sub={`${resumen.conteo.perdido} perdidas`} color="#b91c1c" />
        <Kpi label="Pipeline abierto" value={fmtU(valorAbierto)} sub={`${abiertas.length} oportunidades`} color={T.accent} />
        <Kpi label="Pipeline ponderado" value={fmtU(pondUSD)} sub="por probabilidad de etapa" color={T.accent2} />
        <Kpi label="Ganado" value={fmtU(ganadasUSD)} sub={`ticket prom. ${fmtU(ticket)}`} color={T.ok} />
        <Kpi label="Clientes" value={`${estadosCliente.cliente}`} sub={`${estadosCliente.prospecto} prospectos · ${estadosCliente.inactivo} inactivos`} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {/* Embudo por etapa */}
        <Box style={{ padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Embudo por etapa</div>
          {ETAPAS_VENTA.map(e => (
            <div key={e} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: ETAPA_META[e].color, flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 12, color: T.ink }}>{ETAPA_META[e].label}</span>
              <span style={{ fontFamily: T.fontMono, fontWeight: 700, fontSize: 13, color: ETAPA_META[e].color }}>{resumen.conteo[e]}</span>
            </div>
          ))}
        </Box>

        {/* Aging — oportunidades estancadas */}
        <Box style={{ padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Más estancadas (días en etapa)</div>
          {agingTop.length === 0 && <div style={{ fontSize: 12, color: T.ink3 }}>—</div>}
          {agingTop.map(x => (
            <div key={x.nombre} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
              <span style={{ color: T.ink }}>{x.nombre}</span>
              <span style={{ fontFamily: T.fontMono, fontWeight: 700, color: x.dias > 14 ? '#b91c1c' : T.ink2 }}>{x.dias}d</span>
            </div>
          ))}
        </Box>

        {/* Motivos de pérdida */}
        <Box style={{ padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Motivos de pérdida</div>
          {motivos.length === 0 && <div style={{ fontSize: 12, color: T.ink3 }}>Sin pérdidas registradas.</div>}
          {motivos.map(m => (
            <div key={m.motivo} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
              <span style={{ color: T.ink }}>{m.motivo}</span>
              <span style={{ fontFamily: T.fontMono, fontWeight: 700, color: T.ink2 }}>{m.count}</span>
            </div>
          ))}
        </Box>

        {/* Por responsable */}
        <Box style={{ padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Win rate por responsable</div>
          {Object.entries(winResp).map(([id, r]) => (
            <div key={id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
              <span style={{ color: T.ink }}>{nombreResp(id)}</span>
              <span style={{ fontFamily: T.fontMono, fontWeight: 700, color: T.ok }}>{r.winRate}% <span style={{ color: T.ink3, fontWeight: 400 }}>({r.ganadas}/{r.ganadas + r.perdidas})</span></span>
            </div>
          ))}
        </Box>
      </div>
    </PageLayout>
  );
}
```

- [ ] **Step 2: Ruta en `App.jsx`**

Lazy import (junto a `Pipeline`): `const VentasReportes = lazy(() => import('./pages/comercial/VentasReportes'));`
Route (DESPUÉS de `/comercial`): `<Route path="/comercial/reportes" element={<VentasReportes />} />`

- [ ] **Step 3: Item en `Sidebar.jsx`**

En la sección Comercial de `ALL_ITEMS`, después de `Embudo` (verificar que no exista ya): `{ icon: '📈', label: 'KPIs Ventas', path: '/comercial/reportes', allowedRoles: ['Admin', 'Administración'] },`

- [ ] **Step 4: Build + commit**

```bash
npm run build
git add src/pages/comercial/VentasReportes.jsx src/App.jsx src/components/layout/Sidebar.jsx
git commit -m "feat(comercial): tablero de KPIs de ventas (/comercial/reportes)"
```

---

### Task 3: Cron `sales-followups.js` (automatizaciones 1 + 4)

**Files:**
- Create: `api/whatsapp/sales-followups.js`
- Modify: `vercel.json` (cron)

- [ ] **Step 1: Crear el cron** (self-contained; molde de `payment-reminders.js` + `daily-summary.js`)

```javascript
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
```

- [ ] **Step 2: Registrar en `vercel.json`** (array `crons`, junto a daily-summary/payment-reminders):

```json
    { "path": "/api/whatsapp/sales-followups", "schedule": "0 12 * * 1-5" }
```

- [ ] **Step 3: Build + commit**

```bash
npm run build
git add api/whatsapp/sales-followups.js vercel.json
git commit -m "feat(comercial/bot): cron sales-followups (propuestas sin respuesta + reactivar inactivos, regla de apagado)"
```

---

### Task 4: Intents del bot (automatización 3)

**Files:**
- Create: `api/whatsapp/intents-comercial.js`
- Modify: `api/whatsapp/extractors.js`, `api/whatsapp/webhook.js` (wiring mínimo)

- [ ] **Step 1: Módulo `api/whatsapp/intents-comercial.js`** (crear/mover oportunidad, escrituras atómicas, solo Admin)

```javascript
// Acciones comerciales del bot: crear prospecto y mover etapa de una obra.
// Escrituras atómicas (RPC) para no pisar a la app. Solo Admin.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const sbH = () => ({ apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' });
async function loadSharedData(key) { const r = await fetch(`${SUPABASE_URL}/rest/v1/shared_data?key=eq.${key}&select=data`, { headers: sbH() }); const rows = await r.json(); return rows[0]?.data ?? null; }
async function rpc(fn, args) { const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: sbH(), body: JSON.stringify(args) }); return r.ok; }
async function saveSharedData(key, data) { await fetch(`${SUPABASE_URL}/rest/v1/shared_data?on_conflict=key`, { method: 'POST', headers: { ...sbH(), Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ key, data }) }); }
const newId = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export async function crearProspecto({ nombreObra, clienteNombre, usuario }) {
  const obrasData = (await loadSharedData('obras')) || { obras: [], detalles: {} };
  const clientes = (await loadSharedData('clientes')) || [];
  const cliente = clientes.find(c => (c.nombre || '').toLowerCase() === (clienteNombre || '').toLowerCase());
  const today = new Date().toISOString().slice(0, 10);
  const nueva = {
    id: newId('obra'), nombre: nombreObra, cliente: cliente?.nombre || clienteNombre || '', clienteId: cliente?.id || null,
    estado: 'en-presupuesto', moneda: 'USD', presupuesto: 0, gastado: 0, avance: 0, margen: 0, direccion: '', tipo: 'Otro',
    venta: { etapa: 'prospecto', responsable: usuario || null, origen: 'whatsapp', fechaCambioEtapa: today, motivoPerdida: null, changelog: [{ etapa: 'prospecto', fecha: today, usuario: usuario || 'bot' }] },
    createdAt: new Date().toISOString(), created_by: usuario || 'bot',
  };
  const ok = await rpc('patch_item_in_shared_object', { p_key: 'obras', p_field: 'obras', p_id: nueva.id, p_patch: nueva });
  if (!ok) { obrasData.obras = [...(obrasData.obras || []), nueva]; await saveSharedData('obras', obrasData); }
  return nueva;
}

export async function moverEtapaObra({ obraNombre, etapaNueva, usuario }) {
  const obrasData = (await loadSharedData('obras')) || { obras: [] };
  const obra = (obrasData.obras || []).find(o => (o.nombre || '').toLowerCase().includes((obraNombre || '').toLowerCase()));
  if (!obra) return { error: 'obra_no_encontrada' };
  const today = new Date().toISOString().slice(0, 10);
  const venta = { ...(obra.venta || {}), etapa: etapaNueva, fechaCambioEtapa: today, changelog: [...((obra.venta || {}).changelog || []), { etapa: etapaNueva, fecha: today, usuario: usuario || 'bot' }] };
  const cambios = { venta };
  if (etapaNueva === 'ganado') cambios.estado = obra.estado === 'finalizada' ? 'finalizada' : 'activa';
  if (etapaNueva === 'perdido') cambios.estado = 'archivada';
  const ok = await rpc('patch_item_in_shared_object', { p_key: 'obras', p_field: 'obras', p_id: obra.id, p_patch: cambios });
  if (!ok) { obrasData.obras = obrasData.obras.map(o => o.id === obra.id ? { ...o, ...cambios } : o); await saveSharedData('obras', obrasData); }
  // Actividad en el timeline.
  const acts = (await loadSharedData('crm_actividades')) || [];
  acts.unshift({ id: newId('act'), clienteId: obra.clienteId || null, obraId: obra.id, tipo: 'cambio_etapa', texto: `Movida a ${etapaNueva} — ${obra.nombre} (bot)`, fecha: new Date().toISOString(), usuario: usuario || 'bot', adjuntos: [], creadoAt: new Date().toISOString(), actualizadoAt: new Date().toISOString() });
  await saveSharedData('crm_actividades', acts);
  return { obra: obra.nombre, etapa: etapaNueva };
}
```

> **Nota:** confirmá el nombre real del RPC de patch por id en objeto (`patch_item_in_shared_object` u otro) en `supabase/migrations/0002`. Si no existe, el fallback read-modify-write ya está. El RPC es preferible (atómico) — investigá y usá el correcto.

- [ ] **Step 2: Intents en `extractors.js`** — agregar keywords para `crear_prospecto` ('nuevo prospecto', 'prospecto nuevo') y `mover_etapa` ('pasá a', 'pasar a', 'mover a', 'a ganado', 'a perdido'), siguiendo el patrón de `INTENT_KEYWORDS`/`extractIntent` existente. Extraer slots: nombre de obra y cliente (prospecto) / nombre de obra y etapa destino (mover).

- [ ] **Step 3: Wiring en `webhook.js`** — registrar las acciones en el systemPrompt (ACCIONES DISPONIBLES) y, donde se ejecutan las acciones confirmadas, delegar a `crearProspecto`/`moverEtapaObra` de `intents-comercial.js`. **Gate: solo si `user.user_rol === 'Admin'`** (un Administración no crea obras por chat). No inflar el handler: importar y delegar.

- [ ] **Step 4: Build + commit**

```bash
npm run build
git add api/whatsapp/intents-comercial.js api/whatsapp/extractors.js api/whatsapp/webhook.js
git commit -m "feat(comercial/bot): intents crear_prospecto y mover_etapa (modulo aparte, escrituras atomicas, solo Admin)"
```

---

### Task 5: Avisos de firma/visita al portal (automatización 2)

**Files:** Modify `api/portal/firmar.js` (aviso al firmar) y `api/portal/data.js` (aviso al abrir el portal) — endpoints de Fase 3

- [ ] **Step 1: Helper de aviso al admin** — agregar a `firmar.js` (y reusar en `data.js`) una función `avisarAdmins(texto)` que busca admins (app_users rol Admin + whatsapp_users) y manda `sendWA`. Llamarla:
- en `firmar.js`, tras firmar: `await avisarAdmins(\`✍️ ${nombre} firmó el contrato de ${obra.nombre}\`)`.
- en `data.js` / `validate-token.js`, al validar el token (best-effort, **una vez por día por obra** para no inundar): `portal_abierto`.

> Si agregar el "una vez por día" complica, dejar **solo** el aviso de firma (el más valioso) y diferir el de visita.

- [ ] **Step 2: Build + commit**

```bash
npm run build
git add api/portal/firmar.js api/portal/data.js
git commit -m "feat(comercial/bot): aviso al admin cuando el cliente firma el contrato"
```

---

### Task 6: Verificación final

- [ ] **Step 1:** `npm test` (incluye `ventaKpis.test.js`) → verde. `npm run build` → exitoso.
- [ ] **Step 2:** Smoke del cron: `curl ".../api/whatsapp/sales-followups?secret=..."` (en prod) → JSON con estancadas/inactivos.
- [ ] **Step 3 (verificación humana, requiere bot/Meta en vivo):** probar los 2 intents ("nuevo prospecto Shell Ruta 3 cliente Pérez" → confirmar → obra creada en-presupuesto/prospecto; "pasá Shell Ruta 3 a ganado" → etapa movida + actividad). Verificar que tras un ingreso la oportunidad sale del filtro del cron.
- [ ] **Step 4: Integrar** (superpowers:finishing-a-development-branch): merge `feat/comercial-fase4` a `main`.

**Dependencias externas / verificación humana:** templates Meta para avisos fuera de ventana 24h; los crons necesitan `CRON_SECRET` y las env de Meta en Vercel; los intents se prueban con el bot real. **CRM completo** tras esta fase (Fases 1-4).
