// Normaliza el nombre de un rubro a "minúscula con la primera letra en mayúscula"
// (sentence case). Así no quedan rubros gritando en MAYÚSCULAS y todo se ve
// parejo en el catálogo, el presupuesto y los listados. Capitaliza la primera
// LETRA (saltea códigos/números iniciales tipo "47 - "), colapsa espacios
// repetidos y recorta. Pensado para aplicarse al CREAR/EDITAR un rubro.
export function formatRubroNombre(s) {
  const t = (s ?? '').toString().trim().replace(/\s+/g, ' ').toLowerCase();
  return t.replace(/[a-záéíóúüñ]/i, ch => ch.toUpperCase());
}
