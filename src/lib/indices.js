// Redeterminación de precios por índice (CAC u otro). FUNCIONES PURAS Y TESTEADAS.
//
// El Índice CAC lo publica mensualmente la Cámara Argentina de la Construcción
// (camarco.org.ar) el día 25, con dos sub-índices: materiales y mano de obra
// (UOCRA), más un general. NO hay API oficial: el valor mensual se carga a mano.
//
// Decisión de diseño: la redeterminación usa valores GUARDADOS (no un scrape en
// vivo) para que un recálculo histórico siempre dé igual y sea auditable ante un
// reclamo del cliente. Fórmula: monto_redeterminado = monto × (índice_actual / índice_base).

// Tipos de índice soportados.
export const INDICES_TIPO = [
  { id: 'cacGeneral',    nombre: 'CAC General' },
  { id: 'cacMateriales', nombre: 'CAC Materiales' },
  { id: 'cacManoObra',   nombre: 'CAC Mano de Obra' },
];

export const getIndiceTipo = (id) => INDICES_TIPO.find(t => t.id === id) || null;

// Factor de redeterminación entre dos valores de índice (base → actual).
// Devuelve 1 (sin ajuste) si falta algún valor o la base no es positiva.
export function factorRedeterminacion(valorBase, valorActual) {
  const b = Number(valorBase) || 0;
  const a = Number(valorActual) || 0;
  if (b <= 0 || a <= 0) return 1;
  return a / b;
}

// Redetermina un monto del período base al período actual según el índice.
export function redeterminar(monto, valorBase, valorActual) {
  return Math.round((Number(monto) || 0) * factorRedeterminacion(valorBase, valorActual));
}

// Lee el valor de un índice (tipo) para un mes 'YYYY-MM' del mapa de índices.
export function valorIndice(indices, mes, tipo = 'cacGeneral') {
  return Number(indices?.[mes]?.[tipo]) || 0;
}

// Variación porcentual (1 decimal) entre dos meses para un tipo de índice.
// null si falta data en alguno de los dos meses.
export function variacionPct(indices, mesBase, mesActual, tipo = 'cacGeneral') {
  const b = valorIndice(indices, mesBase, tipo);
  const a = valorIndice(indices, mesActual, tipo);
  if (b <= 0 || a <= 0) return null;
  return Math.round((a / b - 1) * 1000) / 10;
}
