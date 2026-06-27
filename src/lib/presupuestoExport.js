// Helpers PUROS para la EXPORTACIÓN del presupuesto (propuesta al cliente).
// Filtran lo que NO se debe "publicar" sin tocar el presupuesto guardado:
//  - tareas con venta $0 (sin material ni M.O, o material a cargo del comprador)
//  - encabezados de sección que quedan sin tareas debajo
//  - rubros que quedan en $0 / sin tareas reales
// (Decisiones 3, 4 y C del spec 2026-06-26.)

// Venta unitaria de una tarea (misma fórmula que pages/obra/helpers.js y
// ExportModal): material (0 si va a cargo del comprador) + M.O, con margen por
// línea o por rubro.
export function tareaVentaUnit(t, rubro) {
  const mat = rubro.materialesACargoComprador ? 0 : (t.costoMat || 0);
  const sub = t.costoSub || 0;
  const cu = mat + sub;
  if (t.margenLinea != null) return cu * (1 + t.margenLinea / 100);
  return mat * (1 + (rubro.margenMat || 0) / 100) + sub * (1 + (rubro.margenMO || 0) / 100);
}

// Quita encabezados de sección que no tienen ninguna tarea real debajo (antes de
// la próxima sección o del final).
function limpiarSecciones(tareas) {
  const out = [];
  for (let i = 0; i < tareas.length; i++) {
    const t = tareas[i];
    if (t.tipo === 'seccion') {
      let hayHija = false;
      for (let j = i + 1; j < tareas.length; j++) {
        if (tareas[j].tipo === 'seccion') break;
        hayHija = true;
        break;
      }
      if (hayHija) out.push(t);
    } else {
      out.push(t);
    }
  }
  return out;
}

// Devuelve los rubros "publicables": cada uno con sus tareas filtradas (sin las
// de $0 ni secciones huérfanas), y excluyendo los rubros que quedan sin tareas
// reales o en total $0. NO muta la entrada.
export function rubrosExportables(rubros) {
  const out = [];
  for (const r of (rubros || [])) {
    const conValor = (r.tareas || []).filter(t => t.tipo === 'seccion' || tareaVentaUnit(t, r) > 0);
    const tareas = limpiarSecciones(conValor);
    const reales = tareas.filter(t => t.tipo !== 'seccion');
    const venta = reales.reduce((s, t) => s + tareaVentaUnit(t, r) * (t.cantidad || 0), 0);
    if (reales.length > 0 && venta > 0) out.push({ ...r, tareas });
  }
  return out;
}

const _norm = (s) => (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const RE_VIATICOS = /viatico|hospedaje|comida/;

// Frases "prediseñadas" por rubro (modo Resumen). Son el default editable de la
// nota del rubro (se muestran y se pueden modificar en el presupuesto) y el
// fallback en el PDF si no hay nota manual.
export const FRASE_CON_MAT = 'Incluye provisión de materiales y mano de obra, según plano.';
export const FRASE_SIN_MAT = 'Incluye mano de obra. Materiales a cargo del comprador, según plano.';
export const FRASE_VIATICOS = 'Gastos de viáticos: comida y hospedaje a cargo del comprador.';

// Nota automática de un rubro según su composición:
//  - logística sin tareas de viáticos/hospedaje/comida → frase de viáticos
//  - factura materiales (alguna tarea con costoMat > 0, no a cargo del comprador) → con materiales
//  - si no → solo mano de obra (materiales a cargo del comprador)
export function notaRubroAuto(rubro) {
  const reales = (rubro?.tareas || []).filter(t => t.tipo !== 'seccion');
  const aCargoComprador = !!rubro?.materialesACargoComprador;
  const tieneMateriales = !aCargoComprador && reales.some(t => (t.costoMat || 0) > 0);
  const esLogistica = _norm(rubro?.nombre).includes('logistica');
  const tieneViaticos = reales.some(t => RE_VIATICOS.test(_norm(t.nombre)));
  if (esLogistica && !tieneViaticos) return FRASE_VIATICOS;
  return tieneMateriales ? FRASE_CON_MAT : FRASE_SIN_MAT;
}

// Vista RESUMEN para presentar al cliente: por cada rubro publicable devuelve su
// nombre, el total de venta, la nota manual (si la cargaron) y la nota automática
// (default). El consumidor muestra `nota || notaAuto`. NO expone tareas/cantidades.
export function resumenRubros(rubros) {
  return rubrosExportables(rubros).map(r => {
    const reales = (r.tareas || []).filter(t => t.tipo !== 'seccion');
    const venta = reales.reduce((s, t) => s + tareaVentaUnit(t, r) * (t.cantidad || 0), 0);
    return { nombre: r.nombre, venta, nota: r.nota, notaAuto: notaRubroAuto(r) };
  });
}
