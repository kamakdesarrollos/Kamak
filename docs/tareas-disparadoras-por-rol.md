# Tareas disparadoras por rol — Kamak (v2 definitivo)

Listado profesional de **tareas estándar (estilo Trello)** que se autogeneran cuando se aprueba el presupuesto (o se registra el primer cobro) y se asignan a un **rol** con su checklist y fecha límite.

Fuentes: los **49 rubros / APUs** del catálogo + el **proceso real** del manual de usuario + el **relevamiento de los 17 tableros Trello** de obras reales. Refinado con un workflow de 5 agentes (uno por rol) + un agente **auditor**, y ajustado con tus decisiones.

> Contexto: Kamak remodela **shops de estaciones de servicio (franquicias)**. La seña dispara **1 mes de fabricación** (muebles, mármoles, estructuras, gráfica) y un montón de compras/contrataciones antes del **Día 0** (~día +20/25). La **entrega** es ~día +40.

## Cómo se cargan (4 niveles del motor)

| Condición | Dónde se carga | Cuándo dispara |
|---|---|---|
| 🌐 **Global** | `tipoObra.tareasBase` | en toda obra del tipo |
| 📂 **Por rubro** | `rubro.tareasEstandar` | si ese gremio está en el presupuesto |
| 🔧 **Por APU** | `apu.tareasEstandar` | si ese APU está en el presupuesto |
| 🧩 **Tercero** | rubro/APU nuevo a crear | proveedor externo (ascensor, AA, cámaras, etc.) |

`día +N` = días desde la aprobación/seña. Origen: 📖 manual · 📋 Trello · ⚙️ proceso · 📦 catálogo · 👤 persona.

## Regla de oro (un solo dueño por acción)

| Acción | Dueño | Los demás |
|---|---|---|
| **Cotizar a subcontratistas** | **Admin** (Franco — pide a 2-3 y elige) | Administración **formaliza** (contrato + anticipo) |
| **Comprar materiales / contratar servicios** | **Logística y compras** | — |
| **Contratos, trámites, backoffice** | **Administración** | — |
| **Medir, recibir, controlar, verificar operativo** | **Jefe de obra** (NO "pone en marcha" — eso es del gremio) | — |
| **Alta / designar / aprobar / validar** | **Admin** | — |
| **Facturar e impuestos** | **Contador externo** | — |
| **Transporte** (flete + pasajes) | **Administración** (contrata y paga) + **Jefe de obra** (define y trackea) | — |
| **Legajo técnico** | **Federico** (genera y custodia) | — |

---

## 👤 ADMINISTRACIÓN — contratos, transporte, trámites, backoffice

### 🌐 Globales
- **Firmar contrato bilateral y registrar la seña** — `alta · +0` 📖
- **Contratar/actualizar seguros y ART** — `alta · +2` 📖
- **Contratar servicio de Seguridad e Higiene** — `alta · +3` 📋 *(legajo de seguridad, EPP, visitas)*
- **Contratar flete + comprar pasajes del personal (transporte)** — `alta · +5` 📋 *(con el Jefe de obra que define y trackea)*
  Flete/camión para muebles, mármoles, estructuras (incl. interurbano, ej. Bs As→Córdoba) · pasajes en micro de la cuadrilla · reservar con anticipación.
- **Liquidar sueldos, recibos y aguinaldos del personal** — `media · +30` 📋
- **Gestión documental de la obra en el Drive** (facturas, autorizaciones, firmas digitales) — `media · +2` 📋
- **Gestionar permiso de obra / habilitación municipal** — `media · +5` 📖
- **Plan de cobranzas y seguimiento de cta cte del cliente** — `media · +3` ⚙️ *(la emisión la hace el Contador)*
- **Activar posventa al cierre** (garantía 6m, prueba, WhatsApp) — `media · +40` 📖
- **Recordatorio: fin del período de prueba (10 días)** — `media · +50` ⚙️
- **Recordatorio: fin de garantía (6 meses)** — `baja · +180` ⚙️

### 📂 Contrato + anticipo con cada gremio (al elegido)
> Cada uno: acordar alcance/precio/plazo · anticipo · firmar · datos de facturación + ART.

| Rubro (gremio) | Tarea | Prio · Offset |
|---|---|---|
| 7 - Mampostería | Contrato albañilería | media · +4 |
| 13 - Sanitarias | Contrato plomería | media · +4 |
| 14 - Gas | Contrato gasista **matriculado** | media · +4 |
| 15 - Eléctrica | Contrato electricista **matriculado** | media · +4 |
| 26 - Const. en seco | Contrato durlock | media · +4 |
| 28 - Pinturas | Contrato pintura | media · +4 |
| **29 - Marmolería** | **Contrato + anticipo (1 mes)** | **alta · +2** |
| **30 - Amoblamientos** | **Contrato + anticipo muebles (1 mes)** | **alta · +2** |
| **38 - Herrería** | **Contrato + anticipo estructuras (1 mes)** | **alta · +2** |
| **46 - GRAFICA** | **Contrato + anticipo gráfica (1 mes)** | **alta · +2** |

### 🔧/📂 Trámites ante organismos
- 🔧 `Pilar de luz` → **Tramitar pilar / medidor de obra** — `alta · +3` ⚙️ **(bloqueante del Día 0)**
- `15 - Eléctrica` → **Tramitar medidor definitivo + habilitación** — `media · +7` ⚙️
- `15 - Eléctrica` → **Confeccionar y entregar planos eléctricos finales (as-built)** — `media · +40` 📖
- 🔧 `Conexión a la Red Domiciliaria` → **Tramitar conexión agua/cloaca** — `media · +7` ⚙️
- `42 - Trámites de Gas` → **Gas: factibilidad, planos, prueba manométrica, inspección** — `alta · +5` ⚙️

### 🧩 Terceros → los coordina el **Jefe de obra** (ver su sección). Administración solo factura/paga si corresponde.

---

## 👤 LOGÍSTICA Y COMPRAS — comprar y contratar servicios

### 🌐 Globales
- **Abrir/reactivar cuentas corrientes** (corralón, electricidad, plomería, pinturería, ferretería, durlock) — `alta · +2` 📖
- **Computar y comprar materiales pre-inicio** (obra gris, durlock, revestimientos, eléctricos, sanitarios) — `alta · +3` 📖
- **Encargar equipamiento de franquicia / gastronómico (lead largo)** — `alta · +1` 📖
  *cigarrera, heladera bajo mesada, exhibidoras, freezer helados, cafetera 2 bocas, molinillo, microondas, carlitera, warmer, exhibidor, góndolas, barra, mesas, sillas, banquetas, sillón, cestos, accesorios baño.*
- **Contratar hospedaje del personal** — `alta · +5` 📖
- **Contratar viandas 2×/día (12 y 20 hs)** — `media · +5` 📖
- **Contratar contenedor/volquete + cerco de obra** — `media · +7` 📋
- **Contratar baño químico** — `media · +7` 📖
- **Asegurar provisión de agua potable** — `media · +5` 📖
- **Comprar EPP y ropa de trabajo del personal** — `media · +4` 📋
- **Seguimiento de pedidos: reclamar a proveedores que despachen a tiempo** — `alta · +5` 📋

> ℹ️ El **transporte (flete + pasajes)** ahora lo maneja **Administración** (con el Jefe de obra). Ver arriba.

### 📂 Encargar fabricación de lead largo (apenas hay seña)
| Rubro | Tarea | Prio · Offset |
|---|---|---|
| 30 - Amoblamientos | Encargar fabricación de muebles a medida | alta · +1 |
| 29 - Marmolería | Encargar mármoles (sobre medidas finales) | alta · +1 |
| 38 - Herrería | Encargar estructuras metálicas | alta · +1 |
| 46 - GRAFICA | Encargar gráfica, cartelería y vinilos | alta · +1 |
| 32/33/31 - Aberturas | Encargar aberturas (sobre medidas de obra) | alta · +2 |
| 34 - Cristales | Encargar cristales (incl. cortina con film) | media · +3 |

### 📂 Comprar materiales por rubro (contra cta cte, entrega por etapa)
| Rubro | Prio · Offset |
|---|---|
| 5/7/9/10 Obra gris | alta · +3 |
| 15 Eléctricos | alta · +3 |
| 13 Sanitarios + equipos (bombas/tanques) | media · +5 |
| 17/21 Pisos y revestimientos | media · +4 |
| 26 Durlock · 27 Steel | media · +4 |
| 28 Pintura | media · +5 |
| 8 Hormigón/hierro (mixer) | media · +7 |
| 12 Cubierta · 45 Zinguería | media · +6 |
| 35 Sanitarios/grifería · 36 Artef. gas | media · +5 |
| 37 Climatización | media · +7 |
| 39 Solar · 40 Parrillas/Piscinas | media · +5 |
| 3 Alquiler máquina mov. suelos | media · +6 |

### 🧩 Terceros → los coordina el **Jefe de obra** (ver su sección).

### 🔧 Por APU
- `Cartel de obra` → Mandar a hacer el cartel — `media · +5`
- `Obrador` → Montar/conseguir el obrador — `media · +5`

---

## 👤 JEFE DE OBRA — medir, recibir, verificar, coordinar

### 🌐 Globales
- **Coordinar arribo de fabricaciones a medida** (muebles, mármoles, estructuras, gráfica) — `alta · +2` 📖
- **Pasar medidas finales en obra** (mármoles, muebles, aberturas, gráfica) — `alta · +3` 📋
- **Definir requerimiento de transporte y trackear arribo** — `alta · +12` 📋 *(Administración contrata el flete)*
- **Definir nómina que viaja y validar pasajes** — `alta · +14` 📋 *(Administración compra los pasajes)*
- **Definir cantidad para hospedaje/viandas y validar operatividad** — `alta · +15` 📖 *(Admin aprueba, Compras contrata)*
- **Seguimiento en sitio: validar que cada pedido llegue para su etapa** — `alta · +7` 📋
- **Coordinar el Día 0** (delimitar área, salón libre, recibir vehículos/herramientas/personal) — `alta · +20` 📖
- **Registro fotográfico de avance e inspecciones** — `media · +7` 📋
- **Coordinar la entrega** (limpieza + vidrios, recorrida, llaves, planos) — `media · +40` 📖
- **Capacitar al personal del cliente** (tablero, artefactos, equipos) — `media · +41` 📖

### 📂 Recibir / controlar / verificar por rubro (NO "poner en marcha" — eso es del gremio)
> Recibir contra medidas/plano · controlar terminaciones · coordinar colocación · **verificar que el gremio dejó operativo** · registrar reclamos.

| Rubro | Tarea | Prio · Offset |
|---|---|---|
| 29 Marmolería | Recibir y controlar mármoles | alta · +3 |
| 30 Amoblamientos | Recibir y controlar muebles | alta · +3 |
| 31/32/33 Aberturas | Medir huecos + recibir/controlar | alta · +3 |
| 34 Cristales | Recibir y controlar (manipuleo) | alta · +3 |
| 38 Herrería | Recibir herrería (rampa, cestos, rejas) | alta · +3 |
| 46 GRAFICA | Recibir vs manual de marca | alta · +3 |
| 12/45 Cubierta/Zinguería | Recibir + coordinar izaje | media · +10 |
| 8 Hormigón | Coordinar mixer + verificar encofrado/armadura | media · +14 |
| 3 Mov. suelos | Coordinar acceso de máquinas | media · +7 |
| 13 Sanitarias | Recibir + verificar prueba del gremio | media · +10 |
| 37 Calefacción | Recibir + verificar puesta en marcha del gremio | media · +10 |
| 36 Gas | Recibir + verificar prueba del **matriculado** | media · +10 |
| 39 Renovables | Recibir + verificar comissioning del gremio | media · +10 |
| 15 Eléctrica | Recibir artefactos + verificar energizado | media · +10 |

### 🔧 Por APU
- `Cerco de obra` → Coordinar el montaje — `media · +4`
- `Cartel de obra` → Coordinar la instalación — `media · +5`
- `Obrador` → Definir y montar — `media · +5`
- `Contenedor` → Recibir/verificar contenedor, baños químicos y agua — `media · +18`

### 🧩 Terceros — coordinar con el proveedor (1 tarea c/u, **globales** en los tipos Puma) — rol `Jefe de obra`
> Pedir cotización · coordinar provisión/instalación · verificar funcionamiento. (Cargadas en vivo en Puma Shop Express + Puma Super 7.)
- Ascensor — `alta · +5`
- Aire acondicionado — `media · +10`
- Cámaras de seguridad (CCTV) — `media · +12`
- Alarma — `media · +12`
- Campana / extracción de aire — `media · +8`
- Corte láser / aceros inoxidables — `media · +6`
- Mamparas / cortinas / vinilos — `media · +10`
- Puertas especiales — `media · +8`
- Árboles / paisajismo — `baja · +30`
- *(Equipamiento gastronómico y mobiliario de franquicia quedan en las globales de Logística/JO.)*

---

## 👤 ADMIN (Franco) — alta, designación, aprobación, cotización
- **Pedir cotización a subcontratistas por gremio y elegir** — `alta · +1` 👤 **→ Franco**
  Listar gremios a subcontratar · pedir presupuesto a 2-3 por gremio · comparar precio/cuadrilla/disponibilidad · elegir y pasar a Administración para el contrato + anticipo.
- **Dar de alta la obra** (cliente/franquicia, contrato, seña, presupuesto) — `alta · +0`
- **Designar jefe de obra (arq. 24 hs) y equipo** — `alta · +1`
- **Aprobar hospedaje + viandas** (tope de gasto) — `media · +3`
- **Validar el inicio de obra (Día 0)** — `alta · +25`

## 👤 CONTADOR EXTERNO
- **Emitir factura de la seña** (AFIP/WSFE + CAE) — `alta · +1`
- **Definir esquema de comprobantes y facturación por avance** — `media · +3`
- **Configurar retenciones y percepciones** (IVA/Gcias/IIBB) — `media · +5`
- **Facturar avance de fabricación** — `media · +20`
- **Facturar saldo final en la entrega** — `media · +40`

---

## 👤 FEDERICO (asignación directa, no por rol)
- **Generar y custodiar el legajo técnico de obra** (planos, unifilar, tendidos, PDF) — `media · +6` 👤
  Reunir planos arq./eléctrico/unifilar/tendidos · generar PDF + impresión · custodiar la copia en obra · archivar en Drive.

---

## Decisiones aplicadas
- **Auditor:** "puesta en marcha" → "recibir/verificar"; agregados (sueldos/aguinaldos, gestión documental, fotos); terceros simétricos; posventa con recordatorios diferidos (+50 / +180); offsets de seguimiento adelantados.
- **Tuyas:** cotización a subcontratistas → **Admin (Franco)** elige, Administración formaliza el contrato; transporte (flete + pasajes) → **Administración + Jefe de obra**; legajo técnico → **Federico**; **terceros** (ascensor, AA, cámaras, alarma, campana, corte láser, mamparas/cortinas/vinilos, árboles, puertas) → **Jefe de obra coordina** con el proveedor (cargados como globales en los tipos Puma).
