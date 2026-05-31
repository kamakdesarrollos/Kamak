// Actualización masiva de precios del CATÁLOGO por índice CAC. FUNCIONES PURAS Y
// TESTEADAS. Materiales y Generales suben por CAC-Materiales; la Mano de Obra real
// (subcontratos) por CAC-Mano de Obra; la colección legacy `mo` (precioHora) solo
// si se pide explícitamente.
//
// Idempotencia: cada ítem guarda `cacMesBase` (el mes CAC al que corresponde su
// precio actual). El factor se calcula desde el cacMesBase del ítem (o el mes base
// global elegido, como fallback para ítems viejos) hacia el mes actual. Re-aplicar
// el mismo mes = no-op (los ítems ya están en cacMesBase === mesActual → factor 1).
//
// IMPORTANTE: actualizar el catálogo NO cambia las obras YA presupuestadas (sus
// costoMat/costoSub son snapshots congelados). Sí afecta presupuestos nuevos: las
// APUs resuelven el precio en vivo del catálogo por nombre.

import { valorIndice, redeterminar, variacionPct } from './indices';
import { today } from './dates';

// Colección → sub-índice CAC que le aplica.
export const COLECCION_INDICE = {
  materiales:   'cacMateriales',
  subcontratos: 'cacManoObra',   // la "Mano de Obra" real del negocio
  generales:    'cacMateriales',
  mo:           'cacManoObra',   // legacy/deprecada (precioHora)
};
// Colección → campo de precio (mo usa precioHora; el resto, precio).
export const campoPrecio = (coll) => (coll === 'mo' ? 'precioHora' : 'precio');

// Procesa UN ítem. Devuelve { item, cambiado, motivo }. No muta el original.
function procesarItem(item, coll, { mesBase, mesActual, indices }) {
  const campo = campoPrecio(coll);
  const tipo  = COLECCION_INDICE[coll];
  const precio = Number(item[campo]) || 0;
  if (precio <= 0) return { item, cambiado: false, motivo: 'sin-precio' };
  const baseItem = item.cacMesBase || mesBase;
  if (!baseItem || !mesActual) return { item, cambiado: false, motivo: 'sin-mes' };
  if (baseItem === mesActual) return { item, cambiado: false, motivo: 'ya-actualizado' };
  const vBase   = valorIndice(indices, baseItem, tipo);
  const vActual = valorIndice(indices, mesActual, tipo);
  if (vBase <= 0 || vActual <= 0) return { item, cambiado: false, motivo: 'sin-indice' };
  if (vBase === vActual) return { item: { ...item, cacMesBase: mesActual }, cambiado: false, motivo: 'factor-1' };
  const nuevo = redeterminar(precio, vBase, vActual);
  return {
    item: { ...item, [campo]: nuevo, cacMesBase: mesActual, updatedAt: today() },
    cambiado: true, motivo: 'actualizado',
  };
}

const coleccionesDe = (opts) => {
  const c = ['materiales', 'subcontratos', 'generales'];
  if (opts && opts.incluirMOLegacy) c.push('mo');
  return c;
};

// Aplica el CAC a todo el catálogo y devuelve un catálogo NUEVO (un solo objeto,
// para persistir en un único setCatalog).
export function aplicarCACalCatalogo(catalog, opts) {
  const next = { ...catalog };
  for (const coll of coleccionesDe(opts)) {
    if (!Array.isArray(catalog[coll])) continue;
    next[coll] = catalog[coll].map((it) => procesarItem(it, coll, opts).item);
  }
  return next;
}

// Calcula el preview SIN mutar: resumen por colección (cuántos se actualizan, la
// variación %, ejemplos) + conteos de omitidos/sin-índice. Reusa procesarItem.
export function calcularPreviewCAC(catalog, opts) {
  const porColeccion = {};
  let omitidos = 0, sinIndice = 0, total = 0;
  for (const coll of coleccionesDe(opts)) {
    const items = Array.isArray(catalog[coll]) ? catalog[coll] : [];
    const tipo = COLECCION_INDICE[coll];
    const campo = campoPrecio(coll);
    let actualizados = 0;
    const ejemplos = [];
    for (const it of items) {
      const r = procesarItem(it, coll, opts);
      if (r.cambiado) {
        actualizados++; total++;
        if (ejemplos.length < 4) ejemplos.push({ nombre: it.nombre, antes: Number(it[campo]) || 0, despues: r.item[campo] });
      } else if (r.motivo === 'sin-precio') omitidos++;
      else if (r.motivo === 'sin-indice') sinIndice++;
    }
    porColeccion[coll] = {
      total: items.length,
      actualizados,
      tipo,
      variacionPct: variacionPct(opts.indices, opts.mesBase, opts.mesActual, tipo),
      ejemplos,
    };
  }
  return { porColeccion, omitidos, sinIndice, totalActualizados: total };
}
