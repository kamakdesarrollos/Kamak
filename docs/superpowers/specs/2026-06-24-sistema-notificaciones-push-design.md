# Sistema de Notificaciones + Push Web — Diseño

**Fecha:** 2026-06-24
**Estado:** Aprobado en brainstorming → pendiente plan de implementación
**Rama:** `feat/notificaciones-push`

## Objetivo

Dotar al ERP Kamak de un **sistema de notificaciones por rol**: una **campanita in-app** (con historial de leídas/no leídas) + **push al celular** (Web Push), enganchado a los eventos que **ya existen** en la app. Que cada rol se entere —y reciba un push aunque no tenga la app abierta— cuando algo le toca: aprobaciones, vencimientos, actividad de obra y portal.

## Alcance de ESTE spec

- **Incluye (Proyecto 1 + 2):** el motor de notificaciones, la campanita in-app, el pipeline de push (SW mínimo + suscripción + envío), el routing por rol, y el enganche de **todos** los eventos del catálogo.
- **NO incluye (Proyecto 3 — spec aparte):** rediseñar `Autorizaciones` en una "bandeja por rol" / pipeline multi-rol visible (logística→autoriza→paga como estados). El sistema de notificaciones ya entrega el 80% de ese valor ("te avisa cuando algo te toca"); el rediseño del workflow se especifica después.

## Contexto / lo que ya existe (no se reconstruye)

- **Roles:** `Admin`, `Administración`, `Jefe de obra`, `Logística y compras`, `Contador externo` (`currentUser.rol`; `Sidebar` usa `allowedRoles`).
- **`SolicitudesContext`** (shared_data `solicitudes`, `addSolicitud`/`resolveSolicitud`, estados `pendiente|aprobada|rechazada`).
- **`Autorizaciones.jsx`**: hub admin con 3 orígenes (eliminaciones, facturas de WhatsApp, movimientos de WhatsApp), tabs por estado.
- **Cheques** (con vencimiento), **Órdenes de pago**, **Cuentas por pagar**, **Tareas** (asignación), **Movimientos**, **Portal cliente/proveedor** (OTP/firma).
- Patrón **`useSyncedSharedData`** (load localStorage → fetch Supabase → realtime → debounce save) para casi todos los stores.
- **Vercel:** el deploy tiene **12 functions** (probable tope del plan Hobby). `main.jsx` corre `purgarServiceWorkersYCaches()` que **desregistra cualquier SW en cada carga** ("esta app NUNCA registra un SW").
- **Lección Fase 1 (PWA):** un SW Workbox (precache + navegaciones NetworkFirst) **rompió mobile** (pantalla blanca). Regla: SW mínimo **sin fetch handler** + probar en un deploy **preview** en mobile real **antes** de main. (Ver `kamak-pwa-intento`.)

## Arquitectura

### 1. Datos (shared_data, mismo patrón que `solicitudes`)

- **`notificaciones`**: `[{ id, tipo, titulo, cuerpo, link, rolesDestino:[rol], actorId, creadoAt, leidaPor:[userId] }]`
  - La campanita filtra por **tu rol** (`rolesDestino` incluye tu rol). "No leída" = tu `userId` **no** está en `leidaPor`.
- **`push_subscriptions`**: `[{ id, userId, sub:{ endpoint, keys:{ p256dh, auth } }, device, creadoAt }]`
  - Mapea qué dispositivos tiene cada usuario (para resolver el routing por rol → a quién pushear).

### 2. Motor (cliente)

**`src/lib/notificaciones.js` (lógica pura, testeable):**
- `EVENTOS = { [tipo]: { roles:[...], titulo(datos), link(datos) } }` — config central declarativa.
- `resolverDestinatarios(roles, usuarios, excluirUserId)` → `[userId]` con esos roles, **deduplicado** y **sin el actor** (no auto-notificar).
- `noLeidaPara(notif, userId)` → bool.

**`src/store/NotificacionesContext.jsx`:**
- `notificaciones` via `useSyncedSharedData('notificaciones', [], { lsKey: 'kamak_notificaciones_v1' })`.
- `crearNotificacion(tipo, datos, actorId)`:
  1. Arma `{ titulo, cuerpo, link, rolesDestino }` desde `EVENTOS[tipo]`.
  2. Agrega el objeto a `notificaciones` (→ realtime a todas las sesiones; la campanita aparece).
  3. POSTea al endpoint de envío `{ rolesDestino, titulo, cuerpo, link, excluirUserId: actorId }` (best-effort; si falla, la notif in-app ya quedó).
- `marcarLeida(id, userId)` / `marcarTodasLeidas(userId)` → agrega `userId` a `leidaPor`.

### 3. Campanita (UI)

**`src/components/layout/NotifBell.jsx`** (montado en `Topbar`):
- Badge con count de **no leídas para tu rol**. Dropdown con la lista (no leídas arriba), cada ítem muestra `titulo`/`cuerpo`/tiempo; **click → navega al `link` + marca leída**. Acción "Marcar todas como leídas".
- Si el push **no está activado**: botón "🔔 Activar notificaciones en este dispositivo".

### 4. Push (diseñado para NO poder romper como la Fase 1)

- **`public/sw-push.js`** — SW **mínimo solo-push**: maneja **solo** `push` (muestra la notificación con `titulo`/`cuerpo`/ícono Kamak) y `notificationclick` (abre o enfoca la app en `link`). **Sin precache, sin `fetch` handler** → no intercepta pedidos de la app → *no puede servir chunks viejos ni romper navegación* (causa raíz de Fase 1 eliminada por diseño).
- **`src/lib/push.js`** — `activarPush(userId)`: `Notification.requestPermission()` → `navigator.serviceWorker.register('/sw-push.js')` → `registration.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey: VITE_VAPID_PUBLIC_KEY })` → guarda la subscription en `push_subscriptions` (vía Supabase client, sin endpoint). **Solo se ejecuta cuando el usuario toca "Activar"** (no en cada carga; la mayoría nunca registra el SW). También `desactivarPush()` (unsubscribe + borrar de `push_subscriptions`).
- **`src/main.jsx`** — modificar `purgarServiceWorkersYCaches()` para **whitelistear** el SW propio (no desregistrar el registration cuyo `active.scriptURL` incluye `'sw-push'`). Sigue matando SW viejos/ajenos.
- **VAPID public key** → `VITE_VAPID_PUBLIC_KEY` (Vite env, horneada en el build; es pública). **VAPID private key** → env del servidor (`VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`).

### 5. Envío (servidor) — 1 acción con `web-push`

- Recibe `{ rolesDestino, titulo, cuerpo, link, excluirUserId }`. Resuelve userIds por rol (lee `usuarios` de shared_data en Supabase), junta sus `push_subscriptions`, y `web-push` a cada subscription con la VAPID privada. Subscriptions que devuelven **410/404 → se borran** de `push_subscriptions`.
- **Auth:** validar sesión Supabase (Bearer), como el resto de `api/`.
- **⚠️ Restricción 12 functions:** **no agregar una function nueva**. Decisión exacta en el plan; candidatos:
  - (a) Fold del envío dentro de un dispatcher existente (p.ej. extender `api/whatsapp/jobs.js` a "jobs" genéricos con un `?kind=push`).
  - (b) Mergear dos endpoints chicos existentes (p.ej. `portal/solicitar-otp` + `portal/validate-token` → `portal/[action].js`) para liberar un slot y agregar `api/notif/[action].js` limpio.
  - (c) Si el proyecto está en plan **Pro** (sin límite): `api/notif/[action].js` limpio directamente.
  - El plan debe **verificar primero** si el límite aplica (contar functions del deploy / confirmar plan) y elegir.

### 6. Eventos por tiempo (CRON diario)

- Reusa el patrón `api/cron/*` (ya hay `api/cron/sync-sanfrancisco.js` + `api/vercel-crons.test.js`). Una función pura **`itemsPorVencer(cheques, cuentas, cobros, hoy)`** (TDD) calcula qué vence hoy / en 3 días.
- **Idempotencia:** marca de enviados en shared_data (`notif_cron_sent`, claves `tipo:itemId:fechaObjetivo`) → un "cheque por vencer" se manda **una sola vez**, no todos los días.

## Catálogo de eventos (routing)

| # | `tipo` | Disparo (call site) | `rolesDestino` | `link` |
|---|--------|---------------------|----------------|--------|
| 1 | `solicitud_eliminacion` | no-admin pide borrar movimiento | `Admin` | `/autorizaciones` |
| 2 | `wa_factura_pendiente` | bot detectó factura | `Admin` | `/autorizaciones?origen=whatsapp` |
| 3 | `wa_movimiento_pendiente` | bot interpretó texto | `Admin` | `/autorizaciones?origen=whatsapp` |
| 4 | `solicitud_resuelta` | admin aprueba/rechaza | el `solicitadoPor` (userId) | `/movimientos` |
| 5 | `cheque_por_vencer` | CRON (3 días antes) | `Admin`, `Administración` | `/cheques` |
| 6 | `cuenta_por_vencer` | CRON | `Administración` | `/ordenes-de-pago` |
| 7 | `cobro_cliente_proximo` | CRON | `Admin`, `Administración` | la obra/cliente |
| 8 | `tarea_asignada` | se asigna una tarea | el asignado (userId) | `/tareas` |
| 9 | `presupuesto_adjuntado` | se adjunta presupuesto a obra | `Jefe de obra`, `Admin` | la obra |
| 10 | `movimiento_cargado` | se carga un movimiento | `Administración` | `/movimientos` |
| 11 | `orden_pago_creada` | se crea una orden de pago | `Administración` | `/ordenes-de-pago` |
| 12 | `cliente_firmo` | firma en el portal cliente | `Admin`, `Administración` | `/clientes` |
| 13 | `proveedor_firmo` | acción en portal proveedor | `Admin`, `Administración` | `/proveedores` |

**Nota:** eventos 4/8 pueden dirigirse a un **userId puntual** (no solo a un rol) → `rolesDestino` admite también `userIds:[...]`. Los call sites exactos (archivo:línea) se relevan en el plan.

## Errores / edge cases

- **Permiso denegado / push no activado:** la campanita **funciona igual** (in-app); el push queda off con botón "Activar" para reintentar. Nada se pierde.
- **iPhone sin instalar o iOS <16.4:** detectar (`window.navigator.standalone`, versión) y mostrar "para push en iPhone, agregá la app a inicio". La campanita anda igual.
- **Subscription muerta** (410/404 al enviar) → se borra sola de `push_subscriptions`.
- **Falla el envío server** → no rompe la app: la notif **ya quedó in-app**; se loguea.
- **Falla `register`/`subscribe`** → try/catch; la app sigue normal (push off).
- **No auto-notificar al actor** (`excluirUserId`).
- **Multi-dispositivo / multi-rol:** dedupe por usuario; varios devices del mismo usuario → push a todos.
- **CRON idempotente** (marca de enviados).
- **shared_data:** `notificaciones`/`push_subscriptions` se adoptan con guard de forma (array) — ya cubierto por el `adoptable()` de `useSyncedSharedData`.

## Testing

- **Unit (TDD), lógica pura sin red/UI:** `resolverDestinatarios` (roles→userIds, dedupe, excluir actor, soporte `userIds`), `noLeidaPara`, validación de la config `EVENTOS` (todo `tipo` tiene roles+titulo+link), `itemsPorVencer` (qué vence hoy/en 3 días), y el filtrado de subs muertas (función pura sobre el resultado del envío).
- **Prueba real en mobile sobre un deploy PREVIEW** (iPhone instalado + Android) **antes de mergear a main** (lección Fase 1). Checklist e2e: registrar SW → suscribir → recibir push con la app **cerrada** → click navega al link → desuscribir. Confirmar que el resto de la app **no se rompe** en mobile (la campanita + la purga whitelisteada).

## Fuera de alcance (futuro)

- **Proyecto 3:** rediseño de `Autorizaciones` como bandeja por rol / pipeline multi-rol.
- **Preferencias por usuario** (silenciar tipos, horarios). v2.
- **Email/WhatsApp como canales** del mismo motor (hoy el bot de WhatsApp es aparte). v2.
