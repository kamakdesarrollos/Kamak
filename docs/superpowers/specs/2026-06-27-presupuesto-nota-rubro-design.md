# Presupuesto: nota editable por rubro (resumen)

Fecha: 2026-06-27 · Estado: aprobado

## Problema
En el modo Resumen del export se quiere una **nota por rubro editable una por una** (como las notas de APU), en vez de las 3 frases globales automáticas.

## Solución
- **Dato:** campo `nota` (string opcional) por rubro en `detalle.rubros[]` (persistido).
- **Frase prediseñada:** cada rubro trae por defecto una **nota automática** según su composición (con materiales / sin materiales = a cargo del comprador / logística sin viáticos), calculada por `notaRubroAuto(rubro)` (helper puro compartido).
- **Edición:** inline en `ObraPresupuesto`, igual que las notas de APU (`tarea.nota`): fila fina debajo del header del rubro, con `editRubroNota` (estado por rubroId) → input → `patch` guarda `rubro.nota`. El campo se muestra **siempre con la frase prediseñada** (atenuada, "auto · click para editar"); al editar, el input viene **pre-cargado** con `rubro.nota || notaRubroAuto(rubro)`; al guardar, la nota propia queda fija. Visible aunque el rubro esté colapsado.
- **Export (modo Resumen):** cada rubro muestra `rubro.nota || rubro.notaAuto`. Nunca queda un rubro sin texto.
- **Limpieza:** se quitan del modal de exportar los 3 campos de "frases globales" (la frase automática es el default y se edita por rubro). El toggle Resumen/Detallado y la leyenda post-seña quedan.

## Componentes
- `src/lib/presupuestoExport.js`: helper puro exportado `notaRubroAuto(rubro)` + constantes `FRASE_CON_MAT` / `FRASE_SIN_MAT` / `FRASE_VIATICOS` (fuente única de la frase). `resumenRubros()` devuelve `{nombre, venta, nota, notaAuto}`. (+ tests)
- `src/pages/obra/ObraPresupuesto.jsx`: import `notaRubroAuto`; estado `editRubroNota` + fila de nota por rubro (patrón de `tarea.nota` / `editRubroMargen`), pre-cargando la frase automática.
- `src/pages/modales/ExportModal.jsx`: en `resumenSecs`, texto = `r.nota || r.notaAuto`; se quitan los 3 estados/inputs de frases globales, el `frases` de `generarHTML`, el `fraseRubro` local y las constantes FRASE_* (ahora viven en `presupuestoExport.js`).

## Fuera de alcance
- Nota por rubro en el modo Detallado (sigue mostrando las tareas con su nota propia).
