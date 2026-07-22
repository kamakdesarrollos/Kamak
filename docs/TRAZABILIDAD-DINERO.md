# Trazabilidad del dinero en Kamak

> Cómo entra, se mueve y sale la plata en el sistema, dónde vive cada dato, qué
> deriva de qué, y qué invariantes tienen que cumplirse SIEMPRE.
> Actualizado: 2026-07-03 (auditoría integral del dinero, rama `fix/auditoria-dinero`).

---

## 1. El principio rector: libro único

**Todo el dinero es un movimiento.** La lista `movimientos` (en `shared_data`,
key `'movimientos'`) es la única fuente de verdad del dinero que se mueve.
Todo lo demás se **deriva** — nunca se guarda un total "a mano":

| Número | Cómo se calcula | Dónde vive la lógica |
|---|---|---|
| Saldo de una caja | `saldoInicial + Σ efectoEnCaja(mov)` | `src/lib/caja.js` (testeado) |
| Estado/saldo de una factura | `monto − Σ pagos` | `src/lib/facturasPendientes.js` (testeado) |
| CC de un proveedor | facturas (por saldo) + legacy − crédito | `src/lib/proveedorCC.js` (testeado) |
| Crédito con un proveedor | anticipos − aplicaciones | `src/lib/proveedorCC.js` |
| Cobrado de una obra | Σ ingresos de la obra (en USD) | `src/pages/obra/helpers.js` |
| Posición consolidada | cajas activas + créditos en proveedores | `src/pages/Dashboard.jsx` |

Si un número derivado no coincide con lo que esperás, el problema está en los
movimientos — no en el cálculo. `node scripts/audit-dinero.mjs` valida todos los
invariantes contra los datos reales (solo lectura).

## 2. El ciclo del dinero

### Entra 💰
- **Cobro al cliente** (cuota de obra): movimiento `ingreso` con `obraId` y
  `cuotaId` de referencia. La CC del cliente se deriva repartiendo lo cobrado
  sobre las cuotas en orden (`repartirCobroEnCuotas`) — no se escribe
  `cuota.pagos[]`.
- **Cheque de tercero recibido**: al registrarlo entra como `ingreso` a la caja
  elegida y nace el cheque en estado `cartera` con `movimientoId` de vínculo.
- **Nota de crédito con devolución**: `nota_credito_compra` con `afectaCaja:true`
  suma a la caja; sin `afectaCaja` es solo fiscal (Libro IVA) y no toca saldos.

### Se mueve 🔁
- **Traspaso entre cajas**: UN solo movimiento `traspaso` con las dos patas
  (`cajaId` −monto, `cajaDestinoId` +`montoDestino`); cross-moneda guarda
  `tcAplicado`. Atómico por diseño (las patas no pueden divergir).
- **Depósito de cheque**: traspaso de la caja donde entró al banco. El cheque
  pasa a `depositado`. Sin caja destino NO hay depósito (guard duro).

### Sale 💸
- **Pago de factura (orden de pago)**: el circuito prioritario. Ver §4.
- **Gasto directo**: movimiento `gasto` (materiales, impuestos, servicios). Si
  tiene proveedor pero NO factura vinculada ni marca de anticipo, **no toca la
  CC del proveedor** (regla: los impuestos tipo ARCA no generan crédito falso).
- **Anticipo a cuenta**: `gasto` con `anticipo:true` → genera **crédito a favor**
  en la CC del proveedor (ver §5).
- **Cheque propio emitido**: debita la caja al emitirse; `acreditado` es solo un
  cambio de estado (no re-debita).
- **Endoso de cheque**: el cheque sale como pago a un proveedor (gasto de la
  caja donde estaba contado).

## 3. Dónde vive cada cosa (Supabase `shared_data`)

| Key | Contenido | Escritura |
|---|---|---|
| `movimientos` | `{ cajas[], movimientos[] }` | Atómica por ítem (RPC) desde app y bot |
| `proveedores` | `{ proveedores[], ccEntries[], facturasPendientes[] }` | Atómica por ítem |
| `cheques` | `[cheque...]` | Atómica por ítem |
| `obras` | `{ obras[], detalles{obraId: {rubros, cuotas, contratos, ...}} }` | `patch_detalle_obra` por obra |
| `gastos_fijos`, `dolar`, `config`, `financiero_mensual`, `comprobantes` | blobs | ⚠️ blob entero con debounce (last-write-wins) |

Con la migración `0006_dinero_transaccional.sql` aplicada, las **operaciones de
negocio** (pagar factura, aplicar crédito, confirmar prorrateo, aprobar
pendiente) se hacen en **una transacción de Postgres** que toca todas las
colecciones juntas y deja rastro en la tabla `money_audit` (quién, qué, cuándo).
Sin la migración, la app y el bot usan un camino verificado con compensación
(si la 2ª escritura falla, se revierte la 1ª).

## 4. El circuito de órdenes de pago (factura → pago)

```
1. Se carga la factura del proveedor        →  facturasPendientes[] (estado 'pendiente')
   (app: FacturaPendienteModal / bot: foto)    · cuenta para Libro IVA desde su fecha
   ⚠ puede NO tener caja: es deuda, no pago    · con obraId si es de una obra
2. Se registra un pago (parcial o total)    →  UNA transacción:
   (app: RegistrarPagoModal / bot: "pagué")     a. movimiento 'gasto' (debita la caja)
                                                b. pago {movimientoId, monto, fecha} en factura.pagos[]
                                                c. estado/saldo derivados se recalculan
3. Estados derivados de los pagos:             pendiente → parcial → pagada
   ('anulada' y 'registrada' son manuales)     'registrada' = solo fiscal, no es deuda
```

**Reglas duras del circuito** (validadas en el form Y server-side):
- Un pago **no puede exceder el saldo** de la factura. Si pagás de más, el
  excedente se registra como **anticipo a cuenta** (nunca se "traga").
- Una factura `pagada`/`anulada`/`registrada` **no admite pagos**.
- **Borrar el movimiento de un pago revierte el pago** en la factura (vuelve a
  deber) — en /movimientos, en Autorizaciones y en el "deshacer" del bot.
- Cada pago es **idempotente** por id de movimiento (reintentos no duplican).

## 5. CC de proveedores con crédito (nuevo, 2026-07-03)

```
deuda   = Σ saldo de facturas no anuladas / no 'registrada'   (lo que le debemos)
        + Σ (debe − haber) de ccEntries legacy                 (asientos manuales viejos)
crédito = Σ anticipos (gastos anticipo:true, en ARS)           (lo que dejamos a cuenta)
        − Σ aplicaciones (pagos {tipo:'credito'} en facturas)  (lo que ya consumimos)
saldo   = deuda − crédito
```

- `saldo > 0` → **le debemos** · `saldo < 0` → **a favor nuestro** · `|saldo| ≤ 1` → al día.
- El crédito a favor se **consume** con el botón "Aplicar crédito" (Órdenes de
  pago / CC del proveedor): agrega un pago `{tipo:'credito'}` a la factura **sin
  mover ninguna caja** — el pedido se retira sin pagar.
- Los créditos a favor **cuentan como ACTIVO**: suman a la posición consolidada
  del Dashboard (fila "Créditos en proveedores").
- Un pago suelto pregunta si es **anticipo** (genera crédito) o **gasto directo**
  (no toca la CC — impuestos, servicios).

## 6. Cheques (máquina de estados)

```
tercero:  cartera ──depositar──▶ depositado          (traspaso caja→banco)
             │  └──endosar──▶ endosado               (gasto: pago a proveedor)
             └──rechazar──▶ rechazado                (revierte la plata contada)
propio:   cartera ──acreditar──▶ acreditado          (solo estado; debitó al emitirse)
cualquiera ──anular──▶ anulado · rechazado ──reactivar──▶ cartera
```
El cheque guarda `movimientoId` para poder revertir su plata. Borrar un cheque
revierte su movimiento de origen; deshacer movimientos de cheques por chat está
bloqueado (se hace desde la pantalla Cheques, que revierte todo junto).

## 7. Prorrateo de gastos fijos

Los gastos fijos se **pagan** como gastos reales de caja (sin obra). Al
confirmar el prorrateo se crean movimientos `categoria:'prorrateo'` **sin caja**
(asiento analítico) que reparten ese costo entre las obras activas:
- Cuentan en el **gastado por obra** (márgenes por obra).
- Se **excluyen** de los consolidados de empresa (Reportes, Dashboard, cashflow)
  — el pago real ya está contado; sumarlos duplicaría el costo.
- La confirmación es **idempotente por mes** (server-side + guard en la UI) y el
  criterio manual exige que los % sumen 100.
- El peso económico convierte presupuestos USD a ARS antes de ponderar.

## 8. Excepciones sancionadas (reglas del dueño, 2026-07-03)

1. **Facturas sin caja: OK.** Ej.: factura a nombre de la empresa por un gasto
   personal → estado `registrada` (cuenta para Libro IVA, no es deuda, no mueve caja).
2. **Movimientos sin caja: MAL**, con dos únicas excepciones:
   - `ccPrevia:true` — arrastre histórico de cobros del cliente pre-sistema
     (con `montoDolar`; excluidos de listados y saldos por diseño).
   - `categoria:'prorrateo'` — asiento analítico (§7).
3. **La CC de proveedores puede quedar a favor** y ese crédito es un activo.

## 9. Los invariantes (y cómo verificarlos)

`node scripts/audit-dinero.mjs` (solo lectura, usa `.env.local`) valida contra
los datos reales:

- Todo movimiento apunta a cajas/obras existentes; montos numéricos ≥ 0; IDs únicos.
- Todo pago en una factura apunta a un movimiento EXISTENTE con el mismo monto.
- Estado/saldo guardados de cada factura == derivados de sus pagos.
- Sin sobrepagos (pagado ≤ monto) y sin crédito sobre-consumido (aplicado ≤ anticipado).
- Cheques depositados tienen movimiento vinculado con el mismo monto; rechazados
  no conservan plata fantasma.
- Movimientos sin caja solo en las excepciones sancionadas (§8).
- Saldos `saldo` persistidos (vestigiales) == derivados.

**Estado al 2026-07-03: 0 inconsistencias en producción** (tras la limpieza:
re-vinculación del pago de $405.336 de ARCA, `proveedorId` en gastos ARCA,
refresh de 4 saldos vestigiales; backup en `scripts/_backup_PRE_LIMPIEZA_AUDITORIA_*.json`).

## 10. El bot y el dinero

El bot (WhatsApp/Telegram, `api/whatsapp/webhook.js`) escribe dinero con los
MISMOS mecanismos que la app: RPCs atómicas por ítem y, para operaciones de
negocio, las RPCs transaccionales de la migración 0006 (con fallback verificado).
Puntos clave:
- Carga de gastos/facturas por foto → pendientes de aprobación (`whatsapp_pending`).
  Aprobar es **test-and-set**: un pendiente resuelto no puede re-aprobarse
  (ni por chat ni en carrera con la app), y aprobar por la app conserva TODO lo
  extraído del comprobante (IVA, percepciones, rubro).
- "pagué X a Y" → matching contra facturas abiertas por saldo (±0,5%) → pago
  atómico (mismo circuito que la app).
- "deshacer" → borra el último movimiento propio POR ÍTEM, revierte el pago en
  la factura vinculada, y rechaza deshacer movimientos de cheques.
- Facturas recibidas: huella anti-duplicados (letra+serial+CUIT+total) para no
  cargar dos veces el mismo comprobante (protege el crédito de IVA).
- Los saldos que informa se derivan igual que en la app (`saldoInicial + Σ efectos`).

## 11. Qué falta (deuda conocida, por orden de prioridad)

Ver el informe completo en `docs/INFORME-AUDITORIA-DINERO-2026-07-03.md` y el
anexo de veredictos. Los estructurales grandes:
1. **RLS por rol**: cualquier usuario autenticado todavía puede escribir las
   keys de dinero desde la consola (el RBAC es de UI). El diseño está en la
   migración 0006 (sección comentada) — requiere decidir el mapa rol→keys.
2. **Keys que siguen siendo blob entero** (last-write-wins): `comprobantes`
   (AFIP), `financiero_mensual`, `gastos_fijos`, `dolar`, `config`.
3. **Dedup de webhooks** de Meta para mensajes de texto de dinero (el lock hoy
   cubre solo media).
4. Mezclas de moneda restantes en agregados (gastado por rubro con cajas USD,
   KPIs de cheques) — detalladas en el anexo.
