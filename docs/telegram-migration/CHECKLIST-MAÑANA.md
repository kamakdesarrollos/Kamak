# Bot interno en Telegram — listo. Checklist de la mañana

**El bot interno del equipo ya está VIVO en Telegram: `@Kamakdesarrollos_bot`.**
WhatsApp queda solo para clientes (el QR del presupuesto no se tocó). Todo lo del
equipo (gastos, facturas, movimientos, caja, obras, avance + fotos, consultas,
notificaciones) ahora va por Telegram, con los **mismos comandos y los mismos
permisos por rol** que tenías en WhatsApp.

---

## 1) Vincularte (cada persona del equipo, una sola vez)

1. Abrí Telegram y buscá **@Kamakdesarrollos_bot** → apretá **Start** (o escribí `/start`).
2. El bot te pide tu **nombre completo** o tu **email** (el registrado en el ERP).
3. Te devuelve un **código de 6 dígitos**.
4. Entrá a la app de Kamak → te aparece un **banner de vinculación** → confirmá.
5. Listo: el bot te saluda por tu nombre. Escribí **ayuda** para ver qué podés hacer.

> Es el MISMO mecanismo de vinculación que ya usabas en WhatsApp (código + confirmar
> en la app). No hubo que tocar nada de la app. El banner puede mostrar el id de
> Telegram en vez de un número — es cosmético, funciona igual.

**Importante:** un bot de Telegram no le puede escribir a alguien que nunca le dio
`/start`. Para que les lleguen las **notificaciones del equipo** (algo para aprobar,
factura/gasto pendiente, tarea asignada, etc.), cada uno tiene que haber hecho
`/start` y vincularse al menos una vez. Pasá el bot al equipo.

## 2) Probarlo (2 minutos)

Una vez vinculado, probá:
- `saldo` → saldo de tus cajas.
- `tareas` → tus tareas pendientes.
- Mandá una **foto de una factura/ticket** con un texto ("pagué esto de Baradero") →
  el bot lee el monto con Claude, lo carga al ERP y **guarda el comprobante** (queda
  como adjunto, igual que en WhatsApp). *(Esta es la prueba que confirma el pipeline
  de adjuntos de punta a punta — la dejo para vos porque necesita una foto real.)*
- Si sos admin, probá un botón: cuando aparezca **Confirmar/Cancelar**, tocá el botón
  (ahora son botones de Telegram, no hay que escribir "sí").

## 3) Permisos (lo que pediste)

**Costos, márgenes y ganancia = SOLO Admin.** Se cerraron además fugas que existían en
el bot de WhatsApp donde un no-admin (jefe de obra, capataz, logística, administración)
podía ver montos:
- `cómo va [obra]` → no-admin ve avance y tareas, **sin** gastado/presupuesto/cobrado.
- `cuánto le debo a [proveedor]` y `gastos de…` → **bloqueados** para no-admin.
- `pendientes` → no-admin ve solo los suyos (no los montos de otros).
- estado de cheques, cert de avance ($), costos en el contexto del asistente → solo Admin.

> **Una decisión te dejé abierta:** hoy el rol **Administración** sigue viendo las
> *órdenes de pago a proveedores* (cuentas por pagar) cuando le pregunta al bot, igual
> que en WhatsApp — porque es parte de su laburo. Si querés que eso también sea
> **solo Admin**, avisame: es 1 línea (`_esAdminBot` → `isAdmin` en `callClaude`).

## 4) Estado técnico

- **Deployado** a producción (proyecto Vercel `kamak1324` = app.kamak.com.ar), commit
  `d1a847a` en `main`. WhatsApp de clientes intacto (verificado).
- Integrado al webhook existente (`api/whatsapp/webhook.js`) — **no** se agregó función
  Vercel (seguimos en 12/12). Telegram comparte el endpoint, se distingue por el payload
  + un secret token.
- Verificado: chequeo de sintaxis, harness de integración 20/20 (incluye factura →
  ERP + storage + adjunto), y auditoría adversarial multi-agente (6 dimensiones) con
  sus arreglos aplicados (entre ellos: el endpoint exige el secret — *fail-closed*).
- Menú de comandos cargado en Telegram (`/start`, `/ayuda`, `/saldo`, `/tareas`, `/pendientes`).

## 5) Features nuevas (en curso)

Sobre la base ya viva estoy sumando (con workflow, como pediste): aprobar/rechazar
pendientes con **botones inline** desde Telegram, un **resumen del día** por rol,
búsqueda de **APU/precio** (precio solo Admin) y `/ayuda` adaptado a cada rol. Quedan
en el mismo commit/deploy y te las dejo listadas al cerrar.

---

*Doc de referencia técnica completo: `docs/telegram-migration/00-inventory.md` y `CHANGES.diff`.*
