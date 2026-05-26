// Helpers matematicos compartidos por las distintas tabs de ObraPresupuesto.
// Antes estaban inline dentro de ObraPresupuesto.jsx (3700+ lineas), lo que
// dificultaba reutilizacion y testeo. Aca son funciones puras, testables
// individualmente (ver helpers.test.js).

/**
 * Devuelve el monto de una cuota convertido a la moneda activa.
 * - Si la cuota tiene flag _usd (cuota nativa USD), se respeta tal cual.
 * - Si la moneda activa coincide con la de la cuota, se respeta tal cual.
 * - Sino se convierte usando el tipo de cambio `tc`.
 */
export const cuotaMontoFn = (c, moneda, tc) =>
  (c._usd || moneda !== 'USD') ? (c.monto || 0) : Math.round((c.monto || 0) / tc);

/**
 * Suma todos los pagos de una cuota, convertidos a la moneda activa.
 * Cada pago puede estar en moneda distinta (ARS/USD) — usa su propio TC si lo
 * tiene, sino el TC vigente.
 */
export const cuotaCobrado = (c, moneda, tc) =>
  (c.pagos || []).reduce((s, p) => {
    if (moneda === 'USD') return s + (p.moneda === 'ARS' ? Math.round((p.monto || 0) / (p.tc || tc)) : (p.monto || 0));
    return s + (p.moneda === 'USD' ? Math.round((p.monto || 0) * (p.tc || tc)) : (p.monto || 0));
  }, 0);

/**
 * Estado calculado de la cuota a partir de sus pagos.
 * - 'pendiente' si nada cobrado
 * - 'pagado' si cubierto al 100%
 * - 'parcial' si cobro parcial
 */
export const cuotaEstadoCalc = (c, moneda, tc) => {
  const cobrado = cuotaCobrado(c, moneda, tc);
  if (cobrado <= 0) return 'pendiente';
  if (cobrado >= cuotaMontoFn(c, moneda, tc)) return 'pagado';
  return 'parcial';
};

/**
 * Precio de venta unitario de una tarea, considerando margenes por linea
 * o por rubro (mat / mano de obra).
 */
export const tareaVentaUnit = (t, rubro) => {
  const costoUnit = t.costoMat + (t.costoSub || 0);
  if (t.margenLinea != null) return costoUnit * (1 + t.margenLinea / 100);
  return t.costoMat * (1 + rubro.margenMat / 100) + (t.costoSub || 0) * (1 + rubro.margenMO / 100);
};

/**
 * Calcula totales (costo, venta, margen, avance) de un rubro a partir de sus
 * tareas. Las "secciones" (separadores visuales) se excluyen del calculo.
 */
export const calcRubro = (rubro) => {
  const tareas = (rubro.tareas || []).filter(t => t.tipo !== 'seccion');
  let cMat = 0, cSub = 0, venta = 0;
  for (const t of tareas) {
    cMat += t.costoMat * t.cantidad;
    cSub += (t.costoSub || 0) * t.cantidad;
    venta += tareaVentaUnit(t, rubro) * t.cantidad;
  }
  const costo = cMat + cSub;
  const margen = venta > 0 ? Math.round((venta - costo) / venta * 100) : 0;
  const avance = tareas.length > 0 ? Math.round(tareas.reduce((s, t) => s + t.avance, 0) / tareas.length) : 0;
  return { cMat, cSub, costo, venta, margen, avance };
};

/**
 * Calcula totales de toda la obra sumando todos sus rubros.
 * Devuelve los rubros con su info pre-calculada anexada.
 */
export const calcObra = (rubros) => {
  const rr = rubros.map(r => ({ ...r, ...calcRubro(r) }));
  const costo = rr.reduce((s, r) => s + r.costo, 0);
  const venta = rr.reduce((s, r) => s + r.venta, 0);
  const cMat = rr.reduce((s, r) => s + r.cMat, 0);
  const cSub = rr.reduce((s, r) => s + r.cSub, 0);
  const margen = venta > 0 ? Math.round((venta - costo) / venta * 100) : 0;
  return { costo, venta, cMat, cSub, margen, rubros: rr };
};

/**
 * Suma la cantidad ya contratada de una tarea, sumando los contratos
 * activos que la incluyen.
 */
export const calcTareaContratada = (tareaId, contratos) =>
  contratos
    .filter(c => c.estado !== 'anulado' && Array.isArray(c.tareas))
    .flatMap(c => c.tareas)
    .filter(t => t.tareaId === tareaId)
    .reduce((s, t) => s + (t.cantidadContratada || 0), 0);
