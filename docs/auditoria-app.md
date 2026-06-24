> Auditoría profunda de la app Kamak — generada en modo autónomo (6 finders auto-verificados por área + síntesis). 2026-06-24.

# Auditoría Kamak — Reporte priorizado

Generado por el auditor jefe a partir de 49 hallazgos auto-verificados por los finders. Se descartaron duplicados y se consolidó por área. Todos los `file:line` fueron contrastados contra el código real donde fue posible.

## 1. Resumen por severidad

| Severidad | Cantidad | De los cuales tocan plata / fiscal | Safe-fix (confianza ALTA, riesgo BAJO) |
|-----------|----------|-------------------------------------|----------------------------------------|
| **Alta**  | 6        | 6                                   | 3                                      |
| **Media** | 22       | ~15                                 | 4                                      |
| **Baja**  | 19       | ~6                                  | 5                                      |
| **TOTAL** | **47**   | —                                   | **12**                                 |

> Nota de consolidación: los 49 hallazgos originales contienen **2 pares duplicados** sobre el mismo root cause (se reportan una vez con la severidad mayor):
> - Fuga de portal: "presupuesto/notas/embudo" (alta) **engloba** "obra.venta motivoPerdida/changelog" (media) → mismo `api/portal/data.js:219-223`.
> - Match de contrato por gremio vacío: "avancePct se pisa en TODOS los contratos" (alta) **engloba** "Gantt muestra Contrato MO — undefined" (media) → mismo root cause `matchGremio(..., '')`.

## 2. Detalle agrupado por severidad → área

### 🔴 ALTA

#### Portal cliente (fuga de datos)
- **`api/portal/data.js:219-223` — Portal manda obra completa (presupuesto, notas, embudo `venta`).** Solo se quitan `gastado` y `margen`; el resto del objeto `obra` viaja crudo al browser del cliente, incluyendo `presupuesto` (costo interno), `notas` internas y `venta` (etapa/changelog/`motivoPerdida`). El `detalle` sí se sanitiza con whitelist (`sanitizeDetalle`), la obra no.
  - **Impacto:** Un cliente con token puede leer en la respuesta de red el costo interno, notas internas y el motivo por el que Kamak lo descartó. Contradice el propósito explícito de `sanitizeDetalle`.
  - **Fix:** Aplicar whitelist también a la obra (solo id, nombre, cliente, direccion, tipo, estado, moneda, fechas, avance, web público). Excluir `presupuesto`, `notas`, `venta`, `createdAt`.
  - **Riesgo de arreglar:** bajo-medio (cambia el shape que recibe `PortalCliente.jsx`; hay que verificar que el front no dependa de campos hoy presentes — ver hallazgo `obra.presupuesto` como fallback). Por ese acoplamiento va a **reportOnly**, no a safe-fix automático.

#### Facturación / AFIP (plata declarada de más)
- **`src/pages/Facturacion.jsx:452-456, 471-473` — Percepción IVA de facturas pendientes nunca reduce la posición de IVA.** `percepcionIVAMes` solo suma `movimientos` con `tipo==='gasto'`; las facturas de Cuentas por Pagar guardan la percepción en `f.percepcionIVA` y nunca entran al pago a cuenta.
  - **Impacto:** Se declara y paga IVA de más a AFIP por cada percepción cargada en una factura pendiente. **Plata real.**
  - **Fix:** Sumar la percepción IVA de `facturasPendientes` del mes vía `facturaPendienteACompraLibroIva`. Cuidar no doble-contar.
  - **Riesgo:** **alto** (matemática fiscal; doble-conteo posible). → reportOnly.
- **`src/pages/Facturacion.jsx:987-995` — Percepción IIBB de facturas pendientes no netea el IIBB devengado.** Mismo patrón; `percIIBBGastos` solo mira `movimientos`.
  - **Impacto:** IIBB a pagar sobreestimado para el mes; se pierde el aviso de "otra jurisdicción".
  - **Fix:** Incluir percepciones IIBB de facturas pendientes respetando `jurisdiccionIIBB`.
  - **Riesgo:** **alto** (fiscal + split PBA/otras). → reportOnly.

#### Bot WhatsApp (núcleo de dinero)
- **`api/whatsapp/webhook.js:3485-3498` — `deshacer` reescribe el blob entero de `movimientos` (LWW) y pisa cajas.** `saveSharedData('movimientos', { movimientos: sinMov, cajas })` con un snapshot del momento de la carga. La app borra de forma atómica vía RPC `remove_shared_object_item`.
  - **Impacto:** Si entra un movimiento o se edita una caja entre el load y el save, se pierde. Toca plata directamente. Es el patrón LWW que el resto del bot ya abandonó.
  - **Fix:** Reemplazar por RPC atómico de borrado por id (espejo de `MovimientosContext`); nunca reescribir `cajas` en este path.
  - **Riesgo:** **alto** (path crítico de dinero, requiere paridad con el RPC de Supabase). → reportOnly.

#### Catálogo / Contratos MO (liquida mal a contratistas)
- **`api/whatsapp/webhook.js:2591-2596` + `src/pages/obra/ObraGantt.jsx:124-127, 350, 831` — `avancePct` se pisa en TODOS los contratos de la obra.** `matchGremio` hace `r.includes(g)` con `g=''` (los contratos del form nunca setean `gremio`) → match siempre true. El webhook **persiste** el avance sobre todos los contratos.
  - **Impacto:** `cert = monto*avPct/100`, `reparo` y `aLiquidar` quedan mal → montos a liquidar a cada contratista incorrectos. Cubre también el "Contrato MO — undefined" del Gantt.
  - **Fix:** Matchear por rubro real (`c.tareas[].rubroNombre`); en `matchGremio` agregar guard `if (!g) return false`. Aplicar idéntico en webhook.js, ObraGantt.jsx:350 y :831.
  - **Riesgo:** **alto** (mueve plata a contratistas + cambio en 3 lugares). → reportOnly.

#### Permisos / RLS
- **`src/store/UsuariosContext.jsx:237-244` — `removeUsuario` borra `app_users` desde el browser (RLS) y falla en silencio.** El DELETE denegado por RLS afecta 0 filas con `error=null`, pero igual borra el usuario de Auth vía `adminAction('deleteUser')`.
  - **Impacto:** El usuario desaparece de Auth (no puede loguear) pero su fila en `app_users` sobrevive; al recargar reaparece. Estado inconsistente Auth↔app_users. Es exactamente el bug por el que `updateUsuario` ya se migró a endpoint con service key.
  - **Fix:** Mover el borrado a un endpoint server con service key (`/api/admin/delete-user` con `requireAdmin`) que borre la fila primero y luego Auth; el cliente no muta estado si el server no confirma.
  - **Riesgo:** **medio** (requiere nuevo endpoint server + paridad de orden de borrado). → reportOnly.

### 🟠 MEDIA

#### Obras / consistencia de moneda
- **`src/pages/Obras.jsx:47-49` y `src/pages/obra/ObraPresupuesto.jsx:118` — Gastado mezcla ARS y USD.** `computeStats` suma `m.monto` sin normalizar; en obra USD se muestra `fmt(gastado, 'USD')` y `pctGastado` sale absurdo. El cobrado sí se normaliza, el gastado no.
  - **Fix:** Normalizar gastado a la moneda de la obra (helper `montoEnARS`/tc) o mostrarlo siempre en pesos como "Costos a proveedores".
  - **Riesgo:** bajo (cálculo de display) pero **toca matemática de dinero** → reportOnly.

#### Facturación / Conciliación
- **`src/pages/Conciliacion.jsx:70-72, 286-289` — Movimientos creados desde "Agregar" quedan `conciliado:true` sin `conciliacionId` si no se confirma.** Quedan excluidos para siempre del pool de futuras conciliaciones (`matchExtracto` filtra `!m.conciliado`). → reportOnly (riesgo medio, toca invariante de conciliación).
- **`api/whatsapp/webhook.js:87-106` — `desglosarCompraBot` no acepta `alicuota`; hardcodea 21%.** Diverge de `desglosarCompra` de la app (que sí toma `alicuota`). Factura 10,5% sin neto se desglosa al 21%. → reportOnly (Libro IVA).
- **`src/lib/wsfe.js:20-25, 44` — Factura B a CF por monto alto envía DocTipo 99/DocNro 0; AFIP la rechaza.** `validarComprobante` no exige documento. → reportOnly (flujo AFIP, confianza media).
- **`src/pages/modales/RegistrarPagoModal.jsx:31, 55, 217-221` — Solo lista cajas ARS; imposible pagar factura desde caja USD.** Limitación silenciosa. → reportOnly (riesgo medio).

#### Contratos MO / concurrencia
- **`src/pages/obra/tabs/TabSeguros.jsx` + `src/store/ObrasContext.jsx:508-518` — `patch` reemplaza el detalle COMPLETO de la obra (LWW por obra), no atómico por contrato/seguro.** El comentario miente ("nunca el blob entero"). → reportOnly (confianza media; mínimo corregir el comentario).
- **`src/pages/obra/ObraGantt.jsx:831-836` — Gantt asocia contrato no relacionado y muestra "Contrato MO — undefined".** Mismo root cause que `avancePct`. Se consolida con el ítem alta.

#### Comercial / Portal
- **`api/portal/firmar.js:148-170` — No valida que el contrato esté `enviado` antes de firmar.** Un POST con token+OTP firmaría cualquier estado; firmar dispara `asegurarGanado()` → mueve la obra a activa. → reportOnly (firma legal + efecto sobre obra).
- **`src/pages/portal/PortalCliente.jsx:507` — `obra.presupuesto` (costo interno) usado como fallback del "Presupuesto total" mostrado al cliente.** Acoplado a la fuga de `data.js`. → reportOnly.
- **`api/whatsapp/webhook.js:3398-3401, 3427-3428` — `como va [obra]` cuenta cuotas con campos inexistentes `c.cobrado/c.pagado`.** KPIs casi siempre "0 pagadas"; además muestra monto sin convertir a USD. → reportOnly (lógica de cuotas).

#### Bot WhatsApp
- **`api/whatsapp/webhook.js:4124-4138` — Dictado responde "Cargué N gastos" aunque para no-admin fueron a aprobación.** Mensaje engañoso sobre el estado del dinero; "deshacer" no aplica. → reportOnly (lógica de rol/aprobación).
- **`api/whatsapp/webhook.js:4086-4095, 1783` — Dictado puede cargar gastos con `cajaId:null`** (no debitan ninguna caja). → reportOnly (toca saldos).
- **`api/whatsapp/webhook.js:1776, 4126-4135` — IDs `mov-${Date.now()}` pueden colisionar en el loop de dictado.** El path de cheques ya usa sufijo random (mitigación conocida no aplicada acá). → reportOnly (riesgo de pisar movimiento; confianza media).
- **`api/whatsapp/_extractors.js:61-95` — `extractMonto` toma el número más grande; un serial/CUIT largo puede convertirse en monto.** → reportOnly (precarga de plata; confianza media).
- **`api/whatsapp/webhook.js:1129-1146, 4694-4736` — Lock de media best-effort sin CAS: ventana de doble-carga de comprobantes.** → reportOnly.
- **`api/whatsapp/webhook.js:728-747` — `getLinkedCliente` vincula por teléfono ignorando `whatsappActivo`** → entrega saldo/plan/portal token a un número solo por coincidencia. → reportOnly (fuga de datos financieros; confianza media).
- **`api/whatsapp/webhook.js:868-877` — `handleClienteFlow` ignora obras por `clienteId` (solo matchea texto `o.cliente`).** El cron espejo sí matchea por id primero. → reportOnly.

#### Permisos / RLS / transversal
- **`api/whatsapp/webhook.js:1168-1182` — El bot trata `cajasVisibles==='*'` como "todas" sin chequear rol.** Diverge de `permisosCaja.js` (que exige Admin). Posible fuga de plata a un no-admin con datos legacy. → reportOnly.
- **`api/whatsapp/webhook.js:4552-4565` — Webhook fail-open: si no se puede leer el body crudo, NO valida firma de Meta y procesa igual.** → reportOnly (seguridad; depende de que `leerBodyCrudo` falle).
- **`src/store/UsuariosContext.jsx:102-115, 258-272` — Roles base se guardan solo en `localStorage` por máquina y se borran al logout.** Permisos divergen entre dispositivos. → reportOnly (riesgo medio).

### 🟡 BAJA

#### Bot / saldos (safe-fixes)
- **`api/whatsapp/webhook.js:368-380` — `calcSaldoCajaBot` ignora `nota_credito_compra` con `afectaCaja`.** Divergencia bot↔app del saldo. Verificado contra `lib/caja.js:20`. ✅ **safe-fix.**

#### Catálogo (safe-fix)
- **`src/lib/apuPriceResolver.js:205` — `resolverMOAPU` chequea `.length` en un Map.** No produce monto incorrecto hoy (cae al mismo fallback) pero es inconsistente con `resolverItemAPU` (que usa `.size`). ✅ **safe-fix.**

#### Permisos / UI (safe-fixes)
- **`src/pages/Usuarios.jsx:400` — KPI "Roles base" muestra `undefined`** (`(roles||[]).length` sobre un objeto). ✅ **safe-fix.**
- **`src/App.jsx:262-268` — `/movimientos` y `/cajas` sin guard de ruta por rol** (solo se ocultan en Sidebar). Filtran por caja, así que no es fuga total. ✅ **safe-fix** (agregar el `useEffect→navigate('/')` que ya usan las demás páginas).

#### Contratos (safe-fix)
- **`src/lib/contratistaDocs.js:139 — `{{plazo}}` siempre en blanco** (`'plazo': ''` hardcodeado) en cláusulas legales sustantivas. Verificado. ✅ **safe-fix** (derivar de fechaInicio→fechaFin, o quitar el placeholder).

#### Resto (report-only de baja)
- `src/pages/obra/ObraPresupuesto.jsx:117-119` — `faltaCobrar/totalCobradoReal` código muerto que mezcla moneda → reportOnly (borrar requiere confirmar que no se usa; toca dinero).
- `src/pages/Obras.jsx:68-78` — `ccObra` duplicado vs `helpers.js` → reportOnly (toca total cliente USD).
- `src/lib/afip.js:286-301` — `fingerprintRecibido` puede dar falso positivo de duplicado (dos cargas iguales mismo día) → reportOnly.
- `src/lib/facturasPendientes.js:54-63` — tolerancia ±0,5% puede emparejar pago con factura equivocada → reportOnly.
- `src/pages/Facturacion.jsx:552-570` — Libro IVA Digital exporta ventas en borrador con N° 0 solo con `confirm()` → reportOnly.
- `src/pages/Conciliacion.jsx:313-324, 517-535` — "Confirmar conciliación" no exige diferencia 0 → reportOnly (UX).
- `api/portal/solicitar-otp.js:49-62` — rate-limit horario del OTP ineficaz (códigos se borran a los 10 min) → reportOnly (seguridad).
- `api/portal/solicitar-otp.js:72-90` — token sin phone deja la firma en callejón sin salida → reportOnly.
- `src/store/ClientesContext.jsx:39-42` — `removeCliente` deja obras/actividades CRM huérfanas → reportOnly (pérdida de historial).
- `src/pages/comercial/PrimerContactoModal.jsx:19-22` — match de cliente sin normalizar acentos/espacios → reportOnly.
- `src/pages/portal/PortalCliente.jsx:11,245,442,690,775` — `cuotaEstadoCalc` sombreada con firma distinta → reportOnly (código engañoso, toca cuotas).
- `src/pages/portal/PortalCliente.jsx:424-428` — `tareaVentaUnit` reimplementada, no respeta `materialesACargoComprador` en admin-preview → reportOnly.
- `api/portal/firmar.js:182-184` — actividad de firma escrita con RMW del blob entero (LWW) → reportOnly.
- `api/portal/firmar.js:133-142` — contador de intentos de OTP no atómico (RMW del blob) → reportOnly.
- `api/portal/data.js:43-47` — `ventaRubro` del portal con predicado de filtro distinto a `calcRubro` → reportOnly (toca venta al cliente).
- `src/App.jsx:93-97` — guard de "Contador externo" en `useEffect` post-render → reportOnly (defensa en profundidad).

## 3. Top 10 a atacar primero

| # | Hallazgo | Severidad | Por qué primero |
|---|----------|-----------|-----------------|
| 1 | Portal manda presupuesto/notas/embudo `venta` al cliente (`api/portal/data.js:219-223`) | Alta | Fuga de costo interno + motivo de pérdida a clientes; mayor superficie de exposición |
| 2 | Percepción IVA de facturas pendientes no reduce posición de IVA (`Facturacion.jsx:452-456`) | Alta | Plata real declarada de más a AFIP, recurrente cada mes |
| 3 | Percepción IIBB de facturas pendientes no netea (`Facturacion.jsx:987-995`) | Alta | Mismo impacto fiscal en IIBB |
| 4 | `avancePct` se pisa en TODOS los contratos (`webhook.js:2591`, `ObraGantt.jsx`) | Alta | Liquida mal a cada contratista; se persiste desde el bot |
| 5 | `deshacer` reescribe blob de movimientos (LWW) (`webhook.js:3485-3498`) | Alta | Puede perder movimientos/cajas en concurrencia; toca plata directo |
| 6 | `removeUsuario` borra `app_users` por browser/RLS (`UsuariosContext.jsx:237`) | Alta | Deja Auth↔DB inconsistente; usuario "no eliminable" |
| 7 | Bot `*` = todas las cajas sin chequear rol (`webhook.js:1168`) | Media | Posible fuga de plata a no-admin; diverge de `permisosCaja.js` |
| 8 | Gastado mezcla ARS/USD en cards y "gasto vs presu" (`Obras.jsx:47-49`) | Media | Números de gestión visibles claramente erróneos en obras USD |
| 9 | `firmar.js` no valida estado `enviado` (`api/portal/firmar.js:148`) | Media | Firma legal + dispara conversión de obra a activa |
| 10 | `calcSaldoCajaBot` ignora NC con `afectaCaja` (`webhook.js:368-380`) | Baja | **Safe-fix inmediato**: alinea saldo bot↔app de un toque |

## 4. Notas para el equipo
- Hay un **patrón sistémico de duplicación de cálculo de dinero** entre app, server (portal) y bot: `ccObra` (×3), `tareaVentaUnit` (×3), `desglosarCompra` (×2), saldo de caja (×2). Cada divergencia futura nace ahí. Recomendación de fondo: extraer helpers compartidos y, donde el bot no puede importar de `src/`, dejar tests de paridad.
- El **bot reincide en LWW** (`deshacer`, firma de actividad, OTP) en módulos donde la app ya migró a RPCs atómicos. Conviene una pasada que reemplace todo `saveSharedData(blob)` por el RPC correspondiente.
- La **whitelist del portal** debe extenderse del `detalle` a la `obra` (mismo criterio que `sanitizeDetalle`).


---

## Anexo A — Fixes seguros (confianza alta, riesgo bajo)

| # | Título | Archivo | Líneas | Severidad | Fix concreto |
|---|---|---|---|---|---|
| 1 | calcSaldoCajaBot ignora notas de crédito con devolución de plata (afectaCaja) | `api/whatsapp/webhook.js` | 368-380 | baja | Dentro del reduce de calcSaldoCajaBot, agregar la rama que ya tiene efectoEnCaja (lib/caja.js:20): tras la rama de 'traspaso', insertar `if (m.tipo === 'nota_credito_compra' && m.afectaCaja && m.cajaId === caja.id) return s + (m.monto || 0);`. Verificado byte-a-byte contra efectoEnCaja. Confianza ALTA, riesgo BAJO. |
| 2 | resolverMOAPU no detecta catálogo MO vacío cuando es un Map (.length en un Map) | `src/lib/apuPriceResolver.js` | 205 | baja | Reemplazar `if (!moCatalogo || moCatalogo.length === 0) {` por `const isEmpty = !moCatalogo || (moCatalogo instanceof Map ? moCatalogo.size === 0 : moCatalogo.length === 0); if (isEmpty) {` — idéntico a resolverItemAPU:162-163 (verificado). No cambia el resultado actual (mismo fallback) pero blinda ante cambios futuros. Confianza ALTA, riesgo BAJO. |
| 3 | KPI 'Roles base' muestra undefined: (roles || []).length sobre un objeto | `src/pages/Usuarios.jsx` | 400 | baja | Reemplazar `value: (roles || []).length,` por `value: Object.keys(roles || {}).length,`. `roles` es un objeto (loadRoles devuelve {...ROLES}); el resto de la página ya itera con Object.entries/keys. Verificado. Confianza ALTA, riesgo BAJO. |
| 4 | Variable {{plazo}} en contratos PADIC siempre se imprime en blanco | `src/lib/contratistaDocs.js` | 139 | media | En datosDocContratista, reemplazar `'plazo': '',` por un plazo derivado de fechaInicio→fechaFin del contrato, ej: `'plazo': (contrato?.fechaInicio && contrato?.fechaFin) ? `${contrato.fechaInicio.slice(0,10).split('-').reverse().join('/')} a ${contrato.fechaFin.slice(0,10).split('-').reverse().join('/')}` : '',`. El contrato ya trae fechaInicio/fechaFin. Si se prefiere no calcular, quitar {{plazo}} de PLACEHOLDERS y de PlantillasContratistaModal.jsx. Confianza ALTA, riesgo BAJO (string de display en doc). |
| 5 | /movimientos y /cajas sin guard de ruta por rol (solo se ocultan en Sidebar) | `src/pages/Movimientos.jsx, src/pages/Cajas.jsx` | Movimientos.jsx (tope del componente) y Cajas.jsx (tope del componente) | media | Agregar en ambos componentes el mismo patrón defensivo que ya usan Usuarios/Catalogos/etc.: `useEffect(() => { if (currentUser && currentUser.rol !== 'Admin' && !currentUser.permisos?.verCaja) navigate('/', { replace: true }); }, [currentUser]);`. Ambas páginas ya filtran por caja, así que es defensa en profundidad alineada con verCaja. Confianza ALTA, riesgo BAJO (aditivo, no cambia datos). |


## Anexo B — Solo reporte (tocan plata/lógica o riesgo medio-alto — revisar a mano)

| # | Título | Archivo | Severidad |
|---|---|---|---|
| 1 | Portal manda presupuesto/notas/embudo venta de la obra al cliente (fuga de datos) | `api/portal/data.js` | alta |
| 2 | Percepción IVA de facturas pendientes nunca reduce la posición de IVA (se paga IVA de más) | `src/pages/Facturacion.jsx` | alta |
| 3 | Percepción IIBB de facturas pendientes no se descuenta del IIBB devengado | `src/pages/Facturacion.jsx` | alta |
| 4 | deshacer reescribe el blob entero de movimientos (LWW) y pisa cajas | `api/whatsapp/webhook.js` | alta |
| 5 | avancePct se pisa en TODOS los contratos de la obra (match por gremio vacío) - certifica/liquida mal | `api/whatsapp/webhook.js, src/pages/obra/ObraGantt.jsx` | alta |
| 6 | removeUsuario borra app_users desde el browser (RLS): borra Auth pero no la fila, falla en silencio | `src/store/UsuariosContext.jsx` | alta |
| 7 | Gastado por obra mezcla ARS y USD: cards y gasto-vs-presu incorrectos en obras USD | `src/pages/Obras.jsx` | media |
| 8 | Conciliacion: movimientos de Agregar quedan conciliado:true sin conciliacionId si no se confirma | `src/pages/Conciliacion.jsx` | media |
| 9 | desglosarCompraBot del bot no acepta alicuota explicita; diverge de la app (hardcodea 21%) | `api/whatsapp/webhook.js` | media |
| 10 | Factura B a Consumidor Final por monto alto envia DocTipo 99/DocNro 0 sin avisar (AFIP rechaza) | `src/lib/wsfe.js` | media |
| 11 | Edicion concurrente de contrato y seguros en la misma obra = last-write-wins (patch no atomico por contrato) | `src/pages/obra/tabs/TabSeguros.jsx, src/store/ObrasContext.jsx` | media |
| 12 | Gantt asocia contrato no relacionado y muestra 'Contrato MO - undefined' | `src/pages/obra/ObraGantt.jsx` | media |
| 13 | firmar.js no valida que el contrato este en estado 'enviado' antes de firmar (dispara asegurarGanado) | `api/portal/firmar.js` | media |
| 14 | obra.presupuesto (costo interno) usado como fallback del precio mostrado al cliente | `src/pages/portal/PortalCliente.jsx` | media |
| 15 | Bot 'como va [obra]' cuenta cuotas con campos inexistentes c.cobrado/c.pagado; monto sin convertir a USD | `api/whatsapp/webhook.js` | media |
| 16 | Dictado dice 'Cargue N gastos' aunque para no-admin fueron a aprobacion (no cargados) | `api/whatsapp/webhook.js` | media |
| 17 | Dictado puede cargar gastos con cajaId null (no debitan ninguna caja) | `api/whatsapp/webhook.js` | media |
| 18 | IDs de movimiento mov-${Date.now()} pueden colisionar en el loop de dictado | `api/whatsapp/webhook.js` | media |
| 19 | extractMonto elige el numero mas grande del texto: serial/CUIT/fecha puede convertirse en monto | `api/whatsapp/_extractors.js` | media |
| 20 | Lock de media best-effort (RMW sin CAS): ventana de doble-carga de comprobantes | `api/whatsapp/webhook.js` | media |
| 21 | getLinkedCliente vincula por telefono aunque whatsappActivo este apagado (fuga de datos de obra) | `api/whatsapp/webhook.js` | media |
| 22 | handleClienteFlow ignora obras vinculadas por clienteId (solo matchea texto o.cliente) | `api/whatsapp/webhook.js` | media |
| 23 | El bot trata cajasVisibles==='*' como 'todas' sin chequear rol (diverge de permisosCaja.js) | `api/whatsapp/webhook.js` | media |
| 24 | Webhook de WhatsApp fail-open: si no se lee el body crudo, no valida firma de Meta y procesa igual | `api/whatsapp/webhook.js` | media |
| 25 | Roles editados (permisos por rol) se guardan solo en localStorage por maquina, no en la DB | `src/store/UsuariosContext.jsx` | media |
| 26 | RegistrarPagoModal solo lista cajas ARS: imposible registrar el pago de una factura desde caja USD | `src/pages/modales/RegistrarPagoModal.jsx` | baja |
| 27 | faltaCobrar/totalCobradoReal en Resumen mezclan moneda (codigo muerto con calculo incorrecto) | `src/pages/obra/ObraPresupuesto.jsx` | baja |
| 28 | ccObra duplicado en Obras.jsx vs helpers.js (riesgo de divergencia del total cliente USD) | `src/pages/Obras.jsx` | baja |
| 29 | fingerprintRecibido sin N: proveedor+fecha+total puede dar falso positivo de duplicado | `src/lib/afip.js` | baja |
| 30 | matchFacturasPorPago: tolerancia ±0,5% puede emparejar el pago con la factura equivocada | `src/lib/facturasPendientes.js` | baja |
| 31 | Libro IVA Digital (TXT AFIP) exporta ventas en borrador con numero 0 solo con confirm() | `src/pages/Facturacion.jsx` | baja |
| 32 | Conciliacion: la diferencia banco vs app no contempla lineas no coincidentes, induce a confirmar con descuadre | `src/pages/Conciliacion.jsx` | baja |
| 33 | El rate-limit horario del OTP es ineficaz: los codigos se borran a los 10 min | `api/portal/solicitar-otp.js` | baja |
| 34 | Si el token del portal no tiene phone, la firma queda en callejon sin salida sin guia clara | `api/portal/solicitar-otp.js` | baja |
| 35 | removeCliente no limpia obras vinculadas ni actividades del CRM (referencias colgadas) | `src/store/ClientesContext.jsx` | baja |
| 36 | PrimerContacto puede crear clientes duplicados por diferencias triviales de nombre | `src/pages/comercial/PrimerContactoModal.jsx` | baja |
| 37 | cuotaEstadoCalc importada y luego sombreada con firma distinta (codigo engañoso) | `src/pages/portal/PortalCliente.jsx` | baja |
| 38 | Calculo de venta del rubro duplicado (admin-preview no respeta materialesACargoComprador) | `src/pages/portal/PortalCliente.jsx` | baja |
| 39 | addActividad/firma escriben crm_actividades por RMW del blob entero en firmar.js (LWW) | `api/portal/firmar.js` | baja |
| 40 | OTP de firma: RMW del blob portal_otp_codes pierde incrementos de intentos bajo concurrencia | `api/portal/firmar.js` | baja |
| 41 | Inconsistencia de filtro de tareas en ventaRubro (portal) vs calcRubro (admin) | `api/portal/data.js` | baja |
| 42 | Guard del rol 'Contador externo' depende de useEffect post-render: la pagina se monta brevemente | `src/App.jsx` | baja |


---

**Resumen del auditor:** De los 49 hallazgos quedan 47 reales tras consolidar 2 pares duplicados (fuga del portal y match de contratos por gremio vacío). Hay 6 de severidad alta y todos tocan plata o datos sensibles: fuga del presupuesto/embudo al portal del cliente, IVA e IIBB declarados de más por percepciones de facturas pendientes, el 'deshacer' del bot que reescribe el blob de movimientos (LWW), el avancePct que se pisa en todos los contratos y liquida mal a contratistas, y el borrado de usuarios que deja Auth y app_users inconsistentes. Solo 5 entran como safe-fixes de confianza alta y riesgo bajo (saldo del bot ignora NC, Map en resolverMOAPU, KPI Roles base, {{plazo}} en blanco y guards de ruta en Movimientos/Cajas); el resto va a reportOnly por tocar matemática de dinero, lógica fiscal o concurrencia. El patrón de fondo es duplicación de cálculos de dinero entre app/server/bot y reincidencia de escrituras LWW en el bot donde la app ya migró a RPCs atómicos.

---

## Anexo C — Aplicación de fixes (2026-06-24, automático)

**Aplicados y commiteados** (3 de 5 — alta confianza, riesgo bajo, verificados contra el código real):

1. **Bot `calcSaldoCajaBot`** — faltaba la rama de NC de proveedor con devolución de plata; se agregó como espejo exacto de `efectoEnCaja` (`src/lib/caja.js`). El comando `saldo` del bot ahora cuadra con la app. → `api/whatsapp/webhook.js`
2. **`resolverMOAPU`** — detección de catálogo vacío ahora es Map-aware (igual que `resolverItemAPU`). Defensivo, sin cambio de comportamiento actual. → `src/lib/apuPriceResolver.js`
3. **KPI "Roles base"** — `Object.keys(roles).length` en vez de `.length` sobre un objeto (mostraba `undefined`). → `src/pages/Usuarios.jsx`

**Retenidos para tu revisión** (el auditor los marcó "safe", pero al verificarlos NO lo son):

4. **`{{plazo}}` en contratos PADIC** (`src/lib/contratistaDocs.js:139`) — es contenido de un documento legal firmable. "Plazo" puede significar duración (días) o rango de fechas; no autocompleto una interpretación en un contrato. **Decisión de negocio.**
5. **Guard de ruta `/movimientos` y `/cajas`** (`src/pages/Movimientos.jsx`, `Cajas.jsx`) — el guard propuesto bloquea por `permisos.verCaja`, pero la visibilidad de cajas también la da ser **responsable/asignado** (`src/lib/permisosCaja.js`). Aplicarlo dejaría afuera a un responsable de caja sin el flag `verCaja` → regresión. Si se quiere un guard, debe basarse en `cajasDelUsuario(...).length > 0`, no en `verCaja`.
