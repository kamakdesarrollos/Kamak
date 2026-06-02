// Resolución del precio real de un material/subcontrato/mo dentro de un APU.
//
// Contexto del bug que motivó esto:
// El SISMAT importado cargó los APU con el campo "precio" del material
// guardando el SUBTOTAL ya calculado (cantidad_real × precio_unitario), no el
// precio unitario. Cuando el cálculo hace cantidad × precio otra vez, infla
// el monto en proporción a la cantidad — un cemento de 200 kg termina
// costando $12M en lugar de $500k.
//
// Solución: tratamos el precio del APU como dato no confiable y lo
// reemplazamos por el del catálogo de materiales. Si la unidad del catálogo
// difiere de la del APU (típico: catálogo "Bolsa de 25Kg" vs APU "Kg"), se
// convierte la cantidad para que la multiplicación dé el monto real.

// Extrae el factor de empaque de una unidad del catálogo.
// Ejemplos:
//   "Bolsa de 25Kg"     → { magnitud: 'kg',  size: 25 }
//   "Bolsa/s de 40kg"   → { magnitud: 'kg',  size: 40 }
//   "Pack x 12 U"       → { magnitud: 'u',   size: 12 }
//   "Rollo de 150 ml"   → { magnitud: 'ml',  size: 150 }
//   "Kg"                → null (es la magnitud base ya)
//   "M³"                → null
const RE_EMPAQUE = /(\d+(?:[.,]\d+)?)\s*(kg|gr?|lt?|ml|cm|mm|m²|m2|m³|m3|m|u|unid|unidades|pack)\b/i;

function normalizarMagnitud(s) {
  if (!s) return '';
  const lower = s.toLowerCase().trim()
    .replace(/[²]/g, '2')   // ²
    .replace(/[³]/g, '3')   // ³
    .replace(/\s+/g, '');
  if (lower === 'unid' || lower === 'unidades') return 'u';
  if (lower === 'gr') return 'g';
  if (lower === 'lt') return 'l';
  return lower;
}

export function parseEmpaque(unidadCat) {
  if (!unidadCat) return null;
  const norm = unidadCat.trim();
  // Si es solo "Kg" / "M³" / "U" → no tiene empaque, magnitud directa
  const soloMagnitud = /^(kg|g|l|lt|ml|m|m2|m3|m²|m³|u|unid|unidades|cm|mm|gl)$/i;
  if (soloMagnitud.test(norm)) return null;
  const m = norm.match(RE_EMPAQUE);
  if (!m) return null;
  const size = parseFloat(m[1].replace(',', '.'));
  if (!size || size <= 0) return null;
  return { magnitud: normalizarMagnitud(m[2]), size };
}

// Factor de conversión de la unidad del APU a la unidad del catálogo.
// Devuelve el factor por el que hay que multiplicar la cantidad del APU
// para obtener la cantidad expresada en la unidad del catálogo.
//
// Ej: APU pide "200 Kg", catálogo es "Bolsa de 25Kg" → factor = 1/25 = 0.04
//     (200 kg × 0.04 = 8 bolsas; 8 × precio_bolsa = total real)
//
// Si las unidades son iguales o no se puede convertir, devuelve 1.
export function factorConversion(unidadApu, unidadCat) {
  if (!unidadApu || !unidadCat) return 1;
  const a = normalizarMagnitud(unidadApu);
  const c = normalizarMagnitud(unidadCat);
  if (a === c) return 1;
  const empaque = parseEmpaque(unidadCat);
  if (empaque && empaque.magnitud === a) {
    // APU pide en magnitud base, catálogo viene en empaque de N → dividir
    return 1 / empaque.size;
  }
  const empaqueApu = parseEmpaque(unidadApu);
  if (empaqueApu && empaqueApu.magnitud === c) {
    // Caso inverso (raro): APU pide en empaque, catálogo en magnitud base
    return empaqueApu.size;
  }
  // Sin match → no convertir
  return 1;
}

// Normaliza un nombre para matching tolerante: case-insensitive,
// sin tildes, sin espacios extra. Exportada para que la cascada de rename
// (al renombrar un material/MO) matchee igual que el resolver.
export function normalizarNombre(s) {
  return (s || '').toString()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Construye un Map normalizado para lookup O(1). Crítico para performance:
// resolver precios linealmente contra el catálogo SISMAT (~2000 items) ×
// miles de APUs × decenas de materiales escala a millones de operaciones
// con normalizarNombre por render. Con Map: una sola pasada por catálogo.
//
// Uso: catalogIndex = buildCatalogItemsIndex(catalog.materiales)
//      buscarEnCatalogo(nombre, catalogIndex)  // O(1)
export function buildCatalogItemsIndex(items) {
  if (!Array.isArray(items)) return items; // pasa-thru si ya es Map o null
  const map = new Map();
  for (const item of items) {
    if (item?.nombre) map.set(normalizarNombre(item.nombre), item);
  }
  return map;
}

// Conveniencia: indexa los sub-catálogos de una vez. Incluye `tareas` (APU
// del catálogo) para que las plantillas puedan buscar la APU por nombre y
// derivar los costos desde ahí, sin guardar copia hardcoded.
export function buildCatalogIndex(catalog) {
  if (!catalog) return null;
  return {
    materiales:   buildCatalogItemsIndex(catalog.materiales),
    subcontratos: buildCatalogItemsIndex(catalog.subcontratos),
    mo:           buildCatalogItemsIndex(catalog.mo),
    generales:    buildCatalogItemsIndex(catalog.generales),
    tareas:       buildCatalogItemsIndex(catalog.tareas),
  };
}

// Busca un item del catálogo por nombre. Acepta Map (rápido) o Array.
export function buscarEnCatalogo(nombre, catalogoItems) {
  if (!nombre || !catalogoItems) return null;
  if (catalogoItems instanceof Map) {
    return catalogoItems.get(normalizarNombre(nombre)) || null;
  }
  if (!Array.isArray(catalogoItems) || catalogoItems.length === 0) return null;
  const target = normalizarNombre(nombre);
  return catalogoItems.find(c => normalizarNombre(c.nombre) === target) || null;
}

// Resuelve el subtotal correcto de un item del APU consultando el catálogo.
// Devuelve un objeto con:
//   - subtotal: monto correcto (precioCatalogo × cantidadConvertida)
//   - precioUnitario: precio actual del catálogo (en su unidad)
//   - unidadCatalogo: unidad del catálogo (para mostrar)
//   - factor: factor aplicado a la cantidad
//   - encontrado: true si matcheó en el catálogo, false si no
//   - origen: 'catalogo' | 'apu-fallback' — de dónde salió el precio
export function resolverItemAPU(itemApu, catalogoItems) {
  const cantidad = Number(itemApu?.cantidad) || 0;
  // Fallback si no hay catálogo: usar el precio del APU (comportamiento viejo).
  const isEmpty = !catalogoItems
    || (catalogoItems instanceof Map ? catalogoItems.size === 0 : catalogoItems.length === 0);
  if (isEmpty) {
    const subtotal = cantidad * (Number(itemApu?.precio) || 0);
    return {
      subtotal,
      precioUnitario: Number(itemApu?.precio) || 0,
      unidadCatalogo: itemApu?.unidad || '',
      factor: 1,
      encontrado: false,
      origen: 'apu-fallback',
    };
  }
  const match = buscarEnCatalogo(itemApu?.nombre, catalogoItems);
  if (!match) {
    // Material no encontrado: mantenemos precio del APU como fallback pero
    // marcamos para que la UI muestre warning.
    const subtotal = cantidad * (Number(itemApu?.precio) || 0);
    return {
      subtotal,
      precioUnitario: Number(itemApu?.precio) || 0,
      unidadCatalogo: itemApu?.unidad || '',
      factor: 1,
      encontrado: false,
      origen: 'apu-fallback',
    };
  }
  const precioCat = Number(match.precio) || 0;
  const factor = factorConversion(itemApu?.unidad, match.unidad);
  const cantidadConv = cantidad * factor;
  return {
    subtotal: cantidadConv * precioCat,
    precioUnitario: precioCat,
    unidadCatalogo: match.unidad || '',
    factor,
    encontrado: true,
    origen: 'catalogo',
  };
}

// Misma función pero para mano de obra (usa precioHora y horas).
export function resolverMOAPU(itemMo, moCatalogo) {
  const horas = Number(itemMo?.horas) || 0;
  if (!moCatalogo || moCatalogo.length === 0) {
    const subtotal = horas * (Number(itemMo?.precioHora) || 0);
    return { subtotal, precioHora: Number(itemMo?.precioHora) || 0, encontrado: false, origen: 'apu-fallback' };
  }
  const match = buscarEnCatalogo(itemMo?.nombre, moCatalogo);
  if (!match) {
    const subtotal = horas * (Number(itemMo?.precioHora) || 0);
    return { subtotal, precioHora: Number(itemMo?.precioHora) || 0, encontrado: false, origen: 'apu-fallback' };
  }
  const precioHora = Number(match.precioHora) || 0;
  return { subtotal: horas * precioHora, precioHora, encontrado: true, origen: 'catalogo' };
}
