# PWA Fase 1 — ERP instalable (app shell) — Design

> Estado: aprobado (brainstorming 2026-06-24). Fase 2 (push notifications) se diseña aparte.

## Objetivo

Que el ERP (`app.kamak.com.ar`, Vite+React en Vercel) sea **instalable** como PWA en
celu/desktop, con carga rápida (app shell precacheado) y **auto-update inmediato** al deployar.
**Sin** offline de datos (la app es de datos en vivo con Supabase).

## Decisiones (brainstorming)

- **App:** solo el ERP. **Alcance:** instalable + rápido (push = Fase 2).
- **Auto-update:** automático e inmediato en todos los dispositivos (`registerType: 'autoUpdate'` +
  recarga al detectar nueva versión). Trade-off aceptado: puede recargar en un momento inoportuno.
- **Ícono:** logo de marca (wordmark bitono blanco+teal) sobre **círculo oscuro `#171818`**. Generado
  con `@resvg/resvg-js` (dev-dep, script `scripts/_gen_pwa_icons.mjs`); PNG commiteados en `public/`.
- **Datos en vivo:** el service worker **NO cachea `/api/*` ni Supabase** (network-only). Solo
  precachea el app shell (JS/CSS/HTML).

## Arquitectura

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `scripts/_gen_pwa_icons.mjs` | Creado ✓ | Genera los PNG de ícono desde el logo (corre una vez). |
| `public/pwa-192.png`, `pwa-512.png`, `pwa-maskable-512.png`, `apple-touch-icon.png` | Creados ✓ | Íconos (any + maskable + apple). |
| `vite.config.js` | Modificar | Sumar `VitePWA({...})`: manifest + Workbox (autoUpdate, precache shell, no-cache API). |
| `index.html` | Modificar | Metas `theme-color`, `apple-touch-icon`, `apple-mobile-web-app-*`. |
| `src/main.jsx` | Modificar | Registrar el SW (`virtual:pwa-register`) con `immediate: true` + recarga en update. |
| `package.json` | (dev-dep) | `vite-plugin-pwa`, `@resvg/resvg-js`. |

### Manifest (VitePWA)
```
name: 'Kamak · Software de Gestión de Obras'
short_name: 'Kamak'
description: 'Gestión de obras — presupuestos, contratos, caja y obra.'
theme_color: '#1a9b9c'   background_color: '#171818'
display: 'standalone'    lang: 'es'   start_url: '/'   scope: '/'
icons: [pwa-192 (any), pwa-512 (any), pwa-maskable-512 (maskable), apple-touch-icon]
```

### Workbox (generateSW)
- `registerType: 'autoUpdate'`, `clientsClaim: true`, `skipWaiting: true`.
- `globPatterns`: precache de `**/*.{js,css,html,svg,png,woff2}` del build.
- `navigateFallback: '/index.html'` (SPA), con `navigateFallbackDenylist: [/^\/api/]`.
- `runtimeCaching`: NINGÚN cache para `/api/*` ni dominios de Supabase → siempre red.

### Update inmediato (`src/main.jsx`)
```js
import { registerSW } from 'virtual:pwa-register';
registerSW({ immediate: true, onNeedRefresh() { updateSW(true); /* recarga ya */ } });
```
(Con `autoUpdate` el plugin ya hace skipWaiting+claim; `updateSW(true)` fuerza la recarga inmediata.)

## Verificación

- Es **configuración/build** → no hay lógica unit-testeable (sin TDD, como marca la skill TDD para config).
- `npm run build` debe emitir `dist/sw.js` + `dist/manifest.webmanifest` sin errores; la suite (575) sigue verde.
- Post-deploy: en Chrome/Android aparece "Instalar app"; en iOS Safari → Compartir → Agregar a inicio
  muestra el ícono Kamak; abre en standalone; al deployar una versión nueva, la app instalada recarga sola.

## No-incluye
- Push notifications (Fase 2). Offline de datos (no es objetivo). La web pública (otro repo).
