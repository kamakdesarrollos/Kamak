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
