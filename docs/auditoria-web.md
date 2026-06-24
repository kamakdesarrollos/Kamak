> Auditoría profunda del sitio kamak.com.ar (kamak-web, Angular 19) — generada en modo autónomo (5 finders auto-verificados + síntesis). 2026-06-24.

# Auditoría kamak.com.ar — Reporte priorizado

**Sitio:** kamak.com.ar (Angular 19.2, SPA en GitHub Pages, build estático CSR, backend de obras vía ERP `/api/public/obras`)
**Hallazgos recibidos:** 42 — **consolidados a 24 únicos** tras descartar duplicados cruzados entre bundles (SSR/prerender aparecía ×4, Title/Meta ×3, canonical/OG ×3, robots/sitemap ×3, lazy-loading ×3, WhatsApp-sin-href ×3, labels ×2).
**Estado:** Todos los hallazgos clave fueron re-verificados contra el código (`index.html`, `obra.component.ts`, `home.component.ts/.html`, `kamak-footer`, `angular.json`, `package.json`, `app.config.ts`, `app.routes.ts`, `node_modules`).

---

## 1. Tabla resumen por severidad (consolidado)

| Severidad | Únicos | Temas |
|---|---|---|
| Crítica | 1 | SPA pura sin SSR/prerender: HTML vacío para crawlers y previews sociales |
| Alta | 9 | Title/Meta por ruta ausentes · OG/canonical al dominio viejo · WhatsApp sin href + 2 números distintos · form sin validación · sin estado error/empty · slug inexistente muestra obra equivocada · mapa ignora coords del ERP · LCP 6.5 MB + 25 MB de video · header/footer viejo con anchors rotos en `/projects/:id` |
| Media | 9 | Sin wildcard 404 · falta robots/sitemap · lang="en" · viewport bloquea zoom · labels sin `for/id` · honeypot no aplicado · mensaje de éxito falso · fuga de listeners · imágenes sin lazy/dimensiones |
| Baja | 5 | Código muerto (template rakium + ruta `/projects/:id`) · guards/header/footer duplicados · admin en hosting público · `obrasApiUrl` override muerto · stat de localidades incoherente · botón flotante WhatsApp ausente |

---

## 2. Detalle por severidad → área

### CRÍTICA — SEO / Arquitectura

**[SSR-01] SPA client-side pura: el HTML que reciben crawlers y previews sociales viene vacío**
`angular.json:18` (builder `application`, sin `server`/`ssr`/`prerender`) · `app.config.ts:32` (`provideClientHydration()`) · `src/server.ts` · `package.json:26-46`
- **Problema (verificado):** El builder es `@angular-devkit/build-angular:application` sin target server/ssr/prerender; `@angular/ssr` y `@angular/platform-server` NO están instalados (confirmado: `node_modules/@angular/ssr` y `/platform-server` no existen), pero `app.config.ts` llama `provideClientHydration()` y existe `src/server.ts` que importa `@angular/ssr/node` + `express`. El deploy sube `dist/kamak-web/browser` (CSR). El `<app-root></app-root>` se sirve vacío.
- **Impacto:** WhatsApp/Facebook/LinkedIn/Twitter (no ejecutan JS) y el primer pase de muchos crawlers ven una página sin `<h1>`, con `<title>` genérico y sin contenido de obra. Las fichas `/obras/:slug` — el contenido SEO de mayor valor (localidad, m², marca) — son prácticamente invisibles e impreviewables. `server.ts` + `provideClientHydration` son código muerto que ni compila contra las deps instaladas.
- **Fix:** Para GitHub Pages lo correcto es **prerender estático (SSG)**: instalar `@angular/ssr` + `@angular/platform-server` (19.2.x), agregar `server`/`outputMode:'static'`/`prerender` en `angular.json` con `getPrerenderParams` que liste slugs desde el ERP en build, y publicar `browser/` ya prerenderizado. Mínimo aceptable si no se hace SSG ahora: borrar `server.ts` y quitar `provideClientHydration()` para no arrastrar código muerto (no resuelve SEO).
- **Riesgo de arreglar:** ALTO (toca build/CI). **Va a reportOnly** (decisión de arquitectura).

---

### ALTA

#### SEO

**[SEO-01] Ninguna página setea Title/Meta propios** — todas heredan `Kamak Desarrollos`
`obra.component.ts:118-141` · `obras.component.ts` · `home.component.ts` · `index.html:5`
- **Problema (verificado):** 0 usos de `Title`/`Meta` de `@angular/platform-browser`. `/`, `/obras` y cada `/obras/:slug` comparten el mismo `<title>` y `description` estáticos del `index.html`.
- **Impacto:** CTR de buscador degradado, previews compartidas idénticas, metadata duplicada en el contenido de long-tail (cada tienda/localidad).
- **Fix:** Inyectar `Title`/`Meta` en `ObraComponent.select()`: `title.setTitle(\`${o.titulo} — ${o.localidad} | Kamak\`)`, `meta.updateTag` description + `og:title`/`og:description`/`og:image=cover(o)`; ídem Home/Obras. Funciona también con prerender.
- **Riesgo:** BAJO. **Va a reportOnly** (requiere inyectar servicios + ramas por componente; mejor implementarlo junto al prerender, no es un edit puntual seguro). Fuerte impacto en conversión/SEO.

**[SEO-02] OG/canonical apuntan a `candelandi.github.io` (dominio del dev viejo) + falta canonical**
`index.html:39-40,48`
- **Problema (verificado):** `og:url = https://candelandi.github.io/kamak-web/`; `og:image`/`twitter:image` son rutas relativas `/assets/logos/logo-kamak.png` (los scrapers exigen URL absoluta); no existe `<link rel="canonical">`. El dominio real es `kamak.com.ar` (`src/assets/CNAME`).
- **Impacto:** Las previews sociales linkean al sitio viejo; Google puede atribuir autoridad a github.io y la imagen de compartido no se muestra.
- **Fix:** `og:url`→`https://kamak.com.ar/`, `og:image`/`twitter:image`→absolutas, agregar `<link rel="canonical">`.
- **Riesgo:** BAJO. **safeFix** (solo metadata).

#### Conversión

**[CONV-01] CTAs de WhatsApp sin `href` (se arman por JS) + DOS números distintos en la misma página**
`home.component.html:297,300,320` · `kamak-footer.component.ts:27` · `site-interactions.ts:63-68`
- **Problema (verificado):** Los `<a data-wa="...">` no tienen `href` en el template; se inyecta en runtime (`WA_NUMBER='5492262559474'`). Sin JS / antes de hidratar no son links, no son focusables por teclado, no aparecen en el tab order. Y conviven con hrefs **estáticos** a `wa.me/5492262353629` (`home:298`, `footer:28`): el texto visible dice **+54 9 2262 559474** pero el link estático apunta a **35-3629** — **dos números de WhatsApp distintos**, con riesgo de derivar consultas al equivocado. El `<a>` de la dirección (`home:300`) no tiene `href` ni `data-wa`: parece link y no hace nada.
- **Impacto:** Pérdida directa de conversión (WhatsApp es el canal principal), a11y rota, y confusión comercial por dos líneas.
- **Fix:** Poner `href` real de `wa.me` directo en el template (como ya está en la línea 298), **unificar a UN número** en una constante compartida usada por home/footer/`onSubmit`, y para la dirección usar link a Google Maps o quitar el `<a>`. El JS `data-wa` queda como mejora progresiva.
- **Riesgo:** BAJO. **Va a reportOnly** parcialmente: la decisión de cuál número es el comercial correcto es de negocio (no puedo elegir por el usuario); el cambio de markup en sí es seguro.

**[CONV-02] El formulario de contacto no tiene ninguna validación (envía vacío)**
`home.component.html:303-324` · `home.component.ts:59-85`
- **Problema (verificado):** Ningún campo tiene `required`; `onSubmit` hace `e.preventDefault()`, anulando la validación nativa (incluido el `type="email"`). Se puede enviar el form vacío → `postLead` genera un lead basura en el embudo Comercial del ERP y abre WhatsApp casi vacío.
- **Impacto:** Leads basura, ruido en el CRM, no se exige el mínimo (nombre + teléfono/email).
- **Fix:** En `onSubmit`, antes de `postLead`/`window.open`, validar `nombre` y (`telefono` || `email`); si falta, mostrar error y `return`.
- **Riesgo:** BAJO. **safeFix.**

#### Integración ERP

**[ERP-01] Slug inexistente muestra la primera obra en vez de 404**
`obra.component.ts:118-124`
- **Problema (verificado):** `select()` hace `findIndex` por slug y `if (i < 0) i = 0` → `/obras/cualquier-cosa` renderiza `obras[0]` con HTTP 200 y URL incorrecta.
- **Impacto:** Contenido equivocado para la URL, duplicate content, URLs basura indexables que devuelven contenido real. Sin estado "no encontrada".
- **Fix:** Si `i < 0`, `this.obra = null` y renderizar bloque "Obra no encontrada" con link a `/obras` (en vez de caer en índice 0).
- **Riesgo:** BAJO. **safeFix** (cambio de lógica acotado + el `*ngIf="obra as o"` ya oculta el main; conviene además un bloque de "no encontrada", pero el cambio mínimo `i=0`→`return/null` es seguro).

**[ERP-02] El mapa nacional ignora `coords` del ERP y depende de un diccionario hardcodeado**
`site-interactions.ts:172-208`
- **Problema (verificado):** `renderKamakMap()` ubica cada obra con `LOCALIDAD_COORDS[loc]` y `if (!c) return`; nunca lee `o.coords.lat/lng` que sí provee `ObraWeb`. Cualquier localidad que no matchee carácter por carácter (acento, ciudad nueva, "San Clemente" vs "San Clemente del Tuyú") desaparece del mapa aunque el ERP traiga lat/lng exacta.
- **Impacto:** El mapa se desincroniza del ERP y se rompe solo al cargar obras nuevas.
- **Fix:** `const lat = o.coords?.lat ?? LOCALIDAD_COORDS[loc]?.[0]; const lng = o.coords?.lng ?? LOCALIDAD_COORDS[loc]?.[1];` y proyectar con `mpx(lng)/mpy(lat)`; tipar el parámetro como `ObraWeb[]`. Diccionario solo como fallback.
- **Riesgo:** BAJO en teoría, pero toca tipado + proyección del mapa y no pude verificar firma de `mpx/mpy`. **Va a reportOnly** (riesgo de regresión visual del mapa sin probar render).

**[ERP-03] Sin estado de error/empty: si el ERP no responde, listado y detalle quedan en blanco**
`obra.component.ts:17-19,110-119` · `obras.component.ts:100-106` · `obras-web.service.ts:30`
- **Problema (verificado):** `getObras()` devuelve `[]` ante error; en detalle `select()` retorna temprano y `*ngIf="obra as o"` oculta TODO el `<main>` (solo header+footer). En el listado la grilla queda vacía pero el H1 sigue diciendo "40+ tiendas" (`totalObras = Math.max(40, length)`). No hay diferenciación cargando / error / vacío.
- **Impacto:** Página rota sin feedback ante caída del ERP; pésima percepción.
- **Fix:** Flags `loading`/`error` en ambos componentes; skeleton mientras carga (ya existe `project-skeleton`), bloque "No pudimos cargar las obras" + retry ante error/empty, "Obra no encontrada" en detalle.
- **Riesgo:** BAJO, pero requiere tocar plantillas + estado en 2 componentes. **Va a reportOnly** (no es un edit puntual).

#### Performance

**[PERF-01] LCP de 6.5 MB sin optimizar + ~25 MB de video autoplay en home**
`home.component.html:122` (`elena-00.jpg` 6.5 MB) · hero.mp4 9.5 MB + diferencial.mp4 9.2 MB + taller.mp4 5.9 MB · `<img>` sin width/height; `<video poster="">` vacío
- **Problema:** La foto principal de "Qué entregamos" pesa 6.5 MB (elena-11 5 MB) servida sin dimensiones (CLS) ni optimización; 3 videos de fondo autoplay (~25 MB) arrancan on-load. En mobile/3G son decenas de MB y un LCP muy alto.
- **Impacto:** LCP y CLS pobres → ranking y rebote.
- **Fix:** Recomprimir a WebP/AVIF y redimensionar (el repo ya tiene `scripts/optimize-images.js` + `npm run optimize:images`, verificado). Servir `elena-00` <300 KB con width/height. Videos: `poster` con frame liviano, `preload="none"`, cargar al entrar en viewport. Corregir `poster=""` (atributo vacío inválido).
- **Riesgo:** BAJO el de atributos (`width/height`, `preload`, `poster`), MEDIO el de recompresión real de assets. **Va a reportOnly** (requiere correr el pipeline de imágenes / decisiones de assets binarios).

#### Navegación

**[NAV-01] `/projects/:id` usa header/footer VIEJOS con anchors muertos y emails equivocados**
`landing-project.component.html:1,228,238` · `components/header/header.component.html:4,8,57,60,63` · `components/footer/footer.component.ts:12-23,28,32`
- **Problema (verificado):** La ruta `projects/:id` (alcanzable desde `map-marker-popup`) renderiza `<app-header>/<app-footer>` (diseño viejo, fondo #111, lucide). El menú viejo apunta a `#proyectos/#servicios/#equipo`, IDs que solo existen en los componentes legacy `team/services/projects` que NO se renderizan en ninguna ruta del sitio nuevo → anchors rotos. El footer viejo lista emails inexistentes (`direccion@`/`administracion@kamak.com.ar`) vs el real `kamakdesarrollos@gmail.com`, links `#` no-op y tagline "para este 2025". El CTA "Contactar ahora" usa `href="/#contacto"` (recarga completa).
- **Impacto:** Marca inconsistente, navegación rota y datos de contacto erróneos en una página pública.
- **Fix:** Si `/projects/:id` quedó obsoleta (reemplazada por `/obras/:slug`), redirigir esa ruta a `/obras` y eliminar el popup que navega ahí. Si se conserva, reemplazar por `<kamak-header>/<kamak-footer>`.
- **Riesgo:** MEDIO (toca routing y/o borrado de componentes; verificar primero que nada externo enlace `/projects/:id`). **Va a reportOnly.**

---

### MEDIA

#### SEO

**[SEO-03] Falta `robots.txt` y `sitemap.xml`**
`src/` · `angular.json` assets
- **Problema (verificado):** No existen `src/robots.txt`, `src/sitemap.xml` ni en `public/`. Sin sitemap, Google no descubre las rutas `/obras/:slug` (client-only); sin robots no hay puntero al sitemap.
- **Fix:** `src/robots.txt` (`User-agent: *` / `Allow: /` / `Sitemap: https://kamak.com.ar/sitemap.xml`) + `sitemap.xml` (estático con `/`, `/obras`, idealmente generado en build con los slugs del ERP). Incluir en `angular.json` assets.
- **Riesgo:** BAJO el `robots.txt` estático (**safeFix**); el `sitemap.xml` dinámico va a **reportOnly** (requiere registrar assets + script de build).

#### Accesibilidad

**[A11Y-01] `<html lang="en">` en sitio íntegramente en español**
`index.html:2`
- **Problema (verificado):** WCAG 3.1.1; afecta lectores de pantalla y señal de idioma para SEO.
- **Fix:** `lang="es-AR"`. **safeFix.**

**[A11Y-02] Viewport bloquea el zoom (`maximum-scale=1.0, user-scalable=no`)**
`index.html:9`
- **Problema (verificado):** WCAG 1.4.4 — usuarios con baja visión no pueden ampliar.
- **Fix:** `content="width=device-width, initial-scale=1"`. **safeFix.**

**[A11Y-03] Labels del formulario sin asociar a sus inputs (`for`/`id`)**
`home.component.html:305-316`
- **Problema (verificado):** 8 campos con `<label>Texto</label>` + control sin `for`/`id`. WCAG 1.3.1/4.1.2: el lector no anuncia la etiqueta, el click en label no enfoca.
- **Fix:** `id` en cada control + `for` coincidente (o envolver el control en el `<label>`).
- **Riesgo:** BAJO. **safeFix.**

#### Conversión

**[CONV-03] El honeypot `_gotcha` se lee pero nunca corta el flujo**
`home.component.ts:59-85` · `home.component.html:317`
- **Problema (verificado):** `body._gotcha = get('_gotcha')` se envía, pero nunca hay `if (_gotcha) return`; un bot que rellena todo genera lead igual.
- **Fix:** Al inicio de `onSubmit`: `if (get('_gotcha')) { this.formOk = true; return; }`.
- **Riesgo:** BAJO. **safeFix.**

**[CONV-04] El mensaje de éxito se muestra aunque falle el envío del lead**
`home.component.ts:75,84`
- **Problema (verificado):** `postLead().subscribe()` es fire-and-forget (el servicio captura errores devolviendo `{ok:false}`); `this.formOk = true` se setea incondicional y nunca se resetea → siempre "✓ Recibimos tu consulta".
- **Fix:** Encadenar el estado al resultado del `subscribe`; ante error/`ok:false`, indicar usar WhatsApp.
- **Riesgo:** BAJO, pero conviene definir copy de error con el usuario. **Va a reportOnly** (cambio de flujo + texto de error a definir).

#### Routing

**[ROUTE-01] Sin ruta wildcard (`**`): URLs desconocidas dejan el `<router-outlet>` vacío**
`app.routes.ts:13-57` (verificado: no hay `path: '**'`)
- **Problema:** Cualquier URL que no matchee deja header/footer con cuerpo en blanco, sin 404 amigable.
- **Fix:** Agregar al final `{ path: '**', redirectTo: '' }` (o un `NotFoundComponent` con CTA a `/obras` y `/`).
- **Riesgo:** BAJO (aditivo, solo afecta rutas que ya fallan). **safeFix** (variante `redirectTo: ''`).

#### Performance

**[PERF-02] Imágenes de galería/grilla/destacadas sin `loading=lazy` ni dimensiones**
`obra.component.ts:40-41,49,80-83` · `obras.component.ts:62-64` · `home.component.html:142`
- **Problema (verificado):** Solo los logos de marca llevan `loading="lazy"`; ninguna imagen de obra. La galería de una obra puede traer muchas fotos del ERP, todas eager → LCP/transferencia y CLS. Además todas las `<img>` de galería usan el mismo `alt=o.titulo`.
- **Fix:** `loading="lazy" decoding="async"` en galerías/cards/destacadas (no en la portada/hero above-the-fold); `width/height` o `aspect-ratio`; `alt` diferenciado (`${o.titulo} — foto ${k+1}`).
- **Riesgo:** BAJO. **safeFix** (atributos aditivos en `<img>`).

**[PERF-03] `initSiteInteractions()` se re-ejecuta en cada navegación y fuga listeners de window/document**
`site-interactions.ts:13,52-57,147,165-167` · llamado en `home.ts:49`, `obras.ts:108`, `obra.ts:127`
- **Problema (verificado):** Cada cambio de ruta agrega `window.addEventListener('scroll'/'mousemove'/'mouseup'/'touchmove'/'touchend')` + `IntersectionObserver` nuevos sin removerlos. Navegando home→obras→obra→home se acumulan (varios parallax en paralelo) → scroll degradado, sobre todo mobile.
- **Fix:** Idempotencia por flag/dataset, o `teardown()` que remueva listeners de window/document y desconecte los observers, llamado en `ngOnDestroy`; o registrar los listeners de window una sola vez con guard global.
- **Riesgo:** MEDIO (toca el motor de interacciones compartido; riesgo de romper el slider/parallax/reveal). **Va a reportOnly.**

---

### BAJA (deuda / reportOnly)

- **[DEAD-01] Código muerto del template rakium** (`/projects/:id` + `LandingProjectComponent` + `components/{hero,team,services,projects,header,footer}`): no enlazados desde la nav nueva, inflan bundle y dependen de `api.rakium.dev`. Eliminar (o redirigir `/projects/:id`→`/obras`). **Riesgo MEDIO** (borrar componentes/routing).
- **[DEAD-02] Duplicados:** dos `AuthGuard` (`pages/admin/guards` usado vs `core/guards` huérfano) y dos juegos header/footer. Consolidar tras retirar el legacy. Riesgo bajo, pero ligado a DEAD-01.
- **[CFG-01] `obrasApiUrl` override muerto:** `obras-web.service.ts:19-25` lee `window.__KAMAK_CONFIG__.obrasApiUrl`, pero `config.js`/CI solo inyectan `googleMapsApiKey` (verificado: la interfaz en `app.config.ts` solo declara `googleMapsApiKey`). Vía de config muerta. Agregar la clave o quitar la rama + comentarios.
- **[MAP-01] Stat "localidades" incoherente** (`site-interactions.ts:200-226`): `seen[loc]` se marca antes del lookup de coords, así el contador puede superar los pins dibujados. Se resuelve al aplicar ERP-02; contar `pts.length`.
- **[ADMIN-01] Rutas `/admin/*` publicadas en hosting estático** con guard solo client-side; deberían tener `noindex` o separarse a otro deploy. Riesgo medio si se reestructura routing.
- **[UX-01] Sin botón flotante de WhatsApp** en home/obras/obra (solo en la página vieja). Sumarlo a `kamak-footer`/layout, dado que la conversión es por WhatsApp.
- **[NAV-02] CTA del hero `href="#contacto"` crudo** (`home.component.html:18`) en vez de `routerLink="/" fragment="contacto"` como el resto. Cosmético/consistencia.

---

## 3. Top 10 a atacar primero (prioriza conversión / SEO)

| # | ID | Por qué primero | Riesgo |
|---|---|---|---|
| 1 | **CONV-01** | WhatsApp es el canal de conversión #1: hoy hay links muertos sin JS + DOS números distintos (riesgo de perder consultas). Unificar número y poner `href` real. | Bajo (decidir número = negocio) |
| 2 | **CONV-02** | Form sin validación → se envía vacío → leads basura en el CRM. | Bajo |
| 3 | **SEO-02** | OG/canonical apuntan al dominio del dev viejo: cada link compartido promociona github.io y sin imagen. Edit de 4 líneas. | Bajo |
| 4 | **SEO-01** | Sin Title/Meta por obra, las fichas (long-tail por localidad) compiten con metadata idéntica. Máximo retorno SEO. | Bajo |
| 5 | **SSR-01** | Sin prerender, todo el SEO/preview de las fichas es invisible para crawlers. Habilita el techo de 3 y 4. | Alto |
| 6 | **ERP-01** | Slug inexistente sirve la obra equivocada con 200 → duplicate content + UX rota. Fix de 1 línea. | Bajo |
| 7 | **ERP-03** | Si el ERP cae, el sitio queda en blanco sin feedback: imagen de marca rota. | Bajo |
| 8 | **PERF-01** | LCP 6.5 MB + 25 MB de video penalizan Core Web Vitals y rebote (mobile). | Bajo/Medio |
| 9 | **SEO-03** | robots + sitemap para que Google descubra `/obras/:slug` (combina con SSR-01). | Bajo |
| 10 | **A11Y-02 + A11Y-01 + ROUTE-01** | Quick wins de 1 línea cada uno (zoom, idioma, wildcard 404) — alto valor/esfuerzo. | Bajo |

---

*Nota de metodología:* los 42 hallazgos originales venían agrupados en 5 bundles con solapamiento alto; se consolidaron a 24 únicos. Se descartaron como duplicados exactos: las 3 repeticiones de SSR, las 3 de Title/Meta, las 3 de canonical/OG, las 3 de robots/sitemap, las 3 de lazy-loading, las 3 de WhatsApp-sin-href y las 2 de labels — fusionadas en su entrada canónica arriba.


---

## Anexo A — Fixes seguros (confianza alta, riesgo bajo)

| # | Título | Archivo | Líneas | Severidad | Fix concreto |
|---|---|---|---|---|---|
| 1 | Cambiar lang del documento a español | `C:/Users/307000/Desktop/Kamak Desarrollos/Software/kamak-web/src/index.html` | 2 | media | Reemplazar `<html lang="en">` por `<html lang="es-AR">`. Corrige WCAG 3.1.1 y la señal de idioma para SEO; el sitio es íntegramente es-AR. |
| 2 | Permitir zoom en el viewport (a11y) | `C:/Users/307000/Desktop/Kamak Desarrollos/Software/kamak-web/src/index.html` | 9 | media | Reemplazar el meta viewport por `<meta name="viewport" content="width=device-width, initial-scale=1" />`, quitando `maximum-scale=1.0, user-scalable=no`. Corrige WCAG 1.4.4 (usuarios con baja visión pueden ampliar). |
| 3 | OG/Twitter/canonical al dominio propio kamak.com.ar (URL absolutas) | `C:/Users/307000/Desktop/Kamak Desarrollos/Software/kamak-web/src/index.html` | 39-48 | alta | En el <head>: og:url -> content="https://kamak.com.ar/"; og:image y twitter:image -> content="https://kamak.com.ar/assets/logos/logo-kamak.png" (URL absoluta, los scrapers no resuelven rutas relativas); y agregar `<link rel="canonical" href="https://kamak.com.ar/" />`. Reemplaza el dominio viejo candelandi.github.io (verificado en linea 40). |
| 4 | Slug de obra inexistente: no caer en la obra[0] | `C:/Users/307000/Desktop/Kamak Desarrollos/Software/kamak-web/src/app/pages/obra/obra.component.ts` | 120-124 | alta | En select(): reemplazar `let i = this.obras.findIndex(o => o.slug === slug); if (i < 0) i = 0;` por: `const i = this.obras.findIndex(o => o.slug === slug); if (i < 0) { this.obra = null; this.prev = null; this.next = null; return; }`. Asi /obras/<slug-inexistente> deja el main oculto (ya hay *ngIf="obra as o") en vez de mostrar la primera obra con HTTP 200. Idealmente agregar luego un bloque 'Obra no encontrada' con link a /obras. |
| 5 | Validar el form de contacto antes de enviar (exigir nombre + telefono/email) | `C:/Users/307000/Desktop/Kamak Desarrollos/Software/kamak-web/src/app/pages/home/home.component.ts` | 62-75 | alta | Tras construir `body` (linea 74) y antes de `this.obrasSrv.postLead(body).subscribe();`, insertar: `if (!body.nombre || (!body.telefono && !body.email)) { return; }`. Evita leads vacios/basura en el embudo Comercial del ERP (el handler ya hace preventDefault y anula la validacion nativa). |
| 6 | Aplicar el honeypot anti-spam (_gotcha) | `C:/Users/307000/Desktop/Kamak Desarrollos/Software/kamak-web/src/app/pages/home/home.component.ts` | 60-62 | media | Al inicio de onSubmit, despues de `e.preventDefault();` y de definir `get`, agregar: `if ((fd.get('_gotcha') || '').toString().trim()) { this.formOk = true; return; }`. Corta el envio cuando un bot rellena el honeypot, sin darle pistas (muestra el mismo mensaje de exito). |
| 7 | Lazy-loading + decoding async en imagenes de galeria de obra | `C:/Users/307000/Desktop/Kamak Desarrollos/Software/kamak-web/src/app/pages/obra/obra.component.ts` | 82 | media | En la <img> de la galeria, agregar `loading="lazy" decoding="async"` y diferenciar el alt: `[alt]="o.titulo + ' — foto ' + (k+1)"`. La galeria del ERP puede traer muchas fotos y hoy cargan todas eager (solo los logos de marca llevan lazy). No aplicar lazy a la portada/hero above-the-fold (lineas 40-41,49). |
| 8 | Lazy-loading en las tarjetas de la grilla de obras | `C:/Users/307000/Desktop/Kamak Desarrollos/Software/kamak-web/src/app/pages/obras/obras.component.ts` | 62-64 | media | Agregar `loading="lazy" decoding="async"` a la <img class="ocard__img"> de cada tarjeta de obra. Evita descargar todas las miniaturas de golpe (atributos aditivos, sin riesgo). |
| 9 | Ruta wildcard para URLs desconocidas | `C:/Users/307000/Desktop/Kamak Desarrollos/Software/kamak-web/src/app/app.routes.ts` | 13-57 | media | Agregar como ULTIMA entrada del array routes: `{ path: '**', redirectTo: '' }`. Hoy no existe wildcard (verificado), por lo que una URL que no matchee deja el <router-outlet> vacio. Es aditivo y solo afecta rutas que ya fallan. |
| 10 | Agregar robots.txt estatico | `C:/Users/307000/Desktop/Kamak Desarrollos/Software/kamak-web/src/robots.txt` | nuevo archivo | media | Crear src/robots.txt con: User-agent: * Allow: / Sitemap: https://kamak.com.ar/sitemap.xml Y registrarlo en `angular.json` -> projects > kamak-web > architect > build > options > assets (junto a CNAME/config.js) para que se publique en la raiz. (El sitemap.xml dinamico desde el ERP queda como tarea aparte de mayor riesgo.) |


## Anexo B — Solo reporte (tocan plata/lógica o riesgo medio-alto — revisar a mano)

| # | Título | Archivo | Severidad |
|---|---|---|---|
| 1 | SPA pura sin SSR/prerender: HTML vacio para crawlers y previews (instalar @angular/ssr + prerender SSG) | `C:/Users/307000/Desktop/Kamak Desarrollos/Software/kamak-web/angular.json` | critica |
| 2 | Ninguna pagina setea Title/Meta propios: todas heredan 'Kamak Desarrollos' (inyectar Title/Meta por ruta) | `C:/Users/307000/Desktop/Kamak Desarrollos/Software/kamak-web/src/app/pages/obra/obra.component.ts` | alta |
| 3 | WhatsApp: hrefs por JS (muertos sin JS) y DOS numeros distintos (559474 visible vs 353629 en href) — unificar a un solo numero comercial | `C:/Users/307000/Desktop/Kamak Desarrollos/Software/kamak-web/src/app/pages/home/home.component.html` | alta |
| 4 | El mapa nacional ignora o.coords del ERP y usa diccionario hardcodeado de localidades | `C:/Users/307000/Desktop/Kamak Desarrollos/Software/kamak-web/src/app/pages/home/site-interactions.ts` | alta |
| 5 | Sin estado loading/error/empty: si el ERP cae, listado y detalle quedan en blanco sin mensaje | `C:/Users/307000/Desktop/Kamak Desarrollos/Software/kamak-web/src/app/pages/obra/obra.component.ts` | alta |
| 6 | LCP 6.5MB (elena-00.jpg) + ~25MB de video autoplay: recomprimir a WebP/AVIF (npm run optimize:images) y poster/preload en videos | `C:/Users/307000/Desktop/Kamak Desarrollos/Software/kamak-web/src/app/pages/home/home.component.html` | alta |
| 7 | /projects/:id usa header/footer viejos con anchors muertos (#proyectos/#servicios/#equipo) y emails inexistentes — redirigir a /obras o migrar a kamak-header/footer | `C:/Users/307000/Desktop/Kamak Desarrollos/Software/kamak-web/src/app/pages/landing-project/landing-project.component.html` | alta |
| 8 | sitemap.xml ausente: generar en build con los slugs de /api/public/obras y registrarlo en angular.json assets | `C:/Users/307000/Desktop/Kamak Desarrollos/Software/kamak-web/src/sitemap.xml` | media |
| 9 | Labels del form sin for/id (a11y): asociar los 8 campos label<->control | `C:/Users/307000/Desktop/Kamak Desarrollos/Software/kamak-web/src/app/pages/home/home.component.html` | media |
| 10 | El mensaje de exito del form se muestra aunque falle el POST a /leads (formOk=true incondicional, nunca se resetea) | `C:/Users/307000/Desktop/Kamak Desarrollos/Software/kamak-web/src/app/pages/home/home.component.ts` | media |
| 11 | initSiteInteractions() re-registra listeners de window/document e IntersectionObservers en cada navegacion (fuga, scroll degradado en mobile) | `C:/Users/307000/Desktop/Kamak Desarrollos/Software/kamak-web/src/app/pages/home/site-interactions.ts` | media |
| 12 | Codigo muerto: template rakium (/projects/:id + LandingProjectComponent + components/{hero,team,services,projects,header,footer}) no enlazado, depende de api.rakium.dev | `C:/Users/307000/Desktop/Kamak Desarrollos/Software/kamak-web/src/app/app.routes.ts` | baja |
| 13 | Duplicados: dos AuthGuard (core/guards huerfano vs pages/admin/guards) y dos header/footer — consolidar tras retirar legacy | `C:/Users/307000/Desktop/Kamak Desarrollos/Software/kamak-web/src/app/core/guards/auth.guard.ts` | baja |
| 14 | Override obrasApiUrl muerto: el servicio lo lee pero config.js/CI solo inyectan googleMapsApiKey (interfaz __KAMAK_CONFIG__ no lo declara) | `C:/Users/307000/Desktop/Kamak Desarrollos/Software/kamak-web/src/app/core/services/obras-web.service.ts` | baja |
| 15 | Stat 'localidades' del mapa cuenta localidades sin coords (seen[loc] marcado antes del lookup) — contar pts.length | `C:/Users/307000/Desktop/Kamak Desarrollos/Software/kamak-web/src/app/pages/home/site-interactions.ts` | baja |
| 16 | Rutas /admin/* publicadas en hosting estatico con guard solo client-side: agregar noindex o separar a otro deploy | `C:/Users/307000/Desktop/Kamak Desarrollos/Software/kamak-web/src/app/app.routes.ts` | baja |
| 17 | Sin boton flotante de WhatsApp en home/obras/obra (solo en la pagina vieja); agregar a kamak-footer/layout | `C:/Users/307000/Desktop/Kamak Desarrollos/Software/kamak-web/src/app/pages/kamak-shared/kamak-footer.component.ts` | baja |
| 18 | server.ts importa @angular/ssr/node (no instalado) y provideClientHydration sin SSR: codigo muerto que romperia un build futuro — borrar o adoptar SSR formalmente | `C:/Users/307000/Desktop/Kamak Desarrollos/Software/kamak-web/src/server.ts` | baja |
| 19 | CTA hero usa href='#contacto' crudo en vez de routerLink='/' fragment='contacto' (inconsistente con el resto de la nav) | `C:/Users/307000/Desktop/Kamak Desarrollos/Software/kamak-web/src/app/pages/home/home.component.html` | baja |


---

**Resumen del auditor:** Consolidé los 42 hallazgos en 24 únicos (descartando los duplicados que se repetían entre bundles: SSR, Title/Meta, canonical/OG, robots/sitemap, lazy-loading, WhatsApp-sin-href y labels), y verifiqué todos los puntos clave contra el código real. El problema de fondo es que el sitio se despliega como SPA client-side pura (builder `application` sin SSR/prerender, con `@angular/ssr` ni siquiera instalado pero `provideClientHydration()` y `server.ts` como código muerto), por lo que crawlers y previews sociales reciben HTML vacío y las fichas de obra —el contenido de mayor valor SEO— son invisibles. En conversión hay dos fallas graves verificadas: los CTA de WhatsApp dependen de JS y conviven dos números distintos (559474 visible vs 353629 en el href), y el formulario no valida nada (se envía vacío y siempre muestra "éxito"). Entrego 11 safeFixes de confianza alta y riesgo bajo con edición concreta (idioma, viewport/zoom, OG+canonical, slug inexistente, validación de form, honeypot, lazy-loading, wildcard 404, robots.txt) y dejo en reportOnly lo de SSR/prerender, Title/Meta por ruta, unificación del número de WhatsApp, mapa-con-coords-del-ERP y limpieza de código muerto, por tocar build/routing/integración o requerir una decisión de negocio.

---

## Anexo C — Aplicación de fixes (2026-06-24, automático)

**Aplicados, build de producción OK y pusheados** a `CandeLandi/kamak-web` main (commit `66a9466`, deploya vía GitHub Pages) — 10 fixes seguros, verificados uno por uno contra el código real:

1. `lang="es-AR"` (estaba `"en"`) — WCAG 3.1.1 + señal de idioma para SEO.
2. Viewport permite zoom (sacado `user-scalable=no`) — WCAG 1.4.4.
3. OG/Twitter/`canonical` → `kamak.com.ar` con URLs absolutas (estaban al dominio viejo `candelandi.github.io`; las previews sociales linkeaban al sitio del dev).
4. Slug de obra inexistente: ya no cae en `obras[0]` con HTTP 200; deja el `<main>` oculto.
5. Galería de obra: `loading="lazy" decoding="async"` + `alt` por foto.
6. Grilla de obras: `loading="lazy" decoding="async"`.
7. Form de contacto: validación mínima (nombre + teléfono/email) — corta leads basura al embudo Comercial.
8. Honeypot `_gotcha` aplicado — corta spam de bots (simula éxito, no envía).
9. Ruta wildcard `**` → home para URLs desconocidas.
10. `robots.txt` creado + registrado en `angular.json`.

**No aplicado (report-only — necesita decisión o es de mayor riesgo):**

- **[CRÍTICO] SSR/prerender:** el sitio es SPA pura; crawlers y previews sociales reciben el HTML vacío (`<app-root></app-root>`). Es el hallazgo de mayor impacto SEO, pero toca build/CI → decisión de arquitectura. Recomendado: **prerender estático (SSG)** con `@angular/ssr` listando slugs desde el ERP en build.
- **Title/Meta por ruta:** cada `/obras/:slug` comparte el `<title>` genérico de `index.html`. Alto impacto SEO/CTR; conviene implementarlo junto al prerender (inyectando `Title`/`Meta` por componente).
- **WhatsApp duplicado:** hay **dos números** en la misma página — el texto visible dice `+54 9 2262 559474` pero un link estático apunta a `…353629`. Cuál es el comercial correcto es **decisión tuya**; unificar en una constante compartida.
