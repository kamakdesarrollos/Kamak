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
 * Total al cliente en USD (la DEUDA del cliente).
 *
 * En Kamak la venta SIEMPRE es en dólares: el cliente debe y paga en USD, así que
 * su deuda es un número FIJO en dólares y NO debe moverse con el tipo de cambio.
 * Si la obra tiene cargado un precio de venta fijo (`detalle.precioVentaUSD`), se
 * usa tal cual. Si no, se cae al cálculo histórico: presupuesto en pesos
 * (venta + adicionales + interés) ÷ tc — que SÍ varía con el dólar, por eso es solo
 * el fallback para obras viejas sin precio fijo cargado.
 */
export const calcTotalClienteUSD = (detalle, ventaBaseARS, adicionalARS, interes, tc) => {
  const fijo = detalle && detalle.precioVentaUSD;
  if (fijo != null && fijo !== '' && Number.isFinite(Number(fijo)) && Number(fijo) > 0) {
    return Math.round(Number(fijo));
  }
  const totalARS = Math.round(((ventaBaseARS || 0) + (adicionalARS || 0)) * (1 + (interes || 0) / 100));
  return arsToUSD(totalARS, tc);
};

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
 * Historial de cobros al cliente de una obra (en USD), derivado de los
 * movimientos de ingreso (única fuente). Cada item: { id, fecha, monto (USD),
 * concepto, cajaNombre }. Ordenado por fecha. Es el "detalle de pagos" real.
 */
export const ingresosObraUSD = (movimientos, cajas, obraId, tc) =>
  (movimientos || [])
    .filter(m => m.obraId === obraId && m.tipo === 'ingreso')
    .map(m => {
      const caja = (cajas || []).find(c => c.id === m.cajaId);
      const monto = m.montoDolar
        ? Math.round(m.montoDolar)
        : (caja?.moneda === 'USD' ? Math.round(m.monto || 0) : Math.round((m.monto || 0) / (tc || 1)));
      return { id: m.id, fecha: m.fecha, monto, concepto: m.concepto || m.descripcion || 'Cobro', cajaNombre: caja?.nombre || '' };
    })
    .sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));

/**
 * Reparte el historial de cobros (ingresosObraUSD) sobre las cuotas EN ORDEN,
 * estilo cascada: cada cobro llena la cuota actual y desborda a la siguiente.
 * Devuelve { [cuotaId]: { cobrado, pagos: [{fecha, monto, concepto, cajaNombre}],
 * fechaPagada } }. El reparto del campo `cobrado` coincide exactamente con
 * repartirCobroEnCuotas; este helper agrega además el detalle (de dónde salió
 * cada parte y cuándo quedó saldada), todo derivado de movimientos.
 * Respeta las cuotas marcadas pagadas a mano (estado 'pagado' sin pagos): se
 * cuentan saldadas, sin consumir cobros y sin fecha de movimiento.
 */
export const detallePagosCuotas = (cuotas, ingresosUSD, obraMoneda, tc) => {
  const ing = [...(ingresosUSD || [])];
  const out = {};
  let idx = 0;
  let restante = ing[idx] ? ing[idx].monto : 0;
  for (const c of (cuotas || [])) {
    const montoC = cuotaMontoUSD(c, obraMoneda || 'ARS', tc);
    if (c.estado === 'pagado' && !((c.pagos || []).length)) {
      out[c.id] = { cobrado: montoC, pagos: [], fechaPagada: null, manual: true };
      continue;
    }
    let llenado = 0;
    const pagos = [];
    while (idx < ing.length && llenado < montoC) {
      if (restante <= 0) { idx++; restante = ing[idx] ? ing[idx].monto : 0; continue; }
      const aplicar = Math.min(restante, montoC - llenado);
      pagos.push({ fecha: ing[idx].fecha, monto: aplicar, concepto: ing[idx].concepto, cajaNombre: ing[idx].cajaNombre });
      llenado += aplicar;
      restante -= aplicar;
    }
    out[c.id] = {
      cobrado: llenado,
      pagos,
      fechaPagada: (llenado >= montoC && montoC > 0 && pagos.length) ? pagos[pagos.length - 1].fecha : null,
    };
  }
  return out;
};

/**
 * Precio de venta unitario de una tarea, considerando margenes por linea
 * o por rubro (mat / mano de obra).
 */
export const tareaVentaUnit = (t, rubro) => {
  // "Materiales a cargo del comprador": no se cobran los materiales del rubro
  // (el cliente los compra), solo la mano de obra / subcontrato.
  const mat = rubro.materialesACargoComprador ? 0 : t.costoMat;
  const sub = t.costoSub || 0;
  const costoUnit = mat + sub;
  if (t.margenLinea != null) return costoUnit * (1 + t.margenLinea / 100);
  return mat * (1 + rubro.margenMat / 100) + sub * (1 + rubro.margenMO / 100);
};

/**
 * Calcula totales (costo, venta, margen, avance) de un rubro a partir de sus
 * tareas. Las "secciones" (separadores visuales) se excluyen del calculo.
 */
export const calcRubro = (rubro) => {
  // Si los materiales van a cargo del comprador, NO los contamos como costo
  // nuestro (el cliente los compra) — solo la mano de obra.
  const sinMat = !!rubro.materialesACargoComprador;
  const tareas = (rubro.tareas || []).filter(t => t.tipo !== 'seccion');
  let cMat = 0, cSub = 0, venta = 0;
  for (const t of tareas) {
    cMat += (sinMat ? 0 : t.costoMat) * t.cantidad;
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
 * Gasto real de la obra agrupado por rubro. Matchea cada gasto por rubroId si lo
 * tiene (más robusto ante renombres), sino por rubroNombre. Lo no imputado a
 * ningún rubro se acumula en `sinRubro`. Devuelve { porRubroId, porNombre, sinRubro }.
 */
export const gastadoPorRubro = (movsObra) => {
  const porRubroId = {}, porNombre = {};
  let sinRubro = 0;
  for (const m of (movsObra || [])) {
    if (m.tipo !== 'gasto') continue;
    const monto = m.monto || 0;
    if (m.rubroId) porRubroId[m.rubroId] = (porRubroId[m.rubroId] || 0) + monto;
    else if (m.rubroNombre) porNombre[m.rubroNombre] = (porNombre[m.rubroNombre] || 0) + monto;
    else sinRubro += monto;
  }
  return { porRubroId, porNombre, sinRubro };
};

/**
 * Gasto real imputado a UN rubro del presupuesto (suma los gastos vinculados por
 * id y por nombre a ese rubro). `mapa` es el resultado de gastadoPorRubro().
 */
export const gastadoDeRubro = (rubro, mapa) =>
  (mapa.porRubroId[rubro.id] || 0) + (mapa.porNombre[rubro.nombre] || 0);

/**
 * Desvío presupuesto-vs-real de un rubro: costo presupuestado (calcRubro) contra
 * el gastado real imputado. desvio>0 = sobrecosto. `pct` = % del presupuesto consumido.
 */
export const desvioRubro = (rubro, mapa) => {
  const { costo } = calcRubro(rubro);
  const gastado = gastadoDeRubro(rubro, mapa);
  const desvio = gastado - costo;
  const pct = costo > 0 ? Math.round((gastado / costo) * 100) : (gastado > 0 ? null : 0);
  return { costo, gastado, desvio, pct };
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
