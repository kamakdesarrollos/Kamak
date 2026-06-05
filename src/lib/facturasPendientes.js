// Cuentas por pagar — helpers PUROS para facturas de proveedor pendientes de pago.
// ⚠️ MANTENER SINCRONIZADO con la copia inline del bot en api/whatsapp/webhook.js
//    (saldoFacturaPendienteBot / estadoFacturaPendienteBot / matchFacturasPorPagoBot).
//    El bot corre en Node sin imports de src/, por eso replica esta lógica.
// La factura pendiente vive en shared_data['proveedores'].facturasPendientes[].
// Lleva los datos fiscales (comprobanteRecibido) → cuenta para Libro IVA desde su
// fecha (devengado, aunque no esté paga). El PAGO es un movimiento de caja aparte,
// linkeado por movimiento.facturaPendienteId, y NO lleva comprobanteRecibido (no
// se duplica el IVA). Soporta pagos parciales: pagos:[{movimientoId,monto,fecha,cajaId}].

const norm = s => (s || '').toString().toLowerCase().trim();

// Saldo pendiente = monto - Σ pagos (nunca negativo).
export function saldoFacturaPendiente(f) {
  if (!f) return 0;
  const pagado = (f.pagos || []).reduce((s, p) => s + (Number(p.monto) || 0), 0);
  return Math.max(0, (Number(f.monto) || 0) - pagado);
}

// Estado DERIVADO de los pagos (fuente de verdad). 'anulada' es el único estado
// que se guarda y no se deriva.
export function estadoFacturaPendiente(f) {
  if (!f) return 'pendiente';
  if (f.estado === 'anulada') return 'anulada';
  const saldo = saldoFacturaPendiente(f);
  const pagado = (Number(f.monto) || 0) - saldo;
  if (saldo <= 1) return 'pagada';
  if (pagado > 0) return 'parcial';
  return 'pendiente';
}

const _esAbierta = f => { const e = estadoFacturaPendiente(f); return e === 'pendiente' || e === 'parcial'; };

const _matcheaProveedor = (f, proveedorId, nombreN) =>
  f.proveedorId ? f.proveedorId === proveedorId : (f.proveedor && norm(f.proveedor) === nombreN);

// Facturas de un proveedor. Por defecto solo las abiertas (pendiente/parcial).
export function facturasPendientesDeProveedor(facturas, prov, { soloAbiertas = true } = {}) {
  if (!prov) return [];
  const nombreN = norm(prov.nombre);
  return (facturas || []).filter(f =>
    _matcheaProveedor(f, prov.id, nombreN) && (!soloAbiertas || _esAbierta(f))
  );
}

// Matching pago→factura: facturas ABIERTAS del proveedor cuyo SALDO ≈ monto del
// pago (tolerancia = máx(tolerancia fija, ±0,5%)). Ordenadas por cercanía. Lo usa
// el bot: 1 resultado → confirmar; >1 → listar; 0 → pago normal.
export function matchFacturasPorPago(facturas, { proveedorId, proveedor, monto, tolerancia = 0 }) {
  const m = Number(monto) || 0;
  const nombreN = norm(proveedor);
  const tol = Math.max(tolerancia, Math.round(m * 0.005));
  return (facturas || [])
    .filter(f => _esAbierta(f) && _matcheaProveedor(f, proveedorId, nombreN) && Math.abs(saldoFacturaPendiente(f) - m) <= tol)
    .map(f => ({ f, diff: Math.abs(saldoFacturaPendiente(f) - m) }))
    .sort((a, b) => a.diff - b.diff)
    .map(x => x.f);
}

// Aplica un pago → nueva factura inmutable con el pago agregado + estado/saldo
// recalculados. `pago` = { movimientoId, monto, fecha, cajaId }.
export function aplicarPagoAFactura(f, pago) {
  const next = { ...f, pagos: [...(f.pagos || []), pago] };
  next.saldoPendiente = saldoFacturaPendiente(next);
  next.estado = estadoFacturaPendiente(next);
  return next;
}

// Total adeudado (suma de saldos de las facturas abiertas). Para KPIs.
export function totalPendiente(facturas) {
  return (facturas || []).reduce((s, f) => _esAbierta(f) ? s + saldoFacturaPendiente(f) : s, 0);
}
