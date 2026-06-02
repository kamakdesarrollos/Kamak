// catalogPatch — semántica de escritura ATÓMICA por ítem para el catálogo.
//
// El catálogo se guardaba como UN blob entero (shared_data key=catalog), con
// upsert del objeto completo. Con dos personas editando a la vez, el save de
// una —con el catálogo viejo en memoria— pisaba la edición de la otra
// (last-write-wins, bug CAT-003). Estas funciones aplican el cambio SOLO al
// ítem editado, de forma inmutable, y son el ESPEJO exacto de las RPC de
// Supabase (patch_/append_/remove_shared_object_item) que persisten igual,
// server-side y atómico. Así dos ediciones a ítems distintos no se pisan.

// Mergea (superficial) `patch` en el ítem cuyo id === id. No muta `list`.
export function patchItem(list, id, patch) {
  if (!Array.isArray(list)) return [];
  return list.map(item => (item && item.id === id ? { ...item, ...patch } : item));
}

// Agrega `item` al final. No muta `list`.
export function appendItem(list, item) {
  return [...(Array.isArray(list) ? list : []), item];
}

// Saca el ítem cuyo id === id. No muta `list`.
export function removeItem(list, id) {
  if (!Array.isArray(list)) return [];
  return list.filter(item => !(item && item.id === id));
}
