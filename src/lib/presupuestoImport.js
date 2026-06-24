// Helpers PUROS para importar un presupuesto de tercero (Excel/PDF) a tareas.
const norm = s => (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

const KEYS = {
  nombre:   ['descripcion', 'detalle', 'item', 'concepto', 'producto', 'nombre', 'articulo'],
  costo:    ['precio', 'p. unitario', 'p unitario', 'unitario', 'costo', 'importe', 'valor', 'monto', 'total'],
  cantidad: ['cant', 'cantidad', 'qty', 'unidades'],
  unidad:   ['unidad', 'um', 'u.m', 'medida'],
};

export function detectarColumnas(headerRow) {
  const cols = (headerRow || []).map(norm);
  const find = keys => cols.findIndex(c => c && keys.some(k => c.includes(k)));
  // nombre: si no matchea, default a la primera columna.
  const nombre = find(KEYS.nombre);
  return {
    nombre:   nombre >= 0 ? nombre : 0,
    costo:    find(KEYS.costo),
    cantidad: find(KEYS.cantidad),
    unidad:   find(KEYS.unidad),
  };
}

export function mapearColumnas(rows, mapping) {
  const at = (row, i) => (i >= 0 && row[i] != null ? row[i] : '');
  return (rows || []).map(row => ({
    nombre:   at(row, mapping.nombre),
    costo:    at(row, mapping.costo),
    cantidad: at(row, mapping.cantidad),
    unidad:   at(row, mapping.unidad),
  }));
}
