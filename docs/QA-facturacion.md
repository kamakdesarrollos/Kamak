# QA — Módulo Facturación (panel ARCA/AFIP)

Plan de pruebas **manual** del módulo Facturación de Kamak. Cubre las 4 solapas
(Resumen, Ventas, Compras, Financiero), la emisión de comprobantes, el desglose
fiscal, las percepciones, las notas de crédito y los exports — incluido lo que se
carga por el **bot de WhatsApp**.

> Está pensado para que lo ejecute alguien del equipo sin conocer el código.
> Marcá cada caso como ✅ OK / ❌ Falla / ➖ N/A y anotá el resultado real cuando
> difiera de lo esperado.

---

## 0. Preparación

### Roles y accesos
- **Admin**: ve y edita todo. Es el único que puede emitir facturas y aprobar
  facturas del buzón.
- **Contador**: entra a Facturación en modo **solo lectura** (no carga ni edita).
- **Otros roles**: NO deben poder entrar a Facturación (los redirige al inicio).

> Probá al menos con un usuario Admin y uno Contador. Verificá que un rol común
> (ej. Comprador) no acceda a la pantalla.

### Datos de prueba que conviene tener cargados
- Al menos **2 clientes**: uno Responsable Inscripto (con CUIT válido) y uno
  Consumidor Final (sin CUIT).
- Al menos **2 proveedores** con CUIT.
- Al menos **1 obra activa** y **1 caja en ARS** con saldo conocido.
- Conocé el **saldo inicial** de esa caja para verificar los descuentos.

### Convenciones de la pantalla
- Arriba a la derecha hay un **selector de mes** y un botón **"Hoy"**. Casi todo
  lo que se ve depende del mes elegido.
- Solapas: **📊 Resumen · 📤 Ventas · 📥 Compras · 💰 Financiero**.

### Qué NO se puede probar todavía (no es una falla)
- **Emisión real contra AFIP (WSFE)**: hoy las facturas se guardan como
  *borrador* sin número de AFIP. El número y el CAE los asigna AFIP cuando se
  conecte el web service, que aún no está integrado.
- Por eso, en los exports oficiales (Libro IVA Digital) las ventas en borrador
  salen con número 0. Es esperado.

---

## 1. Acceso y navegación

| # | Caso | Pasos | Esperado |
|---|------|-------|----------|
| 1.1 | Acceso Admin | Entrar como Admin a Facturación | Ve las 4 solapas y el botón "+ Nueva factura" |
| 1.2 | Acceso Contador | Entrar como Contador | Ve todo pero SIN "+ Nueva factura" ni edición; no puede cargar valores en el Financiero |
| 1.3 | Acceso denegado | Entrar con un rol común | Lo redirige al inicio, no ve Facturación |
| 1.4 | Cambio de mes | Cambiar el mes y tocar "Hoy" | Todas las solapas actualizan sus datos al mes elegido / al mes actual |

---

## 2. Solapa VENTAS — Emisión de comprobantes

### 2.1 Alta de factura
| # | Caso | Pasos | Esperado |
|---|------|-------|----------|
| 2.1.1 | Factura B a Consumidor Final | + Nueva factura → cliente CF → tipo Factura B → neto $10.000, IVA 21% → guardar | Total $12.100. Aparece en la lista de Ventas del mes como *borrador* |
| 2.1.2 | Factura A a Responsable Inscripto | Cliente RI con CUIT válido → tipo Factura A → guardar | Se guarda. La letra disponible para ese cliente es solo "A" |
| 2.1.3 | Letra según cliente | Elegir un cliente CF e intentar Factura A | Solo ofrece tipos de letra B (Factura A es exclusiva de RI) |
| 2.1.4 | Factura A sin CUIT válido | Cliente RI con CUIT inválido → Factura A | Muestra error de validación (CUIT del receptor inválido) y no deja guardar |
| 2.1.5 | Neto en 0 | Dejar neto vacío/0 | No deja guardar (el neto debe ser > 0) |
| 2.1.6 | Cálculo de IVA | Neto $1.000, alícuota 10,5% | IVA $105, total $1.105 |

### 2.2 Concepto AFIP (nuevo)
| # | Caso | Pasos | Esperado |
|---|------|-------|----------|
| 2.2.1 | Selector presente | Abrir Nueva factura | Hay un campo "Concepto AFIP" con: Servicios (default), Productos, Productos y Servicios |
| 2.2.2 | Es independiente del detalle | Escribir un detalle libre y elegir otro Concepto AFIP | Son dos campos distintos: el detalle es texto, el Concepto AFIP es la categoría |
| 2.2.3 | Persiste y exporta | Guardar y exportar CSV de Ventas | La columna "Concepto AFIP" muestra el valor elegido |

### 2.3 Notas de crédito / débito EMITIDAS (comprobante asociado)
| # | Caso | Pasos | Esperado |
|---|------|-------|----------|
| 2.3.1 | NC pide factura original | Tipo Nota de Crédito → cliente con facturas previas | Aparece selector obligatorio "Comprobante asociado" con las facturas de ese cliente y misma letra |
| 2.3.2 | Sin facturas previas | NC para un cliente sin facturas de esa letra | El selector queda deshabilitado con aviso (RG 5824/2026) y no deja completar |
| 2.3.3 | Original emitida | Elegir como asociado una factura YA emitida (con número) | Muestra "Asociado AFIP: tipo X · PV Y · N° Z" |
| 2.3.4 | Original borrador | Elegir como asociado una factura en borrador (sin número) | Aviso ámbar "⚠ La factura original todavía es un borrador…" |

### 2.4 Anti-duplicado y borrado
| # | Caso | Pasos | Esperado |
|---|------|-------|----------|
| 2.4.1 | Duplicado bloqueado | Intentar cargar 2 veces el mismo comprobante (mismo cliente, tipo, fecha, total) | Avisa en rojo que ya existe y no deja guardar el segundo |
| 2.4.2 | Eliminar borrador | Admin → en la lista de Ventas, borrar un borrador | Pide confirmación y lo elimina. (Contador no debe ver el borrar) |
| 2.4.3 | Lista vacía | Mes sin ventas | Muestra "No hay comprobantes emitidos en este mes" |

---

## 3. Solapa COMPRAS — Libro IVA Compras

> Las compras salen de los **gastos con comprobante** cargados en Movimientos o
> por el bot (no se cargan en esta solapa, solo se visualizan).

| # | Caso | Pasos | Esperado |
|---|------|-------|----------|
| 3.1 | Factura de proveedor aparece | Cargar un gasto con factura A de proveedor | Aparece en Compras del mes con tipo, proveedor, neto, IVA, total |
| 3.2 | Factura C sin IVA crédito | Gasto con Factura C (monotributista) | Neto = total, IVA $0, no suma crédito |
| 3.3 | Recibo de sueldo NO aparece | Gasto categoría "sueldo"/"cargas"/"IIBB" | NO figura en el Libro IVA Compras (no genera crédito) |
| 3.4 | Nota de crédito recibida | Ver una NC de proveedor (ver sección 6) | Aparece con badge ámbar "NC" e importes en **negativo** |

---

## 4. Desglose fiscal — el punto más crítico

> Verifica que la caja descuente el **TOTAL** y que el IVA crédito no se infle.
> Estos casos cubren el bug grave que ya se corrigió.

| # | Caso | Pasos | Esperado |
|---|------|-------|----------|
| 4.1 | **Caja descuenta el TOTAL** | Gasto Factura A: neto $1.000.000 + IVA $210.000 | La caja baja **$1.210.000** (NO $1.000.000). En Compras: neto $1.000.000 / IVA $210.000 / total $1.210.000 |
| 4.2 | Base fiscal con percepción IIBB | Gasto total $1.210.000 con percepción IIBB $10.000 | Base $1.200.000 → neto $991.735,54 / IVA $208.264,46. El total guardado sigue siendo $1.210.000 |
| 4.3 | Base fiscal con percepción IVA | Gasto total $1.240.000 con percepción IVA $30.000 | Base $1.210.000 → neto $1.000.000 / IVA $210.000. El IVA NO se infla |
| 4.4 | Ambas percepciones | Total $1.250.000, IIBB $10.000 + IVA $30.000 | Base $1.210.000 → neto $1.000.000 / IVA $210.000 |
| 4.5 | Consistencia de los 4 caminos | Cargar la MISMA factura por: (a) gasto+foto admin, (b) factura_compra auto-carga admin, (c) buzón→modal, (d) `aprobar N` por chat | Los 4 dan el mismo neto/IVA/total y la misma plata fuera de caja |

---

## 5. Percepciones IIBB e IVA sufridas

### 5.1 Percepción IIBB (descuenta del IIBB del mes)
| # | Caso | Pasos | Esperado |
|---|------|-------|----------|
| 5.1.1 | Campo solo en gastos | Movimientos → nuevo gasto | Aparece "Percepción IIBB sufrida $"; en ingresos NO aparece |
| 5.1.2 | Descuenta del IIBB | Cargar gasto con percepción IIBB $800 (jurisdicción PBA) | Financiero: el IIBB del mes baja $800; el hint muestra "− perc $800" |
| 5.1.3 | Bot la lee del ticket | 🤖 Foto de ticket YPF que discrimine "Perc. IIBB" | El bot extrae la percepción y la carga |

### 5.2 Jurisdicción IIBB (nuevo)
| # | Caso | Pasos | Esperado |
|---|------|-------|----------|
| 5.2.1 | Selector aparece | Cargar percepción IIBB > 0 | Aparece "Jurisdicción IIBB" (PBA default, CABA, Córdoba, Otra) |
| 5.2.2 | PBA netea | Percepción IIBB jurisdicción PBA | Descuenta del IIBB del mes |
| 5.2.3 | Otra jurisdicción NO netea | Percepción IIBB jurisdicción CABA | NO descuenta del IIBB; aparece nota ámbar "⚠ $X de otra jurisdicción (no netea acá)" |
| 5.2.4 | Bot lee jurisdicción | 🤖 Ticket que diga "IB Pcia Bs As" / "CABA" / "Córdoba" | Asigna PBA / CABA / CBA respectivamente |

### 5.3 Percepción IVA (nuevo — descuenta del IVA, NO del IIBB)
| # | Caso | Pasos | Esperado |
|---|------|-------|----------|
| 5.3.1 | Campo solo en gastos | Movimientos → nuevo gasto | Aparece "Percepción IVA sufrida $" |
| 5.3.2 | Reduce la posición IVA | Cargar gasto con percepción IVA $30.000 | Resumen → Posición IVA baja $30.000; el card muestra "incl. − $30.000 percep. IVA (pago a cuenta)" y el subtítulo "− Percep. IVA" |
| 5.3.3 | NO toca el IIBB | Misma carga del 5.3.2 | El IIBB del mes NO cambia |
| 5.3.4 | Excedente a saldo a favor | Percepción IVA mayor que la posición técnica del mes | El excedente engrosa el saldo a favor que se arrastra al mes siguiente |
| 5.3.5 | Bot la distingue de IIBB | 🤖 Ticket de mayorista con "Perc. IVA RG 2408/3337" | El bot la carga como percepción IVA, separada de la IIBB |
| 5.3.6 | Modal de aprobación | Aprobar una factura del buzón con percepción IVA | Input prellenado + hint verde "El bot la leyó del ticket"; la base fiscal del hint resta ambas percepciones |

---

## 6. Notas de crédito de proveedor (recibidas) — nuevo

| # | Caso | Pasos | Esperado |
|---|------|-------|----------|
| 6.1 | Bot detecta NC | 🤖 Foto/PDF que diga "Nota de Crédito A/B/C" | Va al **buzón** (no se auto-carga). En Autorizaciones tiene badge "Nota de crédito" |
| 6.2 | Aprobar como solo-fiscal | Modal de la NC → "¿Devolvió plata? = No" → guardar | Crea movimiento Nota de crédito. **Ninguna caja cambia**. Reduce IVA crédito y compras del mes |
| 6.3 | Aprobar con devolución | Modal → "¿Devolvió plata? = Sí" → elegir caja | La caja elegida **sube** por el monto de la NC |
| 6.4 | Libro IVA Compras | Ver la NC en la solapa Compras | Badge ámbar "NC", importes en **negativo** (neto/IVA/total). El crédito del mes baja |
| 6.5 | Posición IVA | Con una NC cargada | El crédito baja → la posición a pagar sube (o baja el saldo a favor) |
| 6.6 | Visible en Movimientos | Ver la NC en Movimientos | Aparece entre los gastos como crédito (verde, "+") con tag "NC · solo fiscal" si no toca caja |
| 6.7 | NC ≠ su factura (no es duplicado) | Cargar factura A 0001-12345 $12.000 y luego una NC A con mismo N°/CUIT/total | La NC NO se rechaza como duplicada |
| 6.8 | NC duplicada SÍ se bloquea | Reenviar la misma NC dos veces | La segunda se detecta como duplicada |
| 6.9 | Aprobar NC por chat | 🤖 `aprobar N` sobre una NC pendiente | La carga como ajuste fiscal puro (sin caja), con mensaje que lo aclara |
| 6.10 | CSV/print de Compras | Exportar CSV / imprimir resumen con una NC | Etiqueta "Nota de Crédito"/"NC" e importes negativos |

---

## 7. Solapa RESUMEN — Posición IVA y comparativas

| # | Caso | Pasos | Esperado |
|---|------|-------|----------|
| 7.1 | Posición = Débito − Crédito | Con ventas y compras del mes | El card muestra Débito (ventas), Crédito (compras) y A pagar / A favor |
| 7.2 | Notas de crédito emitidas restan del débito | Emitir una NC de venta | El débito del mes baja |
| 7.3 | Comparativa mes anterior | Ver el bloque del mes anterior | Muestra débito/crédito/posición del mes previo |
| 7.4 | Saldo a favor arrastrado | Mes con crédito > débito, luego mes siguiente | El saldo a favor del primer mes reduce lo "a pagar" del siguiente |
| 7.5 | Percepción IVA en la posición | Ver sección 5.3.2 | El card refleja la percepción IVA como pago a cuenta |

---

## 8. Solapa FINANCIERO — IIBB, sueldos, cargas

| # | Caso | Pasos | Esperado |
|---|------|-------|----------|
| 8.1 | IIBB devengado − descuentos | Ver la fila IIBB del mes | IIBB = devengado − retenciones (cobros) − percepciones PBA (gastos). El hint muestra el desglose |
| 8.2 | Retención IIBB en cobros | Cargar un ingreso (cobro) con retención IIBB | Descuenta del IIBB del mes |
| 8.3 | Carga manual override | Admin → escribir un valor manual en IIBB/sueldos/etc. | El valor manual reemplaza al automático |
| 8.4 | Contador no edita | Como Contador, intentar cargar un valor | No puede editar (solo lectura) |
| 8.5 | Acumulado | Ver la columna acumulado a lo largo de los meses | Suma correctamente mes a mes |

---

## 9. Condiciones IVA del receptor — nuevo

| # | Caso | Pasos | Esperado |
|---|------|-------|----------|
| 9.1 | Nuevas condiciones disponibles | Editar un cliente → condición IVA | Aparecen: Responsable Inscripto, Monotributo, **Monotributo Social**, **Mono Trab. Indep. Promovido**, IVA Sujeto Exento, **IVA No Alcanzado**, **Sujeto No Categorizado**, Consumidor Final |
| 9.2 | Letra de factura | Cliente con una de las nuevas condiciones → emitir factura | Solo permite Factura B (Factura A es solo para RI) |
| 9.3 | CSV Ventas | Exportar CSV con un cliente de condición nueva | La columna Cond.IVA muestra el nombre correcto |

---

## 10. Exports

| # | Caso | Pasos | Esperado |
|---|------|-------|----------|
| 10.1 | CSV Libro IVA Ventas | Resumen → ⬇ CSV Libro IVA Ventas | Baja un .csv que abre bien en Excel (acentos OK), con columnas incluyendo Concepto AFIP |
| 10.2 | CSV Libro IVA Compras | Resumen → ⬇ CSV Libro IVA Compras | Baja el .csv; las NC salen con importes negativos |
| 10.3 | CSV Financiero | Financiero → ⬇ CSV Financiero | Baja el .csv con las filas mensuales |
| 10.4 | Imprimir / PDF | Resumen → 🖨 Imprimir | Abre el resumen imprimible con ventas, compras y posición; box de Percep. IVA si hay |
| 10.5 | ZIP de comprobantes | Resumen → 🗂 ZIP comprobantes del mes | Baja un .zip con las fotos/PDF de las compras del mes |
| 10.6 | Botones deshabilitados | Mes sin datos | Los botones de export quedan atenuados / sin acción |

### 10.7 TXT Libro IVA Digital (AFIP, RG 5363) — nuevo
| # | Caso | Pasos | Esperado |
|---|------|-------|----------|
| 10.7.1 | Descarga el ZIP | Resumen → 📦 TXT Libro IVA Digital (AFIP) | Baja `libro-iva-digital-AAAA-MM.zip` con 4 archivos .txt |
| 10.7.2 | Aviso de borradores | Generar con ventas en borrador (sin N°) | Avisa que esos comprobantes saldrán con N° 0 antes de generar |
| 10.7.3 | Contenido compras | Con facturas de proveedor del mes | Los .txt de Compras tienen una línea por factura con datos reales |
| 10.7.4 | **Validación oficial** | Pasar los .txt por el aplicativo/validador de AFIP (lo hace el contador) | AFIP los acepta sin error de formato. **⚠ Es lo único que no se pudo testear contra el sistema real de AFIP — verificar una vez.** |

---

## 11. Bot de WhatsApp (🤖) — flujos fiscales

> Requiere el bot operativo (entorno de producción). Mandá fotos de tickets/
> facturas reales.

| # | Caso | Pasos | Esperado |
|---|------|-------|----------|
| 11.1 | Gasto con factura A | Foto de Factura A de proveedor | Caja descuenta el total; queda en Compras con neto/IVA correctos |
| 11.2 | Ticket con percepción IIBB | Foto de ticket YPF con "Perc. IIBB" | Carga la percepción IIBB y descuenta del IIBB del mes |
| 11.3 | Ticket con percepción IVA | Foto con "Perc. IVA RG 2408/3337" | Carga la percepción IVA (separada de IIBB), descuenta del IVA del mes |
| 11.4 | Nota de crédito | Foto de "Nota de Crédito" de proveedor | Va al buzón como NC para que el admin la apruebe |
| 11.5 | Mensajes del bot | Tras cargar | La confirmación muestra Neto / IVA / Percep. IIBB / Percep. IVA cuando corresponda |
| 11.6 | Aprobar por chat | `pendientes` y luego `aprobar N` | Carga la factura/NC con su desglose fiscal completo |
| 11.7 | Duplicado por bot | Reenviar la misma factura | El bot avisa que ya está cargada y no la duplica |

---

## 12. Regresión (que no se haya roto nada)

| # | Caso | Esperado |
|---|------|----------|
| 12.1 | Posición IVA base | Con ventas/compras normales (sin percepciones ni NC), Débito − Crédito da igual que antes |
| 12.2 | Saldos de caja | Todas las cajas cuadran: ingresos suman, gastos restan el total, traspasos OK, NC solo-fiscal no mueve saldo |
| 12.3 | Detección de duplicados | Reenviar una factura ya cargada (foto o manual) se sigue bloqueando |
| 12.4 | CSVs abren en Excel | Acentos, separador y totales correctos en los 3 CSV |
| 12.5 | Cambio de mes | Cambiar de mes recalcula todas las solapas sin errores |
| 12.6 | Permisos Contador | El Contador ve todo pero no puede crear/editar/borrar nada |

---

## Hoja de resultados

| Sección | Casos | OK | Falla | N/A | Notas |
|---------|------:|---:|------:|----:|-------|
| 1. Acceso | 4 | | | | |
| 2. Ventas | 13 | | | | |
| 3. Compras | 4 | | | | |
| 4. Desglose fiscal | 5 | | | | |
| 5. Percepciones | 13 | | | | |
| 6. NC de proveedor | 10 | | | | |
| 7. Resumen / Posición IVA | 5 | | | | |
| 8. Financiero | 5 | | | | |
| 9. Condiciones IVA | 3 | | | | |
| 10. Exports | 10 | | | | |
| 11. Bot WhatsApp | 7 | | | | |
| 12. Regresión | 6 | | | | |

**Probado por:** ____________  **Fecha:** ____________  **Versión/commit:** ____________
