# Diseño — Módulo "Comercial" (CRM + seguimiento de venta)

**Fecha:** 2026-06-05
**Estado:** Aprobado en brainstorming · revisado adversarialmente (5 dimensiones) · pendiente de revisión del usuario
**Autor:** Franco / Federico (Kamak) + Claude

---

## 1. Objetivo

Dar a Kamak un **embudo de ventas y seguimiento de clientes** integrado, sin construir un CRM
desde cero ni duplicar datos. Hoy el ciclo de venta ya existe pero **implícito** sobre las obras:
la obra `en-presupuesto` es la cotización/oportunidad y `obraConfirmada()` ya separa "propuesta"
de "venta real" en toda la app. Falta: estado de venta explícito (incluido **Perdido + motivo**),
responsable comercial, próximo contacto, **timeline consolidado por cliente**, contrato firmable
en el portal, automatizaciones comerciales del bot, y **reportes de pipeline/conversión**.

Resultado esperado: una sección **Comercial** (`/comercial`) con Embudo (Kanban), Clientes 360 y
un Tablero de KPIs, más la firma de contrato en el portal y el bot comercial.

## 2. Decisiones tomadas (cerradas en brainstorming)

| Tema | Decisión |
|------|----------|
| Unidad del embudo | **Por oportunidad/obra** (un cliente puede tener varias oportunidades en paralelo: Shop Express + Super 7) |
| Etapas | **5**: Prospecto → Cotizado → Negociación → Ganado → Perdido (+motivo) |
| Permisos | Solo **Admin** (Franco principal, Federico también carga). Sin ownership por vendedor; "responsable comercial" es un dato, todos ven todo |
| Portal | El cliente **firma un contrato** digitalmente → firma = señal de Ganado |
| Contrato | **Plantilla legal autocompletada** con datos de cliente/obra/monto/cuotas |
| Firma | **Firma electrónica SIMPLE propia (OTP + audit trail)** — art. 5 Ley 25.506: tiene valor probatorio, pero **no** la presunción de autoría/integridad de la firma *digital* (arts. 7-8). Sin costo recurrente. DocuSign / firma digital queda como upgrade opcional futuro |
| Bot | **4 automatizaciones** (ver §8) con **regla de apagado** |
| Contactos por cliente | **Uno** (tel + email), como hoy |
| Sección | Nombre **"Comercial"**, ruta `/comercial`, máximos KPIs posibles |

## 3. Enfoque elegido

**A — Overlay sobre obras (elegido).** La etapa de venta es un campo nuevo `obra.venta` sobre la
obra existente; el embudo es una vista de las obras agrupadas por etapa. Reusa `obraConfirmada()`,
las obras actuales, el portal, el bot y el modelo de cuotas. Sin migración disruptiva.

Descartados:
- **B — Entidad "Oportunidad" separada.** Duplica datos, rompe `obraConfirmada()`, obliga a migrar
  las obras existentes y a re-sincronizar el bot. Más riesgo, sin beneficio real.
- **C — CRM externo (HubSpot/Pipedrive) + sync.** Segundo lugar donde viven los clientes; el
  cliente quiere todo dentro de Kamak.

## 4. Modelo de datos

Todo sigue en `shared_data` (key → JSON blob) con **escritura atómica por ítem** vía los RPCs de
`supabase/migrations/0002_*` (colecciones dentro de objeto) y `0003_*` (arrays directos). **No** se
crean tablas SQL normalizadas.

### 4.1 Etapa de venta sobre la obra — `src/store/ObrasContext.jsx`

Campo nuevo `obra.venta`, **separado** de `obra.estado` (que sigue siendo
`en-presupuesto|activa|pausada|finalizada|archivada`, ver `src/lib/constants.js:23`):

```js
obra.venta = {
  etapa: 'prospecto' | 'cotizado' | 'negociacion' | 'ganado' | 'perdido',
  responsable: userId,              // Franco / Federico (app_users.id)
  origen: 'referido' | 'web' | 'whatsapp' | 'recompra' | 'visita' | 'otro',
  fechaProximoContacto: 'YYYY-MM-DD' | null,
  motivoPerdida: string | null,     // requerido si etapa === 'perdido'
  fechaCambioEtapa: 'YYYY-MM-DD',   // cuándo entró a la etapa actual (para aging)
  changelog: [{ etapa, fecha, usuario }]   // historia de transiciones
}
```

**Constante nueva** `ETAPAS_VENTA` en `src/lib/constants.js`:
`['prospecto', 'cotizado', 'negociacion', 'ganado', 'perdido']`.

### 4.2 Cliente enriquecido — `src/store/ClientesContext.jsx`

Campos nuevos al ítem de `shared_data['clientes']` (patch atómico por campo, no rompe el seed ni el
sync del bot):

```js
cliente += {
  tags: [],                         // ['VIP', 'Puma', 'moroso', ...]
  responsableComercial: userId | null,
  fechaProximoContacto: 'YYYY-MM-DD' | null,
  estado: 'prospecto' | 'cliente' | 'inactivo',   // DERIVADO (ver §7.3) vía derivaClienteEstado(); persistido para filtrar, recalculado en cada cambio de obra/actividad
}
```

Contacto sigue siendo único: `telefono` + `email` (sin personas múltiples).

### 4.3 Timeline de actividades — blob nuevo `shared_data['crm_actividades']`

Array, clonando el patrón atómico de `src/store/TareasContext.jsx`. Provider nuevo
`src/store/ComercialContext.jsx` (**nombre definitivo**) con `useSyncedSharedData({ atomic: true })`.

```js
actividad = {
  id, clienteId,
  obraId: string | null,            // opcional: si la actividad es de una oportunidad puntual
  tipo: 'llamada' | 'mail' | 'reunion' | 'whatsapp' | 'nota'
      | 'propuesta_enviada' | 'cambio_etapa' | 'portal_abierto' | 'firma',
  texto: string,
  fecha: 'YYYY-MM-DD' | ISO,
  usuario: userId | 'sistema' | 'bot',
  adjuntos: [{ id, nombre, url, tipo }]   // OPCIONAL en v1 (solo URLs externas)
}
```

Se alimenta **a mano** (registrar llamada/reunión) y **automáticamente** (cambio de etapa, apertura
de portal, firma, propuesta enviada).

> **Adjuntos:** opcionales en v1 (solo URLs externas). El bucket `kamak-fotos/crm/<id>/` y los helpers
> de subida de archivos desde la app quedan para una fase posterior.
>
> **Payload de `cambio_etapa`:** `{ tipo:'cambio_etapa', usuario: currentUser.id, texto: 'Movida de
> {etapaAnterior} a {etapaNueva}', fecha, obraId, clienteId }`. En paralelo, `obra.venta.changelog`
> guarda `{ etapa, fecha, usuario }`.

### 4.4 Contrato + firma — `detalle.contrato` (dentro del detalle de la obra)

```js
detalle.contrato = {
  plantillaId,
  htmlRenderizado,                  // HTML del contrato ya con datos resueltos
  version: number,                  // sube en cada regeneración
  estado: 'borrador' | 'enviado' | 'firmado' | 'rechazado',
  fechaEnviado, fechaFirmado, fechaRechazado,
  firma: {
    nombre, dni,
    fecha: ISO, ip, userAgent,
    hashDocumento: sha256(htmlRenderizado),   // ata la firma a ESTA versión exacta
    otp: { canal: 'whatsapp' | 'email', verificadoAt: ISO },
    proveedorExterno: null          // reservado para DocuSign (fase futura)
  } | null
}
```

> **Generación y XSS:** `htmlRenderizado` se genera **server-side** (endpoint con SERVICE_KEY), con
> escaping de los placeholders y sanitización (DOMPurify / sanitize-html) **antes** de persistir. El
> portal lo renderiza ya sanitizado; nunca se genera ni sanitiza en el browser del cliente.

### 4.5 Plantilla de contrato — `shared_data['crm_plantillas_contrato']`

Array de `{ id, nombre, html, placeholders: [...] }`. Placeholders soportados:
`{{cliente.nombre}}`, `{{cliente.cuit}}`, `{{obra.nombre}}`, `{{obra.direccion}}`,
`{{alcance}}`, `{{montoUSD}}`, `{{planCuotas}}`, `{{fecha}}`. Una plantilla default sembrada;
editable desde la app (admin).

### 4.6 Auditoría mínima

A cada ítem nuevo o mutado por el CRM se le agregan `created_by`/`created_at` y, en cliente y
oportunidad, un `changelog[]` actualizado en el **mismo** patch atómico.

## 5. Sección "Comercial" (navegación)

`src/components/layout/Sidebar.jsx` usa el array `ALL_ITEMS` con separadores `{ section }` e ítems
`{ icon, label, path, allowedRoles | adminOnly }`. Se agrega una **sección nueva** y se **mueve
Clientes** a ella:

```js
{ section: 'Comercial' },
{ icon: '📊', label: 'Embudo',     path: '/comercial',          allowedRoles: ['Admin', 'Administración'] },
{ icon: '◎', label: 'Clientes',    path: '/clientes',           allowedRoles: ['Admin', 'Administración'] },
{ icon: '▦', label: 'KPIs Ventas', path: '/comercial/reportes', allowedRoles: ['Admin', 'Administración'] },
```

Rutas nuevas en `src/App.jsx` (bajo el `<Route path="*">` autenticado, ~líneas 238-265), con
`lazy()` como el resto:
- `/comercial` → `Pipeline.jsx` (Kanban)
- `/comercial/reportes` → `VentasReportes.jsx` (KPIs)
- Clientes 360 reusa `/clientes` (extendido).

## 6. Embudo / Kanban — `src/pages/comercial/Pipeline.jsx`

- 5 columnas = etapas (`ETAPAS_VENTA`). Cada **card** = una oportunidad (obra), con: cliente, monto
  USD (`precioVentaUSD` o `presupuesto/tc`), **días en la etapa** (de `fechaCambioEtapa`),
  responsable, próximo contacto, y un punto de color por aging.
- **Drag & drop** entre columnas → cambia `obra.venta.etapa` con escritura atómica (`patch` del
  detalle/obra). Cada movimiento agrega entrada a `changelog` y crea una actividad
  `tipo:'cambio_etapa'`.
- Mover a **Perdido** abre modal pidiendo `motivoPerdida` (obligatorio) → setea
  `obra.estado='archivada'`.
- Mover a **Ganado** confirma la obra: `obra.estado = (obra.estado==='finalizada') ? 'finalizada' : 'activa'`
  (ver §7.1) — la misma conversión que ya hace hoy `obraConfirmada()` y que dispara
  `src/lib/generarTareasObra.js` (idempotente: no regenera si `detalle.tareasGeneradas`).
- **Asignar responsable:** dropdown de responsable comercial (admin-only) en la card del Kanban y en
  la ficha de cliente.
- Filtros: por responsable, origen, tag, rango de monto. Buscador por cliente.
- Totales por columna (cantidad + suma USD) en el encabezado.
- Respeta el theme `T` y los componentes de `src/components/ui`.

## 7. Estados, transiciones y derivaciones

### 7.1 Relación `venta.etapa` ↔ `obra.estado`

| `venta.etapa` | `obra.estado` resultante |
|---------------|--------------------------|
| prospecto / cotizado / negociacion | `en-presupuesto` |
| ganado | `activa` — salvo que la obra ya estuviera `finalizada` (terminal), en cuyo caso se **preserva** `finalizada` |
| perdido | `archivada` |

`obraConfirmada()` (`src/pages/obra/helpers.js:261`, `obra.estado !== 'en-presupuesto'`) sigue siendo
la única fuente de "ganada" para Dashboard/Reportes/alertas. El CRM lo respeta.

### 7.2 Transiciones y auto-derivaciones

- `prospecto → cotizado`: al setear `detalle.financiacion.propuestaEnviada=true` se dispara
  **automáticamente** la transición **y** la actividad `propuesta_enviada`. **Ojo:** la función
  `enviarPropuesta()` (`ObraPresupuesto.jsx:2161`) que setea ese flag **hoy no tiene botón** que la
  invoque, así que el flag casi nunca se setea. **Requisito:** conectar `enviarPropuesta()` a un botón
  visible **"Enviar propuesta al cliente"** en `TabFinanciacion` (vía canónica), o setearlo al exportar
  el PDF de propuesta.
- `cotizado → negociacion`: manual.
- `→ ganado` (cualquiera de estas, en **OR**, automático): contrato `firmado` · primer **pago**
  (movimiento `ingreso` con ese `obraId`) · obra puesta en `activa` a mano.
  **Dónde vive (defecto a corregir):** hoy el auto-confirm al cobrar es un `useEffect` **local** en
  `ObraPresupuesto.jsx:4324-4334` (PIEZA 2) que **solo corre con ese componente montado** — un ingreso
  cargado desde `Movimientos.jsx` o el bot **no** lo dispara, y la oportunidad quedaría en
  cotizado/negociación pese a estar cobrada. **Requisito:** centralizar la regla en un efecto **global**
  de `ObrasContext` (o en `addMovimiento` de `MovimientosContext`): ante el **primer** `ingreso` de un
  `obraId`, setear `estado='activa'` + `venta.etapa='ganado'` y disparar `generarTareasObra` **solo si**
  `!detalle.tareasGeneradas` (idempotente; evita doble generación de tareas).
- `→ perdido`: manual, exige `motivoPerdida`.
- Movimientos hacia atrás (ej. `negociacion → cotizado`) permitidos; quedan en `changelog`.
- **Importante (operación normal):** `perdido` solo se setea **explícitamente**. Archivar una obra
  Ganada (tuvo ingresos) **no** la reinterpreta como Perdida. Esto **no** contradice el backfill de
  §7.4 (que sí deriva `archivada→perdido` para datos legacy): el backfill corre **una sola vez** sobre
  obras viejas; esta regla rige la operación de ahí en más.

### 7.3 `cliente.estado` derivado

- `cliente` (activo): tiene ≥1 obra con `obraConfirmada()` true.
- `prospecto`: solo tiene obras `en-presupuesto` (oportunidades abiertas), ninguna ganada.
- `inactivo`: sin obra activa **y** sin oportunidad abierta, con última obra/actividad >
  `DEFAULT_MESES_INACTIVO` meses (en `src/lib/constants.js`, default 6).

Función pura `derivaClienteEstado(cliente, obras, ultimaActividad)`. Se **recalcula** al: cambiar
`obra.estado`, crear obra, o crear actividad (y, como red de seguridad, lazy al abrir Clientes). Si un
`inactivo` recibe una nueva oportunidad/actividad, vuelve a `prospecto`/`cliente`.

### 7.4 Backfill de las obras existentes (one-time)

Script `scripts/backfill_venta_etapa.mjs` (idempotente, con backup previo como el resto de scripts).
**Idempotencia:** si `obra.venta` ya existe, se respeta y no se pisa. **Obras de arrastre/legacy**
(total fijo USD, sin `detalle.rubros`/`financiacion`): leer todo con optional chaining; no asumir que
existen rubros ni `propuestaEnviada`.
- `obra.estado='en-presupuesto'` → `etapa = propuestaEnviada ? 'cotizado' : 'prospecto'`.
- `obra.estado in ('activa','finalizada')` → `etapa = 'ganado'`.
- `obra.estado='archivada'` → `etapa = (tuvo ingresos) ? 'ganado' : 'perdido'` (motivo `'(migración)'`).
- `fechaCambioEtapa` (jerarquía): `cotizado` → `fechaPropuesta || createdAt`; `ganado` → fecha del
  primer ingreso `|| fechaInicio || createdAt`; `perdido` → `fechaFin || createdAt`; default `createdAt`.

## 8. Bot de WhatsApp — `api/whatsapp/`

Las 4 automatizaciones, **respetando la regla de apagado**:

> Los recordatorios de seguimiento de una oportunidad **se apagan** si se cumple **CUALQUIERA** (OR):
> `venta.etapa ∈ {ganado, perdido}` · existe ≥1 `ingreso` para el `obraId` · `obra.estado ≠ 'en-presupuesto'`
> (es decir, pasó a `activa` / `pausada` / `finalizada` / `archivada`). *(No existe un estado "iniciada":
> los estados válidos son `en-presupuesto|activa|pausada|finalizada|archivada`, `constants.js:23`.)*

Implementación: cron nuevo `api/whatsapp/sales-followups.js` (análogo a `payment-reminders.js`,
agregado a `vercel.json`). Solo procesa oportunidades con:
`venta.etapa ∈ {cotizado, negociacion}` **AND** `obra.estado === 'en-presupuesto'` **AND** sin
movimientos `ingreso` para ese `obraId` **AND** no archivada. En cuanto aparece cualquiera de las
señales, la oportunidad cae fuera del filtro y deja de avisar.

1. **Recordar propuestas sin respuesta** (cron): avisa a Franco cuando una oportunidad `cotizado`
   lleva > N días (default 5) sin moverse de etapa.
2. **Avisar firma/visita al portal** (event-driven): hook en `api/portal/firmar` y en
   `validate-token`/`data` → mensaje al admin "Cliente X abrió el portal" / "firmó el contrato".
   También crea actividad (`portal_abierto` / `firma`).
3. **Cargar/mover oportunidades por chat** (intents en `webhook.js` + `extractors.js`): "nuevo
   prospecto Shell Ruta 3", "pasá la de Axion a ganado". Crea/actualiza `obra.venta`.
4. **Reactivar clientes inactivos** (cron): clientes `estado='inactivo'` (sin obra activa **ni**
   oportunidad abierta) hace > N meses → sugiere recontactar. Se apaga apenas el cliente tenga una
   oportunidad abierta o una obra activa.

## 9. Portal del cliente — contrato + firma

`src/pages/portal/` + `api/portal/`. El portal pasa de **solo lectura** a poder firmar.

- Nueva pantalla **"Contrato"** en `PortalCliente.jsx` (visible si `detalle.contrato.estado ∈
  {enviado, firmado, rechazado}`): muestra `htmlRenderizado`, plan de cuotas en USD, y botón
  **Firmar**.
- **Flujo de firma electrónica (OTP + audit trail):**
  1. Cliente toca Firmar → ingresa nombre + DNI.
  2. `POST /api/portal/solicitar-otp` (SERVICE_KEY, valida token) → manda OTP por **WhatsApp**
     (bot ya wireado) con fallback a email.
  3. Cliente ingresa OTP → `POST /api/portal/firmar` valida OTP, calcula `hashDocumento =
     sha256(htmlRenderizado)`, guarda `detalle.contrato.firma` con `{nombre, dni, fecha, ip,
     userAgent, otp.verificadoAt, hashDocumento}`, set `estado='firmado'`.
  4. Server dispara conversión: `obra.estado='activa'` + `venta.etapa='ganado'` + alerta admin +
     bot (automatización 2) + actividad `firma`.
- **Auditoría de accesos:** registrar en actividad `portal_abierto` (señal de engagement/churn para
  los KPIs).
- **Validez legal (sin sobre-prometer):** esta es **firma electrónica SIMPLE** en el sentido del
  **art. 5 de la Ley 25.506**: tiene valor probatorio, pero **no** goza de la presunción de autoría e
  integridad de la **firma DIGITAL** (arts. 7-8, que exige certificado de un certificador licenciado).
  La **carga de la prueba recae en Kamak**. Es suficiente para contratos comerciales privados de este
  tipo, pero **no equivale a firma digital**. El portal debe **mostrarle al cliente** qué tipo de firma
  está aplicando. `proveedorExterno` (DocuSign u otro con certificado) queda reservado para firma
  digital avanzada si un cliente lo exige.
- Endpoints usan SERVICE_KEY (bypass RLS) como `api/portal/data.js`, validando el token mágico.
- **CORS:** todos los endpoints de portal (`validate-token`, `data`, `solicitar-otp`, `firmar`) deben
  usar el **CORS restringido al regex de dominios kamak** de `data.js:35`, **no** el wildcard `'*'` que
  hoy todavía tiene `validate-token.js:5` (corregirlo). Los de firma además: **rate-limit por token**,
  **OTP nunca en claro** (hasheado en storage) y **consumir/invalidar el OTP** tras la firma.
- **Pre-requisito de seguridad del portal (BLOQUEANTE):** mover el cálculo de venta (precio por
  rubro/tarea) al **server** en `api/portal/data.js` y devolver **solo** venta total + avance %;
  **remover** del detalle público los campos internos `costoMat`, `costoSub`, `costoGral`,
  `margenLinea`, `margenMat`, `margenMO` (hoy se filtran al cliente, ver `data.js:104`). El contrato
  firmable y el detalle público **no** deben exponer costos ni márgenes de Kamak. Liga con el ítem
  abierto de la auditoría (PORTAL costos/márgenes). **El usuario pidió resolver esto YA — ver fix
  aplicado fuera de este spec.**

## 10. KPIs — `src/pages/comercial/VentasReportes.jsx`

Todos en **USD**, coherentes con el resto. Reusan derivaciones de `src/pages/obra/helpers.js`
(`cobradoObraUSD`, `ccObra`) y los datos de `obra.venta`.

**Conversión:** tasa global (ganado / cerradas), conversión etapa-a-etapa
(prospecto→cotizado→negociación→ganado), win rate, tasa de pérdida.
**Pipeline:** valor abierto (suma oportunidades no cerradas), pipeline ponderado por probabilidad de
etapa, ticket promedio, oportunidades por etapa, velocidad del pipeline.
**Tiempos:** ciclo de venta promedio (prospecto→ganado), tiempo medio por etapa (cuellos de
botella), aging (oportunidades estancadas > N días).
**Pérdida:** ranking de motivos, valor perdido por mes, etapa donde más se cae.
**Por responsable** (Franco/Federico): oportunidades, ganadas, win rate, valor cerrado.
**Cliente:** nuevos por mes, prospectos/activos/inactivos, recompra (>1 obra), LTV, top por
facturación, saldo por cobrar (de `ccObra`).
**Proyección/forecast:** ventas ganadas por mes (tendencia), forecast del mes/trimestre, cobros
proyectados de obras ganadas (de las cuotas).
**Actividad/engagement:** actividades por período, oportunidades sin próximo contacto agendado,
"frías" (sin actividad > N días), **% que abrió el portal** y **% que firmó**.
**Origen:** ventas y conversión por origen (referido/web/whatsapp/recompra/visita).

> **Pipeline ponderado — mapa de probabilidad** (en `src/lib/constants.js`, ajustable con el cliente):
> `PROBABILIDAD_POR_ETAPA = { prospecto: 0.10, cotizado: 0.40, negociacion: 0.70, ganado: 1.0, perdido: 0.0 }`.
> Pipeline ponderado = `Σ(montoUSD × prob[etapa])` sobre las oportunidades abiertas.

## 11. Clientes 360 — extender `src/pages/Clientes.jsx`

Al abrir un cliente: datos + **sus oportunidades** (todas sus obras con su etapa y monto) +
**timeline consolidado** (todas las actividades de todas sus obras — hoy NO existe porque los
comentarios son por obra) + **cuenta corriente real en USD** (suma de `ccObra`/`cobradoObraUSD` de
sus obras) + acciones: "registrar actividad", "agendar próximo contacto", "cambiar etapa".

## 12. Persistencia, RLS y atomicidad

- Blobs nuevos (`crm_actividades`, `crm_plantillas_contrato`) quedan cubiertos por la policy
  **operativa** de `supabase/migrations/0001_rls.sql` (lectura/escritura `authenticated`). No
  requieren migración nueva salvo que se quiera ownership por vendedor (no es el caso ahora).
- Escrituras vía RPCs de `0003_*` (`append/patch/remove_item_in_shared_array`) para los arrays, y
  patch por campo para enriquecer cliente/obra. Evita last-write-wins app↔bot.
- `detalle.contrato.firma`, los códigos OTP (`portal_otp_codes`) y `portal_tokens` se escriben **solo
  server-side** (SERVICE_KEY) desde `api/portal/*`; el browser nunca escribe directo. **A validar contra
  `0001_rls.sql`:** la policy operativa permite escritura a cualquier `authenticated`, así que el
  enforcement real de "solo server escribe la firma" es que el browser nunca llama esos RPCs; si se
  quiere enforcement duro, agregar policy/columna que restrinja la escritura de `firma`/OTP a la
  SERVICE_KEY. Igual para actividades con `usuario ∈ {sistema, bot}`: solo desde server.
- **Costos/márgenes NUNCA al portal:** el endpoint `api/portal/data.js` debe devolver exclusivamente
  **precio de venta** y **cuentas corrientes/cobros**; jamás `costoMat`, `costoSub`, `costoGral`,
  `margen*` ni el costo de ningún ítem. El cálculo de venta se hace en el server. (Ver fix urgente.)
- Sync realtime existente (`useSyncedSharedData` + `syncBus`) propaga cambios multi-tab.

## 13. Manejo de errores / edge cases

- **OTP:** expira a los **10 min**, **máximo 3 intentos**; al agotarlos se **invalida** y el endpoint
  responde **429/410** → el cliente debe **pedir un OTP nuevo** (resetea el contador). Rate-limit por
  token. Si WhatsApp falla, fallback a email; si ambos fallan, mensaje claro al cliente.
- **Versión del documento:** si el admin regenera el contrato después de enviado, `version` sube y
  la firma previa (si existía) se invalida — el hash ya no coincide. El cliente debe firmar la nueva
  versión.
- **Doble firma / doble pago:** la conversión a Ganado es idempotente (si ya está `activa`, no
  re-dispara tareas).
- **Obra sin cliente / cliente legacy por nombre:** el Kanban tolera `clienteId` ausente (fallback
  por nombre, como el resto de la app).
- **Backfill:** idempotente; si `obra.venta` ya existe, no lo pisa.
- **Perdido reversible:** se puede reabrir una oportunidad Perdida (vuelve a `negociacion`,
  `obra.estado='en-presupuesto'`); queda en `changelog`.

## 14. Testing

- **Puros** (Vitest, como `src/lib/*.test.js`): derivación `cliente.estado`, mapeo
  `venta.etapa ↔ obra.estado`, filtro de la regla de apagado del bot, cálculo de KPIs (conversión,
  aging, pipeline ponderado), render de placeholders de plantilla, `sha256` del documento.
- **Backfill:** test de idempotencia y de cada rama de derivación.
- **Endpoint firma:** test de OTP (expiración, intentos, hash mismatch, idempotencia de conversión).

## 15. Fases de implementación (orden propuesto)

Cada fase entrega valor de forma independiente y se puede deployar sola.

1. **Sección Comercial + Embudo/Kanban**: `ETAPAS_VENTA`, `obra.venta`, backfill, Pipeline.jsx con
   drag&drop, Perdido+motivo, mover Clientes a la sección. *(Valor inmediato sobre datos que ya hay.)*
2. **Clientes 360 + timeline**: `ComercialContext` + `crm_actividades`, ficha 360, próximo contacto,
   tags, `cliente.estado` derivado.
3. **Contrato + firma en portal**: `crm_plantillas_contrato`, generación/render, pantalla Contrato,
   `api/portal/solicitar-otp` + `api/portal/firmar`, conversión a Ganado, auditoría de accesos.
4. **Bot comercial + KPIs avanzados**: `sales-followups.js` (cron) + intents de cargar/mover +
   reactivación, avisos de firma/visita, y `VentasReportes.jsx` con el set completo de KPIs.

## 16. Decisiones diferidas / fuera de alcance

- **DocuSign / firma electrónica avanzada**: solo si un cliente lo exige (campo `proveedorExterno`
  ya reservado).
- **Múltiples contactos por cliente**: no ahora (un contacto alcanza).
- **Ownership/RLS por vendedor**: no ahora (solo Admin).
- **Export a CRM externo**: descartado.

## 17. Riesgos

- **Consistencia `venta.etapa` ↔ realidad**: mitigado con auto-derivaciones (pago/activa/firma →
  Ganado) y el backfill, para que el embudo no quede desfasado de lo que pasa por obra/bot.
- **`webhook.js` es grande (4264 líneas)**: los nuevos intents deben seguir el patrón de
  `extractors.js` (slots pre-Claude) y no inflar el handler; considerar un módulo aparte
  `api/whatsapp/intents-comercial.js`.
- **Validez legal de la firma**: documentada como firma electrónica (no digital); si el negocio
  necesita más peso, está el camino a DocuSign sin rehacer el modelo.
