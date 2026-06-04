<!-- Auditoria generada por workflow multi-agente (67 agentes) el 2026-05-30. Hallazgos verificados adversarialmente. -->

# Auditoría Técnica y de Negocio — App Kamak (Gestión de Obras)

> Consolidación de 176 hallazgos técnicos (verificados adversarialmente) + 37 recomendaciones de negocio de 5 expertos en construcción. Las severidades reflejan la verificación adversarial: varios hallazgos fueron **rebajados** respecto de su severidad original cuando el impacto declarado no se sostuvo al leer el código.

---

## 1. Resumen ejecutivo

- **Hay 4 bugs CRÍTICOS confirmados, todos de plata o de seguridad**: (1) traspaso cross-moneda inline que acredita sin convertir (~1000x), (2) "acreditar" un cheque propio genera un doble egreso, (3) el bot cambia estado de cheque sin tocar la caja (depósitos que no llegan al banco / rechazos que dejan plata fantasma), (4) el webhook de WhatsApp **no valida la firma de Meta** → suplantación total de un Admin. A esto se suma el Dashboard sumando ARS+USD como si fuera una sola moneda.
- **El defecto transversal nº1 es la mezcla de monedas sin conversión**: aparece en Dashboard, Reportes, bot (resumen/obra/CC proveedor), traspasos, cheques USD y saldos de CC de proveedor. Cualquier movimiento en caja USD distorsiona los números.
- **El segundo patrón transversal es la falta de integridad referencial**: `deleteObra`, `removeCaja`, `removeProveedor`, `removeCliente` y el rename de rubros/proveedores **no cascadean**, dejando movimientos, cheques, CC y tareas huérfanos que siguen (o dejan de) impactar saldos.
- **Tercer patrón: concurrencia last-write-wins**. La app persiste blobs completos (movimientos, catálogo, comprobantes, proveedores, alertas) mientras el bot escribe atómico; una ventana de 800ms–3s puede pisar datos del bot de forma silenciosa.
- **El rol "Contador externo" está completamente roto** (se compara contra el literal `'Contador'` que ningún usuario tiene): no puede entrar a Facturación y a la vez no queda confinado. Reportado 3 veces (AUTH-001, SEC-03, GLB-01) — es **un solo bug**.
- **Fechas en UTC** (`toISOString()`) fechan movimientos/cheques/tareas un día adelante después de las 21:00 ARG, saltando de mes y descuadrando cierres y Libro IVA. Facturación ya lo arregló; el resto no.
- **Varias pantallas "feature" son mockups hardcodeados**: Conciliación bancaria, Portal Proveedor, app mobile Director/Comprador. Aparentan funcionar pero no persisten nada.
- **Conteo por severidad (post-verificación, deduplicado):** Crítica **4** · Alta **~18** · Media **~70** · Baja **~40**. (Los duplicados Contador externo y deleteObra/removeCaja se cuentan una sola vez.)

**Estado de verificación:** los hallazgos marcados `confirmado` fueron leídos en el código real con evidencia archivo:línea. Los marcados **(no verificado)** son análisis no contrastados adversarialmente — tratar como probables pero a confirmar antes de tocar código.

---

## 2. Bugs críticos y altos CONFIRMADOS

### 2.1 CRÍTICOS (plata / seguridad)

#### MOV-01 — Traspaso cross-moneda inline acredita SIN convertir (~1000x) ✅ verificado
- **Ubicación:** `src/pages/Movimientos.jsx:156-166` (save) y `:150-152`; efecto en `src/store/MovimientosContext.jsx:212`; acreditación en `src/lib/caja.js:15`.
- **Impacto:** `TraspasoForm` calcula y muestra `montoDestino` correcto en la UI pero NO lo envía en `onSave`. El context cae al fallback `montoDestino = monto`, así $1.000.000 ARS → caja USD acreditan **1.000.000 USD**. El `TraspasoModal` (aparte) sí lo manda bien → mismo concepto, dos comportamientos.
- **Fix:** en `save()` incluir `montoDestino: isCross ? Math.round(montoDestino) : null`. Mejor: centralizar el cálculo cross-moneda en `traspasar()` para que ningún llamador pueda olvidarlo.

#### CHQ-01 — "Acreditado" de un cheque PROPIO hace doble egreso ✅ verificado
- **Ubicación:** `src/pages/Cheques.jsx:244-246` (botón), `791-826` (handleDepositar), `962-967` (modal reusado).
- **Impacto:** un cheque propio ya descontó la caja al emitirse (gasto). "Acreditar" reusa `handleDepositar`, que hace un `traspasar` desde la caja de origen al banco → la caja de origen **queda en −2x el monto**. Cada acreditación de cheque propio pierde `monto` de forma silenciosa.
- **Fix:** para cheques propios, "acreditado" debe ser **solo cambio de estado** (sin movimiento/traspaso). Separar el handler de propios del de terceros; el copy "el ingreso ya fue acreditado al recibirlo" es para terceros.

#### CHQ-03 — El bot cambia estado de cheque sin ajustar la caja ✅ verificado
- **Ubicación:** `api/whatsapp/webhook.js:2959-2974` (`estado_cheque`) vs `src/pages/Cheques.jsx:791-826,861-867`.
- **Impacto:** "deposité el cheque 4421" por WhatsApp solo hace `sbPatchItem('cheques',...)`: el depósito **no llega al banco** (plata sigue en caja origen) y "rechazaron el 4421" **deja el ingreso original sumando** (plata fantasma). La app sí ajusta la caja; el bot no. Se dispara con lenguaje natural cotidiano.
- **Fix:** replicar la lógica de la app en `estado_cheque`: depósito → traspaso caja→banco; rechazo → movimiento de reversa del ingreso original (atómico vía `append_to_shared_array`).

#### SEC-02 — El webhook de WhatsApp no valida la firma X-Hub-Signature-256 de Meta ✅ verificado
- **Ubicación:** `api/whatsapp/webhook.js:3609-3768` (handler), `3680` (`const phone = message.from`).
- **Impacto:** el handler solo chequea `body.object` e identifica al remitente por `message.from` (campo del propio body, atacante-controlable). Quien conozca la URL pública y el teléfono de un Admin puede **forjar movimientos de caja, traspasos, pagos a proveedores y aprobar pendientes** como ese Admin. No hay `createHmac`/App Secret en todo `api/`.
- **Fix:** validar HMAC-SHA256 del raw body con el App Secret de Meta (comparación timing-safe), rechazar 403 si no coincide. Control estándar y documentado por Meta.

#### DASH-01 — Dashboard suma ARS + USD como si todo fuera pesos ✅ verificado
- **Ubicación:** `src/pages/Dashboard.jsx:76-78, 83, 94-95, 415-417`.
- **Impacto:** "Ingresos/Gastos/Neto del mes", "Top proveedores" y el gráfico Cash Flow suman `m.monto` crudo sin mirar `caja.moneda`. Un ingreso de U$S 5.000 se suma como 5.000 "pesos". El **Neto puede invertir su signo**. Es la primera pantalla que ve el dueño. (Hoy el seed no tiene movimientos en caja USD, así que el bug se "duerme" hasta el primer movimiento USD real, pero la app soporta obras USD.)
- **Fix:** función compartida `montoEnARS(m, cajas, tc)` (reusar lógica de `cobradoObraUSD` en `helpers.js:86-94`) y usarla en KPIs, cashFlow y topProvs.

### 2.2 ALTOS confirmados

#### Rol "Contador externo" roto — AUTH-001 = SEC-03 = GLB-01 (UN solo bug, reportado 3 veces) ✅ verificado
- **Ubicación:** `src/pages/Facturacion.jsx:368-370`; `src/App.jsx:86`; `src/components/layout/Sidebar.jsx:20,66` — todos comparan contra el literal `'Contador'`, pero el rol real es `'Contador externo'` (`src/store/UsuariosContext.jsx:21`, `src/lib/constants.js:33 ROL_CONTADOR`).
- **Impacto:** **doble fallo**: (a) el contador es expulsado de Facturación (su única pantalla) a `/`; (b) el redirect de confinamiento no dispara → navega por Dashboard/Movimientos/Cajas según permisos heredados. La sobre-exposición está acotada a esos flags (no hay escalada a Admin).
- **Fix:** reemplazar los 4 literales `'Contador'` por `ROL_CONTADOR` de `constants.js`. Agregar lint que prohíba comparar `rol` contra literales no listados en `ROLES`.

#### OPG-01 — Datos semilla usan `costoMO` pero el cálculo lee `costoSub` → costos/ventas subvaluados ✅ verificado
- **Ubicación:** `src/store/ObrasContext.jsx:32-70,128-139` (`costoMO`) vs `src/pages/obra/helpers.js:187-208` (`costoSub`); render en `ObraPresupuesto.jsx:795,1414-1415`.
- **Impacto:** la mano de obra del seed (ej. bocas de luz: costo real 4000/u, computado 1000/u) **desaparece del costo, la venta y el margen**. Afecta toda obra que nazca del seed (incluida la estrella Baradero) o import legacy con `costoMO`. Las tareas creadas por la UI actual sí usan `costoSub`.
- **Fix:** que los helpers lean `t.costoSub ?? t.costoMO ?? 0` (cubre también datos persistidos legacy), o migración one-shot `costoMO→costoSub`.

#### CAT-001 — Renombrar un rubro deja huérfanas todas sus APUs/materiales/MO/tareas (referencia por nombre) ✅ verificado
- **Ubicación:** `src/pages/Catalogos.jsx:876-881` + `src/store/CatalogContext.jsx:159`.
- **Impacto:** `update('rubros',...)` solo cambia el nombre; todas las entidades referencian al rubro por **string** (`tareas[].rubroNombre`, `materiales[].rubro`, `mo[].oficio`). Renombrar "PINTURA"→"PINTURAS" desagrupa todo y **rompe la auto-generación de tareas estándar** al aprobar presupuestos (`generarTareasObra.js:97-104` matchea por nombre). Sin aviso. Recuperable renombrando de vuelta.
- **Fix:** cascadear el rename en una sola `setCatalog` (actualizar `rubroNombre`/`rubro`/`oficio`), o migrar a `rubroId`. Mientras tanto, advertir en el confirm.

#### CAT-003 — Persistencia del catálogo last-write-wins del objeto completo ✅ verificado
- **Ubicación:** `src/store/CatalogContext.jsx:143-152, 104-140`; `dbHelpers.js:134-137`.
- **Impacto:** `saveSharedData('catalog', catalog)` hace upsert del objeto entero con debounce 800ms; dos editores casi simultáneos (multi-pestaña/multi-usuario) pierden ítems. Existe `patchItemInSharedArray` atómico que NO se usa acá. (El bot **no** escribe la key `catalog`, así que el vector "usuario+bot" no aplica; el catálogo se edita con baja frecuencia → explotabilidad media.)
- **Fix:** merge por colección/id antes del upsert o RPC de merge server-side; revisar coordinación de `fromRemote`.

#### MOV-02 — El bot ejecuta traspasos cross-moneda sin convertir si falta TC ✅ verificado
- **Ubicación:** `api/whatsapp/webhook.js:1883` y `:1875-1913`.
- **Impacto:** `const montoDestino = parseFloat(datos.montoDestino) || monto;` — sin validación dura. Si el LLM no pregunta el TC, acredita el mismo número en otra moneda. La app sí protege (calcula la conversión).
- **Fix:** si las monedas difieren y no viene `montoDestino`/TC, **no ejecutar**: pedir el TC. Recién con `montoDestino>0` registrar.

#### CHQ-02 — Cheques USD se fuerzan a caja ARS y suman como pesos ✅ verificado
- **Ubicación:** `src/pages/Cheques.jsx:264,358-363,370,766-780,706-727`; `src/lib/caja.js:10-22`.
- **Impacto:** el modal permite moneda USD pero el `<select>` de caja solo lista cajas ARS; tampoco propaga `moneda` al movimiento. Un cheque USD 5.000 suma 5.000 "pesos" a una caja ARS, corrompiendo `totalARS`. Hay cajas USD reales en el seed.
- **Fix:** filtrar cajas seleccionables por moneda del cheque, propagar `moneda`, y convertir/bloquear con `montoDestino`/`tcAplicado` como ya hace `traspasar`.

#### CHQ-05 — `daily-summary` nunca reporta cheques por vencer (shape equivocado) ✅ verificado — *(= WA-01, duplicado)*
- **Ubicación:** `api/whatsapp/daily-summary.js:188` vs `api/whatsapp/webhook.js:2732,2964`; `src/store/ChequesContext.jsx:14`.
- **Impacto:** la key `cheques` es un array plano; `chequesData?.cheques` da `undefined → []`. La sección "Cheques por vencer ≤3 días" del resumen diario **nunca dispara**. El webhook sí normaliza con `Array.isArray`.
- **Fix:** `const cheques = Array.isArray(chequesData) ? chequesData : (chequesData?.cheques || [])`.

#### CHQ-06 — `reactivarCheque` borra `movimientoId` → ingreso original huérfano ✅ verificado
- **Ubicación:** `src/store/ChequesContext.jsx:63-69`; `src/pages/Cheques.jsx:731-738,861-867`.
- **Impacto:** recibir→rechazar→reactivar→eliminar deja **+100 fantasma** en caja sin cheque que lo respalde. El borrado posterior no limpia nada porque `movimientoId` quedó null.
- **Fix:** no nullear `movimientoId` si el ingreso original sigue vivo; idealmente registrar un array de ids de todos los movimientos del cheque y revertir todos al eliminar.

#### CHQ-07 — Depositar/endosar/rechazar generan movimientos no vinculados al cheque ✅ verificado
- **Ubicación:** `src/pages/Cheques.jsx:799-824,830-859,706-728,735`.
- **Impacto:** el borrado solo revierte `cheque.movimientoId` (el ingreso original). Los traspasos/gastos/ingresos de depósito/endoso/rechazo no guardan su id → al borrar un cheque no-cartera quedan movimientos colgados y saldos inconsistentes.
- **Fix:** persistir los ids de TODOS los movimientos derivados y revertirlos al borrar, o impedir eliminar cheques con estado ≠ cartera/anulado.

#### PROV-CC-001 — Race: el save de la app pisa asientos de CC que el bot escribió atómicamente ✅ verificado
- **Ubicación:** `src/store/ProveedoresContext.jsx:144-153`; `api/whatsapp/webhook.js:134-144, 2192-2205`.
- **Impacto:** cuando el admin **edita activamente** proveedores/CC, el guard de 800ms–3s ignora el broadcast del bot y el save sube `ccEntries` stale, **pisando la certificación/factura (DEBE) que cargó el bot** → deuda del proveedor desaparece, saldo incorrecto, silencioso. (El caso idle sí está cubierto por `fromRemote`.)
- **Fix:** persistir `ccEntries` vía RPC atómico append/patch por id desde la app, o separar `proveedores` y `ccEntries` en keys distintas y mergear por id.

#### PROV-CC-003 — Saldo del proveedor mezcla ARS y USD sin conversión ✅ verificado
- **Ubicación:** `src/store/ProveedoresContext.jsx:61-82`; `api/whatsapp/webhook.js:1834-1862, 2857-2869`.
- **Impacto:** `debe - pagado` suma `monto` de gastos sin mirar `caja.moneda`. Un pago de USD 1.000 desde caja USD resta $1.000 ARS de una deuda en pesos → se muestra "Al día" a quien aún se le debe. El bot acepta cualquier `cajaId` (la app filtra solo ARS).
- **Fix:** resolver la moneda de cada gasto vía su caja y convertir con TC antes de restar; bloquear pagos en moneda ≠ deuda.

#### PROV-CC-005 — Borrar una obra deja CC/pagos huérfanos que siguen contando en el saldo ✅ verificado
- **Ubicación:** `src/store/ObrasContext.jsx:309-312`; `src/store/ProveedoresContext.jsx:227-233`.
- **Impacto:** `deleteObra` no limpia `ccEntries` ni movimientos con ese `obraId`. El saldo consolidado del proveedor sigue sumando esos DEBE; `getObrasProveedor` muestra obras fantasma. (El neto se auto-balancea salvo saldo abierto.)
- **Fix:** al borrar obra, cascadear `ccEntries`/movimientos o excluir del saldo los asientos cuyo `obraId` ya no exista.

#### PORTAL-CC-002 / PORTAL-DATA-003 — Portal cliente: KPI desincronizado + fuga de datos financieros ✅ verificado
- **PORTAL-CC-002** (`PortalCliente.jsx:266-267,574`; `helpers.js:103-114`): una cuota marcada "pagada" a mano sin movimiento se cuenta en `countPagadas`/verde pero NO en `pagadoCuotasUSD` (solo movimientos) → el cliente ve cuotas verdes y un "Pagado"/Saldo que no cierra. **Fix:** una sola regla de "cuánto se pagó" para KPI y estado por cuota.
- **PORTAL-DATA-003** (`api/portal/data.js:31,95-103`; `webhook.js:583-584`): CORS `*`, token a **365 días** enviado por WhatsApp, y se devuelve el `detalle` crudo con **márgenes y costos internos** (lo que se paga al subcontratista). **Fix:** reducir expiración (30-90 días, revocable), restringir CORS y filtrar el detalle a solo lo que el cliente debe ver.

#### IR-01 / IR-02 / GLB-04 — `deleteObra` y `removeCaja` sin cascada (núcleo de integridad) ✅ verificado
> IR-02 y GLB-04 son **el mismo bug de `removeCaja`**; IR-01 consolida la cascada faltante de `deleteObra` (que también cubre MOV-07, TAREAS-002, AUTH-004 parcial).
- **`deleteObra`** (`src/store/ObrasContext.jsx:309-312`): deja huérfanos movimientos, cheques, `ccEntries`, tareas y el blob `detalles[obraId]` (que nunca se borra → infla el payload para siempre). Movimientos huérfanos siguen sumando al saldo de caja → "plata fantasma".
- **`removeCaja`** (`src/store/MovimientosContext.jsx:175-177`; `Cajas.jsx:366-370`): el saldo de la caja **se evapora** de `totalARS`/`totalUSD`, pero sus movimientos siguen vivos contando en ingresos/gastos del mes y en Libro IVA si tienen comprobante. El confirm avisa "no revertirá los movimientos".
- **Fix común:** bloquear el borrado si hay entidades asociadas (o soft-delete `activa:false`), o cascada explícita. Como mínimo, conservar la caja inactiva para que `calcSaldoCaja` siga reflejando su efecto.

#### IR-03 — `removeProveedor` borra CC pero deja pagos (movimientos) colgados ✅ verificado
- **Ubicación:** `src/store/ProveedoresContext.jsx:183-195, 61-82`.
- **Impacto:** se borra el DEBE (ccEntries) pero persiste el HABER (pagos como movimientos) con `proveedorId` colgado y nombre vivo; un proveedor homónimo recreado **hereda esos pagos** por el match por nombre.
- **Fix:** al borrar, desvincular `proveedorId`/`proveedor` de sus movimientos o bloquear si tiene pagos.

#### SEC-01 — Gating de roles 100% client-side; RLS es paso manual no garantizado ✅ verificado
- **Ubicación:** `src/store/UsuariosContext.jsx:116-125,209-222`; `src/App.jsx:224-262`; `docs/RLS-SETUP.md:11-19`.
- **Impacto:** el rol sale de un fetch con anon key; las rutas internas no tienen guard por rol (solo Sidebar oculta). La protección real depende **exclusivamente** de RLS aplicada a mano en Supabase Studio, **no versionada como migración** ni verificable en el repo. Si la RLS no está activa, un no-Admin puede `UPDATE app_users SET rol='Admin'` desde DevTools.
- **Fix:** versionar RLS como migración SQL en el repo; health-check que confirme que un no-Admin recibe error al UPDATE de `app_users`; mover cambios de rol/alta a edge functions que validen rol server-side.

#### AUTH-002 — `cajas_visibles=[]` significa "TODAS" en el bot y "NINGUNA" en la app ✅ verificado
- **Ubicación:** `api/whatsapp/webhook.js:938-942` vs `src/pages/Cajas.jsx:353-354` y `Dashboard.jsx:180`; defaults en `UsuariosContext.jsx:33,147`.
- **Impacto:** mismo dato, **semántica opuesta**. Un usuario nuevo (default `[]`) ve cero cajas en la app pero **todas** por WhatsApp. La propia UI rotula `[]` como "Ninguna" mientras el bot le da todo. Bypass de segregación de acceso a datos financieros, por defecto.
- **Fix:** unificar: `'*'`=todas, `[]`=ninguna en ambos lados (corregir `cajaEsVisible` para que `[]` devuelva false), o default `'*'` consistente. Documentar el contrato en un solo lugar.

#### GLB-02 — `today()`/`todayStr()` en UTC fechan al día siguiente después de las 21:00 ARG ✅ verificado — *(consolida MOV-06, TAREAS-010, CHQ-09 parcial)*
- **Ubicación:** `src/lib/dates.js:7`; `src/pages/Movimientos.jsx:15,81,137`; defaults en `MovimientosContext.jsx:186,211` — vs `src/pages/Facturacion.jsx:31-36` (ya arreglado con `todayISO()` local).
- **Impacto:** un movimiento cargado 22:00 del 30/04 queda fechado 2026-05-01 → cae en el mes equivocado del filtro de Movimientos, Libro IVA y Financiero. Exposición fiscal (AFIP).
- **Fix:** centralizar `today()` en `dates.js` con componentes locales (como `todayISO`) y reemplazar TODAS las variantes UTC.

---

## 3. Inconsistencias y media/baja (resumen)

> Todos **(no verificado)** salvo donde se indica ✅. Análisis plausible, a confirmar antes de tocar código.

**Obras / Presupuesto / Gantt / APU**
- **OPG-03** ✅ `mergeGantt` no elimina barras huérfanas del Gantt (cosmético; la certificación MO está protegida por el guard `if (!td) continue`). Severidad real: media.
- **OPG-04** Tres fórmulas distintas de "avance del rubro" (Gantt ponderado por costo / Presupuesto promedio simple / Resumen ponderado por venta) → riesgo de certificar de más/menos. **Unificar en un helper único.**
- **OPG-05** `setFechaInicio`/drag dejan `endDay` desincronizado de `duration`. **Tratar `duration` como fuente única.**
- **OPG-06** `gastado` del header sale de `detalle.movimientos` (semilla) vs MovimientosContext en el resto.
- **OPG-07 / PORTAL-CC-002** Cuotas pagadas a mano no descuentan del cobrado de movimientos (misma raíz; ver §2). 
- **OPG-08** `handleApprove` puede duplicar tareas auto (marca de idempotencia async, `addTarea` no espera).
- **OPG-09** Drag de tarea entre rubros no actualiza `rubroNombre`/match con contrato/Gantt.
- **OPG-10** `factorConversion` no normaliza m²/m³ ni `gl` → factor 1 silencioso (precio sin convertir). 
- **OPG-11** `InlineNum` definido dentro del `.map()` e invocado como función (riesgo de pérdida de foco). **Extraer a componente de módulo.**
- **OPG-12** `margenLinea` sin clamp → venta negativa sin aviso (≥ −100).

**Catálogos / Plantillas**
- **CAT-002** ✅ Eliminar rubro deja APUs/MO huérfanas e invisibles (datos no se destruyen; UX). Media.
- **CAT-004** ✅ Obra desde plantilla pierde `tipo` → nunca se generan `tareasBase` del tipo. **Pasar `tipo: usarPlt.tipo` en el payload.**
- **CAT-005** Importar APU descarta ítems MO/EQ/AU → costo de MO incompleto en APUs SISMAT.
- **CAT-006** Dos `parseReceta` divergentes (Catalogos vs Plantillas). **Extraer uno solo a `src/lib`.**
- **CAT-007** Override parcial de costo en plantilla anula la resolución automática del otro componente.
- **CAT-008** Reseed SISMAT al bumpear versión **descarta ediciones del usuario** (incluido lo de Supabase). **Mergear por id.**
- **CAT-009** Keys por índice en checklist de tareas estándar. **CAT-010** id determinístico `sc-sismat-${t.id}` colisionable. **CAT-011** filtro busca campos internos (id/updatedAt). **CAT-012** `addMO` código muerto pero `calcTarea` suma `catalog.mo` invisible. **CAT-013** `incrementUso` sin guard de null.

**Movimientos / Cajas / Cheques**
- **MOV-04** ✅ checkbox "fondo de reparo 5%" no retiene nada (ver §5).
- **MOV-05** save full-blob de movimientos puede pisar un movimiento que el bot agregó atómicamente (ver §3 sync).
- **MOV-08** `NuevaCajaModal` manda `saldo` no `saldoInicial` (funciona por fallback frágil).
- **MOV-09** `TraspasoModal` no valida saldo insuficiente; opacidad del botón ≠ condición real.
- **MOV-11** Modal de caja muestra cheques en cartera como total aparte sumable (el saldo ya los incluye).
- **MOV-12 / FAC-011 / ALERTAS-ID-005 / SEC-11** IDs `Date.now()` sin sufijo aleatorio en el bot → colisiones. **Usar `crypto.randomUUID()`/sufijo random.**
- **CHQ-04** ✅ El bot setea estado `'cobrado'` que la app no reconoce (badge vacío, sale de cartera). **Unificar set de estados.**
- **CHQ-08** App permite cheque sin caja; el bot exige caja (validación divergente).
- **CHQ-10** Endoso no descuenta CC del proveedor endosado (`endosadoA` texto libre).
- **CHQ-11/CHQ-12** `esPoseedor` por `usuarioId` ausente en seed; cheque sin `fechaVencimiento` fuera de toda banda.

**Facturación / Fiscal / Libro IVA**
- **FAC-001** ✅ IIBB devengado se calcula sobre el **total con IVA**, no el neto → sobreestima ~21% (`Facturacion.jsx:858-883`). Overrideable a mano. **Acumular base neta.**
- **FAC-002** ✅ Aprobar NC de proveedor por chat ignora percepciones (caso raro; pierde fidelidad en el export Libro IVA Digital).
- **FAC-003** `desglosarCompraBot` hardcodea 21% → facturas a 10,5% (vivienda) por chat inflan IVA crédito ~10 puntos. **Pasar/inferir alícuota.**
- **FAC-006** Ventas a 0% gravado se clasifican como exentas en el Libro IVA Digital.
- **FAC-007** `montoNeto < baseFiscal` estricto descarta el neto cuando coincide con la base.
- **FAC-009** `percepcionIVA` del mes solo de `tipo==='gasto'` (más estrecho que `comprasMes`).
- **GLB-03** ✅ IVA crédito del mes vs comparativa (`compFor`) usan filtros de compras distintos (`compFor` sin guard `SIN_IVA_CREDITO`) → posición/saldo a favor arrastrado divergente. **Un solo filtro de "compras con crédito".**
- **GLB-05** `jurisdiccionIIBB` del pending del bot guarda `'PBA'` explícito (rompe invariante "PBA=ausente").
- **GLB-08** Plata entera en caja/movimientos vs centavos en facturación → diferencias de redondeo acumulables.

**Proveedores / Clientes / CC**
- **PROV-CC-002** ✅ La × para borrar un PAGO en la CC del proveedor no hace nada (id de movimiento vs id de ccEntry). **Distinguir `e._esMov` → `removeMovimiento`.**
- **PROV-CC-004** ✅ Borrar proveedor/asiento seed se "resucita" al recargar (re-merge del seed por id). **Sembrar solo en primer arranque / tombstones.**
- **PROV-CC-010** ✅ CC vincula pagos por nombre; renombrar proveedor desvincula histórico (Clientes sí propaga). **Backfill `proveedorId` + propagar nombre.**
- **PROV-CC-006/007/008** Pagos sin DEBE/"General" invisibles en CC por obra; footer muestra totales globales; sobrepago (saldo<0) se colapsa a "Al día" (el bot sí distingue).
- **PROV-CC-009** Validación de CUIT en Clientes pero no en Proveedores; `condicion` vs `condicionIVA` (naming divergente).
- **PROV-CC-011/012** Keys inestables en CC agrupada por rubro; `fmtN` con `Math.abs` oculta signo de saldos negativos.

**Tareas / avance / autorizaciones / mobile**
- **TAREAS-001 / MOV-03 / TAREAS-001** ✅ Aprobar solicitud de eliminación NO revierte el cheque vinculado (`Autorizaciones.jsx:343-346` vs `Movimientos.jsx:1114-1118`). **Extraer `removeMovimientoConVinculos(id)` único.**
- **TAREAS-004** Reabrir/re-aprobar presupuesto puede re-generar tareas base (idempotencia atada a marca mutable en el mismo blob).
- **TAREAS-005/006** Carrera al togglear checklist (last-write-wins de la colección); `marcarVista` dispara write por cada expand.
- **TAREAS-007** Dos modelos homónimos de "tarea"/"avance" sin vínculo (checklist vs rubros[].tareas[].avance).
- **TAREAS-009/011/012** Sliders por índice; `filtroEstado` falta en deps de `useMemo`; permiso de checklist difiere entre fila y modal.

**Bot WhatsApp / serverless**
- **WA-02** `findClienteByObra` ignora `obra.clienteId` (payment-reminders sí lo usa).
- **WA-03** Corrección de avance crea cert NUEVA (duplica deuda) si la cert previa no se encuentra. **Certificar solo el delta o no crear cert nueva.**
- **WA-04** resumen/como_va_obra/cc_proveedor suman ARS+USD (mismo patrón que DASH-01).
- **WA-05/06** TC sin respetar flag `manual`; funciones de cuota muertas que leen `cuota.pagos[]`.
- **WA-07** Dedup de wamid es check-then-act → doble ejecución en reintentos concurrentes de Meta. **Dedupe atómico con PK única.**
- **WA-08** Vinculación con `query.includes(nombre)` laxo (seguridad).
- **WA-11** `como_va_obra`/`daily-summary` leen `c.cobrado`/`c.pagado` (modelo viejo) en vez de derivar de movimientos.
- **WA-09/10/12** Pierde foto al reprocesar; falta `cajaEsVisible` en pago_proveedor/traspaso; índices posicionales congelados de listas numeradas.

**Dashboard / Reportes / Export / Búsqueda / Config**
- **REP-01** ✅ "Cobrado/Gastado YTD" y Top proveedores suman ARS+USD (mismo patrón DASH-01; read-only, solo Admin).
- **DASH-02** ✅ Dashboard usa `o.gastado`/`o.margen` estáticos del seed → obras nuevas siempre 0% gastado, alerta de sobrecosto nunca dispara. **Derivar de movimientos (como `computeStats`).**
- **REP-02** "Margen por obra"/"Distribución por tipo" usan `o.margen`/`o.presupuesto` estáticos. **REP-03** `c.numero` no existe (es `c.n`).
- **DASH-03** `useMemo` de cuotasProximas/adicionalesPendientes/alertas con deps incompletas (no recomputan al entrar un cobro). **DASH-04** Top proveedores agrupado por nombre string, no id.
- **CFG-01** `manualInput` del dólar no refleja cambios remotos/auto. **CFG-02** Toggles de Seguridad/Notificaciones/Apariencia son placebo (2FA/auditoría/IP whitelist no hacen nada). **Marcar "próximamente" o cablear.**
- **EXP-01** Nº de presupuesto del PDF pseudo-aleatorio (`rubros.length*7+42`), preview hardcodea `042`. **EXP-02** ExportModal duplica `tareaVentaUnit` e incluye secciones como filas/conteo.
- **SRCH-01** Traspasos/NC etiquetados "Gasto". **SRCH-02** `highlight` desalinea con acentos (NFD).
- **GLB-06** `dolarCompra` desincronizado de `dolarVenta` en manual. **GLB-07** Total de traspasos suma monedas distintas bajo `$`. **GLB-10** `Movimientos.jsx` redefine `fmtN`/`fmtFecha` con semántica distinta a `format.js`. **GLB-11** `diasHasta` frágil ante huso; comentario de `diasDesde` erróneo.

**Sincronización / arquitectura de estado**
- **SYNC-01** ✅ `saveSharedDataKeepalive` cae a `anonKey` → el flush al cerrar/F5 puede ser rechazado por RLS y no sincronizar (el dato sí queda en localStorage). **Abortar keepalive sin token / verificar `res.ok`.**
- **SYNC-02** Flush keepalive/silent no emite `broadcastChange` → otras pestañas/portal desincronizados.
- **SYNC-03** Ventana de 3s "ignorar broadcast" descarta cambios del bot de forma permanente (no reintenta). **Diferir el re-fetch + merge por id.**
- **SYNC-04** `fromRemote` se baja con `setTimeout(0)` → writes redundantes / posible eco. **SYNC-05/06** `markReady()` no idempotente (StrictMode); `TOTAL_LOADERS` manual y mensaje "5s" vs `1000ms` real.
- **SYNC-07** `userEditedBeforeFirstLoad` no sube el cambio local si el primer fetch da `undefined`. **SYNC-08** last-write-wins del array/objeto completo (raíz de MOV-05/CAT-003/PROV-CC-001/ALERTAS-RACE-004). **SYNC-09/10/11/12** broadcast pre-SUBSCRIBED se pierde; `patchItemInSharedArray` puede vaciar array ante `undefined`; debounce 500 vs 800; `loadSharedData` hace `getSession()` en cada lectura (portal siempre `undefined`).

**Auth / roles**
- **AUTH-005** KPI "Roles base" muestra `undefined` (`(roles||[]).length` sobre objeto). **AUTH-006** Flash de "Sin acceso" si `app_users` tarda >1s. **AUTH-007** Admin puede auto-borrarse (sin guard del último Admin). **AUTH-008** `updateUsuario` read-modify-write completo (permisos concurrentes se pisan). **AUTH-009** Default `cajasVisibles` `[]` vs `'*'` inconsistente. **AUTH-010** Roles custom solo en localStorage (no sincronizan). **AUTH-011/012** Countdown hardcodea 60; `bootstrapAdmin` sin guard de reentrada.

**Seguridad (resto)**
- **SEC-04** `getLinkedCliente` acepta match solo por teléfono ignorando `whatsappActivo`. **SEC-05** Endpoints del portal devuelven `e.message` crudo. **SEC-06** Tokens de portal 1 año, regenerados en cada interacción, nunca purgados/revocados. **SEC-07** `createAuthUser` con `signUp` anon key. **SEC-08** `bootstrapAdmin` auto-promueve a Admin si `app_users` aparece vacía (RLS/error de red). **SEC-09** Bucket `kamak-fotos` público (comprobantes con CUIT/montos accesibles por URL). **SEC-10** Interpolación sin `encodeURIComponent` de `phone`/`key` en URLs PostgREST. **SEC-12** Autorización del bot parcialmente delegada al LLM (prompt-injection puede sesgar caja/categoría/percepciones).

---

## 4. Datos no vinculados / integridad referencial (sección dedicada)

> Pedido explícito. **Patrón sistémico: ninguna eliminación cascadea, y muchos vínculos son por NOMBRE en vez de por id.** La mayoría de los `delete*` solo filtran su propio array.

**Eliminaciones sin cascada (confirmadas):**
| Acción | Deja huérfano | Efecto | Hallazgo |
|---|---|---|---|
| `deleteObra` | movimientos, cheques, ccEntries, tareas, `detalles[obraId]` | plata fantasma en caja + payload infinito | **IR-01** ✅ (+ MOV-07, TAREAS-002, PROV-CC-005, AUTH-004) |
| `removeCaja` | movimientos por `cajaId`/`cajaDestinoId` | saldo se evapora del total pero el movimiento sigue contando en mes/IVA | **IR-02 = GLB-04** ✅ |
| `removeProveedor` | movimientos de pago (HABER) | proveedor homónimo recreado hereda pagos | **IR-03** ✅ |
| `removeCliente` | obras (`o.cliente`=nombre), movimientos | obra asignada a cliente fantasma | **IR-04** (no verif.) |
| `removeComprobante` | NC/ND con `comprobanteAsociadoId` | NC fiscalmente irresoluble (WSFE) | **FAC-04** (no verif.) |
| `removeMovimiento` (vía Autorizaciones) | cheque vinculado | cheque sin respaldo | **MOV-03 = TAREAS-001** ✅ |
| `removeProveedor`/`deleteObra` | tokens de portal | token huérfano 1 año → spinner infinito en portal | **PORTAL-TOKEN-006** (no verif.) |
| borrar obra/caja | `obras_visibles`/`cajas_visibles` de usuarios | UUID crudo en UI | **AUTH-004** (no verif.) |

**Vínculos por NOMBRE (frágiles ante rename/typo):**
- **CAT-001** ✅ rubro→APUs/MO/tareas (rompe auto-generación). 
- **PROV-CC-010** ✅ proveedor→pagos (renombrar desvincula histórico).
- **DASH-04** Top proveedores agrupa por `m.proveedor` string (fragmenta gasto, link roto).
- **IR-05** `obraNombre`/`cajaDestinoNombre`/`proveedor`/`clienteNombre` duplicados se desincronizan al renombrar (solo Cliente propaga). **Estrategia única: id como fuente de verdad, nombre resuelto en runtime.**
- **IR-06** `addObra` **descarta `clienteId`** que el modal ya recolecta → obra nace sin FK fuerte.

**Modelado ambiguo:**
- **IR-07** Depósito de cheque por traspaso no maneja cross-moneda ni vincula el movimiento del depósito.
- **IR-08** Tareas auto guardan `origenRef` colgable si se borra el rubro/tipoObra del catálogo.
- **IR-09** `ccEntries.haber` vestigial pero el seed lo usa → posible doble conteo visual de pagos.
- **IR-10** `migrarSaldoInicial` puede congelar un `saldoInicial` erróneo si los movimientos remotos llegan parciales.

**Recomendación arquitectónica:** introducir un helper central de borrado por entidad (`deleteObraConVinculos`, `removeCajaConGuard`, etc.) y migrar todos los vínculos por nombre a id con backfill one-shot. Es la inversión de mayor retorno para la integridad de datos.

---

## 5. Funcionalidad faltante (técnica)

- **MOV-10** ✅ **Conciliación bancaria es 100% mockup** (`Conciliacion.jsx:17-57`): arrays literales, botones sin `onClick`, totales fijos. **Marcar WIP o implementar lectura de movimientos + parse de extracto.**
- **PORTAL-PROV-001** **Portal Proveedor 100% mock** (`PortalProveedor.jsx:5-15,47-198`): sin token, sin datos reales, muestra "Don Luis SRL" a cualquiera. **No rutear a producción o marcar "en construcción".**
- **TAREAS-008** **App mobile Director/Comprador son mockups** (`MobileComprador.jsx`, `MobileDirector.jsx`): sliders y "guardar" que no persisten; botón "Forzar sincronización" decorativo. **No exponer rutas hasta cablear a contexts reales.**
- **MOV-04** ✅ **Checkbox "fondo de reparo 5%" no retiene nada** (`RegistrarPagoModal.jsx:147-153`): guarda `fondoReparo:true` pero descuenta el 100%. **Implementar la retención o quitar el checkbox.**
- **FAC-010** **No hay forma de emitir/marcar emitido ni anular un comprobante** desde la UI (solo borrar borrador); Libro IVA siempre exporta con número 0/borrador.
- **PORTAL-DOC-010** **Botón "Descargar" de documentos del portal no hace nada** (`doc.url` ignorado).
- **PROV-CC-013** **No se puede cargar deuda (DEBE) a un proveedor desde la app** (`addCC`/`updateCC` sin consumidores); la CC depende 100% del bot.
- **TAREAS-003** `origen`/`origenRef` (AUTO) se persisten pero nunca se muestran ni filtran (feature a medias).

---

## 6. Recomendaciones de negocio (construcción) — por lente y prioridad

### Presupuestos, costos y márgenes
| Prioridad | Recomendación | Esfuerzo | Por qué importa |
|---|---|---|---|
| **Alta** | **Imputar cada gasto a un rubro/tarea** (desvío real por rubro) | Medio | El margen se gana/pierde rubro por rubro; hoy solo hay un total global. Habilita casi todo el control de obra. |
| **Alta** | **Redeterminación por inflación** (versiones del presupuesto, índices CAC/ICC/dólar) | Alto | Sin re-valorizar, el margen "real" es ficticio (venta vieja vs costo viejo). |
| **Alta** | **Certificación de avance de subcontratistas + fondo de reparo automático** | Alto | Se paga por avance certificado, no por contrato; controla el fondo de reparo. |
| Media | Acopio de materiales **valorizado** (no solo cantidades) | Medio | Acopiar protege margen en inflación; evita doble compra. |
| Media | Curva avance físico vs financiero (valor ganado simplificado) | Medio | Detecta el desvío antes de gastar todo. |
| Media | Margen objetivo vs real + simulador what-if | **Bajo** | Evita aprobar obras con margen insuficiente; reusa `calcObra`. |
| Media | Cierre económico de obra (rentabilidad final consolidada) | Medio | Aprender qué obra/cliente deja plata. Depende de imputación por rubro. |
| Media | Trazabilidad de precios del catálogo + alerta "desactualizado" | **Bajo** | Higiene base de costos; prerequisito de la redeterminación. |

### Flujo de caja, financiación y cobranzas
| Prioridad | Recomendación | Esfuerzo | Por qué importa |
|---|---|---|---|
| **Alta** | **Proyección de flujo a 8-13 semanas** (forward, no histórico) | Medio | Herramienta de supervivencia PyME: anticipar baches de caja. Reusa cuotas/cheques/gastos fijos. |
| **Alta** | **Cuentas por Cobrar consolidadas + aging + interés punitorio** | Medio | Saber a quién apretar primero; disciplinar la mora. |
| **Alta** | **Indexación de cuotas en pesos por CAC/CER/IPC** (no solo USD fijo) | Alto | Muchos clientes no dolarizan; sin índice se regala 40-60% por inflación. |
| Media | Fondo de reparo como pasivo acumulado + agenda de liberación | Medio | Plata que se debe/se reclama meses después del cierre. |
| Media | Calce de cheques recibidos vs pagos + registro de descuento | Medio | Endosar/descontar bien evita descubierto caro. |
| Media | Calendario y proyección de obligaciones AFIP | Medio | Salidas grandes en fecha fija; reusa la posición fiscal ya calculada. |
| Baja | Anticipos de cliente amortizables contra certificaciones | Medio | Relevante si trabajan por certificaciones de avance. |

### Fiscal e impositivo (Argentina)
| Prioridad | Recomendación | Esfuerzo | Por qué importa |
|---|---|---|---|
| **Alta** | **Retenciones que la empresa PRACTICA** al pagar (Ganancias RG830, IVA RG18, SUSS RG4644, IIBB) | Alto | Riesgo fiscal nº1: si está designada agente y no retiene, AFIP reclama con patrimonio propio + multas. Hoy paga el bruto. |
| **Alta** | **Verificar condición fiscal del proveedor contra padrón AFIP** (apócrifos, monotributo excedido) | Medio | Determina crédito fiscal y deducibilidad; computar de un apócrifo = impugnación. |
| **Alta** | **Emisión electrónica real con CAE (WSFE)** | Alto | Hoy todo queda en "borrador"; una factura sin CAE no es válida. `afip.js` ya tiene los códigos. |
| **Alta** | **Calendario de vencimientos impositivos** | Medio | Reusa posición IVA/financiero ya calculados + AlertasContext. |
| Media | IVA débito devengado vs percibido y desfase con cuotas indexadas | Medio | La empresa financia al fisco; vincular comprobante↔cobro. |
| Media | Regímenes de información / export SICORE / SIRCAR | Medio | Cada régimen no presentado = multa; ahorra horas al contador. (SICORE depende de las retenciones practicadas.) |
| Baja | Tablero "en blanco vs en negro" consolidado por obra | **Bajo** | Mejora una funcionalidad que ya existe a medias. |

### Operaciones y control de obra
| Prioridad | Recomendación | Esfuerzo | Por qué importa |
|---|---|---|---|
| **Alta** | **Pedido de materiales + Orden de Compra** (campo→compras) | Alto | Corazón operativo; conecta presupuesto↔compra real. |
| **Alta** | **Control de acopio/stock** (comprado vs consumido por avance) | Alto | Robo hormiga / sobrecompra = fuga de margen. La obra "Recoleta" del seed ya tiene margen negativo por sobrecosto de materiales. |
| **Alta** | **Parte diario de obra** (dotación, clima, novedades, fotos) | Medio | Prueba documental para certificaciones y reclamos de adicionales. |
| **Alta** | **Avance físico vs económico** (semáforo/curva) | Medio | Datos ya existen; solo cruzarlos. |
| **Alta** | **Legajo y vencimientos de subcontratistas** (ART, seguros, AFIP) | Medio | Responsabilidad solidaria si se accidenta un operario sin ART. Reusa Proveedores+docs+Alertas. |
| Media | Certificación formal con acta + gestión del fondo de reparo | Medio | Documento claro evita conflicto con gremios. |
| Media | **App de campo funcional** (Director/Comprador hoy maquetas) | Medio | Sin esto, parte diario/pedidos no tienen puerta de entrada móvil. |
| Baja | Control de pañol y herramientas | **Bajo** | Fuga de segundo orden; atacar al final. |

### Comercial y relación con el cliente
| Prioridad | Recomendación | Esfuerzo | Por qué importa |
|---|---|---|---|
| **Alta** | **Aprobación de adicionales por el cliente** (firma digital ligera desde portal/bot) | Medio | Adicionales = fuente nº1 de conflicto y plata no cobrada. Requiere endpoint de escritura en el portal. |
| **Alta** | **Contrato/propuesta comercial con el cliente** (hoy solo hay contratos de MO) | Medio | El contrato del cliente define qué se cobra y cómo se ajusta; hoy la CC del cliente no tiene respaldo. |
| **Alta** | **Notificaciones proactivas al cliente** (hitos, fotos nuevas, cuota por vencer) | Medio | Mejora cobranza y reduce llamados; reusa WhatsApp+plantillas Meta. |
| **Alta** | **Documentos del portal con flag "visible al cliente" + actas** | **Bajo** | Hoy TODO doc se muestra al cliente → riesgo de filtrar márgenes/contratos MO. Flag de visibilidad es bajo esfuerzo. |
| Media | Canal de mensajería cliente↔equipo registrado en la obra | Alto | Protege ante reclamos; requiere escritura en portal. |
| Media | Transparencia de CC: recibos PDF + ajuste por inflación visible | Medio | Reduce la pelea "por qué subió la cuota". |
| Media | Consolidar cliente por `clienteId` + soporte multi-obra en portal/bot | Medio | Los mejores clientes repiten obra; el bot hoy solo muestra la primera. |

---

## 7. Quick wins (alto impacto / bajo esfuerzo — arrancar ya)

> Ordenados por relación impacto/esfuerzo. Los primeros son cambios de pocas líneas que tapan agujeros de plata o seguridad confirmados.

1. **Rol "Contador externo"** — reemplazar 4 literales `'Contador'` por `ROL_CONTADOR` (AUTH-001/SEC-03/GLB-01). *Trivial; desbloquea un rol entero + cierra fuga de confinamiento.*
2. **MOV-01 traspaso cross-moneda inline** — agregar `montoDestino` en `save()` (`Movimientos.jsx:156-166`). *Pocas líneas; corta una pérdida de ~1000x.*
3. **CHQ-05/WA-01 cheques por vencer** — normalizar `Array.isArray(chequesData)` en `daily-summary.js:188`. *Una línea; restaura el aviso de vencimientos.*
4. **GLB-02 fechas UTC** — `today()` con componentes locales en `dates.js` (copiar `todayISO` de Facturación) y reemplazar variantes. *Tapa el salto de mes en cierres/IVA.*
5. **AUTH-002 `cajas_visibles=[]`** — unificar semántica (`[]`=ninguna en el bot). *Cierra bypass de acceso a cajas por defecto.*
6. **CAT-004 obra desde plantilla pierde `tipo`** — pasar `tipo: usarPlt.tipo` en el payload (`Plantillas.jsx:796-797`). *Una línea; arregla auto-generación de tareas base.*
7. **IR-06 `addObra` descarta `clienteId`** — agregar `clienteId: obra.clienteId || null` (`ObrasContext.jsx:285-290`). *Una línea; FK fuerte cliente↔obra.*
8. **MOV-04 fondo de reparo placebo** — deshabilitar el checkbox hasta implementarlo (no inducir error). *Evita pagar el 100% creyendo que se retiene.*
9. **PORTAL-DATA-003 / SEC-06 tokens** — bajar expiración a 30-90 días y dejar de regenerar en cada mensaje. *Acota la fuga; filtrar el `detalle` crudo del portal va aparte.*
10. **Marcar mockups como WIP** — Conciliación (MOV-10), Portal Proveedor (PORTAL-PROV-001), mobile Director/Comprador (TAREAS-008): no rutear a producción o banner "en construcción". *Evita decisiones sobre datos falsos.*
11. **Negocio bajo esfuerzo / alto valor:** flag "visible al cliente" en documentos del portal, simulador de margen what-if, y trazabilidad de precios del catálogo (fecha + alerta de antigüedad).

> **Después de los quick wins**, encarar las dos inversiones estructurales: (a) **helper central de borrado con cascada + migración de vínculos por nombre a id** (§4), y (b) **escrituras atómicas por id desde la app** (RPC append/patch) para cerrar la familia de races last-write-wins (PROV-CC-001, MOV-05, CAT-003, ALERTAS-RACE-004, SYNC-03/08).