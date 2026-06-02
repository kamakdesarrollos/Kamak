// ── Visibilidad de cajas — fuente de verdad única ────────────────────────────
//
// Modelo: el Admin ve todas las cajas. Un no-admin ve:
//   1) SU caja: aquella de la que es responsable (caja.usuarioId === su email).
//      El responsable se elige al crear la caja ("a quién corresponde"). Esto es
//      lo que la gente espera: asignás el dueño y el dueño la ve, sin más pasos.
//   2) Las que un Admin le asignó a mano (caja.id ∈ currentUser.cajasVisibles).
//
// Antes la visibilidad salía SOLO de cajasVisibles y NO se conectaba con el
// responsable de la caja, así que asignar el dueño no alcanzaba para que la viera
// (había que, además, ir a Usuarios → Accesos y tildarla). Esto unifica ambos.
//
// Nota: para un no-admin, cajasVisibles === '*' NO se trata como "todas" (sería
// una fuga); solo cuenta como lista explícita si es un array.

export function puedeVerCaja(caja, currentUser) {
  if (!caja || !currentUser) return false;
  if (currentUser.rol === 'Admin') return true;
  // 1) Es el responsable de la caja.
  if (caja.usuarioId && currentUser.email && caja.usuarioId === currentUser.email) return true;
  // 2) Se la asignaron explícitamente.
  const cv = currentUser.cajasVisibles;
  return Array.isArray(cv) && cv.includes(caja.id);
}

// Subconjunto de cajas visibles para el usuario (mantiene el orden original).
export function cajasDelUsuario(cajas, currentUser) {
  if (!Array.isArray(cajas)) return [];
  if (currentUser?.rol === 'Admin') return cajas;
  return cajas.filter(c => puedeVerCaja(c, currentUser));
}

// IDs de las cajas visibles — para filtrar movimientos/cheques por cajaId.
export function idsCajasDelUsuario(cajas, currentUser) {
  return cajasDelUsuario(cajas, currentUser).map(c => c.id);
}
