import { describe, it, expect } from 'vitest';
import { saldoFacturaPendienteBot, estadoFacturaPendienteBot } from '../../api/whatsapp/webhook.js';
import { saldoFacturaPendiente, estadoFacturaPendiente } from './facturasPendientes';
import { saldoProveedorCC } from './proveedorCC';

// El bot (api/, self-contained en Node sin imports de src/) DUPLICA la lógica de
// saldo/estado de facturas y la CC del proveedor. La sesión pasada un desfasaje
// generó un bug crítico. Estos tests fuerzan que el bot y la app NO diverjan en
// los caminos de dinero: si alguien edita una copia y no la otra, fallan.

const FACTURAS = [
  { id: 'a', monto: 100000, pagos: [] },                                          // pendiente
  { id: 'b', monto: 100000, pagos: [{ monto: 40000 }] },                          // parcial
  { id: 'c', monto: 100000, pagos: [{ monto: 100000 }] },                         // pagada
  { id: 'd', monto: 100000, pagos: [{ monto: 99999.5 }] },                        // pagada (tolerancia $1)
  { id: 'e', monto: 100000, pagos: [{ monto: 40000 }, { monto: 30000 }] },        // parcial (multi-pago)
  { id: 'f', monto: 100000, pagos: [{ monto: 40000 }, { monto: 20000, tipo: 'credito' }] }, // parcial con crédito
  { id: 'g', monto: 100000, pagos: [], estado: 'anulada' },                       // anulada
  { id: 'h', monto: 100000, pagos: [], estado: 'registrada' },                    // solo fiscal
  { id: 'i', monto: 0, pagos: [] },                                               // monto inválido
  { id: 'j', monto: 100000, pagos: [{ monto: '50000' }] },                        // pago string
];

describe('paridad bot↔app — saldo y estado de facturas', () => {
  for (const f of FACTURAS) {
    it(`factura "${f.id}" → mismo saldo y estado en bot y app`, () => {
      expect(saldoFacturaPendienteBot(f)).toBe(saldoFacturaPendiente(f));
      expect(estadoFacturaPendienteBot(f)).toBe(estadoFacturaPendiente(f));
    });
  }
});

// Réplica EXACTA de la fórmula de CC del bot (webhook.js cc_proveedor) para
// verificar que produce el MISMO saldo que la app (src/lib/proveedorCC). Si el
// bot y la app calculan la deuda distinto, un director ve un número por chat y
// otro por pantalla — el bug que estamos cerrando.
function ccProveedorBot(prov, facturas, movimientos, ccEntries) {
  const facturasProv = (facturas || []).filter(f => {
    const esDelProv = f.proveedorId ? f.proveedorId === prov.id
      : (f.proveedor || '').toLowerCase().trim() === (prov.nombre || '').toLowerCase().trim();
    if (!esDelProv) return false;
    const e = estadoFacturaPendienteBot(f);
    return e !== 'anulada' && e !== 'registrada';
  });
  const deudaFacturas = facturasProv.reduce((s, f) => s + saldoFacturaPendienteBot(f), 0);
  const deudaLegacy = (ccEntries || []).filter(e => e.proveedorId === prov.id).reduce((s, e) => s + (e.debe || 0) - (e.haber || 0), 0);
  const anticipado = (movimientos || []).filter(m => m.tipo === 'gasto' && m.anticipo === true && (m.proveedorId === prov.id || (m.proveedor || '').toLowerCase().trim() === (prov.nombre || '').toLowerCase().trim())).reduce((s, m) => s + (m.monto || 0), 0);
  const aplicado = facturasProv.flatMap(f => (f.pagos || []).filter(p => p.tipo === 'credito')).reduce((s, p) => s + (Number(p.monto) || 0), 0);
  const credito = Math.max(0, Math.round(anticipado - aplicado));
  return Math.round(deudaFacturas + deudaLegacy) - credito;
}

describe('paridad bot↔app — saldo de CC del proveedor (con crédito)', () => {
  const PROV = { id: 'pv-1', nombre: 'Corralón' };
  // ctx.cajas ARS: la app usa montoEnARS; los anticipos son ARS → montos iguales.
  const APPCTX = { cajas: [{ id: 'banco', moneda: 'ARS' }], tc: 1000 };
  const anticipo = (over) => ({ tipo: 'gasto', anticipo: true, proveedorId: 'pv-1', proveedor: 'Corralón', cajaId: 'banco', monto: 50000, ...over });
  const factura = (over) => ({ proveedorId: 'pv-1', proveedor: 'Corralón', monto: 100000, pagos: [], estado: 'pendiente', ...over });

  const ESCENARIOS = [
    { nombre: 'solo deuda', facturas: [factura()], movs: [], cc: [] },
    { nombre: 'deuda parcial', facturas: [factura({ pagos: [{ monto: 30000 }] })], movs: [], cc: [] },
    { nombre: 'a favor (anticipo sin deuda)', facturas: [], movs: [anticipo()], cc: [] },
    { nombre: 'deuda − crédito', facturas: [factura({ monto: 80000 })], movs: [anticipo()], cc: [] },
    { nombre: 'crédito aplicado', facturas: [factura({ pagos: [{ monto: 20000, tipo: 'credito' }] })], movs: [anticipo()], cc: [] },
    { nombre: 'gasto directo NO genera crédito', facturas: [], movs: [anticipo({ anticipo: undefined })], cc: [] },
    { nombre: 'con ccEntries legacy', facturas: [factura()], movs: [], cc: [{ proveedorId: 'pv-1', debe: 50000, haber: 20000 }] },
    { nombre: 'anulada/registrada no son deuda', facturas: [factura({ id: 'x', estado: 'anulada' }), factura({ id: 'y', estado: 'registrada' })], movs: [], cc: [] },
  ];

  for (const s of ESCENARIOS) {
    it(`"${s.nombre}" → bot y app dan el mismo saldo`, () => {
      const app = saldoProveedorCC(PROV, s.facturas, s.movs, s.cc, APPCTX).saldo;
      const bot = ccProveedorBot(PROV, s.facturas, s.movs, s.cc);
      expect(bot).toBe(app);
    });
  }
});
