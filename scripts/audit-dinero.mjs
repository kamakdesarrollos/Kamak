// Auditoría READ-ONLY de invariantes contables sobre los datos reales de Kamak.
// SOLO hace GET a PostgREST — jamás escribe. Replica la lógica pura de
// src/lib/caja.js y src/lib/facturasPendientes.js para validar consistencia.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KAMAK = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '_audit-dinero-resultado.json');

// ── env ──────────────────────────────────────────────────────────────────────
const env = {};
for (const line of readFileSync(resolve(KAMAK, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const URL_ = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_KEY;
if (!URL_ || !KEY) { console.error('Faltan SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }

async function fetchKey(key) {
  const r = await fetch(`${URL_}/rest/v1/shared_data?key=eq.${key}&select=data`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }, // GET only
  });
  if (!r.ok) throw new Error(`${key}: HTTP ${r.status}`);
  const rows = await r.json();
  return rows[0]?.data ?? null;
}

// ── réplicas de lógica pura (src/lib/caja.js) ───────────────────────────────
function efectoEnCaja(m, cajaId) {
  if (m.tipo === 'ingreso' && m.cajaId === cajaId) return (m.monto || 0);
  if (m.tipo === 'gasto' && m.cajaId === cajaId) return -(m.monto || 0);
  if (m.tipo === 'traspaso') {
    if (m.cajaId === cajaId) return -(m.monto || 0);
    if (m.cajaDestinoId === cajaId) return (m.montoDestino ?? m.monto ?? 0);
  }
  if (m.tipo === 'nota_credito_compra' && m.afectaCaja && m.cajaId === cajaId) return (m.monto || 0);
  return 0;
}
const calcSaldo = (caja, movs) => Math.round((caja.saldoInicial || 0) + movs.reduce((s, m) => s + efectoEnCaja(m, caja.id), 0));
// src/lib/facturasPendientes.js
const saldoFactura = (f) => Math.max(0, (Number(f.monto) || 0) - (f.pagos || []).reduce((s, p) => s + (Number(p.monto) || 0), 0));
function estadoFactura(f) {
  if (f.estado === 'anulada') return 'anulada';
  if (f.estado === 'registrada') return 'registrada';
  const saldo = saldoFactura(f);
  const pagado = (Number(f.monto) || 0) - saldo;
  if (saldo <= 1) return 'pagada';
  if (pagado > 0) return 'parcial';
  return 'pendiente';
}

const findings = []; // {check, severidad, detalle, items}
const add = (check, severidad, detalle, items = []) => { if (items.length || detalle) findings.push({ check, severidad, detalle, n: items.length || undefined, items: items.slice(0, 25) }); };

const main = async () => {
  const [movData, provData, cheques, obrasData, gastosFijos] = await Promise.all([
    fetchKey('movimientos'), fetchKey('proveedores'), fetchKey('cheques'), fetchKey('obras'), fetchKey('gastos_fijos'),
  ]);
  const cajas = movData?.cajas || [];
  const movs = movData?.movimientos || [];
  const provs = provData?.proveedores || [];
  const cc = provData?.ccEntries || [];
  const facturas = provData?.facturasPendientes || [];
  const chqs = Array.isArray(cheques) ? cheques : [];
  const obras = obrasData?.obras || [];
  const detalles = obrasData?.detalles || {};

  const movById = new Map(movs.map(m => [m.id, m]));
  const cajaIds = new Set(cajas.map(c => c.id));
  const provIds = new Set(provs.map(p => p.id));
  const obraIds = new Set(obras.map(o => o.id));
  const facIds = new Set(facturas.map(f => f.id));

  // 0. Volumen general
  const resumen = {
    cajas: cajas.length, movimientos: movs.length, proveedores: provs.length,
    ccEntries: cc.length, facturasPendientes: facturas.length, cheques: chqs.length,
    obras: obras.length, detallesObras: Object.keys(detalles).length,
  };

  // 1. Semillas demo que hayan quedado en prod
  const seedMovIds = ['mv1','mv2','mv3','mv4','mv5','mv6','mv7','mv8','mv9'];
  const seedCajaIds = ['cj-pablo','cj-socio','cj-galicia','cj-mp','cj-bara','cj-pablo-u','cj-socio-u','cj-gal-u','cj-juan-r','cj-marcos-r'];
  const seedCcIds = ['cc1','cc2','cc3','cc4','cc5','cc6','cc7','cc8','cc9'];
  const seedProvIds = ['leandro','don-luis','easy','ariel','distri'];
  add('seeds-movimientos', 'alto', 'Movimientos DEMO en datos reales', movs.filter(m => seedMovIds.includes(m.id)).map(m => `${m.id} $${m.monto} ${m.descripcion}`));
  add('seeds-cajas', 'medio', 'Cajas DEMO en datos reales', cajas.filter(c => seedCajaIds.includes(c.id)).map(c => `${c.id} ${c.nombre} saldoInicial=${c.saldoInicial} activa=${c.activa}`));
  add('seeds-cc', 'alto', 'Asientos CC DEMO en datos reales', cc.filter(e => seedCcIds.includes(e.id)).map(e => `${e.id} ${e.tipo} debe=${e.debe} haber=${e.haber}`));
  add('seeds-proveedores', 'medio', 'Proveedores DEMO en datos reales', provs.filter(p => seedProvIds.includes(p.id)).map(p => `${p.id} ${p.nombre}`));

  // 2. Saldos: stored vs derivado
  const drift = [];
  for (const c of cajas) {
    const calc = calcSaldo(c, movs);
    const stored = Math.round(c.saldo ?? 0);
    if (c.saldoInicial == null) drift.push(`${c.id} ${c.nombre}: SIN saldoInicial (no migrada)`);
    else if (Math.abs(calc - stored) > 1) drift.push(`${c.id} ${c.nombre}: stored=${stored} derivado=${calc} drift=${stored - calc}`);
  }
  add('saldo-drift', 'critico', 'Saldo guardado ≠ saldo derivado (el guardado es vestigial pero lo lee el bot)', drift);

  // 3. Referencias de movimientos
  add('mov-caja-inexistente', 'critico', 'Movimientos que apuntan a caja inexistente', movs.filter(m => m.cajaId && !cajaIds.has(m.cajaId)).map(m => `${m.id} ${m.fecha} $${m.monto} caja=${m.cajaId} "${(m.descripcion||'').slice(0,40)}"`));
  add('traspaso-destino-inexistente', 'critico', 'Traspasos con caja destino inexistente', movs.filter(m => m.tipo === 'traspaso' && m.cajaDestinoId && !cajaIds.has(m.cajaDestinoId)).map(m => `${m.id} ${m.fecha} $${m.monto} destino=${m.cajaDestinoId}`));
  // Excepciones sancionadas (reglas de negocio 2026-07-03) a "movimiento sin
  // caja = bug": (1) ccPrevia (arrastre histórico de CC del cliente, excluido
  // de listados y saldos por diseño); (2) categoria 'prorrateo' (asiento
  // ANALÍTICO que reparte gastos fijos ya pagados con caja real — no toca
  // saldos y se excluye de los consolidados). Todo lo demás sin caja es bug.
  add('mov-sin-caja', 'alto', 'Movimientos sin caja (no afectan ningún saldo; excluye ccPrevia y prorrateo)', movs.filter(m => !m.cajaId && m.tipo !== 'nota_credito_compra' && !m.ccPrevia && m.categoria !== 'prorrateo').map(m => `${m.id} ${m.tipo} ${m.fecha} $${m.monto} "${(m.descripcion||'').slice(0,40)}"`));
  add('ccprevia-info', 'bajo', `Arrastres históricos ccPrevia sin caja (sancionado): ${movs.filter(m => !m.cajaId && m.ccPrevia).length}`, []);
  add('mov-obra-inexistente', 'medio', 'Movimientos imputados a obra inexistente', movs.filter(m => m.obraId && !obraIds.has(m.obraId)).map(m => `${m.id} ${m.fecha} $${m.monto} obra=${m.obraId}`));
  add('mov-monto-invalido', 'critico', 'Movimientos con monto no numérico / negativo / NaN', movs.filter(m => typeof m.monto !== 'number' || !isFinite(m.monto) || m.monto < 0).map(m => `${m.id} ${m.tipo} monto=${JSON.stringify(m.monto)}`));
  add('mov-duplicado-id', 'critico', 'IDs de movimiento duplicados', [...movs.reduce((acc, m) => acc.set(m.id, (acc.get(m.id) || 0) + 1), new Map())].filter(([, n]) => n > 1).map(([id, n]) => `${id} x${n}`));
  // Posibles pagos duplicados (mismo día+monto+proveedor+caja)
  const sig = new Map();
  for (const m of movs.filter(m => m.tipo === 'gasto' && m.monto > 0)) {
    const k = `${m.fecha}|${m.monto}|${(m.proveedor||'').toLowerCase().trim()}|${m.cajaId}`;
    sig.set(k, [...(sig.get(k) || []), m.id]);
  }
  add('gastos-posible-duplicado', 'alto', 'Gastos con misma fecha+monto+proveedor+caja (posible doble carga)', [...sig.entries()].filter(([k, ids]) => ids.length > 1 && k.split('|')[2]).map(([k, ids]) => `${k} → ${ids.join(', ')}`));

  // 4. Facturas pendientes
  add('factura-estado-drift', 'alto', 'Facturas con estado/saldo guardado ≠ derivado', facturas.filter(f => (f.saldoPendiente != null && Math.abs(f.saldoPendiente - (estadoFactura(f) === 'registrada' ? 0 : saldoFactura(f))) > 1) || (f.estado && !['anulada','registrada'].includes(f.estado) && f.estado !== estadoFactura(f))).map(f => `${f.id} ${f.numero || 's/n'} estado=${f.estado}/${estadoFactura(f)} saldo=${f.saldoPendiente}/${saldoFactura(f)}`));
  add('factura-sobrepago', 'alto', 'Facturas con pagos que EXCEDEN el monto (exceso invisible)', facturas.filter(f => (f.pagos || []).reduce((s, p) => s + (Number(p.monto) || 0), 0) > (Number(f.monto) || 0) + 1).map(f => `${f.id} ${f.numero || 's/n'} monto=${f.monto} pagado=${(f.pagos||[]).reduce((s,p)=>s+(+p.monto||0),0)}`));
  add('factura-pago-mov-roto', 'critico', 'Pagos de factura cuyo movimientoId NO existe en movimientos', facturas.flatMap(f => (f.pagos || []).filter(p => p.movimientoId && !movById.has(p.movimientoId)).map(p => `${f.id} ${f.numero || 's/n'} pago $${p.monto} mov=${p.movimientoId}`)));
  add('factura-pago-monto-distinto', 'alto', 'Pago de factura cuyo monto ≠ monto del movimiento vinculado', facturas.flatMap(f => (f.pagos || []).filter(p => p.movimientoId && movById.has(p.movimientoId) && Math.abs((movById.get(p.movimientoId).monto || 0) - (Number(p.monto) || 0)) > 1).map(p => `${f.id} ${f.numero || 's/n'} pago=$${p.monto} mov=$${movById.get(p.movimientoId).monto}`)));
  add('factura-prov-inexistente', 'medio', 'Facturas con proveedorId inexistente', facturas.filter(f => f.proveedorId && !provIds.has(f.proveedorId)).map(f => `${f.id} ${f.numero || 's/n'} prov=${f.proveedorId}`));
  add('mov-facturaid-rota', 'alto', 'Movimientos que referencian factura inexistente', movs.filter(m => m.facturaPendienteId && !facIds.has(m.facturaPendienteId)).map(m => `${m.id} $${m.monto} factura=${m.facturaPendienteId}`));
  // pago vinculado en factura pero el mov no está marcado (o vice versa)
  const pagoMovIds = new Set(facturas.flatMap(f => (f.pagos || []).map(p => p.movimientoId).filter(Boolean)));
  add('mov-marca-sin-pago', 'medio', 'Movs con facturaPendienteId que la factura NO registra como pago', movs.filter(m => m.facturaPendienteId && facIds.has(m.facturaPendienteId) && !pagoMovIds.has(m.id)).map(m => `${m.id} $${m.monto} factura=${m.facturaPendienteId}`));

  // 5. CC entries
  add('cc-prov-inexistente', 'alto', 'Asientos CC con proveedorId inexistente (deuda huérfana)', cc.filter(e => e.proveedorId && !provIds.has(e.proveedorId)).map(e => `${e.id} ${e.tipo} debe=${e.debe} haber=${e.haber} prov=${e.proveedorId}`));
  add('cc-haber-vestigial', 'medio', 'Asientos CC con haber>0 (vestigiales: los pagos ahora se derivan de movs — riesgo de doble conteo si alguna vista los suma)', cc.filter(e => (e.haber || 0) > 0).map(e => `${e.id} ${e.fecha} ${e.tipo} haber=${e.haber} prov=${e.proveedorId}`));
  add('cc-obra-inexistente', 'bajo', 'Asientos CC imputados a obra inexistente', cc.filter(e => e.obraId && !obraIds.has(e.obraId)).map(e => `${e.id} obra=${e.obraId}`));
  // gastos a proveedor SOLO matcheables por nombre (sin proveedorId)
  const provNombres = new Set(provs.map(p => (p.nombre || '').toLowerCase().trim()));
  add('gasto-prov-solo-nombre', 'medio', 'Gastos con proveedor por NOMBRE sin proveedorId (matching frágil de CC)', movs.filter(m => m.tipo === 'gasto' && !m.proveedorId && m.proveedor && provNombres.has(m.proveedor.toLowerCase().trim())).map(m => `${m.id} ${m.fecha} $${m.monto} "${m.proveedor}"`));
  add('gasto-prov-nombre-desconocido', 'medio', 'Gastos con nombre de proveedor que NO existe en el padrón (no aparecen en ninguna CC)', movs.filter(m => m.tipo === 'gasto' && !m.proveedorId && m.proveedor && !provNombres.has(m.proveedor.toLowerCase().trim())).map(m => `${m.id} ${m.fecha} $${m.monto} "${m.proveedor}"`));

  // 6. Cheques
  add('cheque-mov-roto', 'alto', 'Cheques depositados cuyo movimientoId no existe', chqs.filter(c => c.movimientoId && !movById.has(c.movimientoId)).map(c => `${c.id} ${c.numero} estado=${c.estado} mov=${c.movimientoId}`));
  add('cheque-depositado-sin-mov', 'alto', 'Cheques depositados SIN movimiento vinculado (la plata no entró a ninguna caja)', chqs.filter(c => c.estado === 'depositado' && !c.movimientoId).map(c => `${c.id} ${c.numero} $${c.monto} dep=${c.fechaDeposito}`));
  add('cheque-monto-mov-distinto', 'alto', 'Cheque cuyo monto ≠ monto del movimiento de depósito', chqs.filter(c => c.movimientoId && movById.has(c.movimientoId) && Math.abs((movById.get(c.movimientoId).monto || 0) - (c.monto || 0)) > 1).map(c => `${c.id} ${c.numero} chq=$${c.monto} mov=$${movById.get(c.movimientoId).monto}`));
  add('cheque-rechazado-con-mov', 'critico', 'Cheques RECHAZADOS que conservan el movimiento de depósito (plata fantasma en caja)', chqs.filter(c => c.estado === 'rechazado' && c.movimientoId && movById.has(c.movimientoId)).map(c => `${c.id} ${c.numero} $${c.monto} mov=${c.movimientoId}`));
  add('cheque-estado-invalido', 'medio', 'Cheques con estado fuera del set conocido', chqs.filter(c => !['cartera','depositado','endosado','rechazado','anulado','acreditado','traspasado'].includes(c.estado)).map(c => `${c.id} estado=${c.estado}`));

  // 7. Obras: cuotas y detalles legacy
  for (const o of obras) {
    const det = detalles[o.id];
    if (!det) continue;
    const legacyMovs = (det.movimientos || []).length;
    if (legacyMovs) add('obra-detalle-movs-legacy', 'medio', `Obra ${o.id} (${o.nombre}) tiene ${legacyMovs} movimientos LEGACY en detalles (fuente duplicada)`, []);
  }
  const cobros = movs.filter(m => m.tipo === 'ingreso' && m.obraId && (m.categoria === 'cobro-cliente' || /cuota|cobro/i.test(m.descripcion || '')));
  add('cobros-sin-obra-valida', 'medio', 'Cobros de cliente a obra inexistente', cobros.filter(m => !obraIds.has(m.obraId)).map(m => `${m.id} $${m.monto} obra=${m.obraId}`));

  // 7b. CRÉDITO en CC de proveedores (semántica 2026-07-03, src/lib/proveedorCC):
  // crédito = anticipos (movs gasto anticipo:true) − aplicaciones (pagos tipo
  // 'credito' en facturas). Invariante duro: las aplicaciones NUNCA pueden
  // exceder los anticipos (crédito sobre-consumido = plata inventada).
  const _esDelProv = (x, p) => x.proveedorId ? x.proveedorId === p.id
    : ((x.proveedor || '').toLowerCase().trim() === (p.nombre || '').toLowerCase().trim());
  const sobreconsumo = [];
  const creditosInfo = [];
  for (const p of provs) {
    const anticipado = movs.filter(m => m.tipo === 'gasto' && m.anticipo === true && _esDelProv(m, p)).reduce((s, m) => s + (m.monto || 0), 0);
    const aplicado = facturas.filter(f => _esDelProv(f, p) && !['anulada', 'registrada'].includes(f.estado))
      .flatMap(f => (f.pagos || []).filter(pg => pg.tipo === 'credito'))
      .reduce((s, pg) => s + (Number(pg.monto) || 0), 0);
    if (aplicado > anticipado + 1) sobreconsumo.push(`${p.nombre}: aplicado $${aplicado} > anticipado $${anticipado}`);
    else if (anticipado - aplicado > 1) creditosInfo.push(`${p.nombre}: crédito disponible $${anticipado - aplicado}`);
  }
  add('credito-sobreconsumido', 'critico', 'Proveedores con crédito aplicado MAYOR al anticipado (plata inventada)', sobreconsumo);
  add('creditos-disponibles', 'bajo', 'Créditos a favor vigentes (informativo — cuentan como activo)', creditosInfo);

  // 8. Totales para el informe
  const totalPorCaja = cajas.map(c => ({ caja: c.nombre, moneda: c.moneda, activa: c.activa, derivado: calcSaldo(c, movs), stored: Math.round(c.saldo ?? 0) }));
  const deudaProveedores = provs.map(p => {
    const debe = cc.filter(e => e.proveedorId === p.id).reduce((s, e) => s + (e.debe || 0), 0);
    const nombreN = (p.nombre || '').toLowerCase().trim();
    const pagado = movs.filter(m => m.tipo === 'gasto' && (m.proveedorId === p.id || (m.proveedor && m.proveedor.toLowerCase().trim() === nombreN))).reduce((s, m) => s + (m.monto || 0), 0);
    return { proveedor: p.nombre, debe, pagado, saldo: debe - pagado };
  }).filter(x => x.debe || x.pagado);

  const out = { fecha: new Date().toISOString(), resumen, findings, totalPorCaja, deudaProveedores };
  writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log('Resumen:', JSON.stringify(resumen));
  console.log(`Hallazgos con items: ${findings.filter(f => f.n).length}`);
  for (const f of findings.filter(f => f.n)) console.log(`  [${f.severidad}] ${f.check}: ${f.n} — ${f.detalle}`);
  console.log(`Detalle completo → ${OUT}`);
};
main().catch(e => { console.error('ERROR', e); process.exit(1); });
