# Presupuesto: modo "Resumen" para presentar sin exponer el detalle

Fecha: 2026-06-26 · Estado: aprobado

## Problema
El PDF de presupuesto muestra cada tarea con cantidad + precio unitario + subtotal → un competidor puede recotizar ítem por ítem. Queremos un modo de presentación "lindo/prolijo" que no exponga ese detalle.

## Solución
Selector **"Detalle del PDF"** en `ExportModal` (botón segmentado): **Resumen** (default) ⟷ **Detallado**. Tocarlo cambia el PDF generado.

- **Detallado**: el PDF actual, completo (uso interno / cliente de confianza).
- **Resumen** (cliente): el cómputo muestra por rubro **nombre + total + "Incluye:"** (nombres de las tareas, alcance) **sin** UN/CANT/UNIT/SUBTOTAL. Totales: **solo TOTAL** (se oculta el split Subtotal materiales / M.O, tanto en el cómputo como en "Resumen económico" de la página de condiciones). Se agrega una **leyenda editable** (default): "✓ El cómputo y listado detallado de materiales ya está realizado. Se entrega al confirmar la obra (posterior a la seña)."

Resto del template igual (portada, condiciones, formas de pago, QR, franja de marcas). Es solo presentación: no toca datos. Reusa `rubrosExportables` (filtro de $0).

## Componentes
- `src/lib/presupuestoExport.js`: nuevo helper puro `resumenRubros(rubros)` → `[{nombre, venta, incluye:[nombres de tarea]}]` (excluye $0, no filtra cantidades/precios — solo nombres). Test en `presupuestoExport.test.js`.
- `src/pages/modales/ExportModal.jsx`: estado `nivel` ('resumen'|'detallado', default 'resumen') + `notaSena` (editable); selector segmentado + textarea de leyenda (visible en Resumen); `generarHTML(nivel, notaSena)` ramifica el cuerpo del cómputo y los totales; CSS para `.rubro-resumen`/`.rubro-incluye`/`.sena-box`.

## Fuera de alcance
- Niveles "Por capítulos" y "Global" (se pueden sumar al mismo selector después).
