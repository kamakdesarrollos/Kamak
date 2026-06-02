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
