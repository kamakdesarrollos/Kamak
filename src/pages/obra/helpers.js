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
 * Devuelve el monto de la cuota en USD para display al cliente.
 * Asume que el monto esta en la moneda de la obra (o tiene flag _usd).
 * - Si la obra es USD o c._usd: el monto ya esta en USD, no convertir.
 * - Si la obra es ARS: convertir dividiendo por tc.
 *
 * Esta funcion existe porque toda la "venta al cliente" en Kamak se cotiza
 * en USD, sin importar la moneda de la obra. Las compras a proveedores
 * quedan en pesos para el admin, pero el cliente siempre ve USD.
 */
export const cuotaMontoUSD = (c, obraMoneda, tc) => {
  const monto = c.monto || 0;
  const esUSD = obraMoneda === 'USD' || !!c._usd;
  return Math.round(esUSD ? monto : monto / tc);
};

/**
 * Convierte un monto en ARS (costos del presupuesto) a USD para display.
 */
export const arsToUSD = (montoARS, tc) => Math.round((montoARS || 0) / (tc || 1));

/**
 * Suma todos los pagos de una cuota, convertidos a la moneda activa.
 * Cada pago puede estar en moneda distinta (ARS/USD) — usa su propio TC si lo
 * tiene, sino el TC vigente.
 *
 * Caso especial (cuotas sin pagos): una cuota puede estar marcada como
 * 'pagado' con el toggle manual o venir de datos legacy SIN un pago
 * registrado. En ese caso contamos su monto completo como cobrado, para que
 * el importe coincida con el estado y no quede saldo fantasma. Esta es la
 * UNICA fuente de verdad de "cuánto se cobró" en toda la app.
 */
export const cuotaCobrado = (c, moneda, tc) => {
  const pagos = c.pagos || [];
  if (pagos.length === 0) return c.estado === 'pagado' ? cuotaMontoFn(c, moneda, tc) : 0;
  return pagos.reduce((s, p) => {
    if (moneda === 'USD') return s + (p.moneda === 'ARS' ? Math.round((p.monto || 0) / (p.tc || tc)) : (p.monto || 0));
    return s + (p.moneda === 'USD' ? Math.round((p.monto || 0) * (p.tc || tc)) : (p.monto || 0));
  }, 0);
};

/**
 * Estado calculado de la cuota. UNICA fuente de verdad de "¿está pagada?" en
 * toda la app (portal, admin, dashboard, reportes) — usala siempre en vez de
 * leer c.estado directo.
 * - Si NO tiene pagos registrados: respeta el estado guardado (toggle manual
 *   o legacy).
 * - Si tiene pagos: deriva del cobrado real vs el monto.
 *   - 'pendiente' si nada cobrado
 *   - 'pagado' si cubierto al 100%
 *   - 'parcial' si cobro parcial
 */
export const cuotaEstadoCalc = (c, moneda, tc) => {
  const pagos = c.pagos || [];
  if (pagos.length === 0) {
    if (c.estado === 'pagado') return 'pagado';
    if (c.estado === 'parcial') return 'parcial';
    return 'pendiente';
  }
  const cobrado = cuotaCobrado(c, moneda, tc);
  if (cobrado <= 0) return 'pendiente';
  if (cobrado >= cuotaMontoFn(c, moneda, tc)) return 'pagado';
  return 'parcial';
};

/**
 * Total cobrado al cliente de una obra, en USD, DERIVADO de los movimientos de
 * ingreso (única fuente de verdad, rediseño "libro único"). Convierte cada
 * ingreso a USD: si tiene montoDolar (ingreso cargado con ref USD) lo usa; sino
 * mira la moneda de la caja (USD → tal cual; ARS → dividido por el tc).
 */
export const cobradoObraUSD = (movimientos, cajas, obraId, tc) =>
  (movimientos || [])
    .filter(m => m.obraId === obraId && m.tipo === 'ingreso')
    .reduce((s, m) => {
      if (m.montoDolar) return s + Math.round(m.montoDolar);
      const caja = (cajas || []).find(c => c.id === m.cajaId);
      const esUSD = caja?.moneda === 'USD';
      return s + (esUSD ? Math.round(m.monto || 0) : Math.round((m.monto || 0) / (tc || 1)));
    }, 0);

/**
 * Reparte el total cobrado de la obra (en USD, derivado de movimientos) sobre
 * las cuotas EN ORDEN (primero el adelanto). Devuelve { [cuotaId]: cobradoUSD }.
 * Las cuotas marcadas pagadas a mano (estado 'pagado' sin pagos registrados) se
 * consideran pagas aparte y NO consumen del total de movimientos (se pagaron
 * por otro medio no registrado como movimiento).
 */
export const repartirCobroEnCuotas = (cuotas, cobradoTotalUSD, obraMoneda, tc) => {
  let restante = Math.max(0, Math.round(cobradoTotalUSD || 0));
  const out = {};
  for (const c of (cuotas || [])) {
    const montoC = cuotaMontoUSD(c, obraMoneda || 'ARS', tc);
    if (c.estado === 'pagado' && !((c.pagos || []).length)) { out[c.id] = montoC; continue; }
    const aplicado = Math.min(montoC, restante);
    out[c.id] = aplicado;
    restante -= aplicado;
  }
  return out;
};

/**
 * Estado de una cuota a partir del cobrado ya repartido (USD). Reemplaza a
 * cuotaEstadoCalc cuando el cobrado se deriva de movimientos.
 */
export const cuotaEstadoDesdeCobrado = (c, cobradoUSD, obraMoneda, tc) => {
  const montoC = cuotaMontoUSD(c, obraMoneda || 'ARS', tc);
  if ((cobradoUSD || 0) <= 0) return 'pendiente';
  if ((cobradoUSD || 0) >= montoC) return 'pagado';
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
