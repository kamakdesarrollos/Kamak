<!-- Re-auditoria por workflow multi-agente (33 agentes) el 2026-06-04. 44 hallazgos, 38 vigentes tras verificacion adversarial. Cruzada contra docs/AUDITORIA-kamak.md (2026-05-30). -->

# Auditoría Kamak — Estado actual (2026-06-04)

> Re-auditoría al 2026-06-04, cruzada contra la auditoría previa del 2026-05-30 (`docs/AUDITORIA-kamak.md`). Hallazgos verificados adversarialmente. Severidades = `severidad_ajustada` cuando la verificación la corrigió.

---

## 1. Resumen ejecutivo

- **Los 4-5 CRÍTICOS de plata/seguridad del 30/05 ya no aparecen en esta ronda** (MOV-01 traspaso cross-moneda ~1000x, CHQ-01 doble egreso de cheque propio, CHQ-03 bot cambia estado de cheque sin tocar caja, SEC-02 webhook sin firma Meta, DASH-01 Dashboard suma ARS+USD): se dan por **arreglados**. El defecto crítico de plata ya no está en la primera pantalla del dueño.
- **Lo más urgente que sigue abierto es exposición de plata y datos**: el bucket `kamak-fotos` sigue **público** (comprobantes con CUIT/montos por URL directa, SEC-09), el portal cliente **filtra costos y márgenes internos** del contratista (PORTAL-DATA-003), y dos pantallas más (Reportes REP-01, Movimientos MOV-02) **siguen sumando ARS+USD sin convertir** pese a que el fix `montoEnARS()` ya existe y se usa en Dashboard.
- **El patrón de integridad referencial sigue intacto**: `deleteObra` (IR-01), `removeCaja` (IR-02→media), `removeCliente` (IR-04), `removeProveedor` (IR-03) no cascadean, y renombrar un rubro (CAT-001) o un proveedor (PROV-CC-010) rompe los vínculos por nombre. Movimientos huérfanos siguen inflando saldos.
- **El patrón de concurrencia last-write-wins se confirma y se amplía**: aparecen 3 keys nuevas donde la app escribe el blob entero mientras el bot escribe atómico — **cheques, tareas y clientes** — más `portal_tokens` con read-modify-write sin atomicidad. La SYNC-03 (ventana de 3s) descarta cambios del bot de forma permanente. *(Proveedores, Movimientos y Obras ya se blindaron — ver `docs/blindaje-guardado-2026-06.md`.)*
- **Lo nuevo del código reciente (Obras/Tabs) es de bajo impacto**: bugs defensivos (`detalle.fotos.length` sin guard, `obrasYaAlertadas` module-level, carpetas en estado local que se pierden, flash de tab vacío, `getCC` sin memoizar). Ninguno es crítico.

---

## 2. Arreglado desde 2026-05-30

Inferido por ausencia en esta ronda (los CRÍTICOS previos no reaparecieron como `sigue-abierto`):

- **MOV-01** — Traspaso cross-moneda inline acreditaba sin convertir (~1000x).
- **CHQ-01 (previo)** — "Acreditado" de cheque propio hacía doble egreso.
- **CHQ-03 (previo)** — El bot cambiaba estado de cheque sin ajustar la caja.
- **SEC-02** — Webhook de WhatsApp sin validación de firma X-Hub-Signature-256.
- **DASH-01** — Dashboard sumaba ARS+USD como pesos (hoy usa `montoEnARS` en `Dashboard.jsx:79-80,97-98`).
- **PORTAL-DATA-003 (parcial)** — Token de portal bajado de 365 a 90 días (`webhook.js:618`). *El resto del hallazgo sigue abierto (CORS y fuga de costos).*
- **CAT-003 / PROV-CC-001 / MOV-05** — Escrituras atómicas por ítem en catálogo, proveedores y movimientos (commit `eaea725`, `docs/blindaje-guardado-2026-06.md`).
- **IR-03 (parcial)** — `removeProveedor` ahora **sí** cascadea `ccEntries` atómicamente (`ProveedoresContext.jsx:180-182`). *El HABER/pagos sigue colgado.*

> Nota: confirmar contra el commit log es recomendable; aquí se infiere por no-reaparición en la ronda verificada.

---

## 3. CRÍTICOS y ALTOS que SIGUEN ABIERTOS

Ordenados por riesgo de plata/seguridad.

| id | título | ubicación | fix (1 línea) |
|---|---|---|---|
| **SEC-09** (alta) | Bucket `kamak-fotos` público: comprobantes con CUIT/montos por URL directa | `supabase/migrations/0004_storage_kamak_fotos.sql:13-15`; `0001_rls.sql:170-173` | Pasar bucket a privado + migrar portal y app a `createSignedUrl()` con expiración. |
| **PORTAL-DATA-003** (alta) | Portal cliente devuelve `detalle` crudo con costos/márgenes internos + CORS `*` | `api/portal/data.js:31,58,97`; `validate-token.js:5` | Proyectar `detalle` a campos visibles `{nombre,unidad,cantidad,avance}`; restringir CORS a kamak.com.ar. |
| **REP-01** (alta) | Reportes: facturación y costo YTD suman ARS+USD sin convertir (también topProveedores) | `src/pages/Reportes.jsx:60-61,91` | Importar `montoEnARS` de `../lib/caja` y usar `s + montoEnARS(m, cajas, tc)`. |
| **MOV-02** (alta) | Movimientos: KPIs Ingresos/Gastos/Neto del mes suman ARS+USD sin convertir | `src/pages/Movimientos.jsx:1193-1195` | Importar `montoEnARS` y aplicarlo en `totalIngresos`/`totalGastos`. |
| **FAC-001** (alta) | IIBB devengado se calcula sobre total con IVA, no neto gravado (~+21%) | `src/pages/Facturacion.jsx:926,949` | Acumular `c.neto` en lugar de `c.total` en línea 926. |
| **IR-01** (alta) | `deleteObra` sin cascada: movimientos/ccEntries/detalles huérfanos siguen contando | `src/store/ObrasContext.jsx:357-362` | `deleteObraConVinculos`: remover movimientos/ccEntries con `obraId===id` y borrar `detalles[id]`. |
| **CAT-001** (alta) | Renombrar rubro no cascadea a `tareas[].rubroNombre` → APUs desagrupadas, rompe `generarTareasObra` | `src/store/CatalogContext.jsx:197-217` (guard línea 205) | En `update()` detectar `coll==='rubros'` y propagar `tareas[].rubroNombre`/`materiales[].rubro`/`mo[].oficio` en un `setCatalog`. |
| **cheques LWW** (alta) | App escribe blob entero de `cheques`, bot escribe atómico → pisa appends/patches del bot | `src/store/ChequesContext.jsx:14`; `src/lib/useSyncedSharedData.js:155` | Migrar a `appendItemInSharedArray`/`patchItemInSharedArray`/`removeItemInSharedArray` (como Movimientos/Proveedores). |
| **tareas LWW** (alta) | App escribe blob entero de `tareas`, bot escribe atómico → borra tarea nueva o revierte patch de avance | `src/store/TareasContext.jsx:33`; `src/lib/useSyncedSharedData.js:155` | Mismo patrón atómico por id que cheques. |
| **FAC-010** (alta) | No hay botón para anular un comprobante emitido desde la UI | `src/pages/Facturacion.jsx:803-840` | Agregar botón "Anular" (con confirm) que llame `updateComprobante(c.id,{estado:'anulado'})`. |
| **MOCK-02 / PortalProveedor** (alta→media) | Ruta pública `/portal/proveedor` sin token: datos hardcodeados de proveedor ficticio | `src/pages/portal/PortalProveedor.jsx:1-205`; `src/App.jsx:230` | Agregar guard de token (`/portal/proveedor/:token`) o redirigir a "en construcción"; quitar de producción. |

> Severidades ajustadas en verificación: PROV-CC-003 baja a **media** (vector real solo vía QuickAddForm USD, no vía Registrar Pago); IR-02 baja a **media**; MOCK-02 a **media** (tiene banner "maqueta de demostración").

---

## 4. Hallazgos NUEVOS (verificados) en el código reciente

| título | severidad | ubicación | fix |
|---|---|---|---|
| `clientes`: app escribe blob entero, bot escribe atómico → pisa el teléfono que el bot vinculó (onboarding WhatsApp) | media | `src/store/ClientesContext.jsx:19`; `useSyncedSharedData.js:155`; bot `webhook.js:661,3585` | Migrar a `patchItemInSharedArray` o separar campo `telefono` solo-bot. |
| `portal_tokens`: bot hace read-modify-write completo sin atomicidad → race entre invocaciones concurrentes | media | `api/whatsapp/webhook.js:619-626,3793-3799` | RPC atómico `patch_shared_object_item` o tabla dedicada por token. |
| `obrasYaAlertadas` es `Set` module-level: sobrevive remount/sesión y silencia la alerta para siempre | media | `src/store/ObrasContext.jsx:15` | Mover dentro del Provider como `useRef(new Set())` y pasar `.current`. |
| `dirtyDetalles` flush al desmontar no chequea `sbLoaded` → puede persistir datos vacíos/semilla en montaje frío | baja | `src/store/ObrasContext.jsx:308-315` | (Bajo: el set solo se llena con ediciones del usuario; revisado.) |
| `TabFotos`: `detalle.fotos.length` sin guard → TypeError en obra vieja sin clave `fotos` | baja | `src/pages/obra/ObraPresupuesto.jsx:3941` | Cambiar a `{(detalle.fotos || []).length} fotos`. |
| `carpetasExtra` (TabDocumentos/TabFotos) en `useState` local → carpetas vacías se pierden al cambiar de tab | baja | `src/pages/obra/tabs/TabDocumentos.jsx:99`; `ObraPresupuesto.jsx:3804` | Derivar carpetas de `usadas` (detalle persistido) o persistir `carpetasExtra` en el detalle. |
| `Obras.jsx`: `getCC` se llama 3×N por render sin memoizar → O(n×movimientos) en cada keystroke del buscador | baja | `src/pages/Obras.jsx:475-496` (y `:653`) | `const ccMap = useMemo(...)` cacheando `ccObra` por obra, deps `[finalizadas, movimientos, cajas, tc]`. |
| `Tareas.jsx`: tab inicial `''` → `tareasVisibles` vacía en el primer render (flash de lista en blanco) | baja | `src/pages/Tareas.jsx:466-478` | Inicializar `tab` en lazy con el contexto, o asumir el flash de 1 frame. |
| `RegistrarPagoModal`: `fondoReparo:false` se serializa siempre en el payload (feature deshabilitada) | baja | `src/pages/modales/RegistrarPagoModal.jsx:31,62` | Omitir `fondoReparo` del payload de `addMovimiento` hasta implementar la retención. |

> **SYNC re-verificados (siguen abiertos):** SYNC-03 (media) ventana de 3s descarta broadcast del bot sin reintento — diferir `setTimeout(()=>loadSharedData(key).then(merge), 3500)`; SYNC-01 (baja/media) keepalive cae a anonKey, write rechazado por RLS silencioso — abortar si no hay `access_token`; SYNC-02 (baja) keepalive/silent no emite `broadcastChange`; SYNC-07 (baja) `userEditedBeforeFirstLoad` no sube el cambio si el fetch da `undefined`.
> **También abiertos:** IR-04 (media) `removeCliente` sin cascada; IR-03 (media) pagos colgados tras `removeProveedor`; PROV-CC-010 (media) renombrar proveedor desvincula pagos por nombre; PROV-CC-003 (media) saldo proveedor mezcla monedas vía QuickAddForm USD; CHQ nuevos (media/baja) totales de cheques por vencimiento/header/7d mezclan ARS+USD en `Cheques.jsx:81,914-915,701`; GLB-02 (media) `fechaRelativa()` usa `toISOString()` en `dates.js:54`; FAC-003 (media) alícuota 21% hardcodeada en `desglosarCompraBot` (`webhook.js:97-98`); MOCK-01/03/04/05.

---

## 5. Quick wins recomendados para la próxima tanda

En orden de impacto/esfuerzo. Los primeros son cambios de pocas líneas que tapan plata o seguridad confirmada y reusan helpers que ya existen.

1. **REP-01 + MOV-02** — importar `montoEnARS` en `Reportes.jsx:60-61,91` y `Movimientos.jsx:1193-1195`. *El helper ya está en `lib/caja.js` y se usa en Dashboard; 2 archivos, corta la mezcla ARS+USD en dos pantallas de plata.*
2. **FAC-001 IIBB** — acumular `c.neto` en lugar de `c.total` en `Facturacion.jsx:926`. *Una línea; corrige un anticipo IIBB sobreestimado ~21%.*
3. **`detalle.fotos.length` guard** — `(detalle.fotos || []).length` en `ObraPresupuesto.jsx:3941`. *Una línea; evita TypeError que rompe TabFotos en obras viejas.*
4. **GLB-02 `fechaRelativa`** — reemplazar `toISOString()` por componentes locales en `dates.js:54`. *Una línea; tapa el salto de día post-21:00 en vencimientos/cheques.*
5. **FAC-010 anular comprobante** — botón "Anular" con confirm que llame `updateComprobante(c.id,{estado:'anulado'})` en `Facturacion.jsx:803-840`. *El estado `anulado` y los filtros ya existen; solo falta exponerlo en UI.*
6. **`obrasYaAlertadas` a useRef** — moverlo dentro del Provider en `ObrasContext.jsx:15`. *Pocas líneas; deja de silenciar alertas legítimas entre sesiones/remounts.*
7. **MOCK-02 PortalProveedor / MOCK-03/04 mobile sin guard de rol** — guard de token/rol o redirect a "en construcción" (`App.jsx:230,260,261`). *Cierra rutas mock accesibles; bajo esfuerzo.*
8. **cheques + tareas LWW a escrituras atómicas** — `ChequesContext.jsx:14` y `TareasContext.jsx:33` a `appendItemInSharedArray`/`patchItemInSharedArray`/`removeItemInSharedArray`. *Mayor que una línea pero el patrón ya está hecho en Movimientos/Proveedores; cierra dos races altos donde el bot pisa al app.*

> Después de los quick wins, las dos inversiones estructurales siguen vigentes desde el 30/05: (a) **helper central de borrado con cascada** (`deleteObraConVinculos`, `removeCajaConGuard`, `removeClienteConGuard`) + migración de vínculos por nombre a id (IR-01/02/03/04, CAT-001, PROV-CC-010); (b) **escrituras atómicas por id desde la app** para cerrar la familia last-write-wins (cheques, tareas, clientes, `portal_tokens`, SYNC-03/08).
