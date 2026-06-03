// searchNorm — normaliza texto para BÚSQUEDAS: minúsculas + sin acentos.
// Así "marmol" matchea "Mármol", "cano" matchea "Caño", etc. La búsqueda de
// las tablas del catálogo comparaba con toLowerCase() solo (sensible a acentos).
export function searchNorm(s) {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
