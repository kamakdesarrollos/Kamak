# Web pública Kamak + integración con el software — Diseño

> **Fecha:** 2026-06-10 · **Autor:** Franco + Claude Code · **Estado:** En revisión
> **Repos involucrados:** `kamak` (ERP React/Supabase — fuente de verdad) · `kamak-web` (sitio Angular 19 — repo compartido de CandeLandi)

## 1. Objetivo

Implementar el **rediseño de la web pública de Kamak** (mockup ya cerrado, 100% navegable) dentro del repo Angular `kamak-web`, **conectado a datos reales del ERP `app.kamak`**, con un flujo donde:

> El usuario carga/edita una obra en `app.kamak` → toca **"Publicar"** → la obra aparece en la web pública con datos reales: nombre, m², tiempo de obra, fotos antes/después, galería, ubicación en el mapa.

Además, **cargar masivamente todas las obras históricas** (Drive + carpeta local `Obras` + planilla CHECK LIST) dentro del ERP como `finalizada`, despublicadas, para que el usuario las cure y publique.

## 2. Hallazgo de arquitectura (la decisión que ordena todo)

Existen **dos backends distintos** y la web hoy usa el equivocado para esta visión:

| | **ERP `app.kamak`** (React + Supabase) | **`api.rakium.dev`** (Node/Express del dev) |
|---|---|---|
| Rol | Software propio, fuente de verdad | Alimenta la web Angular **hoy** |
| Obras | `Gallo Negro`, `CAGLE-ELENA`, `La Lucila-Fan de pan` (= `finalizada`) | "Projects" en **otra base** — las obras del ERP **no están acá** |
| Campos web | ❌ sin m²/marca/coords/antes-después/publicar | ✅ ya tiene antes/después, galería, área, días, lat/lng, PUBLISHED/DRAFT |

**Decisión tomada:** la web se **re-apunta al ERP**. El ERP es la única fuente de verdad; se deja de depender de `api.rakium.dev` para las obras. (El admin Angular de `kamak-web` que gestiona projects de rakium queda fuera de uso para obras; no se borra en esta pasada.)

## 3. Arquitectura objetivo

```
┌────────────────────────┐         ┌─────────────────────────────────────┐
│  app.kamak (ERP React)  │         │  kamak-web (Angular 19, sitio)       │
│  Supabase shared_data   │         │  Home · Obras · Obra (mockup)        │
│  obras[] + obra.web{}    │         │                                     │
│                         │         │   ProjectsService ─┐                 │
│  Editor de obra + botón │         │   (re-apuntado)    │                 │
│  PUBLICAR ──────────────┼────┐    │                    ▼                 │
└────────────┬────────────┘    │    │   GET /api/public/obras  ◄──────────┼─┐
             │ SERVICE_KEY      │    │   GET /api/public/obras/:slug        │ │
             ▼                  │    │                                      │ │
   kamak/api/public/obras  ─────┴────┼──► (whitelist sanitizado: sin costos)│ │
   kamak/api/public/leads  ◄─────────┼─── POST  (form de contacto)          │ │
             │                       │        │ + fallback WhatsApp          │ │
             ▼                       └────────┼──────────────────────────────┘ │
   shared_data['obras'] (venta.origen:'web') ◄┘   Storage kamak-fotos (público)─┘
   → embudo Comercial (Kanban, Prospecto)         (fotos antes/después/galería)
```

**Patrón ya probado:** el endpoint del portal del cliente (`kamak/api/portal/data.js`) ya lee `shared_data` con `SERVICE_KEY` y devuelve un whitelist sanitizado. Los endpoints nuevos siguen exactamente ese patrón (sin abrir RLS a `anon`, sin exponer costos/márgenes).

## 4. Workstreams (áreas de trabajo)

Cada área se construye con **agente constructor + auditor adversarial** dedicado (ver §10).

### A. Modelo de datos — extensión de la obra (ERP)
Agregar un sub-objeto `obra.web` (no ensucia los campos operativos) + flag de origen:

```js
obra.web = {
  publicar:    false,            // ← el botón "Publicar"
  slug:        'baradero-costa-parana',
  destacada:   false,            // aparece en grilla destacada del home
  orden:       0,
  categoria:   'tienda' | 'comercial',
  marca:       'Shop Express' | 'Super 7' | 'YPF' | 'Shell' | '' ,
  m2:          260 | null,
  localidad:   'Baradero',
  provincia:   'Buenos Aires',
  coords:      { lat, lng } | null,
  antes:       true,             // true → slider antes/después · false → galería
  imageBefore: url | null,
  imageAfter:  url | null,
  gallery:     [{ url, caption, orden }],
  portada:     url | null,
  texto:       ['parrafo 1', 'parrafo 2'],   // copy marketing
  diasOverride: number | null    // si no, se deriva de fechaInicio→fechaFin
}
obra.origen = 'seed-drive' | 'seed-obras' | 'manual'  // las históricas no ensucian caja/dashboards
```
- `estado:'finalizada'` ya existe en el ERP.
- Las vistas operativas (caja, presupuesto, dashboards) filtran `origen` distinto de `'manual'` para no mezclar las históricas de showcase.
- Migración de datos retro-compatible: `obra.web` y `obra.origen` son opcionales; obras sin ellos siguen funcionando.

### B. Endpoints públicos del ERP
Nuevos serverless en `kamak/api/public/` (mismo dominio del ERP, patrón `portal/data.js`, `SUPABASE_SERVICE_KEY`, CORS al origen del sitio, sin secretos en el bundle):

- **`GET /api/public/obras`** → lista solo `web.publicar:true`. Whitelist por obra:
  `{ slug, titulo, nombre, localidad, provincia, marca, categoria, m2, dias, antes, imageBefore, imageAfter, gallery:[url], portada, coords, texto, destacada, orden, fechaFin }`.
  **Nunca** devuelve costos, márgenes, presupuesto, gastado, cuotas, contratos, movimientos, cliente sensible.
- **`GET /api/public/obras/:slug`** → idem, una obra.
- **`POST /api/public/leads`** → crea lead en el embudo Comercial. Body del form → obra-lead:
  ```js
  { id:`obra-${ts}`, nombre, cliente, direccion:ubicacion, tipo, presupuesto:0,
    notas:(tipo + m² + plazo + marca + mensaje), esLead:true, estado:'en-presupuesto', createdAt,
    venta:{ etapa:'prospecto', origen:'web', fechaCambioEtapa, changelog:[{etapa:'prospecto',fecha,usuario:'sistema'}] } }
  ```
  Persistido vía la RPC existente `append_shared_object_item('obras','obras', nueva)` + un item en `crm_actividades`. **Rate-limit + honeypot/captcha** contra spam. Notificación opcional a Franco por el bot de WhatsApp.

### C. Re-apuntado + port visual Angular (Home · Obras · Obra)
- **Reemplazo total** del sitio público actual; se conserva 100% el data-layer/admin (que se re-apunta).
- Reescribir `ProjectsService` (o un nuevo `ObrasPublicService`) para pegarle a `/api/public/obras` del ERP en vez de `api.rakium.dev`. Mapper API→vista.
- Nuevos componentes: `pages/home` (reescrito), `pages/obras` (índice filtrable, ruta `obras`), `pages/obra` (case study, ruta `obras/:slug`, reusando/reescribiendo `landing-project`). Agregar rutas en `app.routes.ts`. **Admin Angular intacto** (queda inactivo para obras).
- Portar el markup del mockup (index/obras/obra.html) pixel a pixel.

### D. Sistema de marca + animaciones + Tailwind
- Tokens del mockup (`--carbon, --paper, --teal #1a9b9c, --sapphire #195764`, fuentes Montserrat/Manrope/JetBrains Mono) → `styles.scss` + espejados en `tailwind.config.js`. Auto-hostear fuentes.
- **Resolver el mismatch Tailwind v3/v4** ANTES de portar el CSS (hoy conviven directivas v3 + plugin v4 → colisiones). Decisión: consolidar en una versión.
- Reconciliar **tema claro** del mockup vs `html/body{background:#000}` global actual (scopear el dark al admin).
- Reimplementar el sistema **kDrop** como **directiva Angular** (`appReveal`): `IntersectionObserver` en `ngAfterViewInit` guardado por `isPlatformBrowser`, re-trigger al entrar al viewport, red de seguridad (si queda en opacity:0 → `animation:none;opacity:1`). **No** gatear con `prefers-reduced-motion` (pedido explícito del cliente) salvo el count-up.
- Reimplementar como componentes/directivas (no scripts globales): count-up, slider antes/después, `[data-parallax]`, helper `data-wa-form`→`wa.me`.

### E. Mapa nacional
- Reusar `GoogleMapComponent` + `GoogleMapsService` existentes (carga runtime de la key vía `window.__KAMAK_CONFIG__`, `ngSkipHydration`). Portar estilo/pins de `map-ar.js`. Pins desde `coords` de las obras publicadas. **Key detrás de flag** hasta que Franco la genere.

### F. Flujo "Publicar" (editor de obra en el ERP)
- En el editor de obra de `app.kamak`: pestaña/sección **"Web"** con los campos `obra.web` + toggle **Publicar** (+ despublicar). Curación de **antes/después** (marcar fotos), portada, copy, marca, m², coords.
- Permiso de publicar según matriz de Autorizaciones (Admin/Socio). Solo `finalizada` publicable.

### G. Seeding masivo (Drive + Obras + CHECK LIST + match)
Fuentes:
- **Drive** `1C_bSbHyfo…` → ~28 carpetas `NN - Localidad - Cliente/Marca` (fotos + subcarpetas Videos/Canva). Sin separación antes/después uniforme dentro de cada carpeta.
- **CHECK LIST** (planilla Drive) → **manifiesto de fotos**, NO metadatos numéricos. Da la **lista canónica 1-30 con nombres limpios** (incl. `16 Sampacho`, `20 Rojas`) y, por obra, qué material tiene: `ANTES` / `DESPUÉS` / `VIDEO` (flags X) + comentarios de calidad (ej. "no muy lindas", "solo durante"). Se usa para validar el match y guiar la curación de antes/después. **No** trae m²/días/marca.
- **`...\Kamak Desarrollos\Obras`** → 43 páginas web guardadas (posts sociales); fuente secundaria de fotos (rescatar `*_n.jpg`, descartar `.descarga`/`.js`).
- **ERP** → obras ya existentes (incl. `Gallo Negro`, `CAGLE-ELENA`, `La Lucila-Fan de pan` = `finalizada`).
- **m²/días/marca:** NO hay planilla. Se derivan donde se pueda (mockup `obras-data.js` para ~3 obras; `fechaInicio→fechaFin` del ERP para las matcheadas) y van **en blanco** en el resto, para completar al publicar.

Algoritmo:
1. Normalizar y **matchear por tokens** (localidad + cliente + marca). Mappings confirmados: `Elena`→`CAGLE-ELENA` (siempre Córdoba), `La Lucila`→`La Lucila-Fan de pan`, `Gallo`→`Gallo Negro`.
2. Si matchea obra existente → **enriquecer** (no duplicar): agregar `obra.web`, fotos.
3. Si no → **crear** obra `estado:'finalizada'`, `origen:'seed-drive'`, `web.publicar:false`.
4. Fotos: descargar de Drive → subir a `kamak-fotos` (`obras/<id>/web/...`) → setear `gallery` (+ `imageBefore/After` por heurística nombre/subcarpeta). **Sin fotos → galería vacía (en blanco).**
5. **m²/días/marca:** derivados donde se pueda; **en blanco** donde no haya (se curan al publicar). La CHECK LIST valida qué obras esperan antes/después/video y marca las de baja calidad.
6. **Dry-run + reporte de reconciliación** para que Franco revise antes de confirmar. Todo entra **despublicado**.

### H. Fotos / Storage / antes-después
- Hosting: **Supabase Storage `kamak-fotos`** (lectura pública ya activa). Mover desde Drive en el seeding.
- **Antes/Después:** autodetección por **nombre de archivo / subcarpeta** cuando exista; el resto queda sin etiquetar para curación manual en el editor.
- Separar fotos **web** (`obra.web.gallery/imageBefore/After`) de las **de avance operativo** (`detalle.fotos[]`) para no mezclar.

### I. CRM lead (form → Comercial)
- Form de contacto → `POST /api/public/leads` → embudo Comercial (`origen:'web'`, columna Prospecto) + **fallback WhatsApp** en paralelo. Campos: Nombre/empresa, Teléfono, Email, Ubicación, Marca/formato, m² aprox, Tipo de proyecto, Plazo, Mensaje.

### J. SEO técnico (incluido en esta pasada)
- Activar **prerender/SSR** de Angular (hoy scaffolded pero inactivo; deploy es CSR puro en GitHub Pages). Evaluar prerender estático vs SSR Node.
- `lang=es-AR`, **metas dinámicas por ruta**, canonical al dominio propio, **sitemap.xml**, `robots.txt`, **JSON-LD** (`GeneralContractor` + `Project`/obra), Open Graph.
- **Árbol de rutas SEO**: `/obras/tienda-[localidad]`, `/servicios/...`, `/franquicias/...`, `/zonas/...` + **301** desde URLs viejas.
- Guardas `isPlatformBrowser` en todos los scripts DOM (kDrop, count-up, parallax, slider, video) para SSR.
- **Dominio/deploy:** el sitio vive bajo `candelandi.github.io/kamak-web`. Ideal transferir a `kamakdesarrollos` para deploy propio en `kamak.com.ar` (pendiente con el dev; no bloquea el build).

### K. Seguridad
- `SUPABASE_SERVICE_KEY` **solo server-side** (endpoints `kamak/api/*`); nunca en el bundle Angular.
- **No** abrir política `anon` sobre `shared_data` (filtraría todo el blob). Whitelist server-side.
- CORS de los endpoints lockeado al origen del sitio público.
- Rate-limit + honeypot en `/api/public/leads`.
- **Rotar el token de GitHub en texto plano** del remote de `kamak` (expuesto en `.git/config`) — acción de Franco.

## 5. Decisiones tomadas (registro)

| # | Decisión |
|---|---|
| Alcance | Sitio completo de una (Home + Obras + Obra) |
| Datos | Conectar datos reales ya; **ERP = fuente de verdad** (re-apuntar desde rakium) |
| Modelo | Extender la obra (`obra.web`) + flag `origen` |
| Publicar | Toggle en `app.kamak`; solo `finalizada`; lectura en vivo en la web |
| Antes/Después | Autodetectar por nombre/subcarpeta; resto manual |
| Fotos | Supabase Storage `kamak-fotos`; mover desde Drive |
| Seeding | Cargar todo como `finalizada` despublicado; sin fotos → en blanco; match 3-puntas sin duplicar |
| SEO | **Incluido** en esta pasada |
| Maps key | Detrás de flag; Franco la genera cuando se pida |
| Video | Fase 2 (solo fotos ahora) |
| Push | Ramas **locales**, sin pushear (ambos repos); dejar listo para PR |
| QA | Constructor + auditor por área + crítico de completitud + e2e Playwright (publicar→web) |

## 6. Dependencias / pendientes de Franco
- ✅ **`SUPABASE_SERVICE_KEY`** + `SUPABASE_URL` — ya están en `kamak/.env.local` (gitignoreado). Se usa la existente.
- ✅ **CHECK LIST** confirmada — es el **manifiesto de fotos** (antes/después/video + calidad), no metadatos. m²/días/marca van en blanco donde falte.
- ⏳ **Google Maps key** — Franco la genera cuando se llegue al mapa (queda detrás de flag mientras tanto).
- ⏳ **Rotar** el token de GitHub expuesto en `kamak/.git/config` (no bloquea).
- ⏳ (Más adelante) transferencia del repo `kamak-web` a `kamakdesarrollos` para deploy propio en `kamak.com.ar`.

## 7. Riesgos y mitigaciones
- **Fuga de datos** por RLS anon → mitigado con whitelist server-side (nunca anon policy).
- **Drift de dos sistemas** (rakium vs ERP) → se elimina re-apuntando todo al ERP.
- **Seeding contra base real** → dry-run + reporte + import despublicado + backup previo de `shared_data['obras']`.
- **Matching difuso** (nombres no coinciden) → confirmación humana del reporte antes de publicar.
- **SSR + scripts DOM** → todo guardado con `isPlatformBrowser`; mapa `ngSkipHydration`.
- **Tailwind v3/v4** → consolidar versión antes de portar CSS.
- **Spam de leads** → rate-limit + honeypot/captcha.

## 8. Plan de ejecución (workflow con auditores)
Fases (se detallan en el plan de implementación — skill `writing-plans`):
1. **Fundaciones** (paralelo): modelo `obra.web` (ERP) · endpoints públicos · fix Tailwind + tokens de marca + fuentes.
2. **Port visual** (paralelo por página): Home · Obras · Obra + directivas (kDrop, slider, count-up, parallax, mapa).
3. **Integración**: re-apuntar data-layer · form→leads · publicar en editor ERP.
4. **Seeding**: descarga Drive/Obras → match → upload `kamak-fotos` → escribir obras (dry-run → confirmar).
5. **SEO**: prerender/SSR · metas · sitemap · JSON-LD · rutas + 301.
6. **QA**: auditoría adversarial por área + e2e `publicar→web` + crítico de completitud.

> **Regla:** cada área pasa por su auditor antes de darse por cerrada. Cero bugs tolerados; lo que el auditor marca se re-verifica.
