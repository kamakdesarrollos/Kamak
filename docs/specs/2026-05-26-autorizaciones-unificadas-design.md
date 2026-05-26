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
| 6 | Acceso a `/autorizaciones` | **Solo Admin**. No-admin no ve la página (no entra ni siquiera para ver sus propias solicitudes). |
| 7 | Gestión de usuarios/roles | **Nueva página `/usuarios`** (admin only). Se extrae el CRUD de usuarios + roles de `Autorizaciones.jsx` actual a un componente propio. Sidebar tendrá un nuevo ítem "Usuarios". |

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

| Ruta | Componente | Acceso | Notas |
|---|---|---|---|
| `/autorizaciones` | `Autorizaciones.jsx` | Admin only | Página principal de aprobaciones, unificada |
| `/autorizaciones?origen=eliminacion` | idem | Admin only | Pre-filtro: muestra solo sección eliminaciones |
| `/autorizaciones?origen=whatsapp` | idem | Admin only | Pre-filtro: muestra solo secciones WhatsApp |
| `/autorizaciones?tab=aprobadas` | idem | Admin only | Abre tab Aprobadas en lugar de Pendientes |
| `/whatsapp` | redirect | Admin only | `<Navigate to="/autorizaciones?origen=whatsapp" replace />` |
| `/usuarios` | `Usuarios.jsx` (nuevo) | Admin only | CRUD de usuarios, permisos y roles. Se extrae de la actual `Autorizaciones.jsx`. |

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
   - Mantener guard de admin (redirect a `/` si no-admin), como está hoy.
   - Agregar `useWhatsappPending` al lado del actual `useSolicitudes`.
   - **Eliminar** los tabs actuales `permisos / usuarios / roles` (se mueven a `/usuarios`).
   - Cambiar la lógica de tabs: ahora son `pendientes / aprobadas / rechazadas`.
   - Cuerpo de cada tab de estado: 3 secciones colapsables (Solicitudes / Facturas WA / Movs WA).
   - Soporte para query params `?origen=` y `?tab=`.

2. **`src/pages/Usuarios.jsx`** — nuevo:
   - Extraer del actual `Autorizaciones.jsx` toda la lógica de tabs `permisos / usuarios / roles`:
     - `EditarAccesosModal`
     - `NuevoUsuarioModal`
     - matriz de permisos por rol
     - reset password flow
     - CRUD de roles
   - Guard admin only.
   - Layout: tabs `Usuarios / Permisos / Roles`.

3. **`src/pages/modales/AprobarWhatsappModal.jsx`** — nuevo:
   - Extraer `FacturaModal` del actual `WhatsappBuzon.jsx`.
   - También extraer la lógica de `handleConfirmFactura` y `handleConfirmMovimiento` (creación del movimiento, vinculación a cuotas, manejo de adicionales, etc.).
   - Modal recibe `item` (factura o movimiento pending), `onConfirm`, `onCancel`.

4. **`src/App.jsx`** — cambios menores:
   - Ruta nueva `/usuarios` → `<Usuarios />` (lazy).
   - Ruta `/whatsapp` → `<Navigate to="/autorizaciones?origen=whatsapp" replace />`.
   - Eliminar import lazy de `WhatsappBuzon` (ya no se usa).

5. **`src/components/layout/Sidebar.jsx`** — cambios menores:
   - Agregar ítem "Usuarios" con `adminOnly: true` (icon, label, path `/usuarios`).
   - Cambiar el cálculo de `solPendientes` para que cuente: `solicitudes pendientes + facturas WA + movs WA`.

6. **`src/components/layout/Topbar.jsx`** — minor:
   - El click en notif de WhatsApp pending → navegar a `/autorizaciones?origen=whatsapp` (en vez de `/whatsapp`).

7. **`src/pages/WhatsappBuzon.jsx`** — eliminar:
   - El contenido se mueve al nuevo `AprobarWhatsappModal` + a `Autorizaciones.jsx`.
   - El archivo se borra del repo.

8. **`src/store/WhatsappPendingContext.jsx`** — sin cambios.
9. **`src/store/SolicitudesContext.jsx`** — sin cambios.

## Edge cases y consideraciones

- **Items con `status` legacy**: si en `shared_data.whatsapp_pending` quedaron items con un `status` raro (de un release anterior), el filtro debe ser tolerante: tratar como "pendiente" todo lo que no sea explícitamente `confirmed` o `rejected`.
- **Fix de `totalPendientes` en WhatsappBuzon**: bug detectado durante el diseño — `totalPendientes = pending.length` cuenta también los resueltos. Se arregla automáticamente porque `WhatsappBuzon.jsx` se elimina.
- **Permisos**: `/autorizaciones` y `/usuarios` ambas Admin-only. Usa el mismo guard que ya existe.
- **Notificaciones**: el campanil del Topbar (que ya muestra pendings WA con link a `/whatsapp`) debe seguir funcionando — al hacer click ahora va a `/autorizaciones?origen=whatsapp`. Cambio menor en `Topbar.jsx`.
- **Badge del sidebar**: solo Admin lo ve. Cuenta el total de items pendientes (eliminaciones + facturas WA + movs WA). No-admin no ve el ítem "Autorizaciones" en el sidebar.
- **Visibilidad de solicitudes para no-admin**: con el cambio, los no-admin pierden la habilidad de ver el estado de sus propias solicitudes (antes podían entrar a `/autorizaciones` y ver la sección "Mis solicitudes"). Si en el futuro se quiere restaurar, opciones: (a) mostrar notif en el Topbar para no-admin cuando su solicitud se resuelve; (b) mostrar el estado en una columna en la página de `/movimientos`; (c) volver a permitir acceso de lectura limitada a `/autorizaciones`. **Por ahora, fuera de scope.**

## Plan de testing

Manual, después de implementar:

1. Como Admin, entrar a `/autorizaciones`:
   - Ver pendings de las 3 categorías.
   - Aprobar una solicitud de eliminación → el movimiento desaparece de `/movimientos`.
   - Aprobar una factura WA → abre modal, editar caja, confirmar → crea movimiento en `/movimientos`.
   - Rechazar una factura WA → desaparece de "Pendientes", aparece en "Rechazadas".
   - Cambiar a tab "Aprobadas" → ver los items aprobados con fecha y quién aprobó.

2. Como Admin, entrar a `/whatsapp` por URL → debe redirigir a `/autorizaciones?origen=whatsapp` y mostrar solo esas secciones.

3. Como Admin, entrar a `/usuarios`:
   - Ver lista de usuarios.
   - Crear/editar/eliminar usuarios funciona.
   - Editar permisos por rol funciona.
   - Reset de contraseña funciona.

4. Como Comprador (no-admin):
   - Entrar a `/autorizaciones` → debe redirigir a `/`.
   - Entrar a `/usuarios` → debe redirigir a `/`.
   - Entrar a `/whatsapp` → debe redirigir a `/`.

5. El sidebar muestra el badge rojo con la suma correcta para admin (todas las pendings: solicitudes + facturas WA + movs WA).

6. El click en una notif de WhatsApp en el campanil del topbar lleva a `/autorizaciones?origen=whatsapp`.

## Migración / rollback

- Sin migración de datos: ambas tablas siguen como están.
- Para rollback: `git revert` los commits relacionados. La data persiste intacta.

## Esfuerzo estimado

- Extraer `AprobarWhatsappModal`: ~45 min (mover 200 líneas de lógica).
- Crear `Usuarios.jsx` (extrayendo de Autorizaciones actual): ~1 hora.
- Refactor `Autorizaciones.jsx` con tabs nuevos y secciones colapsables: ~2-3 horas.
- Cambios menores en `App.jsx`, `Sidebar.jsx`, `Topbar.jsx`: ~30 min.
- Borrar `WhatsappBuzon.jsx`: 5 min.
- Testing manual: ~30 min.

**Total: ~5-6 horas de trabajo focal.**

## Out of scope

- Migrar a un único `shared_data.autorizaciones` (Enfoque A) — para una fase posterior si el flujo crece.
- Nuevos tipos de autorización (aprobación de adicionales, autorización de obras, etc.) — el modelo lo soporta, pero se implementa cuando se necesite.
- Mejoras al modal de WhatsApp (mejor UX para múltiples facturas, etc.) — mantener funcionalidad actual.
- Cambio de la edge function `admin-users` — no afecta este flujo.
