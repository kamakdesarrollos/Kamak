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

// Parsea un número en formato AR ("185.000,50" / "185.000" / "185000") a Number.
function parseNum(v) {
  if (typeof v === 'number') return v;
  const s = (v == null ? '' : String(v)).replace(/[^\d.,-]/g, '');
  if (!s) return 0;
  let n2;
  if (s.includes(',')) {
    // Tiene coma: la coma es decimal y los puntos son separadores de miles.
    n2 = s.replace(/\./g, '').replace(',', '.');
  } else if (/\.\d{3}$/.test(s)) {
    // Tiene punto seguido de exactamente 3 dígitos al final: separador de miles AR.
    n2 = s.replace(/\./g, '');
  } else {
    n2 = s;
  }
  const n = Number(n2);
  return Number.isFinite(n) ? n : 0;
}

export function normalizarItems(items) {
  return (items || [])
    .map(it => ({
      nombre: (it.nombre || '').toString().trim(),
      costo: parseNum(it.costo),
      cantidad: parseNum(it.cantidad) || 1,
      unidad: (it.unidad || '').toString().trim() || 'u',
    }))
    .filter(it => it.nombre && it.costo > 0);
}

// Subtotal de UNA fila de la tabla de revisión: costo (formato AR) × cantidad
// (default 1 si vacía/inválida). Reusa parseNum para no romperse con "185.000".
export function subtotalFila(it) {
  return parseNum(it && it.costo) * (parseNum(it && it.cantidad) || 1);
}

export function itemsATareas(items, { contratoId, makeId }) {
  return (items || []).map(it => ({
    id: makeId(),
    codigo: '',
    nombre: it.nombre,
    unidad: it.unidad || 'u',
    cantidad: it.cantidad || 1,
    costoMat: 0,
    costoSub: Math.round(it.costo),
    contratoId,
    fuente: 'Presupuesto',
    receta: { materiales: [] },
    avance: 0,
  }));
}

// Aplana las tareas de todos los rubros de un detalle de obra. Es la "fuente de
// verdad" sobre la que se derivan monto/avance de los contratos origen:'adjunto'
// (sus tareas viven anidadas en el rubro, ligadas por contratoId).
export function tareasDeObra(detalle) {
  return ((detalle && detalle.rubros) || []).flatMap(r => (r && r.tareas) || []);
}

export function montoContrato(contratoId, tareas) {
  return (tareas || [])
    .filter(t => t.contratoId === contratoId)
    .reduce((s, t) => s + (t.costoSub || 0) * (t.cantidad || 0), 0);
}

export function avanceContrato(contratoId, tareas) {
  const propias = (tareas || []).filter(t => t.contratoId === contratoId);
  let total = 0, ejec = 0;
  for (const t of propias) {
    const c = (t.costoSub || 0) * (t.cantidad || 0);
    total += c;
    ejec += c * ((t.avance || 0) / 100);
  }
  return total > 0 ? Math.round((ejec / total) * 100) : 0;
}

export function matchProveedor(nombre, cuit, proveedores) {
  const list = proveedores || [];
  const c = (cuit || '').replace(/[^\dkK]/g, '');
  if (c) {
    const porCuit = list.find(p => (p.cuit || '').replace(/[^\dkK]/g, '') === c);
    if (porCuit) return porCuit;
  }
  const n = norm(nombre);
  return (n && list.find(p => norm(p.nombre) === n)) || null;
}
