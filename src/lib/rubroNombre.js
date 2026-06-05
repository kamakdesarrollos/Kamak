// Normaliza el nombre de un rubro a "minúscula con la primera letra en mayúscula".
// La inicial mayúscula es la del PRIMER carácter del string: si el rubro arranca
// con un código/número (ej. "47 - Logistica"), ese carácter no es letra, así que
// NO se capitaliza nada y queda todo en minúscula ("47 - logistica"). Solo se
// capitaliza cuando el nombre empieza con letra ("Mobiliario shop express").
// Colapsa espacios repetidos y recorta. Se aplica al CREAR/EDITAR un rubro.
export function formatRubroNombre(s) {
  const t = (s ?? '').toString().trim().replace(/\s+/g, ' ').toLowerCase();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}
