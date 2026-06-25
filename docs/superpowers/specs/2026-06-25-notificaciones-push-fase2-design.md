# Notificaciones + Push — Fase 2 (cablear eventos + CRON + push server-side)

**Fecha:** 2026-06-25
**Rama:** `feat/notificaciones-push-fase2`
**Estado:** Aprobado en brainstorming → implementación autónoma
**Spec Fase 1 (fundación):** `2026-06-24-sistema-notificaciones-push-design.md`

## Objetivo

Completar el sistema de notificaciones: cablear los eventos pendientes del catálogo
a sus call sites reales (cliente + servidor) y los vencimientos por CRON, para que
los push lleguen al celu cuando algo le toca a cada rol. La fundación (motor, feed,
SW de push, `?job=push`, campanita) ya está LIVE en prod.

## Decisiones tomadas (con el dueño)

1. **Eventos legacy → push sí, Topbar intacto.** Los 6 tipos en `TIPOS_LEGACY`
   (`solicitud_eliminacion`, `wa_factura_pendiente`, `wa_movimiento_pendiente`,
   `cheque_por_vencer`, `cobro_cliente_proximo`, `tarea_asignada`) ya se ven in-app
   como alerta derivada del Topbar. Emitir su notif **solo agrega el push** — el feed
   ya los oculta (`feedVisible`/`feedNoLeidas`), cero doble conteo. → Para legacy
   **no se escribe el feed** (solo push); para tipos nuevos, feed + push.
2. **`movimiento_cargado` → FUERA.** Administración solo ve sus propios movimientos
   y a Admin no le aporta. Se quita del catálogo activo.
3. **`cuenta_por_vencer` → fecha en la orden de pago.** Se agrega un campo opcional
   `fechaVencimiento` (fecha de pago programada: echeq / pagos mensuales fijos) al
   alta de la orden de pago; el cron avisa 3 días antes.
4. **`proveedor_firmo` → DIFERIDO.** No existe el portal proveedor (es maqueta).

## Alcance: 9 eventos

### Pieza central nueva: `api/_lib/notif.js`
Helper serverless reusado por webhook, portal y cron:
- `crearNotifServidor(tipo, datos)`: resuelve `roles→userIds` (lee `app_users` con
  SERVICE_KEY) + `userIds` explícitos − actor; si el tipo NO es legacy escribe el
  feed atómico (`append_item_in_shared_array` con fallback RMW, espejo del cliente);
  **siempre** manda push. Best-effort (try/catch, nunca rompe el flujo).
- `enviarPushAUsuarios(userIds, {titulo,cuerpo,link})`: lógica de web-push extraída
  de `runPush` (jobs.js se refactoriza para usarla → sin duplicación). Limpia subs
  muertas (404/410) por endpoint, loguea fallos no-404/410.
- Importa `EVENTOS`, `resolverDestinatarios`, `TIPOS_LEGACY` de
  `../../src/lib/notificaciones.js` (confirmado: `firmar.js` ya importa de `src/`,
  Vercel bundlea). `TIPOS_LEGACY` se MUEVE a `notificaciones.js` (fuente única) y
  Topbar lo importa de ahí.

### Cliente (3)
| Evento | Call site exacto | Destino | Notas |
|---|---|---|---|
| `tarea_asignada` | `TareasContext.addTarea` tras `appendItemInSharedArray` (línea ~91); solo `origen==='manual'`; `userIds: asignadoA` | asignados (−actor) | legacy → solo push. `TareasProvider` está dentro de Notificaciones ✓. Re-asignación al editar = fuera de alcance |
| `presupuesto_adjuntado` | `ObraPresupuesto.confirmarImport` tras crear contrato (línea ~701) | Jefe de obra + Admin | feed+push. Se cablea en la **página** (provider afuera). Datos: `obra.nombre`, `rubro.nombre`, `proveedor` |
| `orden_pago_creada` | `FacturaPendienteModal.guardar` tras `addFacturaPendiente` (línea ~135) | Admin + Administración | feed+push. Skip si `soloRegistrar`. Se cablea en el **modal** |

### Servidor por evento (3)
| Evento | Call site exacto | Destino | Notas |
|---|---|---|---|
| `wa_movimiento_pendiente` | `webhook.js` tras el loop `sendWA(admins)` (~línea 1930) | Admin | legacy → solo push. `actorId: user.user_id` |
| `wa_factura_pendiente` | `webhook.js` tras el loop `sendWA(admins)` (~línea 2239) | Admin | legacy → solo push |
| `cliente_firmo` | `api/portal/firmar.js` tras `avisarAdmins` (~línea 187) | Admin + Administración | feed+push (nuevo). Datos: `cliente: firma.nombre`, `obra.nombre`, `obraId`. `actorId: null` (firmante externo) |

### CRON dentro de `runReminders` (3) — sin 3er cron
| Evento | Fuente | Condición | Idempotencia |
|---|---|---|---|
| `cheque_por_vencer` | `cheques` (estado `cartera`, `fechaVencimiento`) | `0 ≤ d ≤ 7` | `cheque_por_vencer:{id}:{fechaVto}` |
| `cuenta_por_vencer` | `proveedores.facturasPendientes` abiertas + nuevo `fechaVencimiento` | `0 ≤ d ≤ 3` | `cuenta_por_vencer:{id}:{fechaVto}` |
| `cobro_cliente_proximo` | loop de cuotas YA existente en `runReminders` | `d===2` o `d===-3` | `cobro_cliente_proximo:{obraId}:{cuotaId}:{fecha}` |

- **Función pura (TDD):** `src/lib/vencimientos.js` → `diasHasta(fecha, hoy)`,
  `chequesPorVencer(cheques, hoy, {dias})`, `cuentasPorVencer(facturas, hoy, {dias})`.
- **Idempotencia:** shared_data `notif_cron_sent` = `{ [clave]: ISOtimestamp }`. Antes
  de notificar se chequea la clave; después se setea. Prune de claves > 60 días.
- Destinos del cron resueltos server-side por `crearNotifServidor` (legacy → push;
  `cuenta_por_vencer` es nuevo → feed+push a Administración).

## Errores / edge cases

- `crearNotifServidor` es best-effort: cualquier fallo se loguea, nunca rompe el
  webhook/portal/cron (igual que `avisarAdmins`).
- Sin VAPID configurado → push se saltea con log (no tira).
- Idempotencia del cron: si `fechaVencimiento` cambia, la clave cambia → re-notifica
  (correcto). Marca se persiste atómicamente leyendo-fresco para no pisar.
- `orden_pago_creada` con `soloRegistrar` (solo fiscal) → no notifica (no es deuda).
- `tarea_asignada` excluye al creador (resolverDestinatarios borra el actor).

## Testing / verificación

- Unit (TDD): `vencimientos.js` (qué vence hoy/umbral, bordes 0 y N días), y que
  `EVENTOS` no tenga `movimiento_cargado` activo si se decide quitarlo del catálogo.
- `npm run build`, `node --check` de los serverless tocados, suite completa.
- **Deploy PREVIEW + prueba mobile real ANTES de main** (lección Fase 1). El SW de
  push NO se toca en Fase 2 → riesgo de romper mobile es bajo, pero igual se verifica.
- Auditoría adversarial (workflow multi-agente) antes de mergear, como en Fase 1.

## Fuera de alcance

- `movimiento_cargado` (quitado), `proveedor_firmo` (diferido), re-asignación de tarea
  al editar, echeq emitidos por nosotros en `cheque_por_vencer`.
- Proyecto 3: rediseño de Autorizaciones como bandeja por rol.
