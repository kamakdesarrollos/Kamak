# Informe — Auditoría integral del dinero (noche del 2026-07-02/03)

> Trabajo nocturno autónomo sobre la rama `fix/auditoria-dinero` (SIN pushear).
> Alcance acordado: arquitectura → bugs verificados → features de CC con crédito
> → limpieza de datos de producción → documentación de trazabilidad.

## Resumen ejecutivo

- **Producción quedó en 0 inconsistencias** contra todos los invariantes contables
  (`node scripts/audit-dinero.mjs` — queda como chequeo permanente).
- **Feature nueva completa**: CC de proveedores con saldo a favor consumible +
  créditos como activo en el Dashboard (lo que pediste).
- **9 commits** en la rama: 2 features + SQL transaccional + 4 lotes de fixes de
  bugs confirmados + documentación. **667 tests pasan** (75 nuevos), build OK.
- **Verificación adversarial**: ~180 sospechas verificadas por agentes independientes
  leyendo el código real → **107 confirmadas** individualmente + 152 reales en
  triage rápido, 5 refutadas. Arreglé esta noche las de dinero más graves; el
  resto queda priorizado en el anexo.

## 1. Limpieza de datos de producción (ejecutada con backup)

Backup completo (32 keys) en `scripts/_backup_PRE_LIMPIEZA_AUDITORIA_*.json`.

| Qué | Acción |
|---|---|
| Pago roto de $405.336 (factura ARCA "Cargas Sociales" con `movimientoId` muerto) | Re-vinculado al movimiento real `mov-1782301796376` (VEP ARCA, mismo monto/fecha/proveedor) + caja corregida a SANTANDER |
| 3 gastos ARCA matcheados solo por nombre | `proveedorId` completado |
| 4 saldos vestigiales desactualizados (Franco/Federico/SANTANDER/Administración) | Refrescados al valor derivado (la app ya derivaba bien; esto alinea lo persistido) |
| 51 movimientos "sin caja" | **NO se tocaron**: son arrastres `ccPrevia` intencionales (cobros históricos de Cagle/La Lucila/Gallo Negro en USD). Documentados como excepción sancionada |

## 2. Features implementadas (rama `fix/auditoria-dinero`)

### CC de proveedores con crédito a favor
- `src/lib/proveedorCC.js` (+24 tests): deuda = facturas por saldo + legacy;
  crédito = anticipos − aplicaciones; saldo negativo = a favor.
- **Arregla de paso el bug del doble descuento**: al saldarse una factura al
  100%, la CC quedaba en −monto para siempre (confirmado por 2 verificadores).
- ProveedorCC: "A favor $X" en verde (antes se escondía como "Al día"), KPI de
  crédito disponible, libro de asientos derivado, botón "Crédito" por factura.
- Órdenes de pago: chip "A favor" por proveedor + botón "Aplicar crédito"
  (consume crédito contra una factura SIN mover caja — el pedido se retira sin pagar).
- RegistrarPagoModal: pago suelto pregunta **anticipo** vs **gasto directo**
  (los impuestos tipo ARCA ya no inventan crédito falso); **sobrepago bloqueado**
  con opción de registrar el excedente como anticipo (antes se "tragaba").
- Dashboard: fila "Créditos en proveedores" + suma a la posición consolidada (activo).

### Núcleo transaccional (SQL — requiere aplicar la migración)
`supabase/migrations/0006_dinero_transaccional.sql` → **aplicar en Supabase
Studio → SQL Editor** (idempotente, con rollback al pie):
- `registrar_pago_factura`: movimiento + pago en la factura en UNA transacción,
  idempotente, con validación de sobrepago server-side.
- `aplicar_credito_factura`, `confirmar_prorrateo` (idempotente por mes),
  `aprobar_pendiente_atomico` (test-and-set).
- Tabla `money_audit` append-only: quién hizo qué operación de dinero y cuándo
  (solo Admin la lee).
- Fix del hueco UPDATE-only de las RPC de 0002/0003 (el primer ítem de una key
  fresca podía perderse en silencio).

**La app y el bot funcionan igual SIN la migración aplicada** (fallback
verificado con compensación); con la migración, las operaciones pasan a ser
atómicas de verdad. Recomendado aplicarla en el primer QA.

## 3. Bugs confirmados y ARREGLADOS esta noche

| # | Bug (confirmado adversarialmente) | Fix |
|---|---|---|
| 1 | Pagar factura escribía en 2 keys sin transacción ni verificación → caja debitada con factura abierta (pasó en prod) | Orquestador atómico RPC→fallback compensado (app y bot) |
| 2 | Sobrepago de factura se "tragaba" (clamp en 0) | Guard + excedente→anticipo |
| 3 | Borrar el movimiento de un pago dejaba la factura 'pagada' con ref muerta (3 rutas: /movimientos, Autorizaciones, bot "deshacer") | `quitarPagoDeFactura` en las 3 rutas |
| 4 | CC proveedor: doble descuento al saldar factura al 100% (app, listado y bot) | Nueva derivación (lib testeada) |
| 5 | Prorrateo NO idempotente: doble click / dos admins duplicaban todos los gastos del mes | RPC test-and-set + guard local + botón deshabilitado de verdad |
| 6 | Prorrateo: % manual sin validar (30% o 500% pasaban) y peso económico mezclando ARS+USD crudos | Validación Σ=100 + conversión a ARS |
| 7 | Doble conteo del gasto fijo en consolidados (pago real + prorrateo analítico sumaban ambos) | 'prorrateo' excluido de costoYTD/gastos del mes/cashflow |
| 8 | Depositar cheque sin caja destino evaporaba la plata (traspaso a '') | Guard duro en modal y handler |
| 9 | Un dispositivo nuevo pisaba el dólar MANUAL del admin (toda la org repreciaba) | Espera del estado remoto + un refresh auto nunca saca del modo manual |
| 10 | Aprobar movimiento del bot por la app descartaba IVA/percepciones/rubro (resultado contable distinto según canal) y podía crear gastos sin caja | Spread completo + bloqueo si no se resuelve caja |
| 11 | Bot: "aprobar 1" dos veces creaba dos movimientos (sin check de status) | Check + RPC test-and-set |
| 12 | Bot: pago que salda factura usaba `pagos[]` stale → pisaba un pago concurrente de la app | RPC / re-lectura fresca |
| 13 | Bot: "deshacer" reescribía el blob ENTERO de movimientos (pisaba lo concurrente) y no revertía factura/cheques | Borrado por ítem + reversión de factura + bloqueo para cheques |
| 14 | Bot: `cc_proveedor` no contaba facturas pendientes como deuda y los impuestos daban "a favor" falso | Misma semántica que la app |
| 15 | Conciliación: movimiento creado desde el extracto nacía `conciliado:true` → si se abandonaba la sesión quedaba excluido del matching PARA SIEMPRE (invitaba a duplicarlo) | Se marca recién al confirmar |

## 4. Confirmados que QUEDAN pendientes (priorizados)

Detalle completo con mecanismo y escenario en
`docs/auditoria-dinero-2026-07-03-veredictos-anexo.md` (~107 confirmados + 152
triage). Los más importantes:

1. **RLS**: cualquier autenticado puede escribir keys de dinero desde DevTools
   (el RBAC es solo de UI). Diseño pendiente de decisión rol→keys.
2. **AFIP `emitir`**: check-then-act sin lock → dos requests concurrentes pueden
   emitir DOS facturas fiscales reales por el mismo comprobante.
3. **Keys todavía blob-entero** (LWW): `comprobantes` (dos usuarios cargando
   facturas AFIP con <3s de diferencia se pisan), `financiero_mensual`,
   `gastos_fijos`, `dolar`, `config`.
4. **ObraPresupuesto**: roundtrip USD corrompe costos al editar en vista U$S
   (±tc/2 por toque de celda); flush del detalle completo por obra (LWW dentro
   de la misma obra entre dos sesiones).
5. **Monedas**: gastado por rubro suma gastos de cajas USD sin convertir;
   KPIs de cheques mezclan ARS+USD; ingreso directo a caja USD no congela TC.
6. **Dedup de webhooks** de Meta para texto (el lock cubre solo media).
7. Cheques: editar un cheque no sincroniza su movimiento; cheque USD acreditado
   a valor facial en caja ARS; eliminar cheque solo revierte el mov de origen.
8. `migrarSaldoInicial` nunca persiste el backfill (hoy inofensivo: todas las
   cajas de prod tienen `saldoInicial`).

## 5. Cómo hacer QA mañana

```bash
git checkout fix/auditoria-dinero
npm run dev
```
1. **Aplicar la migración**: Supabase Studio → SQL Editor → pegar
   `supabase/migrations/0006_dinero_transaccional.sql` → Run.
2. Probar el circuito de pago: crear orden de pago → pagar parcial → pagar el
   resto con sobrepago (ver el excedente→anticipo) → ver el crédito en la CC →
   "Aplicar crédito" contra otra factura → verlo como activo en el Dashboard.
3. Probar prorrateo: confirmar → intentar confirmar de nuevo (bloqueado).
4. Borrar un movimiento de pago → la factura vuelve a deber.
5. `node scripts/audit-dinero.mjs` → debe dar 0 hallazgos.
6. Si todo cierra: merge a `main` (auto-deploya) y `supabase functions` no
   requiere nada (la migración es solo SQL).

Los backups de los datos previos a la limpieza están en
`scripts/_backup_PRE_LIMPIEZA_AUDITORIA_*.json` (restaurables con un upsert).
