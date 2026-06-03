# Auditoría Kamak — fallas, incongruencias y propuesta de mejora

Generada por auditoría multi-agente (6 dimensiones en paralelo + verificador adversarial). **37 hallazgos confirmados** contra el código, **13 descartados** como falsos positivos. Consolidados en ~18 problemas únicos.

> ⚠️ **NADA de esto está aplicado todavía.** Es una propuesta para revisar y priorizar. Los fixes tocan producción → conviene aplicarlos con vos despierto y coordinando el refresh de las pestañas.

Hilo conductor: casi todos los problemas serios son de **dos familias** que ya venimos viendo:
1. **Concurrencia / "aparece y desaparece"** (guardado de blob entero + guards de broadcast faltantes o inertes).
2. **Enlaces por NOMBRE en vez de por ID** (renombrar algo rompe referencias en silencio).

---

## 🔴 CRÍTICOS (alta) — recomiendo atacar primero

### A. El catálogo tiene el MISMO bug que tenían las plantillas (guard inerte) — ACTIVO
`src/store/CatalogContext.jsx:112,166,190-211`
El guard de 3s existe y se chequea (línea 166), **pero `lastLocalSaveAt.current` NUNCA se setea** en add/update/remove (no hay `touch()`). Y `pendingSaveRef` es código muerto (nunca se asigna). ⇒ Editás un material / una tarea estándar / tareasBase de un tipo, y un broadcast de la otra persona puede pisarlo (igual que "aparece y desaparece" en plantillas). **Es el mismo bug que arreglamos anoche, pero en el catálogo, y está activo.**
**Fix (chico y seguro, ya probado en Plantillas):** agregar `const touch = () => { lastLocalSaveAt.current = Date.now(); }` y llamarlo en `add/update/remove/bulkSeed/bulkUpdatePreciosCAC`. Limpiar o implementar `pendingSaveRef`.

### B. Obras y Proveedores guardan el BLOB ENTERO (pérdida de datos con 2 personas)
`src/store/ObrasContext.jsx:263-272`, `src/store/ProveedoresContext.jsx:144-152`
Persisten `{ obras, detalles }` / `{ proveedores, ccEntries }` completos con debounce. Dos personas editando **obras distintas** → el último guardado pisa al otro (last-write-wins). Es el bug que ya sacamos de Catálogo y Plantillas, pero acá sigue. Afecta presupuestos (los detalles de obra viven acá).
**Fix:** migrar a escritura atómica por ítem (RPC nueva 0004 para objetos tipo diccionario, o key por obra `obras_detalle_<id>`). Es el cambio más grande de la lista.

> 🎯 **REQUISITO DEL USUARIO (2026-06-03): edición colaborativa del presupuesto EN VIVO.**
> Cuando 2 usuarios están en el MISMO presupuesto y uno modifica algo (cantidad, rubro, tarea, plan de pagos…), el otro **no lo ve en vivo** — tiene que verlo **en directo, por cada movimiento**.
> Hoy: el detalle de obra se guarda como blob entero con debounce de ~800ms + broadcast → la otra pestaña recién recarga al recibir el broadcast (y si ambos editan, el guard de 3s puede demorar/suprimir la actualización). Además `ObraPresupuesto` puede tener estado local del detalle que no se re-renderiza con el cambio remoto.
> Para lograrlo hace falta: (1) **escritura atómica por ítem** del detalle (fix B) para que cada cambio viaje granular sin pisar; (2) que `ObraPresupuesto` lea el detalle SIEMPRE en vivo del context (sin copia local stale); (3) idealmente **Supabase Realtime (postgres_changes)** sobre `shared_data` para *push* instantáneo en vez del broadcast+reload, o al menos bajar el debounce y refinar el guard para que NO suprima los cambios del OTRO usuario (el guard solo debe ignorar los propios). Es una funcionalidad, no solo un bug — planificar junto con B.

### C. Re-aprobar un presupuesto reabierto genera tareas inconsistentes
`src/pages/obra/ObraPresupuesto.jsx` (handleReopen) + `src/lib/generarTareasObra.js:71`
Al reabrir, se pone `presupuestoAprobado=false` pero **no se limpia `tareasGeneradas`**. Si modificás el presupuesto y re-aprobás, los rubros ya marcados no regeneran sus tareas; rubros viejos por ID quedan "ya aplicados".
**Fix:** en handleReopen, resetear `tareasGeneradas: { tipoIdAplicado:null, rubrosAplicados:[], apusAplicados:[] }`.

### D. Editor de tareas estándar con roles FANTASMA
`src/pages/modales/TareasEstandarEditor.jsx:14` + `src/pages/Catalogos.jsx` (tabs Rubros y Tipos de obra)
El editor usa `ROLES_DEFAULT = ['Admin','Comprador','Director de obra','Capataz','Administración']`, pero esos 3 del medio **no existen** en el sistema (los roles reales: Admin, Administración, Jefe de obra, Logística y compras, Contador externo). En las tabs **Rubros** y **Tipos de obra** no se le pasan los roles reales → si elegís "Comprador", la tarea se asigna a un rol inexistente y termina cayendo en **Admin**. **Afecta directamente las tareas disparadoras que cargamos.**
**Fix:** pasar `roles={Object.keys(ROLES)}` en las dos tabs (la tab APU ya lo hace bien) y borrar la lista hardcodeada.

### E. Renombrar un rubro/tipo de obra rompe enlaces en silencio
`src/store/CatalogContext.jsx:198-201` + `src/lib/generarTareasObra.js:82,99-102`
`cascadeRename` solo propaga a materiales/MO/generales, **no a rubros ni tipos de obra**. Y `generarTareasObra` matchea tipo/rubro **por nombre normalizado**. Si renombrás un rubro o tipo, los presupuestos viejos dejan de generar sus tareas — sin ningún aviso.
**Fix (corto):** extender cascadeRename a rubros/tipos (parchear presupuestos que los referencian). **Fix (de fondo, recomendado):** que presupuestos/plantillas guarden `rubroId`/`tareaId`/`tipoObraId` y matchear por ID, con el nombre solo para mostrar.

### F. Reseed de plantillas destructivo
`src/store/PlantillasContext.jsx:477-490, 505-516`
Si se bumpea `PLANTILLAS_SEED_VERSION` (o se limpia el localStorage), `needsReseed` **sobreescribe TODAS las plantillas remotas con el SEED** (borra las creadas por el usuario, ej. "Puma Shop Express"). Además hay una ventana de 1-2s al cargar donde una edición se puede pisar.
**Fix:** mergear (mantener las del usuario, agregar/actualizar solo las del SEED) en vez de reemplazar; y bloquear edición hasta que termine la carga remota.

### G. (Seguridad) Datos financieros sin filtrar por usuario / sin RLS por caja
`src/pages/obra/ObraPresupuesto.jsx` (TabCuentaCliente/Corriente) + `supabase 0001_rls.sql`
Las pestañas de cuenta del cliente/corriente calculan sobre **todos** los movimientos/cajas sin filtrar por `cajasDelUsuario`, y la RLS deja leer las keys operativas a cualquier autenticado. Un no-admin podría ver cobros/saldos de cajas ajenas vía DevTools.
**Fix:** filtrar por `cajasDelUsuario(currentUser)` en esas pestañas y/o RLS por caja en Supabase.

---

## 🟡 MEDIOS

- **H. Auto-aprobar al cobrar (Pieza 2) sin `catalog` en deps** (`ObraPresupuesto.jsx`): si el catálogo carga tarde, el cobro dispara la aprobación con catálogo vacío → **0 tareas generadas para siempre** (el ref bloquea reintento). Fix: agregar `catalog` a deps o condicionar a `catalog?.tareas?.length > 0`.
- **I. ConfiguracionContext sin guard de broadcast** (3s + pendingSaveRef): editar config con 2 usuarios puede perder cambios. Fix: mismo patrón que los demás.
- **J. AlertasContext**: `onRemoteChange` sin guard + `marcarTodasLeidas` guarda el blob entero (pisa marcas atómicas que llegan del bot). Fix: guard + marcar leídas por ítem.
- **K. Borrar un material/MO no limpia las APUs que lo usan** (`CatalogContext.jsx:211`): quedan ítems "SIN CATÁLOGO". Fix: `cascadeRemove` o avisar "está en N tareas".
- **L. Resolver por nombre con duplicados** (`apuPriceResolver.js`): si dos ítems normalizan al mismo nombre, el índice se pisa silenciosamente. Fix: warning al construir el índice + matchear por ID.
- **M. Plantillas no avisan APU inexistente** (`Plantillas.jsx:35-58`): una tarea sin APU muestra $0 sin marcar (el catálogo sí marca "SIN CATÁLOGO"). Fix: badge de "sin datos".
- **N. Plantilla hereda tipo de obra** que si no matchea un `tipoObra` no genera tareasBase, sin aviso. Fix: validar/seleccionar tipo.
- **O. 'Admin' vs 'Administración'**: nombres confusos; varios checks usan `=== 'Admin'` (excluye Administración). Fix: documentar jerarquía / renombrar.

## 🟢 BAJOS / deuda técnica
- **P. PlantillasContext** sin `pendingSaveRef` en el guard (menor: ya no usa debounce).
- **Q. Plantillas sin migración de shape** (otros contexts sí tienen versionado).
- **R. cascadeRename usa `catalogRef.current`** (race solo si 2 renames en <100ms).
- **Rubro "7 - Mampostería" tiene 4 variantes**: si un presupuesto usa 2, dispararía el "Contrato albañilería" 2 veces (cada variante es un rubro distinto). A vigilar al usar las tareas disparadoras.

---

## Plan de acción sugerido (orden por impacto/esfuerzo)

| # | Fix | Impacto | Esfuerzo |
|---|---|---|---|
| 1 | **A** — `touch()` en CatalogContext (guard inerte) | 🔴 alto (bug activo) | chico |
| 2 | **D** — roles reales en TareasEstandarEditor | 🔴 alto (afecta tareas disparadoras) | chico |
| 3 | **C** — limpiar tareasGeneradas al reabrir | 🔴 alto | chico |
| 4 | **H** — `catalog` en deps de Pieza 2 | 🟡 medio | chico |
| 5 | **F** — reseed de plantillas no destructivo | 🔴 alto | medio |
| 6 | **E** — cascade/IDs para rubros y tipos | 🔴 alto | medio-grande |
| 7 | **B** — Obras/Proveedores a escritura atómica | 🔴 alto | grande |
| 8 | **G** — filtrado/RLS financiero | 🔴 alto (seguridad) | medio |
| 9 | I, J, K, L, M, N, O | 🟡 medio | varios |

Los 1-4 son fixes chicos y de bajo riesgo (varios idénticos al que ya hicimos en Plantillas) — se pueden agrupar en un solo deploy.
