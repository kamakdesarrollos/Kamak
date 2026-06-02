// groupByKey — agrupa una lista por el valor de `key` dejando los ítems del
// mismo grupo CONTIGUOS, en el orden de primera aparición del grupo y
// preservando el orden interno. Sirve para la tabla del catálogo: antes se
// asumía que la lista venía ordenada por rubro y el encabezado se reinsertaba
// cada vez que el rubro reaparecía salteado → headers repetidos al buscar.
export function groupByKey(list, key) {
  if (!Array.isArray(list)) return [];
  const groups = new Map();
  for (const item of list) {
    const k = (item && item[key]) || '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(item);
  }
  return [...groups.values()].flat();
}
