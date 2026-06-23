# Presupuesto que vende el TIEMPO — Diseño

**Fecha:** 2026-06-23
**Estado:** Diseño aprobado (dirección + copy + paquete completo). Pendiente revisión del spec → plan de implementación.

## 1. Objetivo

Rediseñar el presupuesto/PDF que recibe el cliente para que **deje de venderse por el precio y pase a venderse por el TIEMPO**, el diferencial real de Kamak. El tiempo se traduce a la única métrica que el dueño siente en el cuerpo: **días de su tienda atendiendo a sus clientes**. La marca seria/prolija es el respaldo; la credibilidad es la condición no negociable.

Hoy el PDF abre con el total en dólares + tabla de rubros; el tiempo casi no figura.

## 2. Tesis y regla de credibilidad

- **Tesis:** re-anclar la decisión en un doble ancla de portada — `INVERSIÓN` al lado de `ENTREGA` — y blindar el plazo con su **mecanismo** (fabricación en paralelo en taller propio) + **prueba** (40+ tiendas, marcas, seguros) + **garantías** (pago contra avance) que matan el miedo a "que me dejen tirado".
- **Regla de credibilidad (innegociable):** un número de tiempo pelado e inflado activa el detector de chamuyo de un cliente que ya juntó 4 presupuestos. Por eso:
  - Todo número de tiempo lleva **"estimado"** y su porqué (la fabricación en paralelo).
  - El plazo tradicional se calcula `N × 3` pero **se muestra como resultado estimado** (ej. "estimado ~135 días"), **nunca** el multiplicador literal ("×3", "3 veces más rápido").
  - El plazo `N` sale del cronograma real de ESA obra (fechas), no de un número fijo genérico.
  - El cliente solo ve **venta en USD, días y alcance** — nunca costos, márgenes ni gastado (consistente con el sanitizado del portal).

## 3. Dato nuevo: Plazo de entrega (días)

No existe como campo. La obra tiene `fechaInicio` y `fechaFinEstim` (`ObrasContext.jsx`).

- **Auto:** `N = díasEntre(fechaInicio, fechaFinEstim)` cuando ambas están cargadas.
- **Override manual:** input **"Plazo de entrega (días)"** en el panel de opciones del `ExportModal` (junto a Vigencia), pre-llenado con el valor auto y editable. Cubre los presupuestos de obras en-presupuesto que todavía no tienen `fechaInicio`.
- **Sin dato (ni fechas ni override):** el bloque de tiempo **no se renderiza** (la portada cae al layout actual de solo-precio). Nada roto, nada vacío.

Derivados (automáticos a partir de `N`):
- `tradicional = N × 3` (se muestra como "estimado ~{N×3} días").
- `diasMas = (N × 3) − N = N × 2` (el número del remate).

## 4. Diseño por sección

### Sección 1 — Portada (DECISIÓN)
Reestructurar `portada-ftr` (`ExportModal.jsx` ~L111-116) y espejarlo en `PortadaPreview` (~L411):
- Fila superior: `CLIENTE` · `TIPO`.
- Fila héroe (mismo peso visual, dos `cell-val-lg`):
  - `INVERSIÓN — U$S {total} — + IVA`
  - `ENTREGA — {N} DÍAS — llave en mano`
- Línea fina gris (#9a9892) arriba del par: **"Obra tradicional: estimado ~{N×3} días, coordinando cada gremio por separado."**
- Remate en teal (#1a9b9c) sobre la banda #171818, debajo del par: **"{N×2} DÍAS MÁS ATENDIENDO A TUS CLIENTES"**.
- Microcopy fino bajo ENTREGA: *"Plazo estimado desde el inicio de obra, con anticipos al día. Cronograma en pág. 2."*
- Se mantiene la celda FECHA · VIGENCIA. Un solo mensaje grande: nada más compite en la portada.

### Sección 2 — Franja "Cómo lo logramos" + credenciales (OPCIONAL, toggle)
Franja angosta entre portada y cómputo, mismo lenguaje visual (dark + teal + mono + diamantes):
- Tres pasos: (1) *Fabricamos tu mobiliario en taller propio EN PARALELO a la obra civil.* (2) *Viaja en contenedor.* (3) *Montaje in situ → llave en mano.*
- Cierre: *"Por eso reabrís en días, no en meses. No esperamos: paralelizamos."*
- Tira de credenciales (mono, mayúscula espaciada): *"40+ tiendas entregadas · Shop Express · Super 7 · Puma · Subway · Cencosud"* y *"Empresa habilitada · Seguros y ART vigentes · Seguridad e higiene en obra · Cobertura nacional"*.
- Activable por obra (toggle como `condiciones`).

### Sección 3 — Cómputo (JUSTIFICA el precio)
Estructura actual **intacta** (no se toca `calcRubroExport` ni los totales). Sembrar micro-frases sin repetir:
- En `comp-hdr` o primer rubro: *"Una sola empresa, una sola responsable: obra civil, mobiliario propio, equipamiento, instalaciones e imagen de marca. Vos no coordinás cinco gremios — nos coordinás a nosotros."*
- En el rubro de mobiliario: *"El mobiliario se fabrica en nuestro taller mientras avanza la obra."*
- En `totales-strip` (~L168), al lado del TOTAL USD: repetir el remate *"{N×2} días más atendiendo a tus clientes"*.
- Si `obra.tipo` es franquicia: micro-línea condicional *"Ejecutado según manual de marca."*
- El campo `nota` por tarea (ya existe) muestra el "no incluye" explícito y corto (mostrarlo da más confianza que esconderlo).

### Sección 4 — Condiciones y Garantías (BAJA LA BARRERA)
Ampliar `condicionesPage` (~L197-256):
- Nueva sección **"PLAZO DE OBRA Y ENTREGA"** junto a Formas de Pago: *"Entrega estimada: {N} días desde el inicio de obra, sujeta a anticipos en fecha."*
- Cronograma con hitos: Anticipo/Reserva → Fabricación en paralelo → Contenedor + montaje → Entrega día {N}. (un plan, no un slogan).
- Bloque destacado **"GARANTÍAS"** reencuadrando lo que hoy es letra chica en Formas de Pago: *"Pagás contra obra hecha: anticipo para reservar fecha, el resto por avance certificado mes a mes. Retenemos un 5% de fondo de reparo hasta la entrega: tu garantía de que respondemos."*
- Micro-cuenta de lucro cesante con número **en blanco/editable por el cliente**: *"Si tu tienda factura $____ por día, abrir {N×2} días antes son ____ días de caja que recuperás. El número lo ponés vos; nosotros ponemos los días."*
- **Penalidad por mora autoimpuesta** (OPCIONAL, toggle por obra): crédito por día de atraso imputable a Kamak, conservadora y **con tope bajo**. Empezar conservador (riesgo financiero real, no solo copy).
- Se mantiene el QR del portal (refuerza control/transparencia).

## 5. Líneas de copy (locked)

- Remate: **"{N×2} DÍAS MÁS ATENDIENDO A TUS CLIENTES"** (ej. 90 con N=45).
- Contraste: *"Obra tradicional: estimado ~{N×3} días, coordinando cada gremio por separado."*
- Cierre matador (a ubicar en condiciones/cierre): *"El precio es lo que invertís una vez. Los días cerrado los pagás todos los meses."*
- Mecanismo: *"Fabricamos tu mobiliario MIENTRAS avanza la obra. No esperamos: paralelizamos."*
- Garantía: *"Pagás contra obra hecha. Retenemos 5% hasta la entrega: tu garantía de que respondemos."*

Tono: serio, prolijo, premium, argentino (vos). Sin signos de exclamación gritados.

## 6. Qué NO hacer (guardrails)

- Sin superlativos de feria ("el mejor", "único", "imbatible", "récord") ni signos de exclamación.
- Sin mostrar el múltiplo exacto ("×3", "3 veces"): se muestra el resultado estimado.
- Sin urgencia fabricada ("válido hasta", "cupos", "descuento por firmar hoy").
- Sin afirmar la plata del cliente como dato de Kamak ("ganás US$ 80.000"): el contraste va en DÍAS; la plata la pone el cliente.
- Sin mostrar costos, márgenes ni gastado.
- Sin romper la paleta/grilla: todo bloque nuevo usa dark #1f2024/#171818 + teal #1a9b9c + diamantes + mono.
- **Sin tocar la lógica de cálculo** (`calcRubroExport`, `tareaVentaUnit`, totales): las tácticas son de encuadre y orden visual. Los totales deben seguir cuadrando idénticos.

## 7. Superficie de implementación

- **Archivo único:** `src/pages/modales/ExportModal.jsx`.
  - `generarHTML(...)` (L61): nuevo parámetro `plazoDias`; portada-ftr, franja nueva entre `${portada}` y `${computo}`, totales-strip, condicionesPage, comp-ftr; CSS sumado al bloque de estilos (misma paleta).
  - `PortadaPreview` (L411): espejar la portada nueva para que la vista previa coincida.
  - Panel de opciones (~L571, junto a Vigencia): input "Plazo de entrega (días)" + toggles "Cómo lo logramos" y "Penalidad por mora".
- **Datos:** `obra.fechaInicio`, `obra.fechaFinEstim` (auto) + override manual. Sin migración (campo derivado/de export, no se persiste en la obra salvo decisión futura).
- **No se toca:** cálculo de rubros/totales, `calcRubroExport`, el sanitizado del portal.
- **Bot (a evaluar, fase 2):** que el bot pueda mandar el mensaje-héroe ("tu shop reabre en {N} días") al compartir el presupuesto (encaja con "bot siempre").

## 8. Casos borde

- Sin `N` (ni fechas ni override) → portada sin bloque de tiempo (layout actual de solo-precio); franja/garantías de tiempo no se muestran.
- `N` muy chico/grande → el contraste sigue siendo ×3, mostrado como estimado; sin caps especiales.
- Obra en USD fijo vs ARS → no afecta el plazo (es días); el total sigue su lógica actual.

## 9. Verificación

- Build (`vite build`) sin errores; tests existentes verdes.
- Portada: con `N` cargado, se ve INVERSIÓN + ENTREGA + contraste estimado + remate; `PortadaPreview` coincide con el PDF generado.
- Sin `N`: portada cae al layout actual, sin huecos.
- Totales del cómputo idénticos a antes (no se tocó el cálculo).
- Toggles "Cómo lo logramos" y "Penalidad por mora" activan/desactivan sus bloques.
- Copy sin exclamaciones, sin "×3" literal, sin costos/márgenes.

## 10. Orden sugerido de implementación

1. Dato + portada (Sección 1) — el 80% del efecto.
2. Condiciones y Garantías (Sección 4) — reusa datos existentes.
3. Franja "Cómo lo logramos" + credenciales (Sección 2) — toggle.
4. Micro-frases en el cómputo (Sección 3).
5. (Fase 2) Página de obras entregadas con fotos reales; mensaje-héroe del bot.
