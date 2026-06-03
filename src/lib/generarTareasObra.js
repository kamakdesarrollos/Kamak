// Generador de tareas automáticas para una obra.
//
// Cuando se aprueba el presupuesto, recorremos:
//   1) `tipoObra.tareasBase` (las tareas administrativas comunes al tipo).
//   2) Por cada rubro del presupuesto, `rubro.tareasEstandar` (las tareas
//      específicas que ese rubro arrastra: ej. MUEBLES → cotizar, etc.).
//
// La función es idempotente vía la marca `obra.tareasGeneradas` que lleva
// `{ tipoIdAplicado, rubrosAplicados: [rubroId, ...] }`. Solo se generan
// las tareas que faltan respecto a esa marca — útil al re-sincronizar
// después de agregar un rubro nuevo al presupuesto.
//
// Devuelve { tareasNuevas: [...], rubrosAplicados: [...], tipoAplicado }.
// El caller persiste las tareas y actualiza la marca.

import { newId } from './id';

function normalizarRol(s) {
  return (s || '').toString().toLowerCase().trim();
}

// Resuelve el userId del rol indicado en la tarea estándar. Prioridad:
// 1) Usuario activo con rol exacto.
// 2) Cualquier admin (si el rol pedido no existe).
// 3) generadoPor (fallback final).
function resolverUserPorRol(rolPedido, usuarios, generadoPor) {
  if (!Array.isArray(usuarios) || usuarios.length === 0) return generadoPor;
  const target = normalizarRol(rolPedido);
  const match = usuarios.find(u => normalizarRol(u.rol) === target);
  if (match) return match.id;
  const admin = usuarios.find(u => normalizarRol(u.rol) === 'admin');
  if (admin) return admin.id;
  return generadoPor;
}

function calcFechaLimite(fechaBaseISO, diasOffset) {
  if (!fechaBaseISO) return null;
  try {
    const d = new Date(fechaBaseISO);
    if (isNaN(d.getTime())) return null;
    d.setDate(d.getDate() + (Number(diasOffset) || 0));
    return d.toISOString().slice(0, 10);
  } catch { return null; }
}

// Convierte una "tarea estándar" del catálogo en payload para addTarea().
function tareaEstandarToPayload(te, { obraId, generadoPor, usuarios, fechaBase, origen, origenRef }) {
  return {
    titulo: te.titulo || 'Tarea',
    descripcion: te.descripcion || '',
    asignadoA: [resolverUserPorRol(te.rol, usuarios, generadoPor)],
    creadoPor: generadoPor,
    obraId,
    prioridad: te.prioridad || 'media',
    fechaLimite: calcFechaLimite(fechaBase, te.diasOffset),
    checklist: (te.checklist || []).filter(Boolean).map(texto => ({ texto })),
    origen,
    origenRef,
  };
}

export function generarTareasObra({
  obra,           // { id, tipo, ... }
  detalle,        // { rubros, tareasGeneradas, fechaAprobacion, ... }
  catalog,        // { rubros: [...], tiposObra: [...] }
  usuarios,       // [{ id, rol, ... }, ...]
  generadoPor,    // userId del que aprueba
}) {
  if (!obra || !detalle || !catalog) return { tareasNuevas: [], rubrosAplicados: [], tipoAplicado: null };

  const marca = detalle.tareasGeneradas || { tipoIdAplicado: null, rubrosAplicados: [] };
  const yaRubros = new Set(marca.rubrosAplicados || []);
  const fechaBase = detalle.fechaAprobacion || new Date().toISOString().slice(0, 10);

  const payloads = [];
  const rubrosAplicados = [...(marca.rubrosAplicados || [])];
  let tipoAplicado = marca.tipoIdAplicado;

  // (1) Tareas BASE del tipo de obra (solo si todavía no se aplicó).
  if (obra.tipo) {
    const tipoMatch = (catalog.tiposObra || []).find(
      tt => normalizarRol(tt.nombre) === normalizarRol(obra.tipo)
    );
    if (tipoMatch && tipoMatch.id !== tipoAplicado) {
      for (const te of (tipoMatch.tareasBase || [])) {
        payloads.push(tareaEstandarToPayload(te, {
          obraId: obra.id, generadoPor, usuarios, fechaBase,
          origen: 'auto-tipo', origenRef: tipoMatch.id,
        }));
      }
      tipoAplicado = tipoMatch.id;
    }
  }

  // (2) Tareas ESTÁNDAR por cada rubro del presupuesto.
  // El nombre del rubro en detalle.rubros[] matchea con catalog.rubros[].nombre.
  const catRubrosByName = new Map();
  for (const cr of (catalog.rubros || [])) {
    catRubrosByName.set(normalizarRol(cr.nombre), cr);
  }
  for (const obraRubro of (detalle.rubros || [])) {
    const cr = catRubrosByName.get(normalizarRol(obraRubro.nombre));
    if (!cr) continue;
    if (yaRubros.has(cr.id)) continue;
    for (const te of (cr.tareasEstandar || [])) {
      payloads.push(tareaEstandarToPayload(te, {
        obraId: obra.id, generadoPor, usuarios, fechaBase,
        origen: 'auto-rubro', origenRef: cr.id,
      }));
    }
    rubrosAplicados.push(cr.id);
  }

  // (3) Tareas ESTÁNDAR por cada APU presente en el presupuesto.
  // Las filas del presupuesto (detalle.rubros[].tareas[]) referencian los APU
  // del catálogo por nombre. Por cada APU presente (salteando filas de sección),
  // generamos sus tareasEstandar. Idempotente vía marca.apusAplicados (un APU
  // dispara sus tareas una sola vez aunque aparezca repetido o se re-sincronice).
  const yaApus = new Set(marca.apusAplicados || []);
  const apusAplicados = [...(marca.apusAplicados || [])];
  const catTareasByName = new Map();
  for (const ct of (catalog.tareas || [])) {
    if ((ct.tareasEstandar || []).length > 0) catTareasByName.set(normalizarRol(ct.nombre), ct);
  }
  for (const obraRubro of (detalle.rubros || [])) {
    for (const bt of (obraRubro.tareas || [])) {
      if (bt.tipo === 'seccion') continue;
      const ct = catTareasByName.get(normalizarRol(bt.nombre));
      if (!ct || yaApus.has(ct.id)) continue;
      yaApus.add(ct.id);
      apusAplicados.push(ct.id);
      for (const te of (ct.tareasEstandar || [])) {
        payloads.push(tareaEstandarToPayload(te, {
          obraId: obra.id, generadoPor, usuarios, fechaBase,
          origen: 'auto-apu', origenRef: ct.id,
        }));
      }
    }
  }

  return { tareasNuevas: payloads, rubrosAplicados, tipoAplicado, apusAplicados };
}

// Helper de id (re-exportado por conveniencia para tests, etc.)
export { newId };
