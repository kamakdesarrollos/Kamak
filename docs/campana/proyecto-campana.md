# Proyecto: Campaña de marketing dentro del ERP (Prompt v2)

> Versión corregida del prompt original (armado con Cowork), enriquecida con los
> hallazgos verificados contra el código el 2026-07-21. Este documento es el
> norte del proyecto: lo ejecuta Claude (Fable 5) en Claude Code, con Franco
> como dueño de las decisiones. Franco es principiante en programación: todo se
> explica en criollo, sin asumir términos técnicos.

## 1. Objetivo (la necesidad, no la solución)

Centralizar en el ERP (`app.kamak.com.ar`) la campaña a ~4.070 estaciones de
servicio que hoy corre desparramada en 5 canales, resolviendo:

- **Trazabilidad**: saber a quién se contactó, por qué canal, quién lo tocó
  (Franco o Carolina) y cuándo — para no pisarse.
- **Estado por canal**: en qué parte del proceso está cada contacto en cada canal.
- **Migración**: los contactos viven en una planilla de Drive → pasarlos al software.
- **Analítica**: KPIs, gráficos y el embudo de concreción
  (Contacto → Respondió → WhatsApp → Reunión → Presupuesto → Obra ganada),
  filtrable por canal / bandera / segmento. Franco lo pidió explícito
  (2026-07-21): comparar campañas entre sí — cuál trae mejores resultados,
  cuánto se gasta en cada una, y **$ invertidos por obra ganada** por
  campaña/canal.
- **Base viva**: la base NO está terminada — Franco sigue armando y generando
  listas (quedan banderas/segmentos por enriquecer). La carga de contactos es
  una **importación incremental permanente con dedup**, no una migración única.
- **Integraciones**: que Instantly, Meta, Google, GA4, Search Console y Clarity
  alimenten los números solos (lo más automático posible).

## 2. Contexto de negocio

- **Kamak**: constructora de tiendas/locales llave en mano, todo el país.
- **Dos tipos de cliente**: estaciones de servicio (especialidad — máximo
  detalle por bandera) y franquicias/locales de cualquier marca (flexible).
- **CTA único de campaña**: que el operador escriba por WhatsApp.
- **Canales**: Cold email (Instantly, 7 secuencias) · Meta/IG Ads (CTWA) ·
  Google Ads + SEO · LinkedIn (Franco, manual) · Llamadas (Carolina).
- **Equipo**: Franco (marketing) + Carolina (llama y carga).
- **Base**: ~4.070 estaciones, ~761 con email.

**Datos canónicos** — Banderas: YPF · Shell · Axion · Puma · ACA · Banderas
nuevas (Gulf, Refinor, Voy con Energía, Dapsa, Wico, Rhasa, Líder Oil).
Tamaño operador: 1 · 2 · 3 · 4+ (los 4+ se tratan uno a uno). 7 segmentos:
Axion · YPF una estación · YPF grupo/multibandera · Shell · Puma minimercado ·
YPF servicompras · Banderas nuevas. Estados de contacto (lista canónica
objetivo): SIN LLAMAR · FUERA DE SERVICIO · NO ATIENDE · VOLVER A LLAMAR ·
PASÓ MAIL · PASÓ WHATSAPP · DECISOR IDENTIFICADO · NO INTERESA · LEAD CALIENTE.
⚠️ La planilla real tiene además estados NO canónicos (NUMERO EQUIVOCADO,
TELEFONO FIJO, ME PASO EL MAIL con variantes) → la migración incluye
normalización, guardando el valor original en un campo aparte.

**Fuente de la verdad**: `Kamak_Estaciones_Unificado.xlsx` en Drive
(file id `1iluRffzEalaylSfc_1ErnSl9YKLonRtX`, owner kamakdesarrollos, pestaña
clave "LISTOS PARA ENVIAR"). Existen archivos casi gemelos (Completo, .bak,
copia Google Sheets): se ignoran. Campos valiosos extra: Decisor, Cargo,
LinkedIn_decisor/empresa, Confianza, APIES.

## 3. Lo ya verificado del software (Paso 1 — HECHO, 2026-07-21)

1. **⚠️ CTA equivocado**: `wa.me/5492262559474` es el celular personal de
   Franco, NO el número del bot (bot: fallback `5492262223704`,
   `src/lib/constants.js:51`). Nada de lo que entra por el CTA toca el sistema.
   El webhook no procesa el `referral` de Meta (CTWA) y a desconocidos les
   responde mal (mensaje de QR o flujo de vinculación de empleados,
   `api/whatsapp/webhook.js:5209-5246`). → Decisión de negocio pendiente (P1).
2. **El embudo existe**: `src/pages/comercial/Pipeline.jsx` (kanban solo-Admin),
   etapas `prospecto/cotizado/negociacion/ganado/perdido`
   (`src/lib/constants.js:26`), lead = cliente + obra shell `esLead:true`,
   actividades en `crm_actividades` con tipo y usuario. Estados de
   telemarketing NO existen. La web ya crea leads vía
   `POST /api/public/leads`. Carolina (rol "Administración") hoy NO puede
   entrar al embudo (guard isAdmin).
3. **Escala**: shared_data se carga ENTERO al abrir la app (+localStorage tope
   5MB). 4.000 contactos como obras-shell romperían la app. → Arquitectura
   decidida: **tabla Postgres real `contactos_campana`** (precedente:
   app_users, money_audit, push_subscriptions), módulo campaña aparte que
   **promueve** al embudo al calificar.
4. **Vercel Hobby al límite**: 12/12 funciones, 2/2 crons (diarios).
   Patrones anti-límite existentes: `jobs.js?job=X`, `api/public/[kind].js`,
   webhook multiplexado. "Refresco cada pocos minutos" imposible sin Pro o
   cron externo (GitHub Actions). → Decisión pendiente (P4). Todos los syncs
   nuevos van consolidados en UNA función dispatcher.
5. **La web es otro repo**: `kamak-web` (Angular 19, deploy GitHub Pages,
   repo CandeLandi/kamak-web). GA4 YA instalado (G-2YM0HCF135), Clarity YA
   (xmf1157oas), Meta Pixel NO. El clic al botón WhatsApp NO se mide (hook
   central: `site-interactions.ts`). Hay un 2º número WA en la web
   (`5492262353629`). Backend admin: api.rakium.dev; público: el ERP.
6. **Patrones a reutilizar**: import xlsx (`presupuestoImport.js`,
   `parseExtractoBancario.js` — sin dedup, hay que escribirlo), cron modelo
   (`api/cron/sync-sanfrancisco.js`: CRON_SECRET → fetch externo → Supabase
   REST → summary), permisos (9 flags jsonb + roles en `UsuariosContext`),
   gráficos artesanales (divs/CSS/SVG, sin librería de charts — mantener
   identidad visual), notifs Telegram al equipo (para avisos "lead caliente").
7. **Docs previos**: `docs/plan-ventas.md` (plan ABM/ICPs anterior — releer).
   Los 13 documentos de campaña viven en Cowork/Drive, fuera del repo.

## 3.bis Verificado 2026-07-22 (barrido para el Paso 3 — 8 agentes)

**WhatsApp — "respondo yo y está conectado" ES posible (coexistence):**
- Meta ofrece oficialmente **Coexistence**: el mismo número activo en la app
  WhatsApp Business (celular) Y en la Cloud API. Los entrantes llegan al
  webhook normal; lo que el dueño responde desde la app llega por
  `smb_message_echoes`; historial hasta 180 días vía `history`. Argentina
  soportada. Requisitos: app Business ≥2.24.17, abrir la app cada ~13 días,
  y activarlo SOLO vía Embedded Signup siendo Tech Provider (App Review +
  Advanced Access) o a través de un BSP (ej. 360dialog, costo mensual).
  Cuentas Business recién creadas pueden demorar elegibilidad (tenure).
  Limitaciones: sin grupos/estados/llamadas hacia la API, sin mensajes
  temporales/ver-una-vez en la app, companion Windows no genera echo.
- Un número personal puede migrar a la app Business conservando chats
  (irreversible para el historial). Alternativa: número NUEVO en la app
  Business del mismo celular (el personal queda intacto).
- Precios 2026: freeform GRATIS dentro de ventana 24 h; fuera, template
  (AR: utility ≈US$0,026, marketing ≈US$0,062). CTWA abre ventana gratis de
  72 h; el `referral` llega con `ctwa_clid` (atribución automática).
- Código: el webhook NO lee `metadata.phone_number_id` (`webhook.js:5081`)
  y envía siempre por el env fijo → 2º número = fix chico (~1 día: branch
  por número + parametrizar envío + namespace `ventas:<phone>`). Referral:
  ~15 líneas. Bandeja de ventas: tabla `wa_messages` + jobs multiplexados +
  UI con syncBus ≈ 4-6 días, CERO funciones nuevas.

**Infra — Vercel Pro NO es necesario:**
- Changelog Vercel 20-ene-2026: **100 crons/proyecto en TODOS los planes**
  (Hobby sigue limitado a frecuencia diaria, formato estricto `0 X * * *`).
  El test candado `api/vercel-crons.test.js` (MAX=2) quedó desactualizado —
  los deploys rotos eran por el schedule `1-5`, no por cantidad. Actualizarlo.
- Repo público → GitHub Actions con `schedule` cada 15 min es GRATIS: cubre
  el "refresco frecuente" sin Pro.
- Funciones: 12/12 hoy. Consolidar `api/portal/{4}` → `api/portal/[kind].js`
  libera 3 slots → entran `api/campana/[kind].js` + `api/campana/sync.js`
  (dispatcher `?src=`) quedando 11/12. Activar Fluid compute (gratis) sube
  el timeout Hobby a 300 s.

**KPIs — todo conectable SIN trámites (los 6 canales):**
- Instantly API v2: analytics por campaña/step/día, API key y listo
  (webhooks solo en plan Hyper Growth → usar polling).
- Meta Insights: spend + conversaciones CTWA por campaña con system user
  token `ads_read` — SIN App Review para cuentas propias.
- Google Ads: SIN developer token — vincular Ads↔GA4 y leer
  `advertiserAdCost` por campaña desde la GA4 Data API.
- GA4 + Search Console: un solo service account (GSC con lag 2-3 días).
- Clarity: export API 10 req/día, ventana 1-3 días → cron snapshot diario
  (nice-to-have UX, no atribución).
- `$ por obra = spend del canal / obras ganadas con ese origen` — el embudo
  del ERP es la fuente de reuniones/obras; requiere origen+campaña en cada
  contacto y UTMs consistentes.

**LinkedIn — qué se puede y qué NO:**
- IMPOSIBLE: saber quién LEYÓ (InMail no tiene read receipts; el visto de
  DM no es exportable). API/SNAP cerrados para CRM propio. Automatización
  (HeyReach/Linked Helper) = riesgo real de ban 2026 → descartada.
- Motor de riesgo CERO: **export oficial de datos de LinkedIn** (ZIP con
  `messages.csv` + `Connections.csv` + `Invitations.csv`) importado al
  módulo → reconstruye contactados/respondieron/aceptaron con timestamps,
  retroactivo, lag 1-3 días. Franco lo pide 1 vez/semana (2 clics).
- Tiempo real: quick-log 2 taps + compartir perfil desde la app (PWA share
  target Android / Atajo iOS). Smart Links (solo SalesNav Advanced) es la
  única forma legítima de "quién vio" el material.

**Drive:** Unificado vigente confirmado (modif. 21/7 10:30 AR, nadie lo
pisa). Ojo: hay un 2º xlsx homónimo viejo (2/7) en otra carpeta de Drive —
archivarlo. Copia local de la PC (2/7) también vieja.

**Docs de Cowork (16 leídos)** — el módulo debe respetar: modelo de 3
entidades **Estación → Operador (unidad de contacto) → Decisor**; plantilla
determinada por lista SalesNav; dedup de estación física por teléfono;
Confianza/Verificado como atributos de primera clase; aprobación humana por
tanda ("dale") — nada se envía solo; topes diarios LinkedIn como regla dura;
"la única métrica que paga es la reunión agendada"; regla de ~30 días de
interacción antes del 1er mensaje PACS; Puma = clientes (referidos, no fría).

## 4. Proceso de trabajo (pasos restantes)

- **Paso 2 — Preguntas** (HECHO 2026-07-21): las 12 respuestas están en la
  sección 5.
- **Paso 3 — Caminos** (HECHO 2026-07-22). Franco eligió:
  1. **WhatsApp: migrar su número personal** a la app WhatsApp Business +
     coexistence. El CTA de la campaña NO cambia (ya apunta a ese número).
     Secuencia: backup → migración guiada (la hace Franco en su celu, es
     irreversible para el historial) → semanas de uso para tenure → Embedded
     Signup/coexistence. Mientras tanto, la bandeja del ERP y el ruteo por
     `phone_number_id` se construyen igual (sirven para ambos modos).
  2. **Camino A — Integral en fases**, con énfasis explícito en métricas y
     gráficos: *"que quede super dinámico y también lindo estéticamente"*.
  Mandato: *"el mejor módulo de ventas que una constructora de retail haya
  tenido nunca"*.
- **PIVOT DE UX (2026-07-22, decisión de Franco)**: la primera cara (5 páginas:
  tabla + kanban + dashboard + importar + llamadas) NO le gustó ("no entiendo",
  "no me gusta nada"). Su modelo mental es una JERARQUÍA navegable. Eligió el
  concepto **"Explorador jerárquico"**: UNA pantalla — árbol Rubro (Estaciones
  de servicio / Franquicias) → Bandera → Operadores desplegables con clic, KPIs
  pegados a cada nivel (no en página aparte), ficha completa del operador en
  panel lateral con acciones + **vincular con obra EXISTENTE o crear nueva**.
  Todo lo demás se absorbe: la cola de llamadas de Caro es una vista del
  explorador, el kanban muere (la etapa se cambia en la ficha), el dashboard
  muere (queda tira de KPIs + Ritmo colapsable). El MOTOR (tablas, context,
  importador multi-hoja, anti-colisión, notifs) queda intacto.
  Aclaración de Franco: *"la información no la vi mal, lo que veo mal es el
  front, la estética, la navegación"* → los DATOS que mostrábamos están bien;
  la reconstrucción es de presentación: diseño visual de primera (aire,
  jerarquía tipográfica, transiciones suaves, semáforos limpios) + la
  navegación jerárquica de una pantalla.
- **Paso 4 — Ejecución autónoma**: plan por etapas (MVP primero), TDD donde
  aplique, dudas menores se resuelven solas y quedan anotadas. Frenar SOLO por:
  (a) credenciales/accesos, (b) riesgo a datos reales o producción.
- **Paso 5 — Entrega**: deploy a PRUEBAS + reporte final en criollo (qué se
  construyó, decisiones tomadas, pendientes, cómo probarlo en compu y celu).

### Reglas duras (adaptadas a la infraestructura del 2026-07-21)

1. Trabajar en rama `feat/campana-marketing`. Para ver funcionando:
   **pushear a la rama `pruebas`** → deploya solo a `pruebas.kamak.com.ar`
   (base de datos de prueba `Kamak-Pruebas`, datos truchos, login con la clave
   compartida del equipo).
2. **🚨 NUNCA abrir PR a `main`**: el repo tiene auto-merge — un PR con CI
   verde SE MERGEA SOLO A PRODUCCIÓN. El pase a producción lo dispara Franco.
3. Construir y probar con **datos de muestra** en pruebas. La **migración real**
   de los 4.070 contactos a producción es un paso final aparte, con OK
   explícito de Franco (script idempotente, probado antes en Kamak-Pruebas).
4. Migraciones SQL: probarlas primero contra Kamak-Pruebas; a prod se aplican
   solas al mergear (Action db-migrate) — diseñarlas aditivas
   (expand/contract, nunca romper el schema que producción está usando).
5. Secretos SIEMPRE por variables de entorno de Vercel (Preview→pruebas,
   Production→real); jamás en el código. Si falta una clave, dejar el lugar
   listo y seguir — no frenar el resto.
6. Commits claros en español. No tocar nada ajeno a esta tarea. Los tests
   existentes (690) deben seguir verdes — el CI bloquea si no.
7. Cambios en la web pública (evento de clic WA) van en el repo `kamak-web`
   (deploy GitHub Pages propio) — coordinar aparte, no mezclar con el ERP.
8. Ser honesto en el tablero sobre qué dato es "en vivo", qué es "cada X
   minutos" y qué es diario (Clarity/Search Console tienen demoras propias).

## 5. Decisiones — respuestas de Franco (2026-07-21)

- **P1 · CTA WhatsApp**: comunicación PERSONALIZADA — responde Franco, desde
  cualquier lado, pero TODO queda registrado en el software. Acepta un número
  nuevo si hace falta: *"que sean las 2 cosas: las respondo yo y está
  conectado"*. → El mecanismo exacto (bandeja en el ERP vs coexistence de
  WhatsApp) se decide en el Paso 3.
- **P2 · Bot**: NO tocar el número ni el flujo del bot interno. Franco SÍ
  tiene acceso al WhatsApp Manager de Meta.
- **P3 · 2º número de la web (…353629)**: es de Fede. Franco prefiere que en
  la web aparezca "su" teléfono (fácil y directo) → se unifica al CTA que
  resulte de P1.
- **P4 · Infra**: condicional — si se puede conectar TODO, se paga Vercel Pro;
  si no, refresco diario por ahora. (Con P5 = admin en todas, apunta a Pro.)
- **P5 · Accesos**: Franco tiene usuario admin en TODAS las plataformas
  (Instantly, Meta Business, GA4, Search Console, Clarity, Google Ads).
- **P6 · Alcance**: el orden de integraciones no le preocupa. Requisitos
  duros: (1) TODOS los datos en UNA sola app; (2) **anti-colisión**: si un
  contacto está en tratativas por un canal (ej. LinkedIn con Franco), nadie
  más debe tocarlo por otro canal — ownership/bloqueo visible.
- **P7 · Embudo**: confirmados los 6 escalones. Lo quiere DINÁMICO: drag &
  drop, arrastrar tarjetas, fácil, práctico y efectivo.
- **P8 · Fuente de verdad**: cree que es el Unificado; pidió verificar en
  Drive que sea el único vigente (la copia local en la PC es del 2/7, vieja).
- **P9 · Estados sucios**: son comentarios que Carolina anota al ir
  contactando (reconoce el desorden) → separar ESTADO canónico de COMENTARIO
  libre; normalizar guardando siempre el texto original.
- **P10 · Docs de Cowork**: están en la PC, carpeta
  `Desktop\Kamak Desarrollos\Campaña Estaciones` (16 .md + CSVs de decisores
  + copia local del Unificado). Leídos e incorporados al diseño.
- **P11 · Carolina**: acceso SOLO al módulo de campañas. NADA de obras ni
  montos — la parte visual de obras y sus montos queda exactamente como está.
- **P12 · LinkedIn**: no sabe cómo instrumentarlo; usa Sales Navigator y
  LinkedIn directo. Quiere registrar: a quién escribió, quién respondió,
  quién leyó. → Investigado: se implementa carga rápida + lo factible SIN
  riesgo de ban de su cuenta.
