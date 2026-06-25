// Lógica pura para los avisos por TIEMPO del cron (sin red, sin estado): qué
// cheque / orden de pago está por vencer hoy, dado un umbral de días. La usa
// runReminders (api/whatsapp/jobs.js) para decidir a quién notificar. Testeable.

// Días enteros desde `hoy` hasta `fecha` (ambos 'YYYY-MM-DD' o ISO completos; se
// recorta a la fecha). null si falta o es inválida. UTC para no depender de TZ.
export function diasHasta(fecha, hoy) {
  if (!fecha || !hoy) return null;
  const a = new Date(`${String(hoy).slice(0, 10)}T00:00:00Z`);
  const b = new Date(`${String(fecha).slice(0, 10)}T00:00:00Z`);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function fmtDDMM(iso) {
  const s = String(iso).slice(0, 10).split('-');
  return s.length === 3 ? `${s[2]}/${s[1]}` : String(iso);
}

const fmtMonto = (n) => `$${Math.round(n || 0).toLocaleString('es-AR')}`;

// Cheques EN CARTERA cuyo vencimiento cae en [0, dias] (incluye hoy). Devuelve
// { id, d, fechaVto, detalle } para cada uno (el detalle alimenta el título de la
// notif). No incluye vencidos (d < 0) — esos ya son otro problema, no "por vencer".
export function chequesPorVencer(cheques, hoy, { dias = 7 } = {}) {
  return (cheques || [])
    .filter((c) => c && c.estado === 'cartera' && c.fechaVencimiento)
    .map((c) => ({ c, d: diasHasta(c.fechaVencimiento, hoy) }))
    .filter(({ d }) => d !== null && d >= 0 && d <= dias)
    .map(({ c, d }) => ({
      id: c.id,
      d,
      fechaVto: String(c.fechaVencimiento).slice(0, 10),
      detalle: `${c.banco || 'Cheque'} #${c.numero || '—'} · ${fmtMonto(c.monto)} · vence ${fmtDDMM(c.fechaVencimiento)}`,
    }));
}

// Órdenes de pago (facturas pendientes) ABIERTAS con fechaVencimiento en [0, dias].
// `abierta(f)` decide si la factura sigue adeudada (default: no anulada/registrada/
// pagada). runReminders puede pasar el predicado real (estadoFacturaPendiente).
export function cuentasPorVencer(facturas, hoy, { dias = 3, abierta } = {}) {
  const esAbierta = abierta || ((f) => f.estado !== 'anulada' && f.estado !== 'registrada' && f.estado !== 'pagada');
  return (facturas || [])
    .filter((f) => f && f.fechaVencimiento && esAbierta(f))
    .map((f) => ({ f, d: diasHasta(f.fechaVencimiento, hoy) }))
    .filter(({ d }) => d !== null && d >= 0 && d <= dias)
    .map(({ f, d }) => ({
      id: f.id,
      d,
      fechaVto: String(f.fechaVencimiento).slice(0, 10),
      detalle: `${f.proveedor || 'Proveedor'} · ${fmtMonto(f.monto)}${f.numero ? ` · N° ${f.numero}` : ''} · vence ${fmtDDMM(f.fechaVencimiento)}`,
    }));
}
