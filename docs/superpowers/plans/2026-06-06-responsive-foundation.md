# Responsive mobile — Fundación (Fase 0-3) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps con checkbox.

**Goal:** Dar la base responsive para que TODA la app de Kamak se use cómodo desde el celular: hook `useIsMobile`, tokens de breakpoints, CSS global de primitives (tap targets + modales fullscreen), y el shell mobile (sidebar como drawer + topbar con hamburguesa).

**Architecture:** Híbrido. (1) **CSS media queries** en `src/index.css` para todo lo que ya es clase (`.k-btn/.k-field/.k-tab/.k-chip/.k-modal/.k-content/.k-sidebar`) — cubre primitives y modales sin tocar JSX. (2) **Hook `useIsMobile()`** (`window.matchMedia`) para lo inline-styled que el CSS no alcanza (grids/flex inline, drawer). Mobile-last (todo bajo `@media (max-width: ...)`, el desktop no se toca). Breakpoints: mobile ≤640, tablet ≤1024, drawer ≤768.

**Tech Stack:** React 19 + Vite, estilos inline + clases `.k-*`. No se refactorizan los ~4117 inline styles; se ataca por capas de impacto.

**Regla de oro:** sólo tocar **presentación/layout** (estilos + render condicional). NUNCA tocar handlers de guardado/lógica.

**Branch:** ya estás en `feat/responsive-mobile`.

---

### Task 1 (Fase 0): Hook responsive + tokens de breakpoints

**Files:**
- Create: `src/hooks/useMediaQuery.js`
- Modify: `src/theme.js` (agregar `BREAKPOINTS`)

- [ ] **Step 1: Crear `src/hooks/useMediaQuery.js`**

```javascript
import { useState, useEffect } from 'react';

// Hook responsive basado en window.matchMedia. SSR-safe (lazy initializer que
// asume desktop si no hay window). Re-renderiza al cruzar el breakpoint.
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = (e) => setMatches(e.matches);
    setMatches(mql.matches);
    // addEventListener moderno con fallback a addListener (Safari viejo).
    if (mql.addEventListener) mql.addEventListener('change', onChange);
    else mql.addListener(onChange);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', onChange);
      else mql.removeListener(onChange);
    };
  }, [query]);

  return matches;
}

// Atajo: ¿estamos en pantalla "no-desktop" (celular/tablet chica)? Corte 768px:
// es la línea para decisiones binarias en JS (drawer vs sidebar, 1 col vs N col).
export function useIsMobile() {
  return useMediaQuery('(max-width: 768px)');
}
```

- [ ] **Step 2: Agregar `BREAKPOINTS` a `src/theme.js`**

Al final del objeto `T` (o como export aparte), agregar:

```javascript
// Breakpoints compartidos JS/CSS (mobile-last). El hook useIsMobile usa 768.
export const BREAKPOINTS = { mobile: 640, drawer: 768, tablet: 1024 };
```

- [ ] **Step 3: Build + commit**

Run: `npm run build` → exitoso.
```bash
git add src/hooks/useMediaQuery.js src/theme.js
git commit -m "feat(responsive): hook useMediaQuery/useIsMobile + tokens BREAKPOINTS"
```

---

### Task 2 (Fase 1): CSS global de primitives + modales fullscreen

**Files:**
- Modify: `src/index.css` (agregar un bloque `@media` al final, después de la media query existente ~línea 298)

- [ ] **Step 1: Leer el final de `src/index.css`** para confirmar los nombres reales de las clases (`.k-btn`, `.k-btn-sm`, `.k-field`, `.k-tab`/`.k-tabs`, `.k-chip`, `.k-modal`, `.k-modal-overlay`, `.k-content`, `.k-sidebar`). Ajustar el bloque siguiente a los nombres que existan.

- [ ] **Step 2: Agregar el bloque responsive al final de `src/index.css`**

```css
/* ───────────────────────────────────────────────────────────────────────────
   RESPONSIVE (mobile-last). Sólo afecta ≤768/≤640; el desktop queda intacto.
   Cubre tap targets, modales fullscreen y el padding del contenido.
   Las grillas/flex inline NO se tocan acá (van por el hook useIsMobile en JS).
   ─────────────────────────────────────────────────────────────────────────── */

/* Tablet: sidebar más angosto y contenido con menos padding. */
@media (max-width: 1024px) {
  .k-sidebar { width: 132px; font-size: 11.5px; }
  .k-content { padding: 14px; }
}

/* Mobile: tap targets cómodos para el dedo (mín. ~40px de alto). */
@media (max-width: 768px) {
  .k-btn { padding: 9px 14px; font-size: 14px; min-height: 40px; }
  .k-btn-sm { padding: 7px 11px; font-size: 13px; min-height: 36px; }
  .k-field, .k-input, input.k-input, select.k-field { min-height: 40px; font-size: 16px; } /* 16px evita zoom en iOS */
  .k-tab { min-height: 42px; padding: 11px 14px; }
  .k-chip { min-height: 30px; }
  .k-content { padding: 12px; }
}

/* Modales: en celular van fullscreen (vence el width inline del componente Modal).
   Usar 100dvh para no quedar tapado por el teclado virtual; contenido scrollable. */
@media (max-width: 640px) {
  .k-modal-overlay { padding: 0 !important; align-items: stretch !important; }
  .k-modal {
    width: 100% !important;
    max-width: none !important;
    min-height: 100dvh;
    max-height: 100dvh;
    border-radius: 0 !important;
    margin: 0 !important;
    overflow-y: auto;
  }
}
```

> Si las clases reales difieren (p.ej. el input usa otra clase), adaptá los selectores a los que existan en `index.css`. No inventes clases que no se usan.

- [ ] **Step 3: Build + commit**

Run: `npm run build` → exitoso. Verificar (dev) en desktop que NADA cambió (todo bajo `@media`).
```bash
git add src/index.css
git commit -m "feat(responsive): CSS global de tap targets + modales fullscreen en mobile"
```

---

### Task 3 (Fase 2): Shell mobile — sidebar drawer + topbar hamburguesa

**Files:**
- Modify: `src/components/layout/PageLayout.jsx` (estado drawer + render condicional)
- Modify: `src/components/layout/Topbar.jsx` (botón hamburguesa + modo compacto en mobile)
- Modify: `src/components/layout/Sidebar.jsx` (prop `onNavigate` para autocerrar el drawer)

- [ ] **Step 1: `Sidebar.jsx` — autocerrar al navegar**

Aceptar una prop `onNavigate` y llamarla tras `navigate(it.path)`:
```jsx
export default function Sidebar({ active, onNavigate }) {
  ...
  onClick={() => { if (it.path) { navigate(it.path); onNavigate?.(); } }}
```

- [ ] **Step 2: `PageLayout.jsx` — drawer en mobile**

Leer el archivo real. Introducir `useIsMobile` + estado `drawerOpen`. En desktop: render igual (sidebar en flujo). En mobile: el `<Sidebar>` NO va en flujo; se muestra como overlay fijo cuando `drawerOpen`, con backdrop. Pasar `onHamburger` al Topbar y `onNavigate={() => setDrawerOpen(false)}` al Sidebar.

```jsx
import { useState } from 'react';
import { useIsMobile } from '../../hooks/useMediaQuery';
// ...
export default function PageLayout({ children, breadcrumb, active }) {
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);
  return (
    <div className="k-page" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Topbar breadcrumb={breadcrumb} isMobile={isMobile} onHamburger={() => setDrawerOpen(v => !v)} />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
        {!isMobile && <Sidebar active={active} />}
        {isMobile && drawerOpen && (
          <>
            <div onClick={() => setDrawerOpen(false)}
              style={{ position: 'fixed', inset: 0, top: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1400 }} />
            <div style={{ position: 'fixed', left: 0, top: 0, bottom: 0, width: 'min(82vw, 300px)', zIndex: 1401, boxShadow: '4px 0 24px rgba(0,0,0,0.3)', overflowY: 'auto' }}>
              <Sidebar active={active} onNavigate={() => setDrawerOpen(false)} />
            </div>
          </>
        )}
        <div className="k-content" style={{ padding: isMobile ? 12 : 18, background: '#fbf8ef', position: 'relative', flex: 1, overflow: 'auto' }}>
          {children}
        </div>
      </div>
    </div>
  );
}
```

> Ajustar a la firma/props reales de PageLayout (puede tener más props). Mantener el comportamiento desktop idéntico.

- [ ] **Step 3: `Topbar.jsx` — hamburguesa + compacto en mobile**

Aceptar `isMobile` + `onHamburger`. En mobile: mostrar un botón ☰ (izquierda) que llama `onHamburger`; **ocultar** el breadcrumb y el bloque ancho (dólar/búsqueda inline), dejando ☰ + logo + campana + avatar compacto. NO eliminar "Salir": si estaba en el topbar, moverlo al drawer o dejar el avatar con su menú. Reducir `gap`/`padding` en mobile.

```jsx
{isMobile && (
  <button onClick={onHamburger} aria-label="Menú"
    style={{ background: 'none', border: 'none', color: '#fff', fontSize: 22, cursor: 'pointer', padding: '4px 8px', lineHeight: 1 }}>☰</button>
)}
{/* breadcrumb y bloques anchos: envolver con {!isMobile && ( ... )} */}
```

- [ ] **Step 4: Build + verificación**

Run: `npm run build` → exitoso. Dev: en ≤768px el sidebar desaparece y aparece ☰; al tocarlo abre el drawer; al elegir un ítem navega y cierra. En desktop, todo igual.

- [ ] **Step 5: Commit**
```bash
git add src/components/layout/PageLayout.jsx src/components/layout/Topbar.jsx src/components/layout/Sidebar.jsx
git commit -m "feat(responsive): shell mobile — sidebar drawer + topbar hamburguesa"
```

---

### Task 4 (Fase 3): Primitives JSX restantes — PageHero + Modal

**Files:**
- Modify: `src/components/ui/PageHero.jsx`
- Modify: `src/components/ui/Modal.jsx`

- [ ] **Step 1: `PageHero.jsx` — KPIs y título responsive**

La grilla de KPIs `gridTemplateColumns: repeat(${kpis.length}, 1fr)` se desborda en mobile. Cambiar a auto-fit:
```jsx
gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))'
```
Título: `fontSize: 'clamp(15px, 4.5vw, 22px)'` (ajustar al tamaño actual). Las acciones (botones a la derecha): que envuelvan/apilen en mobile (`flexWrap: 'wrap'`).

- [ ] **Step 2: `Modal.jsx` — ancho seguro (el CSS hace el fullscreen)**

El `.k-modal` con el `@media` de Task 2 ya lo vuelve fullscreen en ≤640. Para 641-768 (tablet chica), evitar que un `width={560}` inline se pase del viewport: cambiar el width inline a `min(94vw, ${width}px)`.
```jsx
// donde aplica el width inline del modal:
style={{ width: `min(94vw, ${width}px)`, ... }}
```

- [ ] **Step 3: Build + commit**
```bash
npm run build
git add src/components/ui/PageHero.jsx src/components/ui/Modal.jsx
git commit -m "feat(responsive): PageHero (KPIs auto-fit) + Modal (ancho seguro) responsive"
```

---

## Cierre de la fundación

- [ ] `npm test` (no debería romper nada; son cambios visuales) + `npm run build` exitoso.
- [ ] Verificación dev en 375px y 768px: shell drawer OK, modales fullscreen, botones tocables, sin scroll horizontal global en el chrome.

**Sigue (fases posteriores, otros planes/workflows):** Fase 4 (Grupo B/C/E: Obras, Dashboard, Movimientos, Pipeline, VentasReportes, formularios), Fase 5 (Grupo A: tablas anchas → cards: Clientes, Proveedores, Usuarios, Cajas, CuentasPorPagar), Fase 6 (Grupo D mega-páginas: ObraPresupuesto, Catalogos, Facturacion, ObraGantt), Fase 7 (Portal cliente/proveedor), Fase 8 (auditoría 320/375/768/1024 px). Todas reusan el hook + las clases + los patrones canónicos de esta fundación.
