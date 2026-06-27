# Presupuesto: nota editable por rubro (resumen)

Fecha: 2026-06-27 · Estado: aprobado

## Problema
En el modo Resumen del export se quiere una **nota por rubro editable una por una** (como las notas de APU), en vez de las 3 frases globales automáticas.

## Solución
- **Dato:** campo `nota` (string opcional) por rubro en `detalle.rubros[]` (persistido).
- **Edición:** inline en `ObraPresupuesto`, igual que las notas de APU (`tarea.nota`): fila fina debajo del header del rubro, con `editRubroNota` (estado por rubroId) → input → `patch` guarda `rubro.nota`. Visible aunque el rubro esté colapsado. "+ nota del rubro" si está vacía.
- **Export (modo Resumen):** cada rubro muestra `rubro.nota` si está cargada; si **no** está, cae a la **frase automática** ya existente (con materiales / sin materiales = a cargo del comprador / logística sin viáticos). Nunca queda un rubro sin texto.
- **Limpieza:** se quitan del modal de exportar los 3 campos de "frases globales" (ya no hacen falta: la frase automática es el default y se edita por rubro). El toggle Resumen/Detallado y la leyenda post-seña quedan.

## Componentes
- `src/pages/obra/ObraPresupuesto.jsx`: estado `editRubroNota` + fila de nota por rubro (patrón de `tarea.nota` / `editRubroMargen`).
- `src/lib/presupuestoExport.js`: `resumenRubros()` agrega `nota: r.nota` al objeto devuelto. (+ test)
- `src/pages/modales/ExportModal.jsx`: en `resumenSecs`, texto = `r.nota || fraseRubro(r)`; se quitan los 3 estados/inputs de frases globales y el `frases` pasado a `generarHTML` (las constantes FRASE_* quedan como default de `fraseRubro`).

## Fuera de alcance
- Nota por rubro en el modo Detallado (sigue mostrando las tareas con su nota propia).
