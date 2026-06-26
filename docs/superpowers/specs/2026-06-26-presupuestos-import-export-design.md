# Mejoras a presupuestos: import (moneda + material/M.O) y export (filtrar $0)

Fecha: 2026-06-26 · Estado: aprobado (decisiones A=convertir auto, B=default inteligente, C=quitar secciones vacías)

## Contexto
- Costos internos del presupuesto = **pesos**; la propuesta los pasa a USD con el TC.
- Import "adjuntar presupuesto de tercero": `AdjuntarPresupuestoModal` (lee Excel/PDF) → `RevisarPresupuestoModal` (tabla editable) → `confirmarImport` arma contrato M.O + tareas vía `itemsATareas` (hoy mete TODO en `costoSub`).
- Export: `ExportModal.generarHTML` + preview, ambos derivan de `calcRubroExport(rubro)` recorriendo `rubro.tareas`.

## 1) Detección de moneda al importar
- **PDF** (`api/presupuesto/extraer.js`): el prompt devuelve además `moneda: 'USD'|'ARS'`, mirando símbolos (U$S/US$/USD vs $) **y texto** ("expresado en dólares", "valores en pesos", etc.).
- **Excel**: helper puro `detectarMoneda(aoa)` que escanea encabezados/celdas por las mismas señales.
- `RevisarPresupuestoModal`: banner "Moneda detectada: X" + selector ARS/USD para corregir.
- Conversión: como internamente se guarda en pesos, si moneda=USD se multiplica cada costo ×TC (dolarVenta) al confirmar. Se muestra el TC. (Decisión A.)

## 2) Clasificación Material / M.O por ítem
- `RevisarPresupuestoModal`: columna con toggle **[Material | M.O]** por fila.
- Default inteligente `clasificarTipoItem(nombre)`: regex de instalación/colocación/montaje/armado/mano de obra/flete → `mo`; si no → `material`. (Decisión B.)
- `itemsATareas` respeta `tipo`: `material`→`costoMat`, `mo`→`costoSub` (default `mo` si falta, back-compat). El monto del contrato = Σ`costoSub`, así los materiales quedan como tareas pero fuera del monto del contrato M.O.

## 3) y 4) Filtrar $0 al exportar (solo export, no toca lo guardado)
- Helper puro `rubrosExportables(rubros)` en `src/lib/presupuestoExport.js`:
  - Quita tareas no-sección con venta = $0 (sin material ni M.O, o material a cargo del comprador).
  - Quita encabezados de sección que queden sin tareas debajo. (Decisión C.)
  - Quita rubros cuyo total venta = $0 o sin tareas reales.
- `ExportModal`: usar `rubrosExportables` para el `rr` de `generarHTML`, del preview y del listado "RUBROS INCLUIDOS".

## Testing
- TDD en helpers puros: `detectarMoneda`, `clasificarTipoItem`, `itemsATareas` (tipo), `rubrosExportables`. Tests en `presupuestoImport.test.js` y nuevo `presupuestoExport.test.js`. Runner: `vitest run`.

## Fuera de alcance (por ahora)
- Portal del cliente (`PortalCliente.jsx`): si muestra desglose, se le puede aplicar el mismo filtro luego.
- No se borra nada del presupuesto guardado; 3 y 4 son solo de la salida.
