# Rediseño del armado del presupuesto — propuesta

Panel de diseño multi-agente (4 enfoques + jurado). Objetivo del usuario: **fácil, práctica, linda**.

## Veredicto del jurado
- **Ganador:** "Elegante" (tipografía calibrada + espaciado, casi todo CSS — máxima factibilidad, 5/5).
- **Injertar de "PRO":** zebra más clara (seguir filas) + **fila de totales sticky por rubro**.
- **Descartados:** "Panel lateral bajo demanda" (divide la edición, confunde) y "Acordeón + sidebar" (refactor grande → posible fase 2).

## Decisión (ajustada al gusto del usuario)
Se MANTIENE el header de rubro **negro, mayúsculas, estilo título de sección, con números en verde** (lo que pidió el usuario). El equipo sugería quitar mayúsculas/suavizar; se descarta ese punto.

## Plan por etapas

**Etapa 1 — Legibilidad (CSS/inline, bajo riesgo)**
- Zebra **más clara** (filas alternadas visibles, hoy ~invisible) para seguir las filas de un vistazo.
- Más aire en las filas (padding 8→10px).
- Encabezado de columnas con fondo sutil + monoespaciado, para que las columnas "anclen".
- Hover de fila siempre (ya está).

**Etapa 2 — Totales por rubro siempre visibles (práctica)**
- Franja de totales **sticky abajo de cada rubro**: Costo · **Venta (verde)** · Margen. No se pierde el total al scrollear.

**Etapa 3 — Edición más cómoda**
- Input inline más prolijo (tamaño/padding/foco).
- (Fase 2 opcional) Tab entre celdas, Enter baja a la fila siguiente; header de rubro sticky al scrollear.

**Etapa 4 — Detalles lindos**
- Secciones, drag handles y transiciones más cuidadas.

## Preservado (no se toca)
Drag&drop, inline-edit en todas las celdas, permisos (verCostos/verMargenes), export, secciones colapsables, "materiales a cargo del comprador", sidebar de navegación, lógica de cálculo (helpers.js).
