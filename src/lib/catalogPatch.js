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

// ── Variante a nivel OBJETO: data = { coleccionA: [...], coleccionB: [...] } ──
// Para keys cuyo `data` es un OBJETO con varias colecciones (ej. 'proveedores' =
// {proveedores, ccEntries}; 'movimientos' = {cajas, movimientos}; 'catalog' =
// {tareas, materiales, ...}). Cada función aplica el cambio SOLO a la colección
// pedida y devuelve un objeto nuevo, sin tocar las demás colecciones. Son el
// espejo exacto de las RPC patch_/append_/remove_shared_object_item y el fallback
// read-modify-write de los helpers genéricos en dbHelpers.js. La propiedad clave
// (testeada): mutar una colección NO pisa la otra (bug PROV-CC-001).
export function patchObjItem(obj, collection, id, patch) {
  const o = obj && typeof obj === 'object' ? obj : {};
  return { ...o, [collection]: patchItem(o[collection] || [], id, patch) };
}
export function appendObjItem(obj, collection, item) {
  const o = obj && typeof obj === 'object' ? obj : {};
  return { ...o, [collection]: appendItem(o[collection] || [], item) };
}
export function removeObjItem(obj, collection, id) {
  const o = obj && typeof obj === 'object' ? obj : {};
  return { ...o, [collection]: removeItem(o[collection] || [], id) };
}
