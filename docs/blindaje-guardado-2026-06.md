# Blindaje del guardado — escrituras atómicas por ítem (2026-06-04)

> Cierra la familia de bugs **last-write-wins app↔bot** (CAT-003, PROV-CC-001, MOV-05 y
> la raíz SYNC-08 de `docs/AUDITORIA-kamak.md`). Commit local `eaea725`.

## Problema

Varias keys de `shared_data` guardan un **objeto con colecciones**:

| key | forma | la escribe… |
|---|---|---|
| `catalog` | `{tareas, materiales, subcontratos, mo, generales, rubros, …}` | app |
| `proveedores` | `{proveedores:[], ccEntries:[]}` | app **y bot** |
| `movimientos` | `{cajas:[], movimientos:[]}` | app **y bot** |
| `obras` | `{obras:[], detalles:{obraId:{…}}}` | app **y bot** |

La app guardaba el **blob entero** con `saveSharedData(key, todo)` y debounce (800ms).
Con dos actores escribiendo a la vez (típico: el admin edita en la app mientras el bot
de WhatsApp carga algo), el `upsert` del blob viejo en memoria **pisaba** lo que el otro
acababa de escribir (last-write-wins). Casos confirmados en la auditoría:

- **PROV-CC-001:** el bot carga una certificación/factura en `ccEntries` (atómico); la
  app, editando proveedores, sube `ccEntries` stale → **la deuda del proveedor desaparece**.
- **MOV-05:** el bot agrega un movimiento (`append_movimiento`); la app lo pisa con su
  blob → **el movimiento desaparece**.

## Solución

Escritura **atómica por ítem y por colección**, server-side, igual que ya hacía el
catálogo (RPC de `supabase/migrations/0002`, `SECURITY INVOKER` → respeta RLS). Si la
RPC no está, cae a **read-modify-write** (lee el objeto **fresco** y muta solo esa
colección — ya no pisa con la copia vieja en memoria).

Helpers genéricos nuevos en `src/lib/dbHelpers.js` (cola serial **por key** para
preservar orden sin que keys distintas se bloqueen):

```js
patchObjectItem(key, collection, id, patch)   // patch_shared_object_item
appendObjectItem(key, collection, item)       // append_shared_object_item
removeObjectItem(key, collection, id)         // remove_shared_object_item
patchDetalleObra(obraId, patch)               // patch_detalle_obra (mapa por obraId)
```

Los helpers del catálogo (`patchCatalogItem`/…) ahora **delegan** en los genéricos
(sin cambio de comportamiento). Las funciones puras `patchObjItem/appendObjItem/
removeObjItem` viven en `src/lib/catalogPatch.js` (espejo de las RPC) y son el fallback
RMW — testeadas en `catalogPatch.test.js`.

### Por contexto

- **ProveedoresContext** — `add/update/removeProveedor` y `add/update/removeCC` persisten
  solo su ítem en su colección. `removeProveedor` borra además sus `ccEntries` con un
  remove atómico por id. Se eliminó el save debounced del blob.
- **MovimientosContext** — `add/update/remove` de cajas y movimientos + `traspasar` →
  atómico por ítem. **No se reescriben las cajas al mover plata**: el saldo lo **derivan**
  app y bot (`saldoInicial + Σ efectos`, `calcSaldoCajaBot` en el bot lo confirma), el
  `caja.saldo` guardado es vestigial.
- **ObrasContext** — la lista `obras` (array) va atómica por ítem. Los `detalles` (mapa por
  obraId) se **flushean con debounce y POR OBRA** (`patch_detalle_obra`): junta el tipeo
  rápido del presupuesto y escribe una vez por obra, así editar una obra **no pisa** el
  avance que el bot puso en **otra**.

El guard de broadcast (`lastLocalSaveAt`, 3s) y el de pre-primer-fetch
(`userEditedBeforeFirstLoad`) se conservan en los tres.

## Races residuales (conocidos, acotados)

- **Mismo detalle de la MISMA obra, app y bot a la vez:** el flush por obra reemplaza las
  claves top-level del detalle → último que escribe gana. Mucho más raro que antes (era
  cualquier obra/cualquier proveedor) y de naturaleza pre-existente.
- **ComprobantesContext** sigue con `useSyncedSharedData` (blob): lo escribe **solo la app**
  (no el bot) → riesgo bajo. No convertido.
- **deleteObra** deja `detalles[obraId]` huérfano (IR-01): es integridad referencial, no
  last-write-wins; se ataca con el helper de borrado en cascada (recomendación §4 de la
  auditoría).

## Migraciones

Nada nuevo a aplicar. Las RPC `*_shared_object_item` (0002) ya están desplegadas (el
catálogo las usa y funciona) y `patch_detalle_obra` también (la usa el bot). **Pendiente
de higiene:** versionar como migración las RPC que hoy están solo desplegadas a mano
(`append_movimiento`, `append_to_shared_array`, `append_ccentry`, `patch_detalle_obra`).

## Verificación

`npx vitest run` → **308 tests** (8 nuevos: mutación por colección + propiedad de
concurrencia app↔bot). `npm run build` → OK.
