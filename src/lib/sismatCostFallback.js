// Fallback de costos SISMAT — cuando el catálogo APU no tiene MO/sub cargado
// (porque la importación original solo trajo materiales), usamos el JSON
// SISMAT como fuente de costos reales.
//
// Reglas de conversión SISMAT → Kamak:
//   - Materiales SISMAT → Materiales Kamak (1:1, sumamos todos los materiales
//     de la tarea con cantidad × precio).
//   - MO SISMAT          → Sub Contrato Kamak × 0.5 (la MO de SISMAT en
//     Kamak se modela como sub-contrato a la mitad del valor porque
//     trabajamos con sub-contratistas, no MO directa).
//
// Devuelve un Map: `nombreNormalizado → { costoMat: number, costoSub: number }`
// donde ambos son costos unitarios (por unidad de la tarea, no por proyecto).

const FACTOR_MO_A_SUB = 0.5;

// Decodifica encoding latin1→UTF8 mal codificado (Ã± → ñ, etc.) que tienen
// los JSONs del SISMAT importado. Aplicamos esto SIEMPRE antes de normalizar
// para que el mismo nombre dé el mismo key independientemente del encoding.
function fixEncoding(s) {
  if (!s) return s;
  try {
    // Dispara con Ã o Â: los caracteres ° / º (grados/ordinales) en
    // doble-codificación latin1 producen 'Â' SIN 'Ã'. Sin esto, nombres como
    // "Columna HÂºAÂº..." no se decodificaban y no matcheaban con "HºAº".
    if (/[ÃÂ]/.test(s)) {
      return decodeURIComponent(escape(s));
    }
  } catch { /* ignore */ }
  return s;
}

// Normaliza para matching tolerante: decodifica encoding, baja acentos,
// minúsculas y COLAPSA todo lo no-alfanumérico a un espacio (así "H°A°" y
// "HºAº" → "h a", y los paréntesis/puntos no rompen el match). Mantiene los
// números (no confunde "15" con "20"). Exportada para tests.
export function normalizarNombre(s) {
  return fixEncoding((s || '').toString())
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

let cachedMap = null;
let loadingPromise = null;

export async function loadSismatCostMap() {
  if (cachedMap) return cachedMap;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    try {
      const [tareasRes, moRes] = await Promise.all([
        fetch('/sismat_tareas.json'),
        fetch('/sismat_mo.json'),
      ]);
      if (!tareasRes.ok || !moRes.ok) return new Map();
      const tareasArr = await tareasRes.json();
      const moArr = await moRes.json();

      const map = new Map();

      // Costo unitario de materiales por tarea: suma de los `precio` tal
      // cual están en el JSON. NO multiplicamos por cantidad porque en el
      // SISMAT original el campo `precio` ya es el subtotal del material
      // dentro de UNA unidad de la tarea (este es el mismo bug que vimos
      // en los APU del catálogo). Sumar nada más.
      for (const t of tareasArr) {
        const nombre = fixEncoding(t?.nombre);
        if (!nombre) continue;
        const key = normalizarNombre(nombre);
        const costoMat = (t.materiales || []).reduce(
          (s, m) => s + (Number(m.precio) || 0),
          0
        );
        const prev = map.get(key) || { costoMat: 0, costoSub: 0 };
        map.set(key, { ...prev, costoMat });
      }

      // MO por tarea, convertida a Sub Contrato Kamak con el factor 0.5.
      for (const t of moArr) {
        const nombre = fixEncoding(t?.nombre);
        if (!nombre) continue;
        const key = normalizarNombre(nombre);
        const costoSub = Math.round((Number(t.precio) || 0) * FACTOR_MO_A_SUB);
        const prev = map.get(key) || { costoMat: 0, costoSub: 0 };
        map.set(key, { ...prev, costoSub });
      }

      cachedMap = map;
      return map;
    } catch (e) {
      console.error('[sismatCostFallback] no se pudo cargar el JSON SISMAT', e);
      return new Map();
    } finally {
      loadingPromise = null;
    }
  })();
  return loadingPromise;
}

export function getSismatCostsForTarea(nombre, sismatMap) {
  if (!sismatMap || !nombre) return null;
  const key = normalizarNombre(nombre);
  return sismatMap.get(key) || null;
}

// Busca el costoSub (MO × 0.5) de una tarea en el mapa SISMAT: por nombre
// exacto o, si no, por PREFIJO normalizado. En SISMAT la MO suele estar cargada
// como "<nombre de la tarea>  <descripción>" (ej. "Mampostería de 15  ladrillo
// común", "Cambio de Válvula de Gas  No incluye materiales"), por eso el match
// EXACTO fallaba y dejaba la tarea sin MO. Devuelve el match más específico
// (prefijo más corto). 0 si no hay MO (hueco legítimo: alquiler/servicio).
export function findCostoSub(sismatMap, nombre) {
  if (!sismatMap) return 0;
  const tn = normalizarNombre(nombre);
  if (!tn) return 0;
  const exact = sismatMap.get(tn);
  if (exact && exact.costoSub > 0) return exact.costoSub;
  let best = null;
  for (const [k, v] of sismatMap) {
    // El " " final exige separador → "15" no matchea "150" ni "1".
    if (v.costoSub > 0 && k.startsWith(tn + ' ')) {
      if (!best || k.length < best.len) best = { len: k.length, costoSub: v.costoSub };
    }
  }
  return best ? best.costoSub : 0;
}

// Migración one-shot del catálogo APU: para cada APU que NO tenga
// sub-contratos ni MO cargados, le agrega un sub-contrato con el valor
// SISMAT × 0.5 (la conversión MO→Sub de Kamak). Esto deja el catálogo
// completo y persistido — el resolver ya no necesita el SISMAT como fallback.
//
// Devuelve `null` si no hay cambios (idempotente — al re-ejecutarse no
// duplica nada porque el guard "ya tiene sub/mo" prende). Devuelve el
// catalog nuevo si modificó alguna APU.
export function migrarCatalogoConSismat(catalog, sismatMap) {
  if (!catalog?.tareas || !sismatMap || sismatMap.size === 0) return null;

  let changedCount = 0;
  const newTareas = catalog.tareas.map(t => {
    const costoSub = findCostoSub(sismatMap, t.nombre);
    if (costoSub <= 0) return t;

    // Skip si la APU ya tiene sub o mo no-cero (el user puede haberlos
    // editado a mano, no queremos pisarle).
    const yaTieneSub = (t.subcontratos || []).some(s => (Number(s.precio) || 0) > 0);
    const yaTieneMO  = (t.mo || []).some(m => (Number(m.precioHora) || 0) > 0);
    if (yaTieneSub || yaTieneMO) return t;

    changedCount++;
    return {
      ...t,
      subcontratos: [
        ...(t.subcontratos || []),
        {
          id: `sc-sismat-${t.id}`,
          nombre: `MO ${t.nombre}`.slice(0, 120),
          cantidad: 1,
          unidad: t.unidad || 'u',
          precio: costoSub,
        },
      ],
    };
  });

  if (changedCount === 0) return null;
  console.log(`[sismatCostFallback] Migración: ${changedCount} APUs enriquecidas con sub-contratos desde SISMAT.`);
  return { ...catalog, tareas: newTareas };
}
