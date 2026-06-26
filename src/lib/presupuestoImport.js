// Helpers PUROS para importar un presupuesto de tercero (Excel/PDF) a tareas.
const norm = s => (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

// Detecta la moneda de un presupuesto externo a partir de su texto (string) o de
// un array-of-arrays de Excel. Mira símbolos (U$S/US$/USD) y palabras
// ("dólar"/"dolares"/"pesos"/"ARS"), NO solo el "$" suelto (ambiguo en AR).
// Devuelve 'USD' | 'ARS' | null (desconocida → el UI cae a ARS por defecto).
export function detectarMoneda(input) {
  const text = Array.isArray(input)
    ? input.flat().map(c => (c == null ? '' : String(c))).join(' ')
    : String(input == null ? '' : input);
  const t = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/u\$s|us\$|\busd\b|dolar/.test(t)) return 'USD';
  if (/\bars\b|peso/.test(t)) return 'ARS';
  return null;
}

// Clasifica un ítem como mano de obra ('mo') o material ('material') según su
// nombre. Heurística para el default del review (el usuario puede corregir): los
// trabajos (instalación/colocación/montaje/flete/M.O) → 'mo'; el resto → 'material'.
const RE_MANO_OBRA = /(instalaci[oó]n|colocaci[oó]n|colocad|montaje|armad[oa]|mano\s+de\s+obra|\bm\.?\s?o\.?\b|flete|acarreo|man[ou]\s+de\s+obra)/i;
export function clasificarTipoItem(nombre) {
  return RE_MANO_OBRA.test((nombre == null ? '' : String(nombre))) ? 'mo' : 'material';
}

const KEYS = {
  nombre:   ['descripcion', 'detalle', 'item', 'concepto', 'producto', 'nombre', 'articulo'],
  // Precio UNITARIO: lo que va a costoSub. Se busca primero (preferido).
  costoUnit: ['p. unitario', 'p unitario', 'precio unitario', 'unitario', 'precio', 'costo', 'valor', 'monto'],
  // Total / importe de línea: sólo como fallback si no hay columna de unitario.
  // (Elegir "Total" como costo unitario inflaría el contrato ×cantidad — #10.)
  costoTotal: ['importe', 'subtotal', 'total'],
  cantidad: ['cant', 'cantidad', 'qty', 'unidades'],
  unidad:   ['unidad', 'um', 'u.m', 'medida'],
};

export function detectarColumnas(headerRow) {
  const cols = (headerRow || []).map(norm);
  const find = keys => cols.findIndex(c => c && keys.some(k => c.includes(k)));
  // nombre: si no matchea, default a la primera columna.
  const nombre = find(KEYS.nombre);
  // costo: priorizar precio unitario; sólo caer a total/importe si no hay unitario.
  const costoUnit = find(KEYS.costoUnit);
  return {
    nombre:   nombre >= 0 ? nombre : 0,
    costo:    costoUnit >= 0 ? costoUnit : find(KEYS.costoTotal),
    cantidad: find(KEYS.cantidad),
    unidad:   find(KEYS.unidad),
  };
}

// Detecta el índice de la fila de encabezado en un array-of-arrays (Excel): la
// primera fila donde detectarColumnas encuentra una columna de costo. Saltea
// filas de título/logo que muchos presupuestos traen arriba (#12). 0 si no hay.
export function indiceHeader(aoa) {
  const rows = aoa || [];
  const idx = rows.findIndex(row => Array.isArray(row) && detectarColumnas(row).costo >= 0);
  return idx >= 0 ? idx : 0;
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
//
// El caso ambiguo es "X.YYY" sin coma (un solo punto seguido de 3 dígitos):
//  - en un COSTO casi siempre son miles ("185.000" = 185000) → default.
//  - en una CANTIDAD casi siempre es decimal ("1.500" = 1,5 m²) → opts.dotDecimal.
// Con coma presente el formato es siempre AR (punto=miles, coma=decimal).
export function parseNum(v, opts = {}) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let s = (v == null ? '' : String(v)).replace(/[^\d.,-]/g, '');
  if (!s) return 0;
  const neg = s.startsWith('-');
  s = s.replace(/-/g, '');
  let n;
  if (s.includes(',')) {
    // AR: la coma es decimal y los puntos son separadores de miles.
    n = Number(s.replace(/\./g, '').replace(',', '.'));
  } else {
    const dots = (s.match(/\./g) || []).length;
    if (dots === 0) {
      n = Number(s);
    } else if (dots >= 2) {
      // Varios puntos sin coma → todos son separadores de miles ("1.234.567").
      n = Number(s.replace(/\./g, ''));
    } else {
      // Un solo punto, sin coma → ambiguo. 3 dígitos detrás = miles salvo que el
      // contexto pida tratarlo como decimal (cantidad).
      const dec = s.split('.')[1] || '';
      n = (dec.length === 3 && !opts.dotDecimal) ? Number(s.replace(/\./g, '')) : Number(s);
    }
  }
  // Fallback: si quedó NaN (ej. "1.234.5"), sacar todos los separadores y reintentar
  // en vez de devolver 0 (que descartaría la fila en silencio — #16).
  if (!Number.isFinite(n)) n = Number(s.replace(/[.,]/g, ''));
  if (!Number.isFinite(n)) return 0;
  return neg ? -n : n;
}

export function normalizarItems(items) {
  return (items || [])
    .map(it => ({
      nombre: (it.nombre || '').toString().trim(),
      costo: parseNum(it.costo),
      cantidad: parseNum(it.cantidad, { dotDecimal: true }) || 1,
      unidad: (it.unidad || '').toString().trim() || 'u',
      // Tipo material/MO: respeta lo elegido en el review; si no vino, lo infiere
      // del nombre (default inteligente).
      tipo: (it.tipo === 'material' || it.tipo === 'mo') ? it.tipo : clasificarTipoItem(it.nombre),
    }))
    .filter(it => it.nombre && it.costo > 0);
}

// Subtotal de UNA fila de la tabla de revisión: costo (formato AR) × cantidad
// (default 1 si vacía/inválida). Usa la MISMA interpretación de cantidad que el
// import (punto = decimal) para que el subtotal mostrado coincida con lo guardado.
export function subtotalFila(it) {
  return parseNum(it && it.costo) * (parseNum(it && it.cantidad, { dotDecimal: true }) || 1);
}

export function itemsATareas(items, { contratoId, makeId }) {
  return (items || []).map(it => {
    // El ítem va a materiales (costoMat) o a mano de obra (costoSub) según su
    // tipo. Sin tipo → 'mo' (back-compat: un presupuesto de tercero es M.O).
    const esMat = it.tipo === 'material';
    return {
      id: makeId(),
      codigo: '',
      nombre: it.nombre,
      unidad: it.unidad || 'u',
      cantidad: it.cantidad || 1,
      // Sin redondear: el costo unitario puede tener decimales y redondearlo acá
      // propaga error al multiplicar por cantidad (#14). parseNum ya devolvió Number.
      costoMat: esMat ? it.costo : 0,
      costoSub: esMat ? 0 : it.costo,
      contratoId,
      fuente: 'Presupuesto',
      receta: { materiales: [] },
      avance: 0,
    };
  });
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

// Clave normalizada de un nombre de empresa: minúsculas, sin acentos/puntuación y
// sin sufijos societarios (SA/SRL/SAS/SACI…), para comparar "Grupo Braf" ≈ "Grupo Braf SA".
function nombreClave(s) {
  let n = norm(s).replace(/[.\-,]/g, ' ').replace(/\s+/g, ' ').trim();
  n = n.replace(/\b(sa|sac|saci|sacif|saic|srl|sas|sci|scs|sce)\b/g, '').replace(/\s+/g, ' ').trim();
  return n;
}

// Match FLEXIBLE para resolver el proveedor de un presupuesto (auto-proveedor):
// - CUIT exacto → { proveedor, exacto: true }  (apto para auto-link)
// - nombre (igualdad de clave o contención ≥4) → { proveedor, exacto: false } (sugerencia editable)
// - nada → null
export function matchProveedorFlexible(nombre, cuit, proveedores) {
  const list = proveedores || [];
  const c = (cuit || '').replace(/[^\dkK]/g, '');
  if (c) {
    const porCuit = list.find(p => (p.cuit || '').replace(/[^\dkK]/g, '') === c);
    if (porCuit) return { proveedor: porCuit, exacto: true };
  }
  const n = nombreClave(nombre);
  if (!n) return null;
  let p = list.find(x => nombreClave(x.nombre) === n);
  if (p) return { proveedor: p, exacto: false };
  p = list.find(x => {
    const xn = nombreClave(x.nombre);
    return xn && n.length >= 4 && xn.length >= 4 && (xn.includes(n) || n.includes(xn));
  });
  return p ? { proveedor: p, exacto: false } : null;
}

// Decide qué hacer con el proveedor de un presupuesto importado.
// proveedorData = { razonSocial, cuit, domicilio, telefono, email, condicionIVA, rubro }
// proveedorId   = id ya resuelto (match exacto o elegido) o null.
// → { accion:'link', proveedorId } | { accion:'crear', datos } | { accion:'texto', nombre }
export function resolverProveedorImport(proveedorData, proveedorId) {
  const d = proveedorData || {};
  if (proveedorId) return { accion: 'link', proveedorId };
  const cuit = (d.cuit || '').toString().trim();
  if (cuit) {
    return { accion: 'crear', datos: {
      nombre: d.razonSocial || 'Proveedor',
      cuit,
      domicilio: d.domicilio || '',
      telefono: d.telefono || '',
      email: d.email || '',
      condicion: d.condicionIVA || 'Responsable Inscripto',
      tipo: d.rubro || '',
      categoria: 'Mano de obra',
    } };
  }
  return { accion: 'texto', nombre: d.razonSocial || '' };
}
