# Adjuntar presupuesto de tercero → tareas + contrato MO

**Fecha:** 2026-06-24
**Módulo:** Presupuesto de obra (`src/pages/obra/ObraPresupuesto.jsx`) + Contratos MO
**Stack:** React 19 + Vite, Context API, Supabase, función serverless en Vercel

## Objetivo

Permitir adjuntar el presupuesto de un tercero (subcontratista / proveedor) a un **rubro** del presupuesto de obra. La app lee el archivo y produce **dos cosas a la vez**:

- **(a) Lado venta** → las líneas del presupuesto se vuelven **tareas del rubro** (con el margen del rubro encima = lo que se le cobra al cliente).
- **(b) Lado costo/gestión** → se crea un **contrato de MO** con ese proveedor, cuyo monto = la suma del presupuesto (lo que Kamak le paga al subcontratista). Ese contrato vive en la sección Contratos MO con su avance, plan de pagos y docs PADIC.

Un rubro puede tener **varios adjuntos = varios contratos = varios proveedores**. El cliente ve un **único rubro unificado** (no ve la división por proveedor).

## Caso de uso (ejemplo real validado)

```
RUBRO: Equipamiento gastronómico          ← el cliente ve 1 rubro (4 ítems con margen)
│
├─ 📎 Adjunto 1 → Proveedor "Grupo Braf"  → Contrato MO #1 (monto = plancha + freidora)
│     • Plancha Grupo Braf       (costoSub)
│     • Freidora Grupo Braf      (costoSub)
│
└─ 📎 Adjunto 2 → Proveedor "Turbo Blender" → Contrato MO #2 (monto = horno + microondas)
      • Horno turbo Blender      (costoSub)
      • Microondas Blender       (costoSub)
```

- **Cliente:** ve "Equipamiento gastronómico" con los 4 ítems (cada uno con margen). No ve proveedores ni la división.
- **Kamak (Contratos MO):** ve 2 contratos — Grupo Braf y Turbo Blender — cada uno con su monto.

## Flujo de usuario

1. En un rubro ya creado, junto a **"+ agregar tarea"**, hay un botón **"📎 Adjuntar presupuesto"** (gateado a `puedeEditar`).
2. Se abre un paso de carga: **elegir archivo** (PDF / imagen / Excel / CSV). El **proveedor** del contrato se resuelve automáticamente cuando se puede (ver sección "Resolución del proveedor").
3. La app **lee el archivo**:
   - **Excel / CSV** → parseo en el cliente con `xlsx` (gratis, instantáneo).
   - **PDF / imagen** → se manda al endpoint `api/presupuesto/extraer.js` que usa Claude (≈2-8¢).
4. Se abre la **pantalla de revisión/mapeo**:
   - **Excel:** se muestran las columnas crudas; el usuario asigna cuál es Nombre / Costo / Cantidad / Unidad (mapeo de columnas).
   - **PDF:** Claude ya devuelve las filas estructuradas (nombre/costo/cantidad/unidad) y el usuario las **verifica/corrige**.
   - En ambos casos: cada celda es editable, se pueden descartar filas, y se ve el subtotal.
5. El usuario confirma ("Agregar N tareas"). Al confirmar (**transacción única**, escritura atómica):
   - Se **sube el archivo** al bucket → URL.
   - Se crea un **contrato MO** en `detalle.contratos[]` (proveedor, monto, gremio = nombre del rubro, `origen:'adjunto'`, `estado:'borrador'`).
   - Cada fila se agrega como **tarea** del rubro (`costoSub` = costo, `costoMat` = 0), **linkeada al contrato** vía `tarea.contratoId`.
   - Se agrega el **adjunto** a `rubro.adjuntos[]` (con su `contratoId`).
6. El archivo queda visible como chip **"📎 nombre.pdf"** bajo el header del rubro; se puede descargar y se pueden adjuntar más.

## Modelo de datos

Todo vive dentro del `detalle` de la obra (en `ObrasContext`, escritura atómica por obra).

**Rubro** (se agregan campos, retrocompatibles — ausentes = comportamiento actual):
```js
{
  id, nombre, proveedor, margenMat, margenMO, orden, abierto, tareas: [...],
  adjuntos: [                          // NUEVO (opcional)
    { id, nombre, url, fecha, proveedor, proveedorId, contratoId }
  ],
}
```

**Tarea** (se agrega 1 campo opcional):
```js
{ id, codigo, nombre, unidad, cantidad, costoMat, costoSub, receta, avance,
  contratoId }                          // NUEVO: a qué contrato/adjunto pertenece (si vino de un presupuesto)
```

**Contrato** (en `detalle.contratos[]`, se agregan campos al shape existente):
```js
{ id, gremio, proveedor, monto, estado, fechaInicio, fechaFin, fondoReparo,  // existentes
  origen: 'adjunto',                    // NUEVO: distingue de los contratos manuales
  adjuntoId,                            // NUEVO: link al adjunto del rubro
  rubroId,                              // NUEVO: a qué rubro pertenece
  proveedorId }                         // NUEVO: link al proveedor del módulo Proveedores
```

- `gremio = rubro.nombre` al crear (para que aparezca prolijo en Contratos MO).
- `estado:'borrador'` = creado desde un presupuesto, pendiente de completar (fechas / plan de pagos / docs PADIC / seguros) en la sección Contratos MO.

## Cálculo: costo, margen, monto del contrato, avance

- **Costo unitario vs total de línea:** el campo "Costo" mapeado es el **costo unitario** (`costoSub`); el subtotal de la línea = `costoSub × cantidad`. Si el presupuesto del tercero trae **solo el total de la línea** (no el unitario), la línea se carga con **cantidad 1** y el total como costo. La pantalla de revisión muestra el subtotal por fila para que el usuario verifique que coincide con el presupuesto original.
- **Venta al cliente:** las tareas importadas son tareas normales → entran en el cálculo de venta existente (`tareaVentaUnit`): `costoSub × (1 + margenMO/100)`. **No se toca la matemática de venta.**
- **Monto del contrato:** `contrato.monto = Σ costoSub` de las tareas cuyo `contratoId === contrato.id`. Se calcula al importar y **se re-sincroniza** cuando se edita el costo de una tarea importada o se agrega/quita una tarea de ese contrato (un helper puro `montoContrato(contrato, rubro)` + actualización en el handler de edición de costos). Fuente de verdad = las tareas.
- **Avance del contrato:** para contratos `origen:'adjunto'`, el `avancePct` se calcula **desde sus tareas linkeadas** (`contratoId`), **NO** por `matchGremio`. Esto evita el bug de "dos contratos en el mismo rubro se pisan" (ver fix de `avancePct`/`matchGremio` del 2026-06-24). `matchGremio` queda para los contratos manuales/legacy.

## Resolución del proveedor (integración con módulo Proveedores)

El contrato nace en **borrador pero con las tareas ya creadas, designadas y linkeadas**. El **proveedor** se resuelve en este orden:

1. **Detección automática:** la IA (PDF) o el parseo (Excel) intentan leer el nombre del proveedor (y CUIT si aparece) del documento.
2. **Match con un proveedor ya cargado:** se busca en el módulo Proveedores (`ProveedoresContext`) por nombre/CUIT. Si matchea → se usa ese `proveedorId` (queda todo conectado: cuenta corriente, facturas, docs PADIC con su CUIT).
3. **Sin match pero con datos suficientes en el documento** (nombre + CUIT): se ofrece **"crear proveedor automáticamente"** → `addProveedor({ nombre, cuit, ... })` y se usa el nuevo `proveedorId`.
4. **No se detecta / ambiguo:** el usuario **elige de la lista de proveedores ya cargados** (selector), o crea uno a mano.

El contrato y el adjunto guardan `proveedorId` (para la integración) + `proveedor` (nombre, para mostrar). El proveedor es lo único que puede requerir intervención del usuario; las tareas y el monto se crean solos.

## Componentes

### A. UI en `ObraPresupuesto.jsx`
- Botón "📎 Adjuntar presupuesto" en la zona de agregar tareas del rubro.
- Chips de adjuntos bajo el header del rubro (nombre + descargar + quitar).
- Modal de carga (archivo + proveedor) y modal de revisión/mapeo (tabla editable).

### B. Lectura del archivo (`src/lib/presupuestoImport.js`, helpers puros)
- `parseExcel(file) → { columnas, filas }` (con `xlsx`).
- `mapearColumnas(filas, mapping) → [{ nombre, costo, cantidad, unidad }]`.
- `filasATareas(filas, { contratoId }) → [tarea]` (costo → costoSub, costoMat 0, cantidad, unidad).
- `montoContrato(contrato, rubro) → number` (Σ costoSub de las tareas del contrato).
- Estos helpers son **funciones puras y testeables** (sin React ni red).

### C. Endpoint `api/presupuesto/extraer.js`
- **Input:** `{ fileBase64, mediaType, filename }` (solo PDF/imagen; Excel NO pasa por acá).
- **Auth:** verifica que el llamador sea un usuario autenticado de Kamak (token de sesión Supabase) — **obligatorio**: el endpoint cuesta plata por llamada, no puede quedar abierto al mundo.
- **Proceso:** llama a Claude (`https://api.anthropic.com/v1/messages`, `x-api-key: process.env.ANTHROPIC_API_KEY`, mismo patrón que el bot) con un content block de tipo `document` (PDF en base64). Pide salida estructurada (tool use / JSON estricto).
- **Output:** `{ proveedor: string|null, items: [{ nombre, costo, cantidad, unidad }] }`.
- **Modelo:** `claude-sonnet-4-6` (fiable) — opción de bajar a un modelo más barato si el costo escala.

### D. Aplicar (en `ObrasContext`, atómico)
- Una sola operación que: sube el archivo, crea el contrato, agrega las tareas con `contratoId`, agrega el adjunto. Usa el patrón de escritura atómica por obra ya existente (`patchDetalle` / RPC), **nunca reescribe el detalle entero**.

### E. Integración con Contratos MO
- Los contratos `origen:'adjunto'` aparecen en la sección Contratos MO como cualquier otro, con badge "desde presupuesto" y estado "borrador".
- Su monto y avance salen de las tareas linkeadas (no editables a mano; se editan editando las tareas).
- El resto (fechas, plan de pagos, colaboradores, docs PADIC, seguros) se completa ahí como siempre.

## Manejo de errores

- **Extracción IA falla / timeout:** se avisa y se ofrece cargar a mano (no rompe el flujo).
- **PDF sin datos claros:** Claude devuelve `items: []` → se muestra tabla vacía editable (el usuario carga a mano o reintenta).
- **Subida del archivo falla:** se aborta la transacción completa (no quedan tareas/contrato sin su adjunto).
- **Usuario cancela en la revisión:** no se sube nada ni se crea nada.
- **Excel sin columnas reconocibles:** el usuario mapea manualmente (es el caso normal de Excel).

## Borrado y consistencia

- **Quitar un adjunto** ofrece quitar también sus tareas y su contrato (están linkeados por `contratoId`). Confirmación explícita (se pierde el costo importado).
- **Borrar una tarea importada** re-sincroniza el monto de su contrato.
- **Borrar el contrato** desde Contratos MO: advertir que tiene tareas/adjunto linkeados en el presupuesto.

## Permisos y seguridad

- Todo el flujo gateado a `puedeEditar` (mismo gate que editar el presupuesto).
- El endpoint de extracción **requiere auth** (anti-abuso de costo de IA).
- **Riesgo conocido (SEC-09):** el bucket `kamak-fotos` es público → los adjuntos quedan con URL pública adivinable. Aceptable por ahora (consistente con el resto de la app); ideal migrar a bucket privado + signed URLs junto con SEC-09. Documentado, no bloqueante.

## Escrituras atómicas

Reusar el patrón atómico por obra ya existente (las tareas/contratos/adjuntos son sub-objetos del `detalle`). No introducir last-write-wins. Ver [[project_array_atomic_writes]].

## Testing

- **Unit (vitest):** `parseExcel`, `mapearColumnas`, `filasATareas`, `montoContrato`, avance por `contratoId`. Casos: costo→costoSub, costoMat 0, cantidad/unidad, Σ monto, múltiples contratos en un rubro sin pisarse.
- **Manual:** endpoint de extracción con un PDF real (digital y escaneado), Excel real, flujo completo en una obra de prueba.

## Fuera de alcance (futuro, no en esta entrega)

- Camino `pdf.js` gratis para PDFs digitales (ahorro de centavos; se agrega encima sin romper nada).
- OCR propio (Tesseract).
- Carga del presupuesto por el bot de WhatsApp (posible a futuro — el bot ya habla con Claude; ver [[feedback_bot_siempre]]).
- Bucket privado + signed URLs para los adjuntos (atado a SEC-09).

## Restricciones del entorno

- **Vercel Hobby: máximo 12 functions serverless — y HOY estamos en 12/12 (al límite).** Por eso el endpoint de extracción NO se agrega como archivo nuevo (sería el 13 → rompe el deploy). Resolución elegida: **fusionar dos crons de WhatsApp** (`payment-reminders.js` + `sales-followups.js` → 1 archivo con `?job=`) para liberar un slot, y recién ahí agregar `api/presupuesto/extraer.js`. Alternativa: plan **Vercel Pro** (sin límite, pago). Ver [[project_vercel_deploy]].
- El endpoint reusa `ANTHROPIC_API_KEY` ya configurada (mismo proyecto Vercel, misma cuenta que el bot).
