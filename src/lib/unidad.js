// Normaliza la unidad de medida a la forma canónica con superíndice:
//   m2 / M2 / m² / M²  → m²
//   m3 / M3 / m³ / M³  → m³
// Cualquier otra unidad (u, gl, kg, ml, m, etc.) se devuelve sin tocar.
//
// Se usa tanto al ESCRIBIR (catálogo, presupuesto) como en una migración
// one-shot que corrige las que ya estaban cargadas como "M2".
export function normUnidad(u) {
  if (u == null) return u;
  const k = String(u).trim().toLowerCase();
  if (k === 'm2' || k === 'm²') return 'm²';
  if (k === 'm3' || k === 'm³') return 'm³';
  return u;
}
