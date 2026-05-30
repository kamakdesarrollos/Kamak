// Saldo de caja derivado (rediseño "libro único"). FUNCIONES PURAS Y TESTEADAS
// (ver caja.test.js): de acá sale CUÁNTO descuenta o suma cada movimiento a una
// caja, así que un error de signo o de monto desbalancea todas las cajas. Vivían
// inline en MovimientosContext; se extrajeron para poder testear la invariante
// crítica: un gasto descuenta el TOTAL (no el neto), una NC solo-fiscal no toca
// caja, y una NC con devolución suma como crédito.

// Efecto (con signo) de un movimiento sobre una caja concreta.
// Replica EXACTAMENTE los signos del viejo applyEfectoEnCajas.
export function efectoEnCaja(m, cajaId) {
  if (m.tipo === 'ingreso' && m.cajaId === cajaId) return (m.monto || 0);
  if (m.tipo === 'gasto'   && m.cajaId === cajaId) return -(m.monto || 0);
  if (m.tipo === 'traspaso') {
    if (m.cajaId === cajaId)        return -(m.monto || 0);
    if (m.cajaDestinoId === cajaId) return (m.montoDestino ?? m.monto ?? 0);
  }
  // Nota de crédito de proveedor: por defecto es solo un ajuste fiscal (Libro IVA)
  // y NO mueve caja. Solo suma a la caja si el admin marcó que el proveedor
  // devolvió plata (afectaCaja) — entra como crédito, igual que un ingreso.
  if (m.tipo === 'nota_credito_compra' && m.afectaCaja && m.cajaId === cajaId) return (m.monto || 0);
  return 0; // endoso, NC solo-fiscal y otros tipos no mueven saldo
}

// Saldo actual de una caja = saldoInicial + suma del efecto de TODOS sus movimientos.
export function calcSaldoCaja(caja, movimientos) {
  const efecto = (movimientos || []).reduce((s, m) => s + efectoEnCaja(m, caja.id), 0);
  return Math.round((caja.saldoInicial || 0) + efecto);
}
