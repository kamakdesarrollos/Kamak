# QA Facturación — Guía paso a paso (para ejecutar)

Guía **click por click** para probar el módulo Facturación. Seguila de arriba
hacia abajo: cada bloque deja datos cargados que usan los bloques siguientes.

**Cómo anotar:** al lado de cada "✔ Verificá" poné OK o anotá qué pasó si falló.

**Importante — dividida en 2 partes:**
- **PARTE 1** se hace **solo desde el navegador** (no necesita WhatsApp).
- **PARTE 2** necesita el **bot de WhatsApp** funcionando (las facturas de
  proveedor y notas de crédito recibidas SOLO entran por el bot; no hay carga
  manual de facturas de compra en la app).

**Valores que vamos a usar** (CUIT válidos, copiables):
- CUIT cliente RI: `20-12345678-6`
- CUIT inválido (para una prueba): `20-12345678-0`

---

# PARTE 1 — Solo navegador (sin WhatsApp)

## Bloque 0 — Login y datos de prueba

1. Entrá a Kamak con un usuario **Admin**.
2. Andá a **Clientes** y creá dos clientes:
   - **"Cliente RI Test"** → Condición IVA: **Responsable Inscripto** → CUIT: `20-12345678-6`. Guardar.
   - **"Cliente Final Test"** → Condición IVA: **Consumidor Final** → sin CUIT. Guardar.
   ✔ Verificá: ambos quedan en la lista de clientes.
3. Andá a **Cajas** y elegí (o creá) una caja en **ARS**. Anotá su **saldo actual**: ______________
4. Asegurate de tener al menos **una obra activa** (si no, creá una en Obras).

---

## Bloque 1 — Emitir facturas (solapa Ventas)

5. Andá a **Facturación** → solapa **📤 Ventas**.
6. Tocá **"+ Nueva factura"**.
7. Cargá una **Factura B**:
   - Cliente: **Cliente Final Test**
   - Tipo: **Factura B**
   - Neto gravado: `10000`
   - IVA: **21%**
   - Guardar.
   ✔ Verificá: el total calculado es **$12.100**. La factura aparece en la lista del mes como **borrador**.
8. Tocá **"+ Nueva factura"** de nuevo y cargá una **Factura A**:
   - Cliente: **Cliente RI Test**
   - Tipo: **Factura A** (al elegir el cliente RI debería ofrecer letra A)
   - Neto: `100000` · IVA: **21%** · Guardar.
   ✔ Verificá: total **$121.000**. Aparece en la lista.
9. **Prueba de letra**: Nueva factura → elegí **Cliente Final Test** → mirá los tipos disponibles.
   ✔ Verificá: solo ofrece tipos de **letra B** (la Factura A es exclusiva de Responsable Inscripto).
10. **Prueba de CUIT inválido**: Nueva factura → Cliente RI Test → cambiá (si te deja) el CUIT a `20-12345678-0`, o editá el cliente con ese CUIT y volvé a intentar Factura A.
    ✔ Verificá: avisa que el CUIT del receptor es inválido y **no deja emitir**.
11. **Prueba de neto 0**: Nueva factura → dejá el neto vacío.
    ✔ Verificá: no permite guardar.

---

## Bloque 2 — Concepto AFIP

12. Abrí **"+ Nueva factura"**.
    ✔ Verificá: hay un campo **"Concepto AFIP"** con las opciones **Servicios** (por defecto), **Productos**, **Productos y Servicios**. Es un campo aparte del "Concepto / detalle" (texto libre).
13. Elegí Cliente RI Test, Factura A, neto `50000`, IVA 21%, **Concepto AFIP = Productos**, escribí un detalle libre cualquiera. Guardar.
    ✔ Verificá: se guarda sin problema.

---

## Bloque 3 — Notas de crédito emitidas + comprobante asociado

14. **"+ Nueva factura"** → Cliente RI Test → Tipo: **Nota de Crédito A**.
    ✔ Verificá: aparece un selector **"Comprobante asociado"** (obligatorio) con las facturas A previas de ese cliente.
15. Elegí como asociado la **Factura A** que cargaste en el paso 8 (es un borrador, sin número).
    ✔ Verificá: aparece un aviso ámbar tipo **"⚠ La factura original todavía es un borrador (sin número de AFIP)…"**.
16. Cambiá el cliente a **Cliente Final Test** (que no tiene facturas A) con tipo Nota de Crédito.
    ✔ Verificá: el selector de comprobante asociado queda **deshabilitado** con la nota de que AFIP lo exige (RG 5824). No deja completar la nota sin asociado.

---

## Bloque 4 — Condiciones IVA nuevas

17. Andá a **Clientes** → editá **Cliente Final Test** → abrí el selector **Condición IVA**.
    ✔ Verificá: aparecen estas opciones: Responsable Inscripto, Monotributo, **Monotributo Social**, **Mono Trab. Indep. Promovido**, IVA Sujeto Exento, **IVA No Alcanzado**, **Sujeto No Categorizado**, Consumidor Final.
18. Ponele condición **Monotributo Social** y guardá. Volvé a Facturación → Nueva factura → elegí ese cliente.
    ✔ Verificá: solo ofrece **Factura B** (las nuevas condiciones no son Responsable Inscripto). Después dejalo de nuevo en Consumidor Final si querés.

---

## Bloque 5 — Percepción IIBB + jurisdicción (gasto manual)

> La percepción IIBB se carga en un **gasto común** en Movimientos (no necesita factura).

19. Andá a **Movimientos** → **Registrar gasto**.
20. Cargá un gasto:
    - Monto: `200000`
    - Caja: la caja ARS del paso 3
    - Obra: la obra activa (o General)
    - Bajá hasta el campo **"Percepción IIBB sufrida $ (opcional)"** → poné `500`.
    ✔ Verificá: al poner la percepción, aparece debajo el selector **"Jurisdicción IIBB"** con **Buenos Aires (PBA)** seleccionado por defecto.
21. Dejá la jurisdicción en **PBA** y guardá el gasto.
    ✔ Verificá: la caja del paso 3 baja **$200.000**.
22. Andá a **Facturación → 💰 Financiero** (con el mes actual).
    ✔ Verificá: en la fila **IIBB**, el hint muestra el desglose con **"− perc $500"** y el IIBB del mes es menor (devengado − $500).
23. Volvé a Movimientos → cargá otro gasto: Monto `100000`, percepción IIBB `500`, pero **Jurisdicción = CABA**. Guardá.
24. Volvé a **Financiero**.
    ✔ Verificá: aparece una **nota ámbar** "⚠ $500 de otra jurisdicción (no netea acá)" y ese $500 de CABA **NO** descuenta del IIBB del mes (solo el de PBA descuenta).

---

## Bloque 6 — Percepción IVA (gasto manual) y su efecto en la Posición IVA

25. Andá a **Movimientos → Registrar gasto**:
    - Monto: `300000`
    - Caja: la caja ARS
    - Campo **"Percepción IVA sufrida $ (opcional)"** → poné `30000`.
    - Guardá.
    ✔ Verificá: la caja baja **$300.000**.
26. Andá a **Facturación → 📊 Resumen** (mismo mes).
    ✔ Verificá: en el card **Posición de IVA**, el subtítulo dice **"… − Percep. IVA"** y abajo del monto aparece **"incl. − $30.000 percep. IVA (pago a cuenta)"**.
27. Mirá el resultado de la posición. Con las ventas de los pasos 7–8 (Débito = $21.000 + $2.100 = **$23.100**), sin compras, y $30.000 de percepción IVA:
    ✔ Verificá: la posición da **A favor $6.900** (23.100 − 30.000). *(Si cargaste más ventas, el número cambia, pero la percepción IVA siempre resta.)*
28. Volvé a **Financiero** y mirá la fila **IIBB**.
    ✔ Verificá: la percepción IVA **NO** afectó el IIBB (solo afecta el IVA). El IIBB sigue igual que después del Bloque 5.

---

## Bloque 7 — Posición IVA y saldo a favor

29. En **Resumen**, mirá el bloque de comparación con el **mes anterior**.
    ✔ Verificá: muestra débito/crédito/posición del mes previo (si hay datos).
30. Cambiá al **mes siguiente** con el selector de mes (arriba).
    ✔ Verificá: si este mes quedó "A favor", ese saldo a favor se traslada y reduce lo "a pagar" del mes siguiente.

---

## Bloque 8 — Financiero (carga manual)

31. En **Financiero**, en la fila del mes, escribí un valor manual en la celda de **Sueldos** (ej. `500000`).
    ✔ Verificá: el valor manual reemplaza al automático y recalcula el neto/acumulado de la fila.
32. Borrá ese valor manual.
    ✔ Verificá: vuelve a tomar el valor automático.

---

## Bloque 9 — Exports

33. **Resumen → "⬇ CSV Libro IVA Ventas"**.
    ✔ Verificá: baja un `.csv`. Abrilo en Excel: se ven los acentos bien, y hay una columna **"Concepto AFIP"** con el valor que elegiste.
34. **Resumen → "⬇ CSV Libro IVA Compras"**.
    ✔ Verificá: baja el `.csv` (puede estar vacío si todavía no cargaste compras por el bot — eso es normal en la Parte 1).
35. **Resumen → "🖨 Imprimir / PDF del resumen"**.
    ✔ Verificá: abre una vista imprimible con ventas, compras y posición. Si hay percepción IVA, muestra un recuadro **"Percep. IVA (pago a cta.)"**.
36. **Financiero → "⬇ CSV Financiero"**.
    ✔ Verificá: baja el `.csv` con las filas mensuales.
37. **Resumen → "📦 TXT Libro IVA Digital (AFIP)"**.
    ✔ Verificá: como tenés ventas en borrador (sin número), te **avisa** que saldrán con número 0 y te pregunta si generar igual. Aceptá.
    ✔ Verificá: baja `libro-iva-digital-AAAA-MM.zip`. Adentro hay 4 archivos `.txt` (VENTAS_CBTE, VENTAS_ALICUOTAS, COMPRAS_CBTE, COMPRAS_ALICUOTAS).
    ✔ Verificá (opcional, técnico): abriendo VENTAS_CBTE.txt, cada línea tiene **266 caracteres** y empieza con la fecha en formato AAAAMMDD.
    > ⚠ La validación final (que AFIP acepte el archivo) la hace el contador con el aplicativo oficial. Eso no se puede probar acá.

---

## Bloque 10 — Permisos (Contador)

38. Cerrá sesión y entrá como **Contador**. Andá a Facturación.
    ✔ Verificá: ve las 4 solapas y los datos, pero **NO** aparece "+ Nueva factura" ni puede cargar valores manuales en el Financiero.
39. Entrá con un usuario de rol común (ej. Comprador) e intentá ir a Facturación.
    ✔ Verificá: lo redirige al inicio (no puede entrar).

> Fin de la PARTE 1. Si no tenés el bot disponible, podés parar acá.

---

# PARTE 2 — Requiere el bot de WhatsApp

> Estos casos cargan **facturas de proveedor** y **notas de crédito recibidas**,
> que SOLO entran por el bot. Necesitás el bot operativo y fotos/PDF de
> comprobantes reales (o de prueba). Entrá a la app como **Admin** en paralelo.

## Bloque 11 — Factura de proveedor (el desglose y la caja)

40. Por WhatsApp, mandá al bot una **foto de una Factura A de proveedor** que discrimine neto e IVA (ej. neto $1.000.000 + IVA $210.000 = total $1.210.000).
41. Seguí el flujo del bot hasta cargar el gasto (elegí la caja si te pregunta).
    ✔ Verificá en la app → **Movimientos**: la caja baja **$1.210.000** (el TOTAL, no $1.000.000).
42. Andá a **Facturación → 📥 Compras**.
    ✔ Verificá: la factura aparece con **neto $1.000.000 · IVA $210.000 · total $1.210.000**.
43. Andá a **Resumen**.
    ✔ Verificá: el **Crédito (Compras)** subió $210.000 y la posición de IVA se ajustó.

## Bloque 12 — Percepciones leídas del ticket (bot)

44. Mandá una **foto de un ticket de estación de servicio (YPF/Shell/Axion)** que discrimine **"Perc. IIBB"**.
    ✔ Verificá: el bot carga la percepción IIBB; en Financiero descuenta del IIBB del mes.
45. Mandá una **foto de un ticket de mayorista** que discrimine **"Perc. IVA RG 2408/3337"**.
    ✔ Verificá: el bot la carga como **percepción IVA** (separada de la IIBB); en Resumen reduce la posición de IVA.

## Bloque 13 — Nota de crédito de proveedor

46. Mandá una **foto/PDF que diga "Nota de Crédito"** de un proveedor.
    ✔ Verificá: el bot responde que la dejó en el **buzón** (no la carga sola).
47. En la app → **Autorizaciones** (buzón).
    ✔ Verificá: aparece con un badge **"Nota de crédito"**. Abrila.
48. En el modal, dejá **"¿Devolvió plata? = No"** y guardá.
    ✔ Verificá: NO cambia ninguna caja. En **Compras** aparece con badge ámbar **"NC"** e importes en **negativo**. El crédito del mes baja.
49. Repetí con otra NC pero esta vez **"¿Devolvió plata? = Sí"** y elegí una caja.
    ✔ Verificá: esa caja **sube** por el monto de la NC.

## Bloque 14 — Aprobar por chat

50. Mandá una foto de factura de proveedor para que vaya al buzón.
51. Por WhatsApp escribí **`pendientes`**, y luego **`aprobar 1`** (el número que corresponda).
    ✔ Verificá: el bot confirma con el desglose (Neto / IVA / Percep. si hay) y el gasto queda cargado en la app.

## Bloque 15 — Duplicados

52. Volvé a mandar **la misma factura** del paso 40.
    ✔ Verificá: el bot avisa que **ya está cargada** y no la duplica.
53. Cargá una factura A `0001-12345` por $12.000 y después una **Nota de Crédito** A con el mismo número/CUIT/total.
    ✔ Verificá: la NC **NO** se rechaza como duplicada (son comprobantes distintos).

---

## Resumen de resultados

| Parte | Bloques | Probado (sí/no) | Fallas encontradas |
|-------|---------|-----------------|--------------------|
| 1 — Navegador | 0 a 10 | | |
| 2 — Bot WhatsApp | 11 a 15 | | |

**Probado por:** ____________  **Fecha:** ____________
