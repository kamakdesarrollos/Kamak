# Spec: /autorizaciones unificadas

> Fecha: 2026-05-26
> Estado: diseñado, pendiente de implementar
> Autor del diseño: Kamak owner + Claude

## Problema

Hoy la app tiene dos flujos de aprobación separados:

1. **`/autorizaciones`** — solo lista **solicitudes de eliminación de movimientos** (creadas por no-admins que quieren borrar un movimiento). Las aprueba el admin.
2. **`/whatsapp`** — lista las **facturas y movimientos enviados por el bot de WhatsApp** que esperan revisión del admin.

Esto causa fricción:
- El admin tiene dos lugares para mirar cuando llega notificación.
- Conceptualmente son lo mismo: "cosas que requieren mi aprobación".
- No hay un único badge en el sidebar que diga "tenés N cosas para aprobar".
- Cuando algo cambie en el futuro (otros tipos de aprobaciones), no hay un lugar canónico.

## Objetivo

Unificar todas las aprobaciones admin en **una sola página `/autorizaciones`**, con un campo "origen" que indica de dónde viene cada item. Cubre:

- `eliminacion_movimiento` (existente — solicitudes)
- `whatsapp_factura` (existente — bot detecta gastos en fotos de facturas)
- `whatsapp_movimiento` (existente — bot interpreta texto y propone ingreso/gasto)

## Decisiones de diseño

| # | Decisión | Elegido |
|---|---|---|
| 1 | Modelo de datos | **Enfoque B**: mantener `shared_data.solicitudes` y `shared_data.whatsapp_pending` separados; unificar solo en la UI. Riesgo mínimo, webhook intacto. |
| 2 | Edición antes de aprobar | **Sí** para items de WhatsApp (modal editable como en `/whatsapp` hoy). **No** para solicitudes de eliminación (1 click). |
| 3 | Layout | **Tabs por estado** (Pendientes / Aprobadas / Rechazadas). Dentro de cada tab, agrupado por origen en secciones colapsables. |
| 4 | Fate de `/whatsapp` | **Atajo**: `/whatsapp` redirige a `/autorizaciones?origen=whatsapp` con pre-filtro de origen. |
| 5 | Badge del sidebar | El número rojo en "Autorizaciones" pasa a contar **todas las pendientes** (no solo eliminaciones). |

## Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│ shared_data.solicitudes        shared_data.whatsapp_pending │
│ (eliminaciones, intacto)        (facturas + movs WA)        │
└─────────────────────────────────────────────────────────────┘
              │                              │
              ▼                              ▼
┌──────────────────────┐         ┌──────────────────────────┐
│ SolicitudesContext   │         │ WhatsappPendingContext   │
│ (sin cambios)        │         │ (sin cambios)            │
└──────────────────────┘         └──────────────────────────┘
              │                              │
              └──────────────┬───────────────┘
                             ▼
              ┌──────────────────────────────────┐
              │  /autorizaciones (página única)  │
              │  - Lee ambos contexts            │
              │  - Tabs por estado               │
              │  - Secciones colapsables por     │
              │    origen                        │
              │  - Modal de edición por item     │
              └──────────────────────────────────┘
```

## Páginas y rutas

| Ruta | Componente | Notas |
|---|---|---|
| `/autorizaciones` | `Autorizaciones.jsx` | Página principal unificada |
| `/autorizaciones?origen=eliminacion` | idem | Pre-filtro: muestra solo sección eliminaciones |
| `/autorizaciones?origen=whatsapp` | idem | Pre-filtro: muestra solo secciones WhatsApp |
| `/autorizaciones?tab=aprobadas` | idem | Abre tab Aprobadas en lugar de Pendientes |
| `/whatsapp` | redirect | `<Navigate to="/autorizaciones?origen=whatsapp" replace />` |

## Estructura visual

```
=== /autorizaciones (Admin) ===

[ Pendientes (5) ] [ Aprobadas ] [ Rechazadas ]                [ ↻ Actualizar ]

Filtro origen: [ Todos ▾ ]

▼ SOLICITUDES DE ELIMINACIÓN (2)
  24/5    "Pago Don Luis · 245k"   Pedido por: Juan   [Ver] [✓ Aprobar] [✕ Rechazar]
  23/5    "ECHEQ Leandro · 500k"   Pedido por: Maria  [Ver] [✓ Aprobar] [✕ Rechazar]

▼ FACTURAS DE WHATSAPP (2)
  23/5    📷  $ 245.000   Don Luis SRL · Baradero
                                              [📝 Revisar y aprobar] [✕ Rechazar]
  22/5    📷  $ 180.000   Easy Const · Pilar
                                              [📝 Revisar y aprobar] [✕ Rechazar]

▼ MOVIMIENTOS DE WHATSAPP (1)
  23/5    💵  Ingreso · cliente Familia Pérez · $ 1.200.000
                                              [📝 Revisar y aprobar] [✕ Rechazar]
```

Tab "Aprobadas" y "Rechazadas" muestran las mismas secciones pero filtradas por estado (read-only).

## Acciones por origen

### Eliminación de movimiento (1 click)

- **Aprobar** → llama `resolveSolicitud(id, 'aprobada')` + `removeMovimiento(movId)`.
- **Rechazar** → llama `resolveSolicitud(id, 'rechazada')`. El movimiento NO se borra.

### Factura/Movimiento de WhatsApp (modal)

- Click **"📝 Revisar y aprobar"** → abre `AprobarWhatsappModal` (extraído del actual `FacturaModal`/UI de `WhatsappBuzon.jsx`).
- En el modal el admin puede editar: caja, obra, monto, moneda, proveedor, descripción, etc.
- Click **"Confirmar"** en el modal → crea el movimiento real vía `addMovimiento()` + llama `confirmItem(id)` en pending (marca status='confirmed', queda en histórico para audit).
- Click **"✕ Rechazar"** en la fila → llama `rejectItem(id)` (marca status='rejected', el item queda pero no crea movimiento).

## Cambios concretos

### Archivos a tocar

1. **`src/pages/Autorizaciones.jsx`** — refactor mayor:
   - Agregar `useWhatsappPending` al lado del actual `useSolicitudes`.
   - Cambiar la lógica de tabs: en vez de `solicitudes / permisos / usuarios / roles`, usar `pendientes / aprobadas / rechazadas`.
   - **Importante**: la gestión de usuarios/permisos sigue existiendo. Va a un sub-tab o sección aparte (decidir en implementación).
   - Cuerpo de cada tab de estado: 3 secciones colapsables (Solicitudes / Facturas WA / Movs WA).
   - Soporte para query params `?origen=` y `?tab=`.

2. **`src/pages/modales/AprobarWhatsappModal.jsx`** — nuevo:
   - Extraer `FacturaModal` del actual `WhatsappBuzon.jsx`.
   - También extraer la lógica de `handleConfirmFactura` y `handleConfirmMovimiento` (creación del movimiento, vinculación a cuotas, manejo de adicionales, etc.).
   - Modal recibe `item` (factura o movimiento pending), `onConfirm`, `onCancel`.

3. **`src/App.jsx`** — minor:
   - Ruta `/whatsapp` → `<Navigate to="/autorizaciones?origen=whatsapp" replace />`.
   - Eliminar import lazy de `WhatsappBuzon` (ya no se usa).

4. **`src/components/layout/Sidebar.jsx`** — minor:
   - Cambiar el cálculo de `solPendientes` para que cuente: `solicitudes pendientes + facturas WA + movs WA`.

5. **`src/pages/WhatsappBuzon.jsx`** — eliminar:
   - El contenido se mueve al nuevo `AprobarWhatsappModal` + a `Autorizaciones.jsx`.
   - El archivo se borra del repo.

6. **`src/store/WhatsappPendingContext.jsx`** — sin cambios.
7. **`src/store/SolicitudesContext.jsx`** — sin cambios.

## Edge cases y consideraciones

- **Items con `status` legacy**: si en `shared_data.whatsapp_pending` quedaron items con un `status` raro (de un release anterior), el filtro debe ser tolerante: tratar como "pendiente" todo lo que no sea explícitamente `confirmed` o `rejected`.
- **Fix de `totalPendientes` en WhatsappBuzon**: bug detectado durante el diseño — `totalPendientes = pending.length` cuenta también los resueltos. Se arregla automáticamente porque `WhatsappBuzon.jsx` se elimina.
- **Permisos**: la nueva página es Admin-only, mismo guard que ya tiene `Autorizaciones`.
- **Notificaciones**: el campanil del Topbar (que ya muestra pendings WA con link a `/whatsapp`) debe seguir funcionando — al hacer click ahora va a `/autorizaciones?origen=whatsapp`. Cambio menor en `Topbar.jsx`.
- **No-admin badge**: para no-admins, el badge del sidebar se calcula como hoy (solo sus propias solicitudes). Para admin: el badge incluye todas las pendings.

## Plan de testing

Manual, después de implementar:

1. Como Admin, entrar a `/autorizaciones`:
   - Ver pendings de las 3 categorías.
   - Aprobar una solicitud de eliminación → el movimiento desaparece de `/movimientos`.
   - Aprobar una factura WA → abre modal, editar caja, confirmar → crea movimiento en `/movimientos`.
   - Rechazar una factura WA → desaparece de "Pendientes", aparece en "Rechazadas".
   - Cambiar a tab "Aprobadas" → ver los items aprobados con fecha y quién aprobó.

2. Como Admin, entrar a `/whatsapp` por URL → debe redirigir a `/autorizaciones?origen=whatsapp` y mostrar solo esas secciones.

3. Como Comprador (no-admin):
   - Entrar a `/autorizaciones` → solo ver "mis solicitudes" (las que yo pedí), no ver WhatsApp.
   - Entrar a `/whatsapp` → debe redirigir a `/` (porque no es Admin).

4. El sidebar muestra el badge rojo con la suma correcta para admin (todas las pendings).

## Migración / rollback

- Sin migración de datos: ambas tablas siguen como están.
- Para rollback: `git revert` los commits relacionados. La data persiste intacta.

## Esfuerzo estimado

- Extraer `AprobarWhatsappModal`: ~45 min (mover 200 líneas de lógica).
- Refactor `Autorizaciones.jsx`: ~3 horas (tabs nuevos, secciones colapsables, filtros, modal integration).
- Cambios menores en `App.jsx`, `Sidebar.jsx`, `Topbar.jsx`: ~30 min.
- Borrar `WhatsappBuzon.jsx`: 5 min.
- Testing manual: ~30 min.

**Total: ~5 horas de trabajo focal.**

## Out of scope

- Migrar a un único `shared_data.autorizaciones` (Enfoque A) — para una fase posterior si el flujo crece.
- Nuevos tipos de autorización (aprobación de adicionales, autorización de obras, etc.) — el modelo lo soporta, pero se implementa cuando se necesite.
- Mejoras al modal de WhatsApp (mejor UX para múltiples facturas, etc.) — mantener funcionalidad actual.
- Cambio de la edge function `admin-users` — no afecta este flujo.
