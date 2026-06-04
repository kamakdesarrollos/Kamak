// cascadeRename — al renombrar un material / mano de obra / general en el
// catálogo, propaga el nuevo nombre a las recetas de las APU (tareas) que lo
// referencian POR NOMBRE. Sin esto, renombrar dejaba a esas APU "SIN CATÁLOGO"
// (el resolver matchea por nombre y ya no encontraba el viejo).
//
// Devuelve { tareas, cambios }:
//   - tareas: el array nuevo (inmutable) con las referencias renombradas.
//   - cambios: [{ id, [field]: nuevoArray }] solo de las tareas que cambiaron,
//     para persistir cada una de forma atómica.
export function cascadeRename(tareas, field, oldName, newName, norm) {
  if (!Array.isArray(tareas)) return { tareas: [], cambios: [] };
  const target = norm(oldName);
  const cambios = [];
  const out = tareas.map(t => {
    const items = t && t[field];
    if (!Array.isArray(items)) return t;
    let changed = false;
    const nuevos = items.map(it => {
      if (it && norm(it.nombre) === target && it.nombre !== newName) {
        changed = true;
        return { ...it, nombre: newName };
      }
      return it;
    });
    if (!changed) return t;
    cambios.push({ id: t.id, [field]: nuevos });
    return { ...t, [field]: nuevos };
  });
  return { tareas: out, cambios };
}

// cascadeRubroRename — al renombrar un RUBRO, propaga el nuevo nombre a todo lo
// que lo referencia POR NOMBRE: tareas[].rubroNombre, materiales/subcontratos/
// generales[].rubro y mo[].oficio. Sin esto, renombrar un rubro desagrupa todas
// sus entidades y rompe la auto-generación de tareas (generarTareasObra matchea
// por nombre). Bug CAT-001.
//
// Devuelve { patched, cambios }:
//   - patched: { [coll]: nuevoArray } SOLO de las colecciones que cambiaron (para setCatalog).
//   - cambios: [{ coll, id, patch }] de cada ítem que cambió, para persistir atómico.
const RUBRO_REF_FIELDS = [
  { coll: 'tareas',       field: 'rubroNombre' },
  { coll: 'materiales',   field: 'rubro' },
  { coll: 'subcontratos', field: 'rubro' },
  { coll: 'generales',    field: 'rubro' },
  { coll: 'mo',           field: 'oficio' },
];

export function cascadeRubroRename(catalog, oldName, newName) {
  const patched = {};
  const cambios = [];
  if (!catalog || !oldName || !newName || oldName === newName) return { patched, cambios };
  for (const { coll, field } of RUBRO_REF_FIELDS) {
    const list = catalog[coll];
    if (!Array.isArray(list)) continue;
    let changed = false;
    const out = list.map(it => {
      if (it && it[field] === oldName) {
        changed = true;
        cambios.push({ coll, id: it.id, patch: { [field]: newName } });
        return { ...it, [field]: newName };
      }
      return it;
    });
    if (changed) patched[coll] = out;
  }
  return { patched, cambios };
}

// syncFormItemNames — mantiene el editor de APU abierto MATCHEADO cuando otra
// pestaña renombra un material/MO. El form del editor es una copia local con el
// nombre viejo; al recargar el catálogo (por broadcast), adoptamos el nombre
// nuevo de la tarea POR ID del ítem (no por nombre, que justamente ya no
// matchea). Solo cambia el nombre — cantidades/edits en curso quedan intactos.
// Devuelve el MISMO `form` si no hubo cambios (para no forzar re-render).
export function syncFormItemNames(form, tarea) {
  if (!form || !tarea) return form;
  const sync = (formArr, tareaArr) => {
    if (!Array.isArray(formArr) || !Array.isArray(tareaArr)) return formArr;
    let changed = false;
    const out = formArr.map(fi => {
      const ti = tareaArr.find(t => t && t.id === fi.id);
      if (ti && ti.nombre !== fi.nombre) { changed = true; return { ...fi, nombre: ti.nombre }; }
      return fi;
    });
    return changed ? out : formArr;
  };
  const materiales = sync(form.materiales, tarea.materiales);
  const subcontratos = sync(form.subcontratos, tarea.subcontratos);
  const generales = sync(form.generales, tarea.generales);
  if (materiales === form.materiales && subcontratos === form.subcontratos && generales === form.generales) return form;
  return { ...form, materiales, subcontratos, generales };
}
