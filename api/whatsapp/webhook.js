// Meta WhatsApp Cloud API — solo dependencias built-in de Node

import crypto from 'node:crypto';
import { extractSlots, mergeSlots, slotsCompletosPara, parseDictado } from './_extractors.js';
// Acciones comerciales (crear prospecto / mover etapa) — módulo aparte para no
// inflar este handler. Escrituras atómicas; gateadas a Admin en ejecutarAccion.
import { crearProspecto, moverEtapaObra } from './_intents-comercial.js';
// Agrupación de materiales por "proveedor tipo" (corralón, electricidad, etc.).
// Lógica PURA compartida con la app — se reusa para el atajo NL "lista de
// materiales de [obra] del [proveedor]". ESM hermano, importable (type:module).
import { proveedorDeMaterial, labelProveedor, PROVEEDORES } from '../../src/lib/proveedoresMateriales.js';
// Notificaciones server-side (campanita + push web) para los pendientes de
// aprobación que entran por el bot. Best-effort: nunca rompe el flujo del webhook.
import { crearNotifServidor } from './_notif.js';

const META_TOKEN      = process.env.META_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;
const VERIFY_TOKEN    = process.env.META_VERIFY_TOKEN;
const ANTHROPIC_KEY   = process.env.ANTHROPIC_API_KEY;
// App Secret de la app de Meta — para validar la firma X-Hub-Signature-256 del
// webhook. Si no está seteado, la validación se omite (no rompe el bot) hasta
// que se configure en Vercel.
const META_APP_SECRET = process.env.META_APP_SECRET;

// ── Telegram (bot INTERNO del equipo) ───────────────────────────────────────
// El equipo interno migra a Telegram; los clientes siguen en WhatsApp (el QR del
// presupuesto NO se toca). Telegram comparte ESTE mismo webhook (Vercel está en
// 12/12 funciones, no se puede agregar una ruta) y reusa TODO el motor: cambia
// SOLO la capa de canal (envío/descarga). Identidad: tabla whatsapp_users con
// phone = "tg:<chatId>" → getLinkedUser / getAllAdmins / estado / locks /
// notificaciones se enrutan solos. Ver docs/telegram-migration/00-inventory.md.
const TELEGRAM_BOT_TOKEN      = process.env.TELEGRAM_BOT_TOKEN;
// Token secreto que Telegram reenvía en el header X-Telegram-Bot-Api-Secret-Token
// (se setea al llamar setWebhook). Si está, validamos cada update con él.
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

// Helper único de rol: SOLO Admin puede ver costos/márgenes/ganancia. Centraliza
// la regla (antes estaba dispersa) para cerrar las fugas de costos a no-admin.
function isAdmin(user) { return user?.user_rol === 'Admin'; }

// Desactivamos el body parser de Vercel para poder leer el cuerpo RAW y validar
// la firma HMAC de Meta sobre los bytes exactos (un re-stringify no coincidiría).
export const config = { api: { bodyParser: false } };

// Lee el cuerpo crudo del request. Si el runtime ya consumió/parseó el stream
// (bodyParser no respetado), devuelve raw=null y el body ya parseado, y en ese
// caso la firma NO se puede validar (degradamos sin romper).
async function leerBodyCrudo(req) {
  if (req.readableEnded || req.body !== undefined) {
    return { raw: null, parsed: req.body };
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return { raw: Buffer.concat(chunks), parsed: null };
}

// Valida la firma del webhook de Meta (HMAC-SHA256 del raw body con el App Secret).
// Comparación timing-safe. Devuelve false ante cualquier discrepancia.
function firmaMetaValida(header, raw, secret) {
  if (!header || !raw || !secret) return false;
  const esperado = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const a = Buffer.from(String(header));
  const b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const SUPABASE_URL    = process.env.SUPABASE_URL;
const SUPABASE_KEY    = process.env.SUPABASE_SERVICE_KEY;

// ── Helpers Supabase ──────────────────────────────────────────────────────────
const sbH = () => ({
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

async function sbGet(table, params = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, { headers: sbH() });
  return res.json();
}

async function sbUpsert(table, data) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...sbH(), 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify(data),
  });
}

async function sbDelete(table, params) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, { method: 'DELETE', headers: sbH() });
}

// ── Desglose fiscal de una compra recibida ────────────────────────────────────
// Espejo de desglosarCompra() en src/lib/afip.js. api/ es self-contained (no
// importa de src/, igual que buscarDuplicadoRecibidoBot duplica el fingerprint):
// mantené ambas funciones sincronizadas. ÚNICA fuente del cálculo en el bot —
// antes estaba copiado inline en 3 ramas (de ahí salió el bug que descontaba el
// neto en vez del total).
//   • total      = lo que sale de caja (IVA + percepciones + todo).
//   • baseFiscal = total − percepcionIIBB − percepcionIVA. Las percepciones son
//     pagos a cuenta de OTROS impuestos, NO integran el IVA crédito: restarlas
//     antes evita inflar el crédito del Libro Compras (impugnación AFIP).
//   • Factura C → neto = base, iva = 0.
//   • montoNeto válido (foto discrimina el neto) → IVA = base − neto, infiere alícuota.
//   • Sino → default 21%.
export function desglosarCompraBot({ total, tipoLetra, percepcionIIBB = 0, percepcionIVA = 0, montoNeto = null } = {}) {
  const round2 = (n) => Math.round(n * 100) / 100;
  const tot   = Math.round(Number(total) || 0);
  const pIIBB = Math.round(Number(percepcionIIBB) || 0);
  const pIVA  = Math.round(Number(percepcionIVA) || 0);
  const baseFiscal = Math.max(0, tot - pIIBB - pIVA);
  const letra = String(tipoLetra || '').toUpperCase().charAt(0);
  if (tot <= 0)        return { neto: 0, iva: 0, alicuota: 0, baseFiscal: 0, total: tot };
  if (letra === 'C')   return { neto: baseFiscal, iva: 0, alicuota: 0, baseFiscal, total: tot };
  const netoConocido = (montoNeto != null && Number(montoNeto) > 0) ? Math.round(Number(montoNeto)) : null;
  if (netoConocido != null && netoConocido < baseFiscal) {
    const iva = Math.max(0, baseFiscal - netoConocido);
    const pct = netoConocido > 0 ? (iva / netoConocido) * 100 : 21;
    const known = [21, 10.5, 27, 0];
    const alicuota = known.reduce((a, b) => (Math.abs(b - pct) < Math.abs(a - pct) ? b : a));
    return { neto: netoConocido, iva, alicuota, baseFiscal, total: tot };
  }
  const neto = round2(baseFiscal / 1.21);
  return { neto, iva: round2(baseFiscal - neto), alicuota: 21, baseFiscal, total: tot };
}

// ── Cuentas por pagar — helpers PUROS replicados de src/lib/facturasPendientes.js
// El bot corre en Node SIN imports de src/, así que duplicamos inline la lógica de
// saldo/estado/match (mismo criterio que la app: saldo = monto − Σpagos; abierta =
// saldo>1 y no 'anulada'; match por proveedor + |saldo−monto| ≤ máx(0, 0,5%)).
// Mantené sincronizado con src/lib/facturasPendientes.js (es el contrato de Fase 1).
const _normProvFP = s => (s || '').toString().toLowerCase().trim();

// Saldo pendiente = monto − Σ pagos (nunca negativo).
// Exportada para el test de paridad bot↔app (src/lib/bot-cc-parity.test.js).
export function saldoFacturaPendienteBot(f) {
  if (!f) return 0;
  const pagado = (f.pagos || []).reduce((s, p) => s + (Number(p.monto) || 0), 0);
  return Math.max(0, (Number(f.monto) || 0) - pagado);
}

// Estado derivado de los pagos. 'anulada' y 'registrada' se guardan y no se derivan.
// 'registrada' = factura solo fiscal (cuenta para Libro IVA pero NO es deuda ni mueve
// caja) → no abierta, no matchea pagos, no figura en el resumen de pendientes.
export function estadoFacturaPendienteBot(f) {
  if (!f) return 'pendiente';
  if (f.estado === 'anulada') return 'anulada';
  if (f.estado === 'registrada') return 'registrada';
  const saldo = saldoFacturaPendienteBot(f);
  const pagado = (Number(f.monto) || 0) - saldo;
  if (saldo <= 1) return 'pagada';
  if (pagado > 0) return 'parcial';
  return 'pendiente';
}

// ¿La factura está abierta (cobrable)? = pendiente o parcial.
function esFacturaAbiertaBot(f) {
  const e = estadoFacturaPendienteBot(f);
  return e === 'pendiente' || e === 'parcial';
}

// ¿La factura es de este proveedor? Por proveedorId si lo tiene; sino por nombre.
function matcheaProveedorFP(f, proveedorId, nombreN) {
  return f.proveedorId ? f.proveedorId === proveedorId : (f.proveedor && _normProvFP(f.proveedor) === nombreN);
}

// Facturas ABIERTAS de un proveedor cuyo SALDO ≈ monto del pago (tolerancia =
// máx(tolerancia fija, ±0,5%)). Ordenadas por cercanía. Lo usa pago_proveedor:
// 1 resultado → confirmar; >1 → listar; 0 → pago normal.
function matchFacturasPorPagoBot(facturas, { proveedorId, proveedor, monto, tolerancia = 0 }) {
  const m = Number(monto) || 0;
  const nombreN = _normProvFP(proveedor);
  const tol = Math.max(tolerancia, Math.round(m * 0.005));
  return (facturas || [])
    .filter(f => esFacturaAbiertaBot(f) && matcheaProveedorFP(f, proveedorId, nombreN) && Math.abs(saldoFacturaPendienteBot(f) - m) <= tol)
    .map(f => ({ f, diff: Math.abs(saldoFacturaPendienteBot(f) - m) }))
    .sort((a, b) => a.diff - b.diff)
    .map(x => x.f);
}

// Rediseño "libro único": el bot SOLO entrega el movimiento. Lo agrega de forma
// ATÓMICA con la función append_movimiento de Postgres (no lee-y-reescribe el
// bloque entero, así nunca pisa lo que escribió la app). El saldo de la caja lo
// calcula la app sola desde los movimientos — el bot ya NO toca cajas.
async function appendMovimiento(mov) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/append_movimiento`, {
      method: 'POST',
      headers: sbH(),
      body: JSON.stringify({ nuevo: mov }),
    });
    if (!res.ok) throw new Error(`rpc ${res.status}`);
  } catch (e) {
    // Red de seguridad: si la función atómica no está disponible (permisos,
    // no creada, etc.), caemos al método viejo (read-modify-write) para NO
    // perder el movimiento. Tiene riesgo de pisada, pero es preferible a perderlo.
    console.error('[appendMovimiento] RPC falló, fallback read-modify-write:', e.message);
    const movData = await loadSharedData('movimientos');
    const movs = movData?.movimientos || [];
    await saveSharedData('movimientos', { ...(movData || {}), movimientos: [mov, ...movs] });
    return; // saveSharedData ya hace broadcast
  }
  await broadcastChange('movimientos');
}

// ── Helpers de mutación ATÓMICA (mismo criterio que appendMovimiento) ─────────
// Toda key que escriban bot Y app se muta con un RPC server-side (agrega/edita
// de a un ítem), NUNCA reescribiendo el blob entero → así el bot no pisa lo que
// guardó la app. Si el RPC falla (no creado/permisos), caen al método viejo
// (read-modify-write) para no perder el dato.
async function sbRpc(fn, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: sbH(), body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`rpc ${fn} ${res.status}`);
}

// Agrega un ítem (al principio) a una key cuyo data es un array.
async function sbAppendArray(key, item) {
  try { await sbRpc('append_to_shared_array', { p_key: key, p_item: item }); }
  catch (e) {
    console.error(`[sbAppendArray ${key}] fallback:`, e.message);
    const data = await loadSharedData(key);
    const arr = Array.isArray(data) ? data : [];
    await saveSharedData(key, [item, ...arr]);
    return;
  }
  await broadcastChange(key);
}

// Edita (merge) un ítem por id dentro de una key array, sin tocar los demás.
async function sbPatchItem(key, id, patch) {
  try { await sbRpc('patch_item_in_shared_array', { p_key: key, p_id: id, p_patch: patch }); }
  catch (e) {
    console.error(`[sbPatchItem ${key}] fallback:`, e.message);
    const data = await loadSharedData(key);
    const arr = Array.isArray(data) ? data : [];
    await saveSharedData(key, arr.map(x => x.id === id ? { ...x, ...patch } : x));
    return;
  }
  await broadcastChange(key);
}

// Agrega un asiento a la CC del proveedor (proveedores.ccEntries) sin pisar el resto.
async function sbAppendCCEntry(entry) {
  try { await sbRpc('append_ccentry', { p_entry: entry }); }
  catch (e) {
    console.error('[sbAppendCCEntry] fallback:', e.message);
    const data = await loadSharedData('proveedores');
    const cc = data?.ccEntries || [];
    await saveSharedData('proveedores', { ...(data || {}), ccEntries: [...cc, entry] });
    return;
  }
  await broadcastChange('proveedores');
}

// Agrega un ítem a un campo ARRAY dentro de un blob OBJETO (ej.
// proveedores.facturasPendientes) sin pisar el resto. Espejo de appendObjectItem
// (src/lib/dbHelpers.js) → RPC append_shared_object_item. Lo usa Cuentas por Pagar.
async function sbAppendArray2(key, collection, item) {
  try { await sbRpc('append_shared_object_item', { p_key: key, p_collection: collection, p_item: item }); }
  catch (e) {
    console.error(`[sbAppendArray2 ${key}.${collection}] fallback:`, e.message);
    const data = await loadSharedData(key);
    const arr = Array.isArray(data?.[collection]) ? data[collection] : [];
    await saveSharedData(key, { ...(data || {}), [collection]: [...arr, item] });
    return;
  }
  await broadcastChange(key);
}

// Mergea un patch en el ítem (por id) de un campo ARRAY dentro de un blob OBJETO
// (ej. proveedores.facturasPendientes) sin pisar el resto. Espejo de
// patchObjectItem (src/lib/dbHelpers.js) → RPC patch_shared_object_item.
async function sbPatchObjectItem(key, collection, id, patch) {
  try { await sbRpc('patch_shared_object_item', { p_key: key, p_collection: collection, p_id: id, p_patch: patch }); }
  catch (e) {
    console.error(`[sbPatchObjectItem ${key}.${collection}] fallback:`, e.message);
    const data = await loadSharedData(key);
    const arr = Array.isArray(data?.[collection]) ? data[collection] : [];
    await saveSharedData(key, { ...(data || {}), [collection]: arr.map(x => x.id === id ? { ...x, ...patch } : x) });
    return;
  }
  await broadcastChange(key);
}

// Mergea un patch en el detalle de UNA obra (obras.detalles[obraId]) sin pisar
// las demás obras ni el resto del bloque.
async function sbPatchDetalleObra(obraId, patch) {
  try { await sbRpc('patch_detalle_obra', { p_obra_id: obraId, p_patch: patch }); }
  catch (e) {
    console.error('[sbPatchDetalleObra] fallback:', e.message);
    const data = await loadSharedData('obras');
    const detalles = data?.detalles || {};
    const cur = detalles[obraId] || {};
    await saveSharedData('obras', { obras: data?.obras || [], detalles: { ...detalles, [obraId]: { ...cur, ...patch } } });
    return;
  }
  await broadcastChange('obras');
}

// ── Pago de factura ATÓMICO (espejo de src/lib/pagoAtomico.js) ────────────────
// Camino preferido: RPC registrar_pago_factura (migración 0006) = movimiento +
// pago en la factura en UNA transacción, validando sobrepago/estado contra datos
// FRESCOS. Fallback (RPC 404 = no desplegada): appendMovimiento + patch con
// RE-LECTURA fresca de la factura — antes el array pagos se computaba desde el
// ctx leído al inicio del request y PISABA un pago concurrente de la app.
// Un error de validación de la RPC (400) NO cae al fallback: se informa.
async function sbRegistrarPago(mov, facturaId, pago) {
  try {
    await sbRpc('registrar_pago_factura', {
      p_mov: mov,
      p_factura_id: facturaId || null,
      p_pago: pago || null,
    });
    await broadcastChange('movimientos');
    if (facturaId) await broadcastChange('proveedores');
    return { ok: true };
  } catch (e) {
    if (!/ 404$/.test(e.message || '')) {
      console.error('[sbRegistrarPago] rechazo RPC:', e.message);
      return { ok: false, error: e.message };
    }
    console.error('[sbRegistrarPago] RPC no desplegada, fallback verificado');
  }
  await appendMovimiento(mov);
  if (!facturaId) return { ok: true };
  const data = await loadSharedData('proveedores');
  const fresca = (data?.facturasPendientes || []).find(f => f.id === facturaId);
  if (!fresca) return { ok: true };
  const pagos = [...(fresca.pagos || []), pago];
  const facturaActualizada = { ...fresca, pagos };
  await sbPatchObjectItem('proveedores', 'facturasPendientes', facturaId, {
    pagos,
    saldoPendiente: saldoFacturaPendienteBot(facturaActualizada),
    estado: estadoFacturaPendienteBot(facturaActualizada),
  });
  return { ok: true, factura: facturaActualizada };
}

// ── Detección de comprobantes RECIBIDOS duplicados (mismo criterio que la app)
// Huella: con N° → letra + serial(último segmento) + CUIT + total redondeado.
//         sin N° → proveedor + fecha + total (heurística para tickets sin formal).
// Se usa para no cargar dos veces la misma factura (cubre el doble crédito IVA).
const _normSerialBot = (s) => {
  const parts = String(s || '').split(/[^0-9]+/).filter(Boolean);
  return parts.length ? (parts[parts.length - 1].replace(/^0+/, '') || '0') : '';
};
export function fingerprintRecibidoBot({ tipo, numero, cuit, total, proveedor, fecha, clase } = {}) {
  const normTotal = Math.round(Number(total) || 0);
  if (!normTotal) return null;
  const normNum  = _normSerialBot(numero);
  const normCuit = String(cuit || '').replace(/\D/g, '');
  // Prefijo 'NC' para notas de crédito (espejo de fingerprintRecibido en afip.js):
  // una NC no debe colisionar con la factura que ajusta.
  const pre      = clase === 'nota_credito' ? 'NC' : '';
  const letra    = pre + String(tipo || '').toUpperCase().charAt(0);
  if (normNum) return `n:${letra}|${normNum}|${normCuit}|${normTotal}`;
  const normProv = pre + String(proveedor || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24);
  if (!normProv) return null;
  const normFecha = String(fecha || '').slice(0, 10);
  return `s:${normProv}|${normFecha}|${normTotal}`;
}
async function buscarDuplicadoRecibidoBot(candidato) {
  const fp = fingerprintRecibidoBot(candidato);
  if (!fp) return null;
  const [movData, pendingRows, provData] = await Promise.all([
    loadSharedData('movimientos'),
    sbGet('shared_data', '?key=eq.whatsapp_pending&select=data'),
    loadSharedData('proveedores'),
  ]);
  const movs = movData?.movimientos || [];
  const pendings = Array.isArray(pendingRows[0]?.data) ? pendingRows[0].data : [];
  // Órdenes de pago (facturas de proveedor pendientes): llevan comprobanteRecibido
  // fiscal → mismo fingerprint que un movimiento/pending. Evita cargar dos veces
  // la misma factura (una como pendiente de pago y otra como gasto/factura).
  const facturasPend = provData?.facturasPendientes || [];
  for (const fp_ of facturasPend) {
    const cr = fp_?.comprobanteRecibido;
    const fpF = fingerprintRecibidoBot({
      tipo: cr?.tipo || fp_.tipoLetra, numero: cr?.numero || fp_.numero, cuit: cr?.cuit || fp_.cuit,
      total: cr?.total != null ? cr.total : fp_.monto, proveedor: fp_.proveedor, fecha: fp_.fecha, clase: cr?.clase,
    });
    if (fpF === fp) return { en: 'factura_pendiente', ref: fp_ };
  }
  for (const m of movs) {
    const cr = m?.comprobanteRecibido;
    if (cr) {
      const fpM = fingerprintRecibidoBot({ tipo: cr.tipo, numero: cr.numero, cuit: cr.cuit, total: cr.total, proveedor: m.proveedor, fecha: m.fecha, clase: cr.clase });
      if (fpM === fp) return { en: 'movimiento', ref: m };
    }
  }
  for (const p of pendings) {
    if (p?.tipoPendiente === 'factura') {
      const fpP = fingerprintRecibidoBot({ tipo: p.tipoFactura, numero: p.numeroFactura, cuit: p.cuit, total: p.montoTotal != null ? p.montoTotal : p.monto, proveedor: p.proveedor, fecha: p.fecha, clase: p.claseComprobante });
      if (fpP === fp) return { en: 'pending', ref: p };
    } else if (p?.tipoPendiente === 'movimiento' && p?.movimiento?.comprobanteRecibido) {
      const cr = p.movimiento.comprobanteRecibido;
      const fpP = fingerprintRecibidoBot({ tipo: cr.tipo, numero: cr.numero, cuit: cr.cuit, total: cr.total, proveedor: p.movimiento.proveedor, fecha: p.movimiento.fecha, clase: cr.clase });
      if (fpP === fp) return { en: 'pending', ref: p };
    }
  }
  // Legacy: movs viejos con referencia + proveedor (sin comprobanteRecibido).
  if (candidato?.numero) {
    const numCand = _normSerialBot(candidato.numero);
    const provN = (s) => String(s || '').toLowerCase().trim();
    const provCand = provN(candidato.proveedor);
    for (const m of movs) {
      if (m?.comprobanteRecibido) continue;
      if (!m?.referencia) continue;
      const refClean = _normSerialBot(m.referencia);
      if (!refClean || refClean !== numCand) continue;
      const provMov = provN(m.proveedor);
      if (!provMov || !provCand) continue;
      if (provMov.includes(provCand) || provCand.includes(provMov)) {
        return { en: 'movimiento', ref: m };
      }
    }
  }
  return null;
}

// Saldo EN VIVO de una caja (igual que la app): saldoInicial + suma de sus
// movimientos. Así el comando `saldo` refleja un movimiento recién agregado
// aunque la app todavía no haya recalculado/persistido. Si la caja aún no tiene
// saldoInicial (pre-migración), usamos el saldo guardado tal cual (no duplicar).
function calcSaldoCajaBot(caja, movimientos) {
  if (caja.saldoInicial == null) return caja.saldo || 0;
  const efecto = (movimientos || []).reduce((s, m) => {
    if (m.tipo === 'ingreso' && m.cajaId === caja.id) return s + (m.monto || 0);
    if (m.tipo === 'gasto'   && m.cajaId === caja.id) return s - (m.monto || 0);
    if (m.tipo === 'traspaso') {
      if (m.cajaId === caja.id)        return s - (m.monto || 0);
      if (m.cajaDestinoId === caja.id) return s + (m.montoDestino ?? m.monto ?? 0);
    }
    // NC de proveedor con devolución de plata: suma como crédito (espejo de efectoEnCaja en src/lib/caja.js).
    if (m.tipo === 'nota_credito_compra' && m.afectaCaja && m.cajaId === caja.id) return s + (m.monto || 0);
    return s;
  }, 0);
  return Math.round(caja.saldoInicial + efecto);
}

async function loadSharedData(key) {
  const rows = await sbGet('shared_data', `?key=eq.${key}&select=data`);
  return rows[0]?.data ?? null;
}

async function saveSharedData(key, value) {
  await fetch(`${SUPABASE_URL}/rest/v1/shared_data`, {
    method: 'POST',
    headers: { ...sbH(), 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ key, data: value, updated_at: new Date().toISOString() }),
  });
  await broadcastChange(key);
}

// ── Helpers Meta API ──────────────────────────────────────────────────────────
// Botones estándar de confirmación. Los ids se mapean a texto cuando vuelven:
// 'confirmar'→"sí", 'cancelar'→"no", 'editar'→"editar". El "editar" deja la
// acción en curso y pide al user el dato a corregir (sin perder el resto).
const BOTONES_CONFIRMAR = [
  { id: 'confirmar', title: 'Confirmar ✅' },
  { id: 'editar',    title: 'Editar ✏️' },
  { id: 'cancelar',  title: 'Cancelar ❌' },
];

// ── Telegram Bot API — capa de canal del bot interno ────────────────────────
// Las funciones sendWA*/downloadMedia branchean según el destinatario: si `to`
// empieza con "tg:" es un chat de Telegram → Bot API; si no, WhatsApp (intacto).
const esTelegram = (to) => typeof to === 'string' && to.startsWith('tg:');
const tgChatId   = (to) => String(to).slice(3);

// Llamada genérica a la Bot API. Devuelve { ok, data }. Nunca tira.
async function tgApi(method, payload) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.ok) {
      console.error(`tgApi ${method} error:`, r.status, JSON.stringify(data).slice(0, 300));
      return { ok: false, data };
    }
    return { ok: true, data };
  } catch (e) {
    console.error(`tgApi ${method} exception:`, e.message);
    return { ok: false, data: null };
  }
}

// Telegram corta los mensajes a 4096 chars. Partimos por saltos de línea.
function splitForTelegram(text, max = 4096) {
  const s = String(text == null ? '' : text);
  if (s.length <= max) return [s];
  const out = [];
  let buf = '';
  for (const line of s.split('\n')) {
    if (buf.length + line.length + 1 > max) {
      if (buf) out.push(buf);
      if (line.length > max) { for (let i = 0; i < line.length; i += max) out.push(line.slice(i, i + max)); buf = ''; }
      else { buf = line; }
    } else {
      buf = buf ? `${buf}\n${line}` : line;
    }
  }
  if (buf) out.push(buf);
  return out;
}

// Envía texto a un chat de Telegram. Reusa el markup del bot (*negrita*, _itálica_)
// vía parse_mode 'Markdown' (legacy, mismo *asterisco* que WhatsApp). Si el parseo
// falla (entidades desbalanceadas en datos del usuario) reintenta en texto plano:
// NUNCA se pierde el mensaje. El teclado inline va solo en el último chunk.
async function tgSendMessage(chatId, body, replyMarkup = null) {
  const chunks = splitForTelegram(body);
  let last = { ok: true };
  for (let i = 0; i < chunks.length; i++) {
    const base = { chat_id: chatId, text: chunks[i], disable_web_page_preview: true };
    if (i === chunks.length - 1 && replyMarkup) base.reply_markup = replyMarkup;
    last = await tgApi('sendMessage', { ...base, parse_mode: 'Markdown' });
    if (!last.ok) last = await tgApi('sendMessage', base); // fallback sin formato
  }
  return { ok: last.ok };
}

// Descarga un archivo de Telegram (file_id) → base64. Mismo contrato que
// downloadMedia de Meta (el token va en el PATH de la URL, no como Bearer).
async function tgDownloadFile(fileId) {
  try {
    const info = await tgApi('getFile', { file_id: fileId });
    const filePath = info?.data?.result?.file_path;
    if (!filePath) return null;
    const r = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`);
    if (!r.ok) { console.error('tgDownloadFile fetch error:', r.status); return null; }
    const buf = await r.arrayBuffer();
    return Buffer.from(buf).toString('base64');
  } catch (e) {
    console.error('tgDownloadFile error:', e.message);
    return null;
  }
}

// Devuelve { ok, status?, error? }. Los callers que responden al admin pueden
// ignorar el retorno (no rompe nada). Pero para AVISOS al cliente (texto libre)
// importa: Meta rechaza el texto libre fuera de la ventana de 24hs, y antes eso
// se tragaba en silencio → el bot decía "listo" sin haber enviado nada.
async function sendWA(to, body) {
  if (esTelegram(to)) return tgSendMessage(tgChatId(to), body);
  try {
    const r = await fetch(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${META_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }),
    });
    if (!r.ok) {
      const t = await r.text();
      console.error('sendWA error:', r.status, t);
      return { ok: false, status: r.status, error: t };
    }
    return { ok: true };
  } catch (e) {
    console.error('sendWA exception:', e.message);
    return { ok: false, error: e.message };
  }
}

// Envía un mensaje con BOTONES de respuesta rápida (máx 3 botones).
// botones: [{ id: 'confirmar', title: 'Confirmar ✅' }, ...]
// Cuando el usuario toca un botón, Meta nos manda un mensaje interactivo
// cuyo button_reply.id es el id que mandamos. Lo parseamos en el handler.
// Fallback: si la API rechaza (algunos números no soportan interactive),
// reintenta como texto plano con instrucción numérica.
async function sendWAButtons(to, body, botones) {
  if (esTelegram(to)) {
    // Telegram: teclado inline, un botón por fila. callback_data = id del botón
    // (confirmar/editar/cancelar) ≤64 bytes. Sin límite de 3 como WhatsApp.
    const inline_keyboard = botones.map(b => [{ text: b.title, callback_data: b.id }]);
    return tgSendMessage(tgChatId(to), body, { inline_keyboard });
  }
  const buttons = botones.slice(0, 3).map(b => ({
    type: 'reply',
    reply: { id: b.id, title: b.title.slice(0, 20) }, // título máx 20 chars
  }));
  try {
    const r = await fetch(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${META_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp', to, type: 'interactive',
        interactive: { type: 'button', body: { text: body.slice(0, 1024) }, action: { buttons } },
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      console.error('sendWAButtons error:', r.status, t);
      // Fallback texto plano
      const txtFallback = `${body}\n\n${botones.map((b, i) => `${i + 1}. ${b.title}`).join('\n')}`;
      await sendWA(to, txtFallback);
    }
  } catch (e) {
    console.error('sendWAButtons exception:', e.message);
    await sendWA(to, body);
  }
}

// Envía un mensaje con LISTA desplegable (hasta 10 opciones). Útil para
// elegir obra/caja/proveedor cuando hay varias coincidencias.
// items: [{ id, title, description? }]
async function sendWAList(to, body, buttonLabel, items) {
  if (esTelegram(to)) {
    // Telegram no tiene listas nativas → se emula con teclado inline, una opción
    // por fila, callback_data 'pick:<id>' (misma convención que el handler).
    const inline_keyboard = items.slice(0, 50).map(it => {
      const label = (it.description ? `${it.title} — ${it.description}` : (it.title || '')).slice(0, 90) || '—';
      let cd = `pick:${it.id}`;
      if (Buffer.byteLength(cd, 'utf8') > 64) { console.warn('tg callback_data >64b:', cd); cd = cd.slice(0, 64); }
      return [{ text: label, callback_data: cd }];
    });
    return tgSendMessage(tgChatId(to), body, { inline_keyboard });
  }
  const rows = items.slice(0, 10).map(it => ({
    id: it.id,
    title: (it.title || '').slice(0, 24),
    description: (it.description || '').slice(0, 72),
  }));
  try {
    const r = await fetch(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${META_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp', to, type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: body.slice(0, 1024) },
          action: { button: (buttonLabel || 'Elegir').slice(0, 20), sections: [{ rows }] },
        },
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      console.error('sendWAList error:', r.status, t);
      const txtFallback = `${body}\n\n${items.map((it, i) => `${i + 1}. ${it.title}`).join('\n')}`;
      await sendWA(to, txtFallback);
    }
  } catch (e) {
    console.error('sendWAList exception:', e.message);
    await sendWA(to, body);
  }
}

// Envía un mensaje de plantilla (template). Necesario cuando se inicia
// conversación con un número que no escribió al bot en las últimas 24hs
// — la API rechaza texto libre fuera de esa ventana.
// La plantilla debe estar registrada y APROBADA en Meta Business Manager.
async function sendWATemplate(to, templateName, languageCode, bodyParams = []) {
  // Telegram no tiene plantillas ni ventana de 24h → se manda el texto directo.
  // (Defensivo: los templates son para clientes en WhatsApp, nunca destino tg:.)
  if (esTelegram(to)) return tgSendMessage(tgChatId(to), bodyParams.join(' '));
  try {
    const r = await fetch(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${META_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: languageCode },
          components: bodyParams.length > 0 ? [{
            type: 'body',
            parameters: bodyParams.map(text => ({ type: 'text', text: String(text) })),
          }] : [],
        },
      }),
    });
    const json = await r.json();
    if (!r.ok) {
      console.error('sendWATemplate error:', r.status, JSON.stringify(json));
      const err = json?.error;
      // Errores comunes y sus causas:
      // 132001 = plantilla no existe / no aprobada / idioma incorrecto
      // 131026 = mensaje fuera de ventana 24h y sin plantilla
      // 100    = parámetros del template no coinciden
      const motivo = err?.code === 132001 ? `Plantilla "${templateName}" (${languageCode}) no existe o no está aprobada en Meta.`
                   : err?.code === 131026 ? `Fuera de ventana de 24hs y la plantilla no aplica.`
                   : err?.message || 'error desconocido';
      throw new Error(motivo);
    }
    return json;
  } catch (e) {
    console.error('sendWATemplate exception:', e.message);
    throw e;
  }
}

async function downloadMedia(mediaId) {
  // Media de Telegram: el mediaId viene como "tg:<file_id>".
  if (typeof mediaId === 'string' && mediaId.startsWith('tg:')) return tgDownloadFile(mediaId.slice(3));
  try {
    const r1 = await fetch(`https://graph.facebook.com/v18.0/${mediaId}`, {
      headers: { 'Authorization': `Bearer ${META_TOKEN}` },
    });
    const info = await r1.json();
    if (!info.url) return null;
    const r2 = await fetch(info.url, { headers: { 'Authorization': `Bearer ${META_TOKEN}` } });
    const buf = await r2.arrayBuffer();
    return Buffer.from(buf).toString('base64');
  } catch (e) {
    console.error('downloadMedia error:', e.message);
    return null;
  }
}

async function broadcastChange(key) {
  try {
    await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'apikey': SUPABASE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{ topic: 'kamak-data-sync', event: 'changed', payload: { key } }],
      }),
    });
  } catch (e) {
    console.error('broadcastChange error:', e.message);
  }
}

async function uploadToStorage(base64Data, mimeType, filepath) {
  try {
    const buffer = Buffer.from(base64Data, 'base64');
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/kamak-fotos/${filepath}`, {
      method: 'POST',
      headers: {
        // apikey OBLIGATORIO: con las service keys NUEVAS (sb_secret_) el API de
        // Storage rechaza el Authorization Bearer como JWT ("Invalid Compact JWS").
        // Con el header apikey acepta la clave nueva (y también la legacy eyJ). Sin
        // esto el upload devolvía null → el bot anotaba el gasto SIN el comprobante.
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': mimeType,
        'x-upsert': 'true',
      },
      body: buffer,
    });
    if (!r.ok) {
      console.error('uploadToStorage error:', r.status, await r.text());
      return null;
    }
    return `${SUPABASE_URL}/storage/v1/object/public/kamak-fotos/${filepath}`;
  } catch (e) {
    console.error('uploadToStorage exception:', e.message);
    return null;
  }
}

// Saldo por cobrar de una obra en USD = total al cliente − cobrado. Réplica FIEL de
// ccObra (src/pages/obra/helpers.js: calcObra→tareaVentaUnit + calcTotalClienteUSD +
// cobradoObraUSD) — el bot no puede importar de src/. MANTENER SINCRONIZADO con helpers.js.
function saldoObraBotUSD(obra, detalle, movimientos, cajas, tc) {
  detalle = detalle || {};
  const ventaUnit = (t, r) => {
    const mat = r.materialesACargoComprador ? 0 : t.costoMat;   // sin `||0`, idéntico a la app
    const sub = t.costoSub || 0;
    if (t.margenLinea != null) return (mat + sub) * (1 + t.margenLinea / 100);
    return mat * (1 + r.margenMat / 100) + sub * (1 + r.margenMO / 100);
  };
  let ventaBaseARS = 0;
  for (const r of (detalle.rubros || []))
    for (const t of (r.tareas || []))
      if (t.tipo !== 'seccion' && t.cantidad != null)
        ventaBaseARS += ventaUnit(t, r) * t.cantidad;
  const adicionalARS = (detalle.adicionales || [])
    .filter(a => a.estado === 'aprobado' && a.aplicaACliente !== false)
    .reduce((s, a) => s + (a.valorVentaTotal ?? a.costoTotal ?? a.monto ?? 0), 0);
  const interes = parseFloat((detalle.financiacion || {}).interes) || 0;
  // total USD: precioVentaUSD fijo si >0 (no depende del tc); sino round a ARS y después
  // /tc (idéntico a calcTotalClienteUSD→arsToUSD).
  const pf = Number(detalle.precioVentaUSD);
  const totalARS = Math.round((ventaBaseARS + adicionalARS) * (1 + interes / 100));
  const totalUSD = (Number.isFinite(pf) && pf > 0) ? Math.round(pf) : Math.round(totalARS / (tc || 1));
  // cobrado USD (réplica byte-por-byte de cobradoObraUSD, helpers.js:105-113).
  const cobradoUSD = (movimientos || [])
    .filter(m => m.obraId === obra.id && m.tipo === 'ingreso')
    .reduce((s, m) => {
      if (m.montoDolar) return s + Math.round(m.montoDolar);
      const caja = (cajas || []).find(c => c.id === m.cajaId);
      return s + (caja?.moneda === 'USD' ? Math.round(m.monto || 0) : Math.round((m.monto || 0) / (tc || 1)));
    }, 0);
  return Math.max(0, totalUSD - cobradoUSD);
}

// ── Datos del sistema ─────────────────────────────────────────────────────────
async function getSystemContext() {
  const [movData, provData, obrasData, cliData, dolarData] = await Promise.all([
    loadSharedData('movimientos'),
    loadSharedData('proveedores'),
    loadSharedData('obras'),
    loadSharedData('clientes'),
    loadSharedData('dolar'),
  ]);
  // tc para el saldo de obras finalizadas (mismo criterio que el flujo cliente y la app).
  const tc = dolarData?.venta || dolarData?.manualVal || 1070;
  return {
    cajas:       movData?.cajas       || [],
    movimientos: movData?.movimientos || [],
    proveedores: provData?.proveedores || [],
    // Facturas de proveedor PENDIENTES DE PAGO (Cuentas por Pagar). Las usa
    // pago_proveedor (match pago→factura) y el resumen del prompt.
    facturasPendientes: provData?.facturasPendientes || [],
    // Estados "vivos" + finalizada/archivada con saldo por cobrar (>1 USD): para poder
    // registrar el cobro pendiente por chat. Saldo idéntico al de la app (ccObra).
    obras: (obrasData?.obras || []).filter(o => {
      if (o.estado === 'activa' || o.estado === 'en-presupuesto' || o.estado === 'pausada') return true;
      if (o.estado === 'finalizada' || o.estado === 'archivada')
        return saldoObraBotUSD(o, (obrasData?.detalles || {})[o.id], movData?.movimientos || [], movData?.cajas || [], tc) > 1;
      return false;
    }),
    detalles:    obrasData?.detalles  || {},
    clientes:    Array.isArray(cliData) ? cliData : [],
  };
}

// ── Helpers cliente / telefono ────────────────────────────────────────────────
// Normaliza un teléfono al formato E.164 sin "+" que requiere Meta WA.
// Acepta varios formatos comunes Arg: "+54 11 5555-1234", "01155551234",
// "5491155551234". Devuelve null si no se puede normalizar razonablemente.
function normalizePhone(raw) {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, '');
  if (!d) return null;
  // 0xxxxxxxxxx (formato local arg con cero inicial) → quitar el 0
  if (d.startsWith('0')) d = d.slice(1);
  // Arg sin código país (10 dígitos): "1155551234" → "5491155551234"
  if (d.length === 10) d = '549' + d;
  // Arg con código país sin el 9 móvil: "541155551234" (12) → "5491155551234"
  else if (d.length === 12 && d.startsWith('54')) d = '549' + d.slice(2);
  // Arg formato "15" móvil viejo (11 dígitos): "1115551234" → ya está bien, +549
  else if (d.length === 11 && (d.startsWith('11') || d.startsWith('15'))) d = '549' + d.slice(d.startsWith('15') ? 2 : 0);
  // Validación final: E.164 → 11-15 dígitos
  if (d.length < 11 || d.length > 15) return null;
  return d;
}

// Busca el cliente vinculado a una obra por nombre. obra.cliente es texto
// libre — matcheamos por lowercase exacto primero, después por inclusión.
function findClienteByObra(obra, clientes) {
  if (!obra?.cliente || !clientes?.length) return null;
  const q = obra.cliente.toLowerCase().trim();
  const exacto = clientes.find(c => (c.nombre || '').toLowerCase().trim() === q);
  if (exacto) return exacto;
  return clientes.find(c => {
    const n = (c.nombre || '').toLowerCase().trim();
    return n && (n.includes(q) || q.includes(n));
  }) || null;
}

// Formatea un monto con moneda, igual al estilo del resto del bot.
function fmtMonto(monto, moneda) {
  const n = Math.round(monto).toLocaleString('es-AR');
  return moneda === 'USD' ? `U$S ${n}` : `$ ${n}`;
}

// Manda el WhatsApp de confirmación de cobro al cliente.
async function notifyClienteCobro({ telefono, clienteNombre, monto, moneda, obraNombre, recibidoPor }) {
  const msg =
    `Hola ${clienteNombre} 👋\n\n` +
    `Te confirmamos que recibimos ${fmtMonto(monto, moneda)} por la obra *${obraNombre}*.\n\n` +
    `Recibido por: ${recibidoPor}\n\n` +
    `¡Gracias por confiar en Kamak Desarrollos! 🙏`;
  const res = await sendWA(telefono, msg);
  if (!res?.ok) {
    // Casi siempre: fuera de la ventana de 24hs (el cliente no le escribió al
    // bot hace poco) → Meta rechaza el texto libre. Avisamos al admin de verdad.
    throw new Error('Meta no dejó enviar el aviso (probablemente el cliente no te escribió en las últimas 24 hs, así que la ventana está cerrada). El cobro quedó igual y el cliente lo ve en el portal.');
  }
}

// ── Cliente vinculado al portal ──────────────────────────────────────────────
// Busca si un numero de WA ya esta vinculado a un cliente.
// Matching robusto: prueba con whatsappActivo flag pero tambien acepta
// clientes cuyo telefono coincida aunque el flag falte (datos legacy o
// guardados pisados por otro proceso).
async function getLinkedCliente(phone) {
  const clientesData = await loadSharedData('clientes');
  const clientes = Array.isArray(clientesData) ? clientesData : [];
  // 1) Match preferido: whatsappActivo + telefono normalizado matchea.
  let match = clientes.find(c => c.whatsappActivo && normalizePhone(c.telefono) === phone);
  if (match) {
    console.log(`getLinkedCliente: match flag+phone cliente=${match.id} (${match.nombre})`);
    return match;
  }
  // 2) Match relajado: cualquier cliente con ese telefono (aunque whatsappActivo
  //    se haya perdido — guardado pisado por el frontend, datos legacy, etc.)
  match = clientes.find(c => normalizePhone(c.telefono) === phone);
  if (match) {
    console.log(`getLinkedCliente: match SOLO phone cliente=${match.id} (${match.nombre}) — flag whatsappActivo perdido`);
    return match;
  }
  console.log(`getLinkedCliente: NO match para phone=${phone}. Total clientes=${clientes.length}. Telefonos guardados:`,
    clientes.map(c => `${c.nombre}:${c.telefono}->${normalizePhone(c.telefono)}|act:${!!c.whatsappActivo}`).join(' / '));
  return null;
}

// Parsea el primer mensaje que el cliente manda desde el QR del presupuesto.
// Patron esperado: "Hola soy [cliente] obra [obra]"
// Devuelve { nombreCliente, nombreObra } o null si no matchea.
function parseClientePrimerMensaje(text) {
  if (!text) return null;
  const m = text.match(/hola\s+soy\s+(.+?)\s+obra\s+(.+?)$/i);
  if (!m) return null;
  return { nombreCliente: m[1].trim(), nombreObra: m[2].trim() };
}

// Match flexible de nombres (ignora mayusculas, tildes, espacios extra).
function nombreMatch(a, b) {
  const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  const A = norm(a), B = norm(b);
  if (!A || !B) return false;
  return A === B || A.includes(B) || B.includes(A);
}

// Crea (o renueva) un portal_token para una obra y devuelve la URL completa
// que el cliente puede abrir en el navegador.
async function generarPortalLink(obraId, obraNombre, clienteNombre, phone) {
  const baseUrl = process.env.PORTAL_BASE_URL || 'https://kamak.com.ar';
  const token = `pt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  // Expiración acotada: un token de portal da acceso de lectura a datos de la obra.
  // 90 días (antes 1 año) reduce la ventana si el link se filtra; se renueva solo
  // cada vez que el cliente vuelve a pedir el acceso por WhatsApp.
  const expires = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  const tokens = (await loadSharedData('portal_tokens')) || {};
  tokens[token] = {
    obraId, obraNombre, cliente: clienteNombre,
    phone, expires,
    createdAt: new Date().toISOString(),
    source: 'qr-onboarding',
  };
  await saveSharedData('portal_tokens', tokens);
  return `${baseUrl}/portal/acceso/${token}`;
}

// Vincula al cliente (guarda phone + whatsappActivo en la ficha) y le manda
// el link al portal. Llamada cuando el cliente escanea el QR y envia el
// primer mensaje "Hola soy X obra Y" desde su telefono.
async function onboardCliente(phone, nombreCliente, nombreObra) {
  const [clientesData, obrasData] = await Promise.all([
    loadSharedData('clientes'),
    loadSharedData('obras'),
  ]);
  const clientes = Array.isArray(clientesData) ? clientesData : [];
  const obras = obrasData?.obras || [];

  // Buscar cliente y obra por nombre flexible.
  const cliente = clientes.find(c => nombreMatch(c.nombre, nombreCliente));
  const obra = obras.find(o => nombreMatch(o.nombre, nombreObra));

  if (!cliente || !obra) {
    await sendWA(phone,
      `Hola! No pude identificar tu obra automaticamente.\n\n` +
      `Por favor escribinos:\n` +
      `*${nombreCliente || '[tu nombre]'}* y la obra *${nombreObra || '[nombre obra]'}*\n\n` +
      `Un asesor te va a responder pronto. Tambien podes contactarnos al telefono de Kamak.`
    );
    return;
  }

  // Si la obra que dijo no coincide con el cliente registrado, avisamos pero
  // igual seguimos (porque la obra podria tener cliente como texto libre).
  // No bloqueamos.

  // Marcar el cliente como vinculado con su telefono.
  // Atómico: parchea SOLO ese cliente por id (no pisa la lista de clientes).
  await sbPatchItem('clientes', cliente.id, {
    telefono: '+' + phone, whatsappActivo: true, whatsappVinculadoAt: new Date().toISOString(),
  });
  console.log(`onboardCliente: vinculado cliente=${cliente.id} (${cliente.nombre}) phone=+${phone}`);
  // Re-leer para verificar que se persistio (defensa contra pisado por
  // frontend o por algun race condition).
  const verify = await loadSharedData('clientes');
  const verifyOk = Array.isArray(verify) && verify.find(c => c.id === cliente.id)?.whatsappActivo === true;
  console.log(`onboardCliente: verificacion post-save = ${verifyOk}`);

  // Generar link al portal y mandarselo.
  const portalUrl = await generarPortalLink(obra.id, obra.nombre, cliente.nombre, phone);
  await sendWA(phone,
    `Hola ${cliente.nombre} 👋\n\n` +
    `Bienvenido al portal de tu obra *${obra.nombre}*.\n\n` +
    `Aca podes ver el avance, las fotos, los documentos y el plan de pagos:\n${portalUrl}\n\n` +
    `Cualquier consulta escribime por aca. Tambien podes preguntarme cosas como:\n` +
    `• *saldo* — cuanto debes\n` +
    `• *proximo pago* — proxima cuota\n` +
    `• *avance* — como va la obra\n` +
    `• *ayuda* — ver todas las opciones`
  );
}

// ── Handler de consultas del cliente vinculado ──────────────────────────────
// Helpers de cuota (replicados aca; en frontend viven en src/lib y src/pages/obra/helpers.js).
function cuotaMontoFn(c, moneda, tc) {
  return (c._usd || moneda !== 'USD') ? (c.monto || 0) : Math.round((c.monto || 0) / tc);
}
function cuotaCobradoFn(c, moneda, tc) {
  return (c.pagos || []).reduce((s, p) => {
    if (moneda === 'USD') return s + (p.moneda === 'ARS' ? Math.round((p.monto || 0) / (p.tc || tc)) : (p.monto || 0));
    return s + (p.moneda === 'USD' ? Math.round((p.monto || 0) * (p.tc || tc)) : (p.monto || 0));
  }, 0);
}
function cuotaEstadoCalc(c, moneda, tc) {
  const cob = cuotaCobradoFn(c, moneda, tc);
  if (cob <= 0) return 'pendiente';
  if (cob >= cuotaMontoFn(c, moneda, tc)) return 'pagado';
  return 'parcial';
}

async function handleClienteFlow(phone, cliente, text) {
  const t = (text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

  // Cargar la(s) obra(s) del cliente.
  const obrasData = await loadSharedData('obras');
  const obras = obrasData?.obras || [];
  const detalles = obrasData?.detalles || {};

  const obrasDelCliente = obras.filter(o => nombreMatch(o.cliente, cliente.nombre));
  if (obrasDelCliente.length === 0) {
    await sendWA(phone,
      `Hola ${cliente.nombre} 👋\n\nNo encontre obras asociadas a tu cuenta. Si pensas que es un error, contactanos a Kamak.`
    );
    return;
  }
  // Por ahora trabajamos con la primera obra activa (o la primera).
  // Multi-obra se resuelve en una iteracion futura.
  const obra = obrasDelCliente.find(o => o.estado === 'activa') || obrasDelCliente[0];
  const detalle = detalles[obra.id] || {};
  const moneda = obra.moneda || 'ARS';

  // Cargar dolar para conversiones USD <-> ARS.
  const dolarData = await loadSharedData('dolar');
  const tc = dolarData?.venta || dolarData?.manualVal || 1070;

  // ── Cálculos de pagos (libro único) ────────────────────────────────────────
  // Lo COBRADO se deriva de los MOVIMIENTOS de ingreso de la obra, igual que el
  // portal y el admin (api/portal/data.js / helpers.cobradoObraUSD). TODO en USD
  // para coincidir con el portal. Antes leía cuota.pagos[] y mostraba un número
  // distinto al portal cuando el cobro venía del bot. Las cuotas marcadas
  // pagadas a mano (estado 'pagado' sin pagos) se respetan.
  // Solo obras CONFIRMADAS tienen cuotas "reales". Si la obra es una PROPUESTA
  // (en-presupuesto), su plan de pagos no es un cobro acordado todavía → no se le
  // muestran cuotas/vencimientos al cliente (recibir un pago la confirma).
  const obraEsPropuesta = obra.estado === 'en-presupuesto';
  const cuotas = obraEsPropuesta ? [] : (detalle.cuotas || []);
  const movDataCli = await loadSharedData('movimientos');
  const cajasCli   = movDataCli?.cajas || [];
  const cobradoUSD = (movDataCli?.movimientos || [])
    .filter(m => m.obraId === obra.id && m.tipo === 'ingreso')
    .reduce((s, m) => {
      if (m.montoDolar) return s + Math.round(m.montoDolar);
      const caja = cajasCli.find(c => c.id === m.cajaId);
      return s + (caja?.moneda === 'USD' ? Math.round(m.monto || 0) : Math.round((m.monto || 0) / (tc || 1)));
    }, 0);
  const cuotaMonto = c => Math.round((moneda === 'USD' || c._usd) ? (c.monto || 0) : (c.monto || 0) / tc); // USD
  // Reparto del cobrado sobre las cuotas en orden (igual que repartirCobroEnCuotas).
  let _restCli = Math.max(0, cobradoUSD);
  const _repartoCli = {};
  for (const c of cuotas) {
    const m = cuotaMonto(c);
    if (c.estado === 'pagado' && !((c.pagos || []).length)) { _repartoCli[c.id] = m; continue; }
    const ap = Math.min(m, _restCli); _repartoCli[c.id] = ap; _restCli -= ap;
  }
  const cuotaCobrado = c => _repartoCli[c.id] || 0;
  const estadoCuota = c => {
    const cob = _repartoCli[c.id] || 0; const m = cuotaMonto(c);
    if (cob <= 0) return 'pendiente';
    if (cob >= m) return 'pagado';
    return 'parcial';
  };
  const totalCuotas = cuotas.reduce((s, c) => s + cuotaMonto(c), 0);
  const totalCobrado = cobradoUSD;
  // Total acordado al cliente: si la obra tiene precio fijo en USD (deuda en
  // dolares, no depende del dolar) se usa ese; sino, la suma de cuotas.
  const _pf = Number(detalle.precioVentaUSD);
  const totalAcordado = Number.isFinite(_pf) && _pf > 0 ? Math.round(_pf) : totalCuotas;
  const saldoPendiente = Math.max(0, totalAcordado - totalCobrado);
  const pagadas = cuotas.filter(c => estadoCuota(c) === 'pagado').length;
  const proximaCuota = cuotas
    .filter(c => estadoCuota(c) !== 'pagado')
    .sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''))[0];

  const fmtFecha = (iso) => {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  };

  // Avance general (promedio de avance por tarea)
  const rubros = detalle.rubros || [];
  const tareas = rubros.flatMap(r => (r.tareas || []).filter(x => x.tipo !== 'seccion'));
  const avanceGeneral = tareas.length > 0
    ? Math.round(tareas.reduce((s, t) => s + (t.avance || 0), 0) / tareas.length)
    : 0;

  // Link al portal (genera uno nuevo cada vez para mayor seguridad)
  const portalUrl = await generarPortalLink(obra.id, obra.nombre, cliente.nombre, phone);

  // ── Routing por comando ───────────────────────────────────────────────────
  if (/^(hola|buen[ao]s|hi|hey|hello|saludos|portal|link|acceso)\b/.test(t)) {
    await sendWA(phone,
      `Hola ${cliente.nombre} 👋\n\nAca tenes el link al portal de tu obra *${obra.nombre}*:\n${portalUrl}\n\n` +
      `Tambien podes escribirme:\n• *saldo* — cuanto debes\n• *proximo pago* — proxima cuota\n• *avance* — como va la obra\n• *ayuda* — ver todas las opciones`
    );
    return;
  }

  if (/^(ayuda|help|menu|opciones|\?)/.test(t)) {
    await sendWA(phone,
      `🔹 *Opciones disponibles:*\n\n` +
      `• *saldo* — cuanto debes y cuanto va pagado\n` +
      `• *proximo pago* / *cuando pago* — proxima cuota a vencer\n` +
      `• *cuanto pague* / *cobrado* — total pagado hasta ahora\n` +
      `• *cuotas* / *plan de pagos* — lista completa de cuotas\n` +
      `• *avance* / *como va* — % de avance de tu obra\n` +
      `• *portal* / *link* — link al portal con toda la info\n` +
      `• *ayuda* — este menu`
    );
    return;
  }

  if (/(saldo|cuanto\s+debo|cuanto\s+falta|te\s+debo|\bdebo\b|deuda)/.test(t)) {
    await sendWA(phone,
      `💰 *Saldo de tu obra ${obra.nombre}*\n\n` +
      `Total acordado: ${fmtMonto(totalAcordado, 'USD')}\n` +
      `Pagaste: ${fmtMonto(totalCobrado, 'USD')}\n` +
      `*Saldo pendiente: ${fmtMonto(saldoPendiente, 'USD')}*\n\n` +
      `Detalle completo en el portal:\n${portalUrl}`
    );
    return;
  }

  if (/(proximo\s+pago|proxima\s+cuota|cuando\s+pago|siguiente\s+pago)/.test(t)) {
    if (!proximaCuota) {
      await sendWA(phone, `🎉 Ya pagaste todas las cuotas de tu obra *${obra.nombre}*. ¡Gracias!\n${portalUrl}`);
      return;
    }
    const monto = cuotaMonto(proximaCuota);
    const cobrado = cuotaCobrado(proximaCuota);
    const restante = Math.max(0, monto - cobrado);
    await sendWA(phone,
      `📅 *Proxima cuota de ${obra.nombre}*\n\n` +
      `Cuota N°${proximaCuota.n || '—'}: ${proximaCuota.descripcion || ''}\n` +
      `Vence: *${fmtFecha(proximaCuota.fecha)}*\n` +
      `Monto: ${fmtMonto(monto, 'USD')}` +
      (cobrado > 0 ? `\nYa pagaste: ${fmtMonto(cobrado, 'USD')}\nFalta: *${fmtMonto(restante, 'USD')}*` : '') +
      `\n\nDetalle: ${portalUrl}`
    );
    return;
  }

  if (/(cuanto\s+pague|pagado|cobrado|que\s+va)/.test(t)) {
    const pct = totalAcordado > 0 ? Math.round((totalCobrado / totalAcordado) * 100) : 0;
    await sendWA(phone,
      `✅ *Pagos de ${obra.nombre}*\n\n` +
      `Pagaste: *${fmtMonto(totalCobrado, 'USD')}* de ${fmtMonto(totalAcordado, 'USD')} (${pct}%)\n` +
      `Cuotas cobradas: ${pagadas} de ${cuotas.length}\n\n` +
      `Ver todas: ${portalUrl}`
    );
    return;
  }

  if (/(cuotas|plan\s+de\s+pagos|plan\s+pagos)/.test(t)) {
    if (cuotas.length === 0) {
      await sendWA(phone, `Tu obra *${obra.nombre}* todavia no tiene un plan de pagos definido.\n${portalUrl}`);
      return;
    }
    const lineas = cuotas.slice(0, 10).map(c => {
      const estado = estadoCuota(c);
      const icon = estado === 'pagado' ? '✅' : estado === 'parcial' ? '🟡' : '⏳';
      return `${icon} N°${c.n} ${c.descripcion || ''} — ${fmtMonto(cuotaMonto(c), 'USD')} — ${fmtFecha(c.fecha)}`;
    });
    await sendWA(phone,
      `📋 *Plan de pagos · ${obra.nombre}*\n\n${lineas.join('\n')}` +
      (cuotas.length > 10 ? `\n\n…y ${cuotas.length - 10} cuotas mas.` : '') +
      `\n\nDetalle completo: ${portalUrl}`
    );
    return;
  }

  if (/(avance|como\s+va|estado\s+obra|progreso)/.test(t)) {
    await sendWA(phone,
      `🏗 *Avance de ${obra.nombre}*\n\n` +
      `Avance general: *${avanceGeneral}%*\n` +
      `Estado: ${obra.estado || '—'}\n` +
      (obra.fechaFinEstim ? `Entrega estimada: ${fmtFecha(obra.fechaFinEstim)}\n` : '') +
      `\nVer fotos y detalle: ${portalUrl}`
    );
    return;
  }

  // Default: respuesta generica con link al portal.
  await sendWA(phone,
    `No pude entender tu consulta. Probá con *ayuda* para ver las opciones disponibles, o entrá al portal para ver el detalle de tu obra:\n${portalUrl}`
  );
}

async function getAllAdmins() {
  const users  = await sbGet('app_users', '?select=*');
  const linked = await sbGet('whatsapp_users', '?select=*');
  return linked.filter(lu => {
    const u = users.find(u => u.id === lu.user_id);
    return u?.rol === 'Admin';
  });
}

// ── Conversación ──────────────────────────────────────────────────────────────
// Estado persistido en tabla whatsapp_conversations:
//   { phone, state, data, history, slots, defaults, updated_at }
//
// - state:    'idle' | 'confirmando' | 'conversando' | 'linking_*' | etc.
// - data:     misc por estado (pendingMediaUrl, lastTareaId, etc).
// - history:  últimos N mensajes (texto) para contexto al LLM.
// - slots:    slots de la intención EN CURSO (intent, monto, obraId, tareaId,
//             cantidad, unidad, ...). Se vacía al ejecutar/cancelar.
// - defaults: persiste entre sesiones (lastObraId, lastCajaId, lastProveedorId).
//
// TTL: si la conversación lleva >20 min sin update y NO estamos en idle,
// reseteamos `state='idle'` y `slots={}` pero conservamos `defaults` y
// dejamos `history` (vale como recordatorio liviano).
const TTL_MIN = 20;
const HISTORY_MAX = 16; // antes era 8, corto para flujos con foto

async function loadConversation(phone) {
  const rows = await sbGet('whatsapp_conversations', `?phone=eq.${phone}`);
  const row = rows[0] || { phone, state: 'idle', data: {}, history: [], slots: {}, defaults: {} };
  // Defaults para filas viejas que no tienen las nuevas columnas
  row.slots = row.slots || {};
  row.defaults = row.defaults || {};
  // TTL
  if (row.updated_at && row.state !== 'idle') {
    const age = (Date.now() - new Date(row.updated_at).getTime()) / 60000;
    if (age > TTL_MIN) {
      row.state = 'idle';
      row.slots = {};
      // history y defaults se conservan
    }
  }
  return row;
}

// Save completo de la conversación. Permite pasar `opts` con campos parciales
// (state, data, history, slots, defaults). Lo que no se pase se conserva
// del estado actual — para evitar borradas accidentales tipo el bug previo
// donde pasar `[]` como history hacía un wipe.
async function saveConversation(phone, opts = {}) {
  // Cargar el estado actual para mergear (evita pisar slots/defaults si
  // el caller solo quiere actualizar history o state).
  const current = await loadConversation(phone);
  const next = {
    phone,
    state:    opts.state    !== undefined ? opts.state    : current.state,
    data:     opts.data     !== undefined ? opts.data     : current.data,
    history:  opts.history  !== undefined ? opts.history  : current.history,
    slots:    opts.slots    !== undefined ? opts.slots    : current.slots,
    defaults: opts.defaults !== undefined ? opts.defaults : current.defaults,
    updated_at: new Date().toISOString(),
  };
  next.history = (next.history || []).slice(-HISTORY_MAX);
  await sbUpsert('whatsapp_conversations', next);
}

// Reset de intent: vuelve a idle, vacía slots y data, PERO mantiene history
// y defaults. Antes el clearConversation borraba todo y el bot se olvidaba.
async function clearConversation(phone) {
  await saveConversation(phone, { state: 'idle', data: {}, slots: {} });
}

// ── Lock por teléfono (serializa comprobantes simultáneos) ───────────────────
// Si llegan varios media casi al mismo tiempo (ej. 3 fotos/PDF juntos), Meta
// dispara webhooks en paralelo que se pisan: duplicaban el gasto y guardaban un
// solo archivo. Lock best-effort en defaults.lockUntil, con TTL anti-deadlock y
// espera acotada: cada invocación espera su turno y procesa de a UNA, así cada
// comprobante queda como su propio gasto con su archivo.
const LOCK_TTL_MS  = 30000;  // un lock tomado vence a los 30s (por si la función murió)
const LOCK_WAIT_MS = 9000;   // espera máxima por el turno
const LOCK_POLL_MS = 700;

async function acquireLock(phone) {
  const start = Date.now();
  for (;;) {
    const conv = await loadConversation(phone);
    const until = Number(conv.defaults?.lockUntil) || 0;
    if (until < Date.now()) {
      await saveConversation(phone, { defaults: { ...(conv.defaults || {}), lockUntil: Date.now() + LOCK_TTL_MS } });
      return true;
    }
    if (Date.now() - start >= LOCK_WAIT_MS) return false; // no conseguí turno → proceso igual (best-effort)
    await new Promise(r => setTimeout(r, LOCK_POLL_MS));
  }
}

async function releaseLock(phone) {
  const conv = await loadConversation(phone);
  await saveConversation(phone, { defaults: { ...(conv.defaults || {}), lockUntil: 0 } });
}

// ── Usuario vinculado ─────────────────────────────────────────────────────────
async function getLinkedUser(phone) {
  const rows = await sbGet('whatsapp_users', `?phone=eq.${phone}`);
  if (!rows[0]) return null;
  const linked = rows[0];
  const appUsers = await sbGet('app_users', `?id=eq.${linked.user_id}&select=*`);
  const appUser = appUsers[0];
  if (!appUser) return null;
  // id = app_users.id (= currentUser.id de la app) para alinear createdBy/ownership
  // entre el bot y la app de forma inequívoca.
  return { ...linked, id: appUser.id, email: appUser.email, user_rol: appUser.rol || linked.user_rol, permisos: appUser.permisos, cajasVisibles: appUser.cajas_visibles || [] };
}

// ¿La caja es visible para el usuario? cajasVisibles puede ser:
//  - el string '*'  → admin: ve TODAS las cajas
//  - un array vacío → sin restricción: ve todas
//  - un array de ids → ve solo esas
// Antes el código hacía cajasVisibles.length===0 || cajasVisibles.includes(id),
// que con '*' (string) daba length 1 e includes false → el usuario quedaba SIN
// ninguna caja (bug que rompía 'saldo' y la carga de gastos para admins).
function cajaEsVisible(user, caja) {
  // Contrato unificado con la app (src/lib/permisosCaja.js):
  //  - '*' = admin → ve TODAS las cajas.
  //  - El RESPONSABLE de la caja (caja.usuarioId === su email) la ve siempre, sin
  //    importar cajasVisibles. Es lo que se elige al crear la caja ("a quién
  //    corresponde"); por eso un no-admin ve su caja por WhatsApp sin asignarla a mano.
  //  - Un array lista las cajas asignadas a mano (extra). [] o sin setear = solo las
  //    de las que es responsable (NUNCA todas, para no filtrar la plata de otros).
  if (!caja) return false;
  const cv = user?.cajasVisibles;
  if (cv === '*') return true;
  if (caja.usuarioId && user?.email && caja.usuarioId === user.email) return true;
  if (!Array.isArray(cv)) return false;
  return cv.includes(caja.id);
}

// ── Flujo de vinculación ──────────────────────────────────────────────────────
async function handleLinkingFlow(phone, text, conv) {
  if (conv.state === 'idle' || conv.state === 'linking_awaiting_user') {
    if (conv.state === 'idle') {
      await saveConversation(phone, { state: 'linking_awaiting_user', data: {}, history: [] });
      await sendWA(phone,
        '👋 Hola! Soy el asistente de *Kamak Desarrollos*.\n\n' +
        'Para vincular tu número con tu cuenta, escribí tu *nombre completo* o tu *email* registrado en el sistema.'
      );
      return;
    }

    const query = text.trim().toLowerCase();
    const appUsers = await sbGet('app_users', '?select=*');
    const match = appUsers.find(u =>
      u.email?.toLowerCase() === query ||
      u.nombre?.toLowerCase().includes(query) ||
      query.includes(u.nombre?.toLowerCase())
    );

    if (!match) {
      await sendWA(phone,
        '❌ No encontré ningún usuario con ese nombre o email.\n\nIntentá nuevamente con tu email exacto o nombre completo.'
      );
      return;
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    // Limpiar códigos previos de este número antes de crear el nuevo. La PK de
    // whatsapp_verifications es el `code`, así que sin esto cada pedido dejaba
    // una fila nueva y se acumulaban varias para el mismo email — lo que rompía
    // el banner de confirmación en la app (usaba .maybeSingle()).
    await sbDelete('whatsapp_verifications', `?phone=eq.${phone}`);

    await sbUpsert('whatsapp_verifications', {
      code,
      phone,
      user_email: match.email,
      expires_at: expiresAt,
    });

    await saveConversation(phone, { state: 'linking_awaiting_confirmation', data: { user_email: match.email, user_name: match.nombre }, history: [] });

    await sendWA(phone,
      `✅ Encontré tu cuenta: *${match.nombre}*\n\n` +
      `Tu código de verificación es: *${code}*\n\n` +
      `Ingresá a la app Kamak y confirmá la vinculación desde el aviso que aparece en pantalla. Tenés 15 minutos.`
    );
    return;
  }

  if (conv.state === 'linking_awaiting_confirmation') {
    const linked = await sbGet('whatsapp_users', `?phone=eq.${phone}`);
    if (linked[0]) {
      await clearConversation(phone);
      await sendWA(phone,
        `🎉 ¡Tu cuenta ya está vinculada! Bienvenido/a *${linked[0].user_name}*.\n\nEscribí *ayuda* para ver qué podés hacer desde acá.`
      );
    } else {
      await sendWA(phone,
        '⏳ Todavía no confirmaste en la app.\n\nAbrí Kamak y confirmá el aviso que aparece en pantalla.'
      );
    }
  }
}

// ── Detección de corrección de avance ────────────────────────────────────────
function extractCorreccion(text, obras, detalles) {
  if (!text) return null;
  const t = norm(text);

  const corrRE = /correg|corrijo|me equivoqu|error|en realidad|eran|era\b|no eran|no son|no era\b|cambiar avance|editar avance|modific/i;
  if (!corrRE.test(t)) return null;

  // Reutilizamos la extracción de avance para sacar obra, tarea y nueva cantidad
  const base = extractAvanceCompleto(text, obras, detalles);
  // Para corrección no requerimos la señal de avance, así que si no matcheó por eso
  // intentamos buscar obra + tarea + número directamente
  if (base?.obraId && base?.tareaId && base?.cantidadAvance != null) {
    return { ...base, esCorreccion: true };
  }

  // Intento directo: número + obra + tarea (sin palabras de avance)
  const cantRE = /(\d+(?:[.,]\d+)?)\s*(mts?2?|m2|m²|m3|m³|ml|u\b|kg|hs|unid(?:ades?)?)?/i;
  const cantMatch = text.match(cantRE);
  if (!cantMatch) return null;

  let obraEncontrada = null;
  for (const o of obras) {
    const oNorm = norm(o.nombre);
    if (t.includes(oNorm)) { obraEncontrada = o; break; }
    const pals = oNorm.split(/\s+/).filter(p => p.length > 3);
    if (pals.some(p => t.includes(p))) { obraEncontrada = o; break; }
  }

  let tareaEncontrada = null, rubroEncontrado = null;
  const buscar = obraEncontrada ? [obraEncontrada, ...obras.filter(o => o.id !== obraEncontrada.id)] : obras;
  outer2:
  for (const o of buscar) {
    for (const r of (detalles[o.id]?.rubros || []).filter(r => r.tipo !== 'seccion')) {
      for (const ta of (r.tareas || []).filter(ta => ta.tipo !== 'seccion')) {
        const taNorm = norm(ta.nombre);
        const pals = taNorm.split(/\s+/).filter(p => p.length > 2);
        if (t.includes(taNorm) || pals.some(p => t.includes(p))) {
          tareaEncontrada = ta; rubroEncontrado = r;
          if (!obraEncontrada) obraEncontrada = o;
          break outer2;
        }
      }
    }
  }

  if (!obraEncontrada || !tareaEncontrada || !cantMatch) return null;

  return {
    completo:       true,
    esCorreccion:   true,
    obraId:         obraEncontrada.id,
    rubroId:        rubroEncontrado?.id || null,
    tareaId:        tareaEncontrada.id,
    cantidadAvance: parseFloat(cantMatch[1].replace(',', '.')),
    unidad:         cantMatch[2] ? norm(cantMatch[2]) : (tareaEncontrada.unidad || 'u'),
    descripcion:    text.slice(0, 120),
    _obra:          obraEncontrada,
    _tarea:         tareaEncontrada,
  };
}

// ── Extracción directa de avance — bypasa Claude cuando todo está en el texto ──
const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function extractAvanceCompleto(text, obras, detalles) {
  if (!text) return null;
  const t = norm(text);

  // Señal explícita de avance (requerida para el bypass)
  const avanceRE = /avance\s*de\s*obra|avance|coloc[aó]|instal[aó]|termin[eéóa]|terminamos|colocamos|hicimos|pusimos|avanzamos|finaliz|pegamos|revoc|enyesamos/i;
  if (!avanceRE.test(t)) return null;

  // Extraer cantidad + unidad
  // Caso 1: número + unidad estándar ("440 mts2", "75 m²")
  const cantRE = /(\d+(?:[.,]\d+)?)\s*(mts?2?|m2|m²|m3|m³|ml|u\b|kg|hs|unid(?:ades?)?)/i;
  let cantMatch = text.match(cantRE);
  let rawQty = cantMatch ? parseFloat(cantMatch[1].replace(',', '.')) : null;
  let rawUnit = cantMatch ? norm(cantMatch[2]) : null;
  let extraQtyWord = null;

  // Caso 2: número + palabra ("50 tomas", "12 bocas") — la palabra puede ser el nombre de la tarea
  if (!cantMatch) {
    const numWordMatch = t.match(/\b(\d+)\s+([a-záéíóúñ]{3,})/);
    if (numWordMatch) {
      rawQty  = parseFloat(numWordMatch[1]);
      rawUnit = 'u';
      extraQtyWord = numWordMatch[2];
    }
  } else {
    // También guardar la palabra que sigue para ayudar a matchear la tarea ("50 mts2 de ceramicos")
    const after = t.substring(t.indexOf(cantMatch[0]) + cantMatch[0].length);
    const m = after.match(/\s+de\s+([a-záéíóúñ]{3,})/);
    if (m) extraQtyWord = m[1];
  }

  // Matchear obra por nombre (full match primero, luego por palabra significativa)
  let obraEncontrada = null;
  for (const o of obras) {
    const oNorm = norm(o.nombre);
    if (t.includes(oNorm)) { obraEncontrada = o; break; }
    const palabras = oNorm.split(/\s+/).filter(p => p.length > 3);
    if (palabras.length > 0 && palabras.some(p => t.includes(p))) { obraEncontrada = o; break; }
  }

  // Matchear tarea (busca en obra encontrada primero, luego en el resto)
  let tareaEncontrada = null, rubroEncontrado = null;
  const obrasBuscar = obraEncontrada
    ? [obraEncontrada, ...obras.filter(o => o.id !== obraEncontrada.id)]
    : obras;

  outer:
  for (const o of obrasBuscar) {
    const rubros = (detalles[o.id]?.rubros || []).filter(r => r.tipo !== 'seccion');
    for (const r of rubros) {
      for (const ta of (r.tareas || []).filter(ta => ta.tipo !== 'seccion')) {
        const taNorm = norm(ta.nombre);
        const taPals = taNorm.split(/\s+/).filter(p => p.length > 2);
        // Coincidencia: nombre completo, cualquier palabra significativa, o extraQtyWord
        const matchNombre = t.includes(taNorm);
        const matchPalabra = taPals.some(p => t.includes(p));
        const matchQtyWord = extraQtyWord && taPals.some(p =>
          p === extraQtyWord || p.startsWith(extraQtyWord) || extraQtyWord.startsWith(p)
        );
        if (matchNombre || matchPalabra || matchQtyWord) {
          tareaEncontrada = ta; rubroEncontrado = r;
          if (!obraEncontrada) obraEncontrada = o;
          break outer;
        }
      }
    }
  }

  if (!obraEncontrada && !tareaEncontrada) return null;

  return {
    completo:      !!(obraEncontrada && tareaEncontrada && rawQty != null),
    obraId:        obraEncontrada?.id || null,
    rubroId:       rubroEncontrado?.id || null,
    tareaId:       tareaEncontrada?.id || null,
    cantidadAvance: rawQty,
    unidad:        rawUnit || tareaEncontrada?.unidad || 'u',
    descripcion:   text.slice(0, 120),
    _obra:         obraEncontrada,
    _tarea:        tareaEncontrada,
  };
}

// ── Claude: interpretar mensaje ───────────────────────────────────────────────
async function callClaude(user, messageText, base64Media, mimeType, conv, ctx, mediaUrl = null) {
  const cajasUsuario = ctx.cajas.filter(c => cajaEsVisible(user, c));
  const cajasEfectivo = ctx.cajas.filter(c => c.tipo === 'efectivo' && c.usuarioId === user.email);
  const cajaEfectivoARS = cajasEfectivo.find(c => c.moneda === 'ARS');
  const cajaEfectivoUSD = cajasEfectivo.find(c => c.moneda === 'USD');

  // Última obra usada por este usuario (de movimientos aprobados)
  const userMovs = ctx.movimientos
    .filter(m => m.obraId && (m.creadoPor === user.user_name || m.creadoPorWA))
    .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  const ultimaObraId = userMovs[0]?.obraId || null;
  const ultimaObra = ultimaObraId ? ctx.obras.find(o => o.id === ultimaObraId) : null;

  // Rubros de la obra en contexto (conversación activa o última usada)
  const obraContextId = conv.data?.obraId || ultimaObraId;
  const obraContext = obraContextId ? ctx.obras.find(o => o.id === obraContextId) : null;
  const obraRubros = obraContextId
    ? (ctx.detalles[obraContextId]?.rubros || []).filter(r => r.tipo !== 'seccion')
    : [];

  // Pre-extracción parcial como hint (para cuando el bypass no activó)
  const preExtObj = extractAvanceCompleto(messageText, ctx.obras, ctx.detalles);
  const preExtracted = preExtObj ? [
    preExtObj.cantidadAvance != null ? `cantidadAvance=${preExtObj.cantidadAvance} unidad=${preExtObj.unidad}` : null,
    preExtObj._obra ? `obra="${preExtObj._obra.nombre}" obraId=${preExtObj.obraId}` : null,
    preExtObj._tarea ? `tarea="${preExtObj._tarea.nombre}" tareaId=${preExtObj.tareaId} rubroId=${preExtObj.rubroId}` : null,
  ].filter(Boolean).join(' · ') : null;

  // Rubros de TODAS las obras activas para que Claude siempre pueda matchear
  const allRubrosStr = ctx.obras.slice(0, 6).map(o => {
    const rubros = (ctx.detalles[o.id]?.rubros || []).filter(r => r.tipo !== 'seccion').slice(0, 6);
    if (rubros.length === 0) return null;
    const isCtx = o.id === obraContextId;
    const rubStr = rubros.map(r => {
      const ts = (r.tareas || []).filter(t => t.tipo !== 'seccion').slice(0, 12);
      const tsStr = ts.length > 0
        ? '\n' + ts.map(t => `      TAREA:${t.id}|${t.nombre}|total:${t.cantidad}${t.unidad}|av:${t.avance||0}%${(isCtx && isAdmin(user)) ? `|costoSubUnit:${Math.round(t.costoSub||0)}` : ''}`).join('\n')
        : '';
      return `    RUBRO:${r.id}|${r.nombre}|prov:${r.proveedor||'—'}${tsStr}`;
    }).join('\n');
    return `  OBRA:${o.id}|${o.nombre}|estado:${o.estado || '—'}${o.estado === 'en-presupuesto' ? ' (PROPUESTA: sin cobros/cuotas confirmados)' : ''}${isCtx ? ' ← CONTEXTO ACTUAL' : ''}\n${rubStr}`;
  }).filter(Boolean).join('\n') || 'sin rubros cargados';

  // ── SLOTS YA CONOCIDOS — bloque crítico anti-repreguntas ────────────────────
  // Si el caller cargó conv.slots (con valores extraídos por extractors.js),
  // los inyectamos al prompt con instrucción explícita de NO repreguntar.
  const slotsObj = conv?.slots || {};
  const slotsEntries = Object.entries(slotsObj).filter(([_, v]) => v != null && v !== '');
  const slotsBlock = slotsEntries.length > 0
    ? `\n\n🔑 SLOTS YA CONOCIDOS (NO REPREGUNTES POR ESTOS):\n${slotsEntries.map(([k, v]) => `  ${k}: ${v}`).join('\n')}\nUsalos directamente en la acción. Si falta algo, preguntá SOLO por lo que falta. Si el usuario corrige uno ("no, eran 60k"), mergealo sobre los slots ya conocidos sin pedir lo que ya tenías.`
    : '';

  // Defaults: última obra/caja/etc usada por el user (persiste entre sesiones).
  const defaultsObj = conv?.defaults || {};
  const defaultsEntries = Object.entries(defaultsObj).filter(([_, v]) => v != null && v !== '');
  const defaultsBlock = defaultsEntries.length > 0
    ? `\n\n📌 DEFAULTS DEL USUARIO (usá si el mensaje no especifica obra/caja/etc):\n${defaultsEntries.map(([k, v]) => `  ${k}: ${v}`).join('\n')}`
    : '';

  // Resumen de ÓRDENES DE PAGO abiertas para que Claude pueda responder "¿qué
  // facturas tengo pendientes?" y matchear pagos. Solo abiertas. Visibilidad por
  // dueño: Admin/Administración ven todas; el resto solo las que cargó cada uno
  // (createdBy = user_id del app_user, alineado con la app).
  const _esAdminBot = user.user_rol === 'Admin' || user.user_rol === 'Administración';
  const facturasAbiertas = (ctx.facturasPendientes || [])
    .filter(f => esFacturaAbiertaBot(f) && (_esAdminBot || f.createdBy === user.id || f.createdBy === user.user_name));
  const facturasPendientesBlock = facturasAbiertas.length > 0
    ? `\n\nÓRDENES DE PAGO (facturas de proveedor pendientes de pago, deuda devengada):\n` +
      facturasAbiertas.slice(0, 20).map(f =>
        `- ${f.proveedor || '—'}${f.numero ? ` · N° ${f.numero}` : ''} · saldo $${Math.round(saldoFacturaPendienteBot(f)).toLocaleString('es-AR')}${f.fecha ? ` · ${f.fecha}` : ''}`
      ).join('\n') +
      (facturasAbiertas.length > 20 ? `\n  (+${facturasAbiertas.length - 20} facturas más — pedile al usuario que filtre por proveedor)` : '') +
      `\n→ Si el usuario pregunta "¿qué facturas tengo pendientes?" / "qué debo pagar" / "facturas impagas", listale esto (proveedor, número, saldo). Total pendiente: $${Math.round(facturasAbiertas.reduce((s, f) => s + saldoFacturaPendienteBot(f), 0)).toLocaleString('es-AR')}.`
    : `\n\nÓRDENES DE PAGO: no hay facturas impagas cargadas.`;

  const systemPrompt = `Sos el asistente de WhatsApp de Kamak Desarrollos, una constructora argentina.
Ayudás al equipo interno a registrar información en el sistema de gestión.
${slotsBlock}${defaultsBlock}

USUARIO ACTUAL:
- Nombre: ${user.user_name}
- Rol: ${user.user_rol}
- Caja efectivo ARS propia: ${cajaEfectivoARS ? `${cajaEfectivoARS.id}|${cajaEfectivoARS.nombre}` : 'ninguna'}
- Caja efectivo USD propia: ${cajaEfectivoUSD ? `${cajaEfectivoUSD.id}|${cajaEfectivoUSD.nombre}` : 'ninguna'}
- Otras cajas accesibles: ${cajasUsuario.filter(c => c.tipo !== 'efectivo' || c.usuarioId !== user.email).map(c => `${c.id}|${c.nombre}(${c.tipo},${c.moneda})`).join(', ') || 'ninguna'}

OBRAS ACTIVAS:
${ctx.obras.map(o => `- ${o.id}|${o.nombre}`).join('\n') || 'No hay obras activas'}

ÚLTIMA OBRA DEL USUARIO:
${ultimaObra ? `${ultimaObra.id}|${ultimaObra.nombre}` : 'sin historial'}

OBRAS ACTIVAS CON RUBROS Y TAREAS (buscá aquí obra y tarea cuando el usuario las mencione):
${allRubrosStr}
→ Para AVANCE_OBRA: usá los IDs exactos RUBRO:id y TAREA:id de esta lista. Matcheá obra y tarea por nombre aunque el usuario escriba con errores o abreviado.

PROVEEDORES:
${ctx.proveedores.slice(0, 30).map(p => `- ${p.id}|${p.nombre}(${p.tipo})`).join('\n')}
${facturasPendientesBlock}

MATCHING DE CAJAS Y OBRAS — MUY IMPORTANTE:
- Ignorá mayúsculas/minúsculas siempre. "baradero" = "Baradero", "franco" = "Franco".
- Usá matching parcial: si el usuario dice "caja franco" buscá la caja cuyo nombre contenga "franco".
- Si el usuario dice "obra baradero" buscá la obra cuyo nombre contenga "baradero".
- Si hay una sola coincidencia parcial, usala directamente sin preguntar.
- Solo preguntá si hay ambigüedad (2+ coincidencias) o ninguna.

CAJA / MEDIO DE PAGO — MUY IMPORTANTE (NO REPREGUNTAR SI SE PUEDE INFERIR):
- LEÉ EL MEDIO DE PAGO DE LA FOTO: si hay imagen de ticket/factura, los comprobantes argentinos suelen indicar al pie cómo se pagó ("MERCADO PAGO", "MERVAL", "DÉBITO", "VISA DÉBITO", "CRÉDITO", "EFECTIVO", "TARJETA", "QR"). Si lo ves en la foto, usá ESE medio aunque el usuario no lo haya escrito.
- Sino, el usuario suele decir CÓMO pagó. Detectá el medio y elegí la caja:
  · "efectivo", "en mano", "cash", "de mi caja", "caja propia" o NO dice nada → su CAJA EFECTIVO (ARS si el monto es en $, USD si es en u$s).
  · "mercado pago", "mp", "mercadopago" → la caja cuyo nombre contenga "mercado" o "mp".
  · "tarjeta", "débito", "crédito", "visa", "master", "con la tarjeta del banco" → la caja tipo banco (o la que tenga "tarjeta"/"banco" en el nombre).
  · "transferencia", "transferí", "por transferencia", "banco", "galicia", "nación", etc. → la caja banco que matchee por nombre.
  · Si menciona una caja por nombre explícito ("de caja franco") → matching parcial directo.
- Guardá SIEMPRE el medio en datos.medioPago: "Efectivo" | "Mercado Pago" | "Tarjeta" | "Transferencia".
- PRIORIDAD: lo que dice el usuario en el texto > lo que dice la foto. Si el usuario escribe "pagué en efectivo" pero la foto dice débito, preguntá cuál vale.
- Orden de fallback si NO se infiere medio ni caja (SOLO PARA GASTOS):
  1. Caja efectivo propia (según moneda).
  2. lastCajaId de los DEFAULTS DEL USUARIO.
  3. Solo si no hay ninguna → preguntá la caja.
- Si el usuario menciona un medio (MP/tarjeta/banco) pero NO existe una caja accesible que matchee, ahí SÍ preguntá cuál usar (mostrale las opciones de sus cajas).
- INGRESOS — REGLA ESPECIAL: un ingreso es plata que entra y la caja importa. NO uses
  el fallback de arriba para ingresos. NUNCA infieras la caja a partir del nombre de la
  OBRA (una obra y una caja pueden llamarse igual, ej. "Baradero": "baradero" ahí es la
  OBRA, no la caja). Para un ingreso, completá datos.cajaId SOLO si el usuario nombró una
  caja explícita ("a caja Pablo", "entra a Galicia") o un medio de pago claro (efectivo/
  MP/transferencia/tarjeta). Si NO mencionó caja ni medio, dejá datos.cajaId VACÍO
  (sin completar) — el bot le preguntará a qué caja.

OBRA — INFERENCIA Y CONFIRMACIÓN:
- Si el usuario no menciona obra pero hay "Última obra del usuario": proponé esa obra y pedí confirmación.
  Ejemplo: "¿Es para [nombre obra]?" — si confirma, usá ese obraId.
- Si el usuario confirma la obra sugerida (sí/dale/esa/correcto): usá esa obra.
- NUNCA uses una obra sin que el usuario la haya mencionado o confirmado.
- Si el usuario menciona una obra: buscala por matching parcial en la lista de obras activas.

RUBRO — SUGERENCIA INTELIGENTE:
- Cuando el usuario describe un MATERIAL o SERVICIO (ej: "tornillos", "pintura", "arena", "caños"), analizá qué rubros de la obra son compatibles con ese material.
- Descartá los rubros donde ese material claramente NO se usaría (ej: tornillos no van en Pintura, arena no va en Electricidad).
- Si quedan 2 o más rubros posibles, preguntá: "¿Para qué rubro?\n1) Albañilería\n2) Construcción en seco\n..." (solo los relevantes, máx 4 opciones)
- Si solo queda 1 rubro posible, usalo directamente sin preguntar.
- Si no hay obra seleccionada todavía, primero confirmá la obra, luego preguntás el rubro.
- El rubro se guarda en el campo "descripcion" del gasto junto al material: "Tornillos - Albañilería".

RAZONAMIENTO DE CATEGORÍA — INFERÍ SIN PREGUNTAR:
- Si el gasto NO corresponde a un material/servicio de obra (no matchea ningún rubro), inferí la categoría lógica por sentido común y poné una descripción clara. NO preguntes, asumí lo razonable:
  · comida, almuerzo, vianda, café, agua, asado, factura(panadería) → *Viáticos* (descripcion: "Viáticos - comida" o similar)
  · nafta, combustible, gasoil, peaje, estacionamiento, uber, remís, pasaje, colectivo → *Movilidad / Combustible*
  · herramienta, taladro, amoladora, alquiler de equipo, andamio → *Herramientas / Equipos*
  · librería, fotocopias, impresión, resma → *Gastos administrativos*
  · seguro, ART, sindicato, honorarios → *Gastos generales*
  · propina, adelanto, anticipo a alguien → *Anticipo / Varios*
- Ejemplo: "gasté en comida \$2.000 en Baradero" → gasto, monto:2000, obraId:baradero, descripcion:"Viáticos - comida", categoria:"general". Ejecutá directo si tenés obra + monto, no repreguntes.
- Cuando dudes entre 2 categorías muy distintas, ahí sí preguntá; pero para casos obvios (comida=viáticos, nafta=combustible) asumí y avisá en el resumen de confirmación qué asumiste.

FOTO EN ESTA CONVERSACIÓN:
- Foto en este mensaje: ${base64Media ? 'SÍ (recién recibida)' : 'NO'}
- Foto guardada de mensaje anterior: ${conv.data?.pendingMediaUrl ? 'SÍ (ya subida, disponible para usar)' : 'NO'}
→ Si hay foto guardada de antes, considerala como si fuera parte de este intercambio. NO pidas otra foto.

ROL DEL USUARIO — SESGO POR DEFECTO (no es una regla fija, cualquier rol puede hacer cualquier cosa):
- "Jefe de obra" / "Capataz": en caso de ambigüedad, asumí avance_obra. Si la foto no parece factura y no dice "compré" o "gasté" → avance. Si el usuario dice explícitamente "gasto", "pagué", "compré" → registrá como gasto.
- "Compras" / "Administración": en caso de ambigüedad, asumí gasto/factura. Si el usuario dice explícitamente "avance", "terminamos", "colocamos" → registrá como avance_obra.
- "Admin": sin sesgo. Seguí el flujo normal de preguntas.

TEXTO TIENE PRIORIDAD SOBRE LA IMAGEN:
- Si el texto del mensaje dice "avance de obra", "Avance de obra", "avancé", "foto del avance" → es SIEMPRE avance_obra. No importa lo que veas en la foto, el texto manda.
- Si el texto menciona una tarea ("revoque grueso", "cerámicos", "pintura"), usá ese texto para matchear con la lista de tareas. No analices la imagen para determinar la tarea.
- La foto es solo evidencia visual adjunta al registro, no es la fuente principal de interpretación.

EXTRACCIÓN DE CONTEXTO DEL HISTORIAL — MUY IMPORTANTE:
- Antes de hacer cualquier pregunta, revisá el HISTORIAL completo de la conversación.
- Si en algún mensaje anterior ya se mencionó la tarea, cantidad, obra o cualquier dato → usá ese dato directamente. NO lo vuelvas a pedir.
- Ejemplo: si el historial tiene "285 mts2 de revoque grueso en Baradero" → ya tenés cantidadAvance=285, unidad=m², tarea≈Revoque grueso, obra=Baradero. No preguntes nada de eso.
- Cuando el usuario confirma ("sí", "es avance", "para Baradero") → es una confirmación, no una nueva instrucción. Integrá esa confirmación con lo que ya tenés del historial y armá el registro completo.

AVANCE DE OBRA — PARSEO INTELIGENTE:
- REGLA CLAVE: si el mensaje (o el historial) tiene cantidad en unidades de obra (m², ml, m3, u, kg, hs) + nombre de trabajo + nombre de obra, y NO menciona precio → es avance_obra. Procesalo directo sin preguntar.
  Ejemplo: "285 mts2 de revoque grueso en obra Baradero" → avance_obra, obra=Baradero, tarea≈Revoque, cantidadAvance=285, unidad=m²
- Palabras que indican avance: "avance de obra", "avancé", "colocados", "instalados", "terminados", "terminé", "colocamos", "hicimos", "pusimos", "avanzamos", "quedó listo", "finalizado", "pegamos", "grueso", "revocamos".
- Matcheá obra y tarea por similitud: "revoque grueso" → tarea "Revoque", "ceramicos" → "Cerámicos". No importan mayúsculas ni tildes.
- Extraé cantidadAvance del número + unidad: "285 mts2" → 285 m², "20 metros lineales" → 20 ml.
- Mandá siempre los IDs exactos rubroId y tareaId. Calculá % automáticamente: cantidadAvance / total de la tarea.
- DISTINGUIR "hoy/se hizo" (suma) vs "total acumulado" (corrige):
  • "150 m² hoy", "hicimos 50 m² hoy", "se colocaron 30 m²" → es AVANCE DEL DIA: datos.esCorreccion=false (se SUMA al avance previo).
  • "ya van 850 m² en total", "llevamos 700 m² acumulados", "el total es 500 m²" → es CORRECCIÓN/SET: datos.esCorreccion=true (REEMPLAZA el avance, no suma).
- Si el usuario es ambiguo entre "hoy" vs "total", PREGUNTÁ explícitamente: "¿son los m² que hicieron hoy o el total acumulado de la tarea?".

ORDEN DE PREGUNTAS (nunca más de una a la vez):
0. SIEMPRE revisá el historial ANTES de hacer preguntas. Si la información ya fue dada, usala. No repitas preguntas.
1. Si llega FOTO — REGLA DE ORO: si el texto menciona una OBRA y/o un CONCEPTO de gasto (combustible, nafta, comida, materiales, flete, herramienta, etc.), es un GASTO DIRECTO (no factura). Leé el monto de la foto del ticket/comprobante y cargá el gasto. NO lo mandes a factura_compra solo porque la foto tenga números o CUIT.
   - Si el texto dice "avance de obra" o tiene cantidad+tarea → avance_obra DIRECTO.
   - Si el texto menciona obra o concepto de gasto (ej: "combustible baradero", "comida en sismat", "materiales pilar") → GASTO directo: extraé el monto de la foto, obra del texto, caja efectivo del usuario, comprobante=blanco. Inferí la categoría (combustible→Movilidad, comida→Viáticos, etc.). NO preguntes caja ni mandes a factura.
   - Si el texto dice "gasto"/"pagué"/"compré" → gasto con comprobante.
   - Si el texto tiene cantidad en unidades (m², ml, u, etc.) + trabajo + sin precio → avance_obra directo.
   - Si el texto dice "avancé"/"colocamos"/"terminamos"/"instalados"/"terminé" → avance_obra.
   - SOLO usá factura_compra si: el texto dice EXPLÍCITAMENTE "factura"/"facturá esto"/"cargá la factura", O no hay ningún contexto (ni obra ni concepto) y la foto es claramente una factura formal de proveedor.
   - FOTO DE TICKET/COMPROBANTE DE COMPRA SIN TEXTO (ticket de super, estación de servicio, ferretería, restaurante, etc.): es SIEMPRE un GASTO. NUNCA respondas solo describiendo la foto ("veo un ticket de..."). Leé el monto y el medio de pago de la imagen, inferí la categoría por el comercio (supermercado/restaurante→Viáticos, estación→Combustible, ferretería/corralón→Materiales) y armá el gasto. Si NO sabés la obra, preguntá SOLO eso: "¿Para qué obra es este gasto de $X?" — proponé la última obra del usuario. NUNCA preguntes "¿avance, gasto o factura?" cuando es obvio que es un ticket de compra.
   - Si NO hay texto claro y rol es "Jefe de obra"/"Capataz" y la foto es de obra (no ticket) → asumí avance_obra, preguntá SOLO lo que no se sabe.
2. Si llega FOTO + texto de gasto (con obra o concepto): procesá como gasto con comprobante=blanco automáticamente, monto leído de la foto, caja efectivo del usuario. NO repreguntes obra ni caja si están claras.
3. Si llega FOTO + texto de avance ("avancé", "foto de avance", "progreso", "terminé", "colocamos", "terminado", "avance de obra"): procesá como avance_obra directamente.
4. MONTO: si hay FOTO de ticket/factura/comprobante, LEÉ el monto total de la imagen (el TOTAL a pagar, no subtotales). NUNCA preguntes el monto cuando hay un comprobante adjunto — el monto SIEMPRE está en el ticket. Solo preguntá el monto si NO hay foto y el usuario no lo escribió.
5. Si falta obra → proponé la última o pedí que la indique
6. Si falta rubro → mostrá opciones relevantes al material
7. Si falta comprobante (y NO hay foto en esta conversación) → preguntá "¿Tiene factura? (sí/no)"
8. Con todo completo → mostrá resumen y pedí confirmación

ACCIONES DISPONIBLES:
1. GASTO: monto, descripción, obraId(opcional), cajaId, proveedorNombre(opcional), tipo(material/mano_de_obra/general), comprobante(blanco/negro), rubroId(opcional), rubroNombre(opcional, nombre EXACTO del rubro del presupuesto de la obra al que se imputa el gasto — sirve para el desvío presupuesto vs real), categoriaFiscal(opcional: 'sueldo'|'cs-soc'|'sind'|'iibb'|'alquiler'|'servicios'|'seguro'|'otro'), percepcionIIBB(opcional, número en pesos), jurisdiccionIIBB(opcional: 'PBA'|'CABA'|'CBA'|'OTRA', default PBA), percepcionIVA(opcional, número en pesos).
   IMPORTANTÍSIMO — el campo "monto" es SIEMPRE el TOTAL del gasto (lo que sale de la caja), con IVA, percepciones y todo incluido. NUNCA pongas el neto en "monto". Si una Factura A discrimina neto $1.000.000 e IVA $210.000, el monto del gasto es $1.210.000 (no $1.000.000) — eso es lo que pagó el usuario.
   IMPORTANTE — DATOS FISCALES EN GASTOS CON FOTO DE FACTURA/TICKET: si la imagen MUESTRA un comprobante formal (Factura A/B/C, ticket fiscal con CAE/CAI), agregá TAMBIÉN en datos: tipoFactura ('A'/'B'/'C', leído de la foto), numeroFactura, cuit (del emisor), montoNeto (opcional, solo si la foto discrimina explícitamente el neto sin IVA — sirve para registrar el desglose con la alícuota real del ticket). El sistema usa esto para el Libro IVA Compras. Es ortogonal a la regla de oro: el gasto sigue cargándose rápido como gasto, NO como factura_compra, pero los datos fiscales viajan dentro del gasto. Si la foto NO discrimina IVA (ticket no fiscal), no completes esos campos.
   PERCEPCIONES DISCRIMINADAS EN EL TICKET (hay DOS, distintas — leelas por separado): aparecen como renglones EXTRA arriba del total, muy común en estaciones de servicio (YPF/Shell/Axion), supermercados mayoristas y ferreterías grandes.
   (a) PERCEPCIÓN IIBB → "Perc. IIBB", "Percepción IIBB Bs As", "IB Pcia Bs As", "Ingresos Brutos". Ponela en datos.percepcionIIBB. Es pago a cuenta de Ingresos Brutos. JURISDICCIÓN: leé de qué provincia es ese renglón y poné el código en datos.jurisdiccionIIBB → 'PBA' (Buenos Aires / Pcia Bs As / ARBA), 'CABA' (Capital Federal / AGIP), 'CBA' (Córdoba), 'OTRA' (cualquier otra). Si no se indica, dejá 'PBA' (es donde opera la empresa).
   (b) PERCEPCIÓN IVA → "Perc. IVA", "Percep. IVA RG 2408", "Perc. RG 3337", "IVA Percepción". Ponela en datos.percepcionIVA. Es pago a cuenta del IVA.
   Son impuestos DISTINTOS: NO las sumes juntas, NO las confundas entre sí, y NO las confundas con el IVA del comprobante ni con el neto. Si el ticket discrimina las dos, completá AMBOS campos con sus montos en pesos. Si solo aparece una, completá solo esa. Si no aparece ninguna discriminada, no completes ninguno. El total del gasto ya las incluye (son lo que pagaste); el sistema las resta de la base del IVA y las descuenta del impuesto que corresponde (IIBB o IVA del mes).
   RECIBO DE SUELDO / CARGAS / SINDICATO / ALQUILER / SERVICIOS: si el texto o la foto refieren a "recibo de sueldo", "haberes", "liquidación", "sueldo de X", "F.931" (cargas sociales), "boleta UOCRA"/"sindicato", "alquiler", o servicios (luz/gas/internet) — completá el campo categoriaFiscal con la opción que corresponda y NO incluyas tipoFactura/numeroFactura/cuit/montoNeto (estos comprobantes NO generan IVA crédito y no van al Libro IVA Compras; el panel Financiero los suma a su columna por categoría). El gasto sigue siendo un GASTO normal con su monto y su foto.
2. INGRESO: monto, descripción, obraId, cajaId
3. FACTURA_COMPRA: foto/PDF de factura de proveedor. Extraé: tipoFactura('A'/'B'/'C'), numeroFactura, proveedor, cuit, fecha(YYYY-MM-DD), monto(TOTAL del comprobante con IVA y percepciones — lo que paga la empresa, NUNCA el neto), montoNeto(opcional, solo si la foto discrimina el neto sin IVA), percepcionIIBB(opcional), jurisdiccionIIBB(opcional: 'PBA'|'CABA'|'CBA'|'OTRA', default PBA), percepcionIVA(opcional), claseComprobante('factura'|'nota_credito'), concepto, yaPagada(opcional, booleano), soloRegistrar(opcional, booleano)
   IMPORTANTE — FACTURA PENDIENTE DE PAGO (default): por DEFECTO una factura de proveedor que llega se carga como PENDIENTE DE PAGO (deuda devengada: cuenta para el Libro IVA desde su fecha aunque todavía no se haya pagado). NO pongas yaPagada salvo que el usuario aclare explícitamente que la factura YA SE PAGÓ ("ya la pagué", "esta ya está paga", "la abonamos", "pagada"). Si el usuario lo aclara → yaPagada=true (el sistema la carga como gasto debitando la caja). Si solo manda la factura sin decir nada de pago → dejá yaPagada sin completar (queda pendiente). OJO: si el mensaje es "le pagué $X a [proveedor]" eso NO es factura_compra, es PAGO_PROVEEDOR (acción 10).
   FACTURA SOLO REGISTRAR (sin movimiento de caja ni deuda): si el usuario aclara que la factura NO es un gasto/deuda a pagar — "es personal", "a nombre de la empresa pero es mía/personal", "no la vamos a pagar", "no es un gasto", "solo registrala", "cargala sin pago", "que no mueva caja", "sin movimiento", o es una "venta por cuenta y orden" (típico combustible ACA/YPF) — poné soloRegistrar=true. El sistema la carga SOLO para el Libro IVA (cuenta para IVA/AFIP) pero NO como deuda ni mueve ninguna caja (no figura en Cuentas por Pagar). Las tres opciones son excluyentes: yaPagada (sale de caja ahora) ≠ pendiente (deuda a pagar, default) ≠ soloRegistrar (ni deuda ni caja). Si NO queda claro si es una deuda a pagar o solo un registro, PREGUNTÁ: "¿Es una factura a pagar o solo la registro sin mover caja?".
   NOTA DE CRÉDITO DE PROVEEDOR: si la foto/PDF dice "Nota de Crédito" / "NOTA DE CREDITO A/B/C" / "NC" (no confundir con "Nota de Débito") → poné claseComprobante='nota_credito'. Es un comprobante que el proveedor emite para REVERTIR (total o parcial) una factura anterior — devolución, bonificación, error. El monto sigue siendo el total del comprobante (positivo); el sistema lo registra en negativo en el Libro IVA Compras. Para facturas/tickets normales, claseComprobante='factura' o dejalo vacío.
4. AVANCE_OBRA: obraId(ID exacto de la lista), rubroId(ID del rubro), tareaId(ID de la tarea), cantidadAvance(unidades completadas, ej:75), unidad(ej:'m²'), porcentajeAvance(% a sumar si no hay cantidad), descripcion
5. CHEQUE_RECIBIDO: obraId, cajaDestinoId
6. COMANDOS: ayuda | saldo | pendientes | cheques | resumen [obraId] [fecha YYYY-MM-DD] | como_va_obra (datos.obra=nombre) | cc_proveedor (datos.proveedor=nombre) | contacto_proveedor (datos.proveedor=nombre)
   NOTA: el comando "pendientes" es SOLO para movimientos/facturas esperando APROBACIÓN en el buzón. Si el usuario pregunta por ÓRDENES DE PAGO / facturas impagas / "qué facturas debo pagar" / "qué le debo pagar a [proveedor]", NO uses el comando "pendientes": respondé como texto (estado:"conversando") listando las ÓRDENES DE PAGO del bloque de contexto (proveedor, número, saldo).
7. TAREAS — comandos: tareas (lista mis pendientes), tarea_detalle (con datos.numero=N), completar_item (con datos.numero=N — marca item N de la última tarea vista)
8. NUEVA_TAREA (solo Admin): si el admin dice "creale tarea a Juan: comprar cemento" o similar, accion.tipo='nueva_tarea' con datos: { titulo, descripcion?, asignadoNombre (nombre del usuario destinatario), prioridad?('baja'|'media'|'alta'), fechaLimite?(YYYY-MM-DD), checklist?[textos] }. Si falta el asignado, preguntar a quién. Si no es admin, responder que solo el admin puede crear tareas para otros — pero cualquier user puede pedir "crear tarea para mí" (auto-asignación).
9. TRASPASO (solo Admin): si el admin dice "pasá $200k de Caja Franco a Banco Galicia" o similar, accion.tipo='traspaso' con datos: { monto, cajaId (ID de la caja origen), cajaDestinoId (ID de la caja destino), montoDestino?(opcional para cross-moneda con TC distinto), descripcion? }. Matchear nombre de caja por nombre parcial. Si las cajas son de moneda distinta y el user no aclaró tipo de cambio, preguntá.
10. PAGO_PROVEEDOR (solo Admin): si el admin dice "pagué $300k a Pérez por la cert de revoque" / "le pagué a Juancito $150k de baradero" → accion.tipo='pago_proveedor' con datos: { monto, proveedorNombre (nombre del proveedor), obraId (ID de la obra si la menciona), cajaId (caja de egreso, sino su efectivo), medioPago, concepto? }. Es DISTINTO de un gasto común: registra el pago contra la cuenta corriente del proveedor. Usalo cuando el destinatario es un proveedor/sub-contratista conocido y se habla de "pagar/abonar/cancelar" a esa persona. Matchear proveedor por nombre parcial.

11. CHEQUE_RECIBIDO: si mandan una FOTO de un cheque/ECheq, o dicen "me dieron un cheque", "cobré con un cheque de X", "recibí un echeq de Y" → accion.tipo='cheque_recibido'. LEÉ de la foto/texto y poné en datos: { numero (N° del cheque), banco, titular (quién lo firma/emite), monto, fechaVencimiento (fecha de cobro/pago en formato YYYY-MM-DD), esEcheq (true si es electrónico/ECheq), clienteNombre? (de quién lo recibimos, si se sabe), obraId? (ID de obra si la menciona), cajaId (SOLO si el usuario dijo EXPLÍCITAMENTE a qué caja entra, ej. "a mi efectivo", "caja Pablo") }. IMPORTANTE: la caja NO se infiere de la obra ni del cheque. Si el usuario NO dijo explícitamente la caja, dejá cajaId vacío y respondé estado:"conversando" preguntando "¿A qué caja entra el cheque?" mostrando sus cajas. Si falta el monto o la fechaVencimiento, preguntá eso. NO lo trates como un gasto.

12. CREAR_PROSPECTO / PRIMER CONTACTO (solo Admin): si el admin dice "nuevo prospecto Shell Ruta 3 cliente Pérez" / "cargá una oportunidad nueva: estación X para Pérez" / "primer contacto Pérez" / "me contactó Pérez por Shell Ruta 3" / "me escribió Pérez" / "consulta de Pérez" / "nuevo contacto Pérez" → accion.tipo='crear_prospecto' con datos: { obraNombre? (nombre de la nueva obra/oportunidad, opcional), clienteNombre? (nombre del cliente, opcional) }. Carga un PRIMER CONTACTO: crea/vincula el CLIENTE (si no existe lo crea como prospecto), crea una OBRA NUEVA en estado en-presupuesto con la etapa del embudo = prospecto (sin presupuesto) y registra la actividad. Necesitás AL MENOS el cliente o el nombre de la oportunidad; si tenés cliente pero no obra, dejá obraNombre vacío (el sistema arma "Consulta — <cliente>"). Si no tenés ni cliente ni obra, preguntá de quién es el contacto. Si NO es Admin, respondé que solo un Admin crea oportunidades por chat. NO lo confundas con un gasto ni con nueva_tarea.

13. MOVER_ETAPA (solo Admin): si el admin dice "pasá Shell Ruta 3 a ganado" / "mové la obra X a negociación" / "Shell a perdido" → accion.tipo='mover_etapa' con datos: { obraNombre (nombre de la obra a mover, matcheá contra OBRAS ACTIVAS por nombre parcial), etapaNueva ('prospecto'|'cotizado'|'negociacion'|'ganado'|'perdido') }. Mueve la oportunidad en el embudo de ventas (a ganado → la obra pasa a activa; a perdido → se archiva). Si falta la etapa o la obra, preguntá eso. Si NO es Admin, respondé que solo un Admin mueve oportunidades por chat. NO lo confundas con un TRASPASO de cajas (eso es plata entre cajas, no etapas de venta).

14. CARGAR_FACTURA (solo Admin): alta MANUAL por texto de una factura de proveedor PENDIENTE DE PAGO (orden de pago / cuenta por pagar) SIN debitar caja. Usalo cuando el admin dice "cargá una factura pendiente de Pérez por $300k" / "nueva factura de Acería del Sur $1.2M" / "orden de pago a Juan $150k" / "le debo a Ferretería Centro $80k" — sin foto y sin que diga que ya la pagó. accion.tipo='cargar_factura' con datos: { proveedorId (ID del proveedor si lo matcheás de la lista) o proveedorNombre (nombre tal cual lo dijo), monto (OBLIGATORIO, total de la factura con IVA), fecha?(YYYY-MM-DD, default hoy), numero?(N° de factura), tipoLetra?('A'/'B'/'C'), cuit?, concepto?, obraId?(ID de obra si la menciona), soloRegistrar?(booleano) }. Si falta el monto o el proveedor, preguntá eso. NO debita ninguna caja: queda como deuda y cuenta para el Libro IVA desde su fecha. soloRegistrar=true si el admin aclara que NO es una deuda a pagar sino solo un registro fiscal ("es personal", "no la vamos a pagar", "solo registrala", "sin movimiento", "que no mueva caja"): el sistema la deja registrada (cuenta para IVA) pero NO como deuda. DISTINTO de: FACTURA_COMPRA (esa es por FOTO/PDF de un comprobante), GASTO (sale de caja) y PAGO_PROVEEDOR ("le pagué $X a alguien" = egreso de plata). Si NO es Admin, respondé que solo un Admin carga facturas por chat.

REGLAS DE FLUJO:
- El usuario escribe corto y conciso. Interpretá la intención aunque falten datos.
- Si la caja se resuelve por efectivo automático, NO la preguntes.
- Si hay foto en esta conversación y es un gasto: comprobante = blanco automáticamente, no preguntes.
- Para AVANCE_OBRA: el obraId en datos DEBE ser el ID exacto de la lista de obras activas (ej: "obra-baradero"), no el nombre.
- Si el usuario confirma (sí/si/dale/ok/confirmo/correcto/s): estado = "ejecutar"
- Si el usuario cancela (no/cancelar/error/mal/n): estado = "cancelar"
- Para comprobante sin foto: "factura"/"con factura"/"blanco" = blanco; "sin factura"/"negro" = negro
- Respondé en español argentino, breve y directo.

HISTORIAL DE CONVERSACIÓN:
${conv.history.map(h => `${h.rol}: ${h.texto}`).join('\n') || 'Sin historial'}

${preExtracted ? `EXTRACCIÓN AUTOMÁTICA DEL MENSAJE ACTUAL (datos ya identificados — USÁ ESTOS DIRECTAMENTE, no preguntes por ellos):
→ ${preExtracted}
Si tenés obra+tarea+cantidad → ejecutá avance_obra directo con estado:"ejecutar".` : ''}

Respondé ÚNICAMENTE con JSON válido:
{
  "mensaje": "texto a enviar al usuario (máx 400 chars)",
  "estado": "conversando" | "confirmando" | "ejecutar" | "cancelar" | "comando",
  "accion": {
    "tipo": "gasto" | "ingreso" | "factura_compra" | "cargar_factura" | "avance_obra" | "cheque_recibido" | "comando" | "nueva_tarea" | "traspaso" | "pago_proveedor" | "crear_prospecto" | "mover_etapa" | null,
    "datos": {}
  }
}`;

  // Text FIRST so Claude reads it with priority before analyzing the image
  const userContent = [];
  userContent.push({ type: 'text', text: messageText || '(imagen adjunta)' });
  if (base64Media && mimeType) {
    if (mimeType === 'application/pdf') {
      userContent.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Media } });
    } else if (mimeType.startsWith('image/')) {
      userContent.push({ type: 'image', source: { type: 'base64', media_type: mimeType, data: base64Media } });
    }
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 2048, system: systemPrompt, messages: [{ role: 'user', content: userContent }] }),
  });
  const data = await res.json();

  // Error de la API (rate limit, imagen muy grande, modelo, etc.)
  if (!res.ok || data.error) {
    console.error('callClaude API error:', res.status, JSON.stringify(data).slice(0, 500));
    return { mensaje: '⚠️ Tuve un problema al procesar tu mensaje. Probá de nuevo en un momento o escribilo con palabras (ej. "gasté $5000 en Baradero").', estado: 'conversando', accion: { tipo: null, datos: {} } };
  }

  try {
    let text = (data.content?.[0]?.text || '').trim();
    if (!text) throw new Error('respuesta vacía');
    // Quitar fences de markdown si vienen.
    text = text.replace(/^```json?\s*/i, '').replace(/\s*```$/, '');
    // Si Claude agregó texto antes/después del JSON, extraer el bloque {...}.
    const a = text.indexOf('{');
    const b = text.lastIndexOf('}');
    if (a >= 0 && b > a) text = text.slice(a, b + 1);
    return JSON.parse(text);
  } catch (e) {
    console.error('callClaude parse error:', e.message, '| raw:', JSON.stringify(data.content?.[0]?.text || data).slice(0, 600));
    return { mensaje: 'Perdón, no entendí bien. ¿Podés repetirlo o escribirlo distinto? Ej: "gasté $5000 de combustible en Baradero".', estado: 'conversando', accion: { tipo: null, datos: {} } };
  }
}

// ── Ejecutar acción ───────────────────────────────────────────────────────────
// Arma el texto de confirmación de una acción a partir de sus datos.
// Usado cuando el user edita un dato durante la confirmación, para re-mostrar
// el resumen actualizado sin volver a llamar a Claude.
function resumenAccion(accion, ctx) {
  const d = accion?.datos || {};
  const obra = ctx.obras.find(o => o.id === d.obraId);
  const caja = ctx.cajas.find(c => c.id === d.cajaId);
  const fmt = n => `$${Math.round(n || 0).toLocaleString('es-AR')}`;
  if (accion.tipo === 'gasto' || accion.tipo === 'ingreso') {
    return (
      `📋 *Confirmar ${accion.tipo}:*\n\n` +
      `💵 Monto: *${fmt(d.monto)}*\n` +
      (obra ? `🏗 Obra: *${obra.nombre}*\n` : '') +
      (d.descripcion ? `📝 ${d.descripcion}\n` : '') +
      (caja ? `🏦 Caja: ${caja.nombre}\n` : '')
    );
  }
  if (accion.tipo === 'avance_obra') {
    const obraA = ctx.obras.find(o => o.id === d.obraId);
    let tareaNombre = d.tareaNombre;
    if (!tareaNombre && obraA) {
      const det = ctx.detalles?.[obraA.id];
      for (const r of (det?.rubros || [])) {
        const t = (r.tareas || []).find(x => x.id === d.tareaId);
        if (t) { tareaNombre = t.nombre; break; }
      }
    }
    return (
      `📋 *Confirmar avance:*\n\n` +
      (obraA ? `🏗 Obra: *${obraA.nombre}*\n` : '') +
      (tareaNombre ? `📐 Tarea: *${tareaNombre}*\n` : '') +
      `📊 Cantidad: *${d.cantidadAvance ?? d.cantidad ?? '?'}${d.unidad || ''}*\n`
    );
  }
  if (accion.tipo === 'traspaso') {
    const co = ctx.cajas.find(c => c.id === d.cajaId);
    const cd = ctx.cajas.find(c => c.id === d.cajaDestinoId);
    return (
      `📋 *Confirmar traspaso:*\n\n` +
      `💵 Monto: *${fmt(d.monto)}*\n` +
      (co ? `↳ De: ${co.nombre}\n` : '') +
      (cd ? `↳ A: ${cd.nombre}\n` : '')
    );
  }
  if (accion.tipo === 'factura_compra' || accion.tipo === 'cargar_factura') {
    const obraF = ctx.obras.find(o => o.id === d.obraId);
    return (
      `📋 *Confirmar factura de proveedor:*\n\n` +
      `🏢 Proveedor: *${d.proveedorNombre || d.proveedor || '—'}*\n` +
      `💵 Total: *${fmt(d.monto ?? d.montoTotal)}*\n` +
      ((d.tipoFactura || d.numeroFactura) ? `🧾 ${d.tipoFactura ? `Tipo ${d.tipoFactura}` : ''}${d.numeroFactura ? ` N° ${d.numeroFactura}` : ''}\n` : '') +
      (d.cuit ? `🆔 CUIT: ${d.cuit}\n` : '') +
      (d.fecha ? `📅 Fecha: ${d.fecha}\n` : '') +
      (obraF ? `🏗 Obra: *${obraF.nombre}*\n` : '')
    );
  }
  if (accion.tipo === 'pago_proveedor') {
    return (
      `📋 *Confirmar pago a proveedor:*\n\n` +
      `🏢 Proveedor: *${d.proveedorNombre || d.proveedor || '—'}*\n` +
      `💵 Monto: *${fmt(d.monto)}*\n` +
      (caja ? `🏦 Caja: ${caja.nombre}\n` : '')
    );
  }
  if (accion.tipo === 'cheque_recibido') {
    return (
      `📋 *Confirmar cheque:*\n\n` +
      `💵 Monto: *${fmt(d.monto)}*\n` +
      (d.banco ? `🏦 Banco: ${d.banco}\n` : '') +
      (d.numero ? `🔢 N°: ${d.numero}\n` : '') +
      ((d.fechaVencimiento || d.vencimiento) ? `📅 Vence: ${d.fechaVencimiento || d.vencimiento}\n` : '')
    );
  }
  // Genérico HUMANO — NUNCA volcar JSON crudo al usuario (factura/cheque/pago ya
  // tienen su plantilla arriba; esto cubre nueva_tarea/prospecto/etc.).
  const lineas = [];
  if (d.monto != null || d.montoTotal != null) lineas.push(`💵 Monto: *${fmt(d.monto ?? d.montoTotal)}*`);
  if (d.proveedorNombre || d.proveedor) lineas.push(`🏢 Proveedor: ${d.proveedorNombre || d.proveedor}`);
  if (obra) lineas.push(`🏗 Obra: *${obra.nombre}*`);
  if (d.descripcion || d.concepto) lineas.push(`📝 ${d.descripcion || d.concepto}`);
  if (d.fecha) lineas.push(`📅 ${d.fecha}`);
  const tituloT = accion.tipo ? String(accion.tipo).replace(/_/g, ' ') : 'acción';
  return `📋 *Confirmar ${tituloT}:*${lineas.length ? `\n\n${lineas.join('\n')}` : ''}`;
}

async function ejecutarAccion(tipo, datos, user, ctx, mediaUrl = null) {
  if (tipo === 'gasto' || tipo === 'ingreso') {
    const obra  = ctx.obras.find(o => o.id === datos.obraId);
    const caja  = ctx.cajas.find(c => c.id === datos.cajaId);
    const monto = Math.round(parseFloat(datos.monto) || 0);
    const tipoStr = tipo === 'gasto' ? 'gasto' : 'ingreso';
    const obraMoneda = obra?.moneda || 'ARS';
    const montoFmt = fmtMonto(monto, obraMoneda);

    // INGRESO: la caja la elige SIEMPRE el usuario, entre sus cajas VISIBLES.
    // Si no nombró una caja explícita, preguntamos — nunca la adivinamos (y
    // jamás del nombre de la obra). Un ingreso es plata que entra: la caja importa.
    if (tipo === 'ingreso' && !caja) {
      const visibles = ctx.cajas.filter(c => cajaEsVisible(user, c));
      const opciones = visibles.slice(0, 10).map(c => `• ${c.nombre}`).join('\n');
      await saveConversation(user.phone, { state: 'awaiting_ingreso_caja', data: { datos, mediaUrl } });
      return `💰 Ingreso de *${montoFmt}*${obra ? ` para *${obra.nombre}*` : ''} anotado.\n\n*¿A qué caja entra?*\n${opciones || '(no tenés cajas visibles configuradas)'}\n\nDecime el nombre de la caja.`;
    }

    const nuevoMov = {
      id:               `mov-${Date.now()}`,
      tipo:             tipo,
      descripcion:      datos.descripcion || '',
      monto,
      fecha:            datos.fecha || new Date().toISOString().split('T')[0],
      obraId:           datos.obraId || null,
      obraNombre:       obra?.nombre || 'General',
      cajaId:           datos.cajaId,
      cajaDestinoId:    null,
      proveedor:        datos.proveedorNombre || '',
      categoria:        datos.tipo === 'mano_de_obra' ? 'mano-de-obra' : datos.tipo === 'material' ? 'material' : 'general',
      // Imputación al rubro del presupuesto (habilita el desvío presupuesto-vs-real).
      rubroId:          (tipo === 'gasto' && datos.rubroId) ? datos.rubroId : undefined,
      rubroNombre:      (tipo === 'gasto' && datos.rubroNombre) ? datos.rubroNombre : undefined,
      categoriaFiscal:  (tipo === 'gasto' && datos.categoriaFiscal) ? datos.categoriaFiscal : undefined,
      // Percepción IIBB sufrida (leída del ticket si la LLM la detectó). Se descuenta
      // del IIBB del mes en el panel Financiero. Típica de estaciones de servicio.
      percepcionIIBB:   (tipo === 'gasto' && datos.percepcionIIBB != null && Number(datos.percepcionIIBB) > 0)
                          ? Math.round(Number(datos.percepcionIIBB)) : undefined,
      // Jurisdicción de la percepción IIBB — solo se guarda si NO es PBA (ausente = PBA).
      jurisdiccionIIBB: (tipo === 'gasto' && Number(datos.percepcionIIBB) > 0 && datos.jurisdiccionIIBB && datos.jurisdiccionIIBB !== 'PBA')
                          ? datos.jurisdiccionIIBB : undefined,
      // Percepción IVA sufrida (RG 2408/3337). Pago a cuenta del IVA del mes.
      percepcionIVA:    (tipo === 'gasto' && datos.percepcionIVA != null && Number(datos.percepcionIVA) > 0)
                          ? Math.round(Number(datos.percepcionIVA)) : undefined,
      medioPago:        datos.medioPago || 'Efectivo',
      comprobante:      datos.comprobante || 'negro',
      comprobanteUrl:   mediaUrl || null,
      creadoPorWA:      true,
      creadoPor:        user.user_name,
    };

    // Gasto con foto/PDF de comprobante → poblamos datos fiscales para el
    // Libro IVA Compras. Si la LLM extrajo tipo/neto/total los usamos; sino
    // asumimos B + 21% con el monto como total (combustible/materiales más
    // comunes en construcción). Así una factura cargada como "gasto rápido"
    // igual aporta crédito fiscal.
    // Categorías que NO generan IVA crédito (recibos, no facturas) — saltean
    // la autocarga de comprobanteRecibido aunque tengan foto adjunta.
    const SIN_IVA_CREDITO = new Set(['sueldo', 'cs-soc', 'sind', 'iibb']);
    if (tipo === 'gasto' && mediaUrl && monto > 0 && !SIN_IVA_CREDITO.has(nuevoMov.categoriaFiscal)) {
      const tipoLetra = String(datos.tipoFactura || 'B').toUpperCase().charAt(0); // 'A'/'B'/'C'
      // Dup check ANTES de persistir: cubre el reenvío del mismo ticket o el
      // cruce con una carga previa (gasto-con-foto, factura_compra o pending).
      // Sin esto, doble carga = doble crédito IVA.
      const dupGasto = await buscarDuplicadoRecibidoBot({
        tipo: tipoLetra, numero: datos.numeroFactura, cuit: datos.cuit,
        total: monto, proveedor: datos.proveedorNombre, fecha: nuevoMov.fecha,
      });
      if (dupGasto) {
        const fmtD = n => `$${Math.round(n || 0).toLocaleString('es-AR')}`;
        const refD = dupGasto.ref;
        const cuandoD = dupGasto.en === 'movimiento' ? `el ${refD.fecha}`
                      : dupGasto.en === 'factura_pendiente' ? `como orden de pago` : `pendiente de aprobar`;
        const montoRef = refD.comprobanteRecibido?.total
                      || (refD.movimiento && (refD.movimiento.comprobanteRecibido?.total || refD.movimiento.monto))
                      || refD.montoTotal || refD.monto || 0;
        return `⚠️ *Comprobante duplicado*\nYa hay una factura/ticket igual cargado ${cuandoD}${montoRef ? ` (${fmtD(montoRef)})` : ''}. No lo dupliqué.`;
      }
      // Desglose fiscal centralizado (ver desglosarCompraBot). neto/IVA salen de
      // la base (sin percepciones); el `total` guardado es el del ticket (con
      // percepción), para que coincida con la caja y con el fingerprint de dup.
      const fiscal = desglosarCompraBot({
        total: monto, tipoLetra,
        percepcionIIBB: nuevoMov.percepcionIIBB || 0,
        percepcionIVA: nuevoMov.percepcionIVA || 0,
        montoNeto: datos.montoNeto,
      });
      nuevoMov.comprobante = 'blanco';
      nuevoMov.comprobanteRecibido = {
        tipo: tipoLetra,
        numero: datos.numeroFactura || '',
        cuit: datos.cuit || '',
        fecha: nuevoMov.fecha,
        neto: fiscal.neto, iva: fiscal.iva, alicuota: fiscal.alicuota, total: monto,
      };
    }

    // ── Rama Admin: auto-aplicar (sin pasar por Autorizaciones) ───────────────
    if (user.user_rol === 'Admin') {
      // Solo entregamos el movimiento (atómico). El saldo lo calcula la app.
      await appendMovimiento(nuevoMov);

      // Si es gasto → confirmación seca y listo.
      if (tipo === 'gasto') {
        return `✅ Gasto de *${montoFmt}* aplicado a *${obra?.nombre || 'General'}* desde *${caja?.nombre || '—'}*.\nQueda editable desde la app.`;
      }

      // Es ingreso → ofrecer notificar al cliente.
      if (!obra) {
        return `✅ Ingreso de *${montoFmt}* aplicado a *${caja?.nombre || '—'}*.\n⚠️ Sin obra asignada, no puedo avisar a ningún cliente.`;
      }

      const cliente = findClienteByObra(obra, ctx.clientes || []);
      if (!cliente) {
        return `✅ Ingreso de *${montoFmt}* aplicado a *${obra.nombre}*.\n⚠️ No encontré a *"${obra.cliente}"* en clientes. Cargalo en la app cuando puedas para poder avisarle automáticamente.`;
      }

      const tel = normalizePhone(cliente.whatsapp || cliente.telefono);
      if (!tel) {
        // Cliente sin teléfono → pedirlo por WA.
        await saveConversation(user.phone, { state: 'awaiting_client_phone', data: {
          clienteId:     cliente.id,
          clienteNombre: cliente.nombre,
          obraNombre:    obra.nombre,
          monto,
          moneda:        obraMoneda,
          recibidoPor:   user.user_name,
        } });
        return `✅ Ingreso de *${montoFmt}* aplicado a *${obra.nombre}*.\n\n📱 *${cliente.nombre}* no tiene WhatsApp cargado. ¿Cuál es su número? (con cód. país, ej. 5491155551234)\n\nO escribí *no* para omitir el aviso.`;
      }

      // Cliente OK → preguntar antes de mandar.
      await saveConversation(user.phone, { state: 'awaiting_client_notice', data: {
        clienteId:     cliente.id,
        clienteNombre: cliente.nombre,
        clienteTel:    tel,
        obraNombre:    obra.nombre,
        monto,
        moneda:        obraMoneda,
        recibidoPor:   user.user_name,
      } });
      return `✅ Ingreso de *${montoFmt}* aplicado a *${obra.nombre}*.\n\n¿Aviso a *${cliente.nombre}* por WhatsApp? (sí/no)`;
    }

    // ── Rama no-Admin: flujo de aprobación (igual que antes) ──────────────────
    nuevoMov.estadoAprobacion = 'pendiente';

    await sbAppendArray('whatsapp_pending', { // atómico
      id:            `wp-${Date.now()}`,
      tipoPendiente: 'movimiento',
      movimiento:    nuevoMov,
      from:          user.phone,
      creadoPor:     user.user_name,
      receivedAt:    new Date().toISOString(),
      status:        'pendiente',
    });

    const admins = await getAllAdmins();
    const msgAdmin =
      `📋 *Nueva solicitud de aprobación*\n\n` +
      `*${user.user_name}* registró un ${tipoStr}:\n` +
      `• Monto: *${montoFmt}*\n` +
      `• Concepto: ${datos.descripcion || '—'}\n` +
      `• Obra: ${obra?.nombre || 'General'}\n` +
      `• Caja: ${caja?.nombre || '—'}\n` +
      `• Comprobante: ${datos.comprobante === 'blanco' ? '✅ Con factura' : '⚠️ Sin factura'}` +
      `${mediaUrl ? '\n• Foto: adjunta' : ''}\n\n` +
      `Revisalo en la app Kamak → Buzón WhatsApp.`;

    for (const admin of admins) {
      await sendWA(admin.phone, msgAdmin);
    }

    // Campanita + push a los Admin (legacy → solo push; el ítem ya se ve in-app
    // en Autorizaciones). Best-effort, no rompe la respuesta al que cargó.
    await crearNotifServidor('wa_movimiento_pendiente', {
      actorId: user.id || null, // no auto-notificar a quien lo cargó (si fuera Admin)
      cuerpo: `${user.user_name}: ${tipoStr} de ${montoFmt}${datos.descripcion ? ` · ${datos.descripcion}` : ''}`,
    });

    return `✅ Listo. El ${tipoStr} de *${montoFmt}* fue enviado a aprobación.\nLos administradores recibirán una notificación.`;
  }

  // ── CARGAR_FACTURA: alta MANUAL por texto de una factura pendiente de pago ────
  // (cuenta por pagar / orden de pago) SIN tocar caja. Espejo de
  // FacturaPendienteModal/addFacturaPendiente: estado 'pendiente', pagos:[],
  // saldoPendiente=monto. Lleva comprobanteRecibido fiscal → cuenta para el Libro
  // IVA desde su fecha (devengado). El PAGO va aparte (pago_proveedor) y ahí debita
  // la caja — acá NO se toca ninguna caja. Solo Admin.
  if (tipo === 'cargar_factura') {
    if (user.user_rol !== 'Admin') return '⚠️ Cargar facturas por chat es solo para un Admin.';
    const fmt = n => `$${Math.round(n || 0).toLocaleString('es-AR')}`;
    const monto = Math.round(Number(datos.monto) || 0);
    if (!(monto > 0)) return '⚠️ Necesito el monto de la factura (mayor a cero) para cargarla. ¿Cuánto es?';

    // Resolver proveedor por id o por nombre (fuzzy, mismo criterio que factura_compra).
    const provFP = (datos.proveedorId && ctx.proveedores.find(p => p.id === datos.proveedorId))
                || (datos.proveedorNombre && ctx.proveedores.find(p => p.nombre && (
                     p.nombre.toLowerCase().includes(datos.proveedorNombre.toLowerCase()) ||
                     datos.proveedorNombre.toLowerCase().includes(p.nombre.toLowerCase()))))
                || (datos.proveedor && ctx.proveedores.find(p => p.nombre && (
                     p.nombre.toLowerCase().includes(datos.proveedor.toLowerCase()) ||
                     datos.proveedor.toLowerCase().includes(p.nombre.toLowerCase()))));
    const proveedorNombre = provFP?.nombre || datos.proveedorNombre || datos.proveedor || '';
    if (!proveedorNombre) return '⚠️ ¿A qué proveedor le cargo esta factura? Decime el nombre.';

    const tipoLetra = String(datos.tipoLetra || datos.tipoFactura || 'A').toUpperCase().charAt(0); // 'A'/'B'/'C'
    const fechaFP = datos.fecha || new Date().toISOString().split('T')[0];
    const obraFP = datos.obraId ? ctx.obras.find(o => o.id === datos.obraId) : null;
    const cuit = (datos.cuit || provFP?.cuit || '').trim();
    const { neto, iva, alicuota } = desglosarCompraBot({ total: monto, tipoLetra });

    // Solo registrar = factura solo fiscal (cuenta para Libro IVA pero NO es deuda
    // ni mueve caja). Caso: factura personal a nombre de la empresa sin gasto a pagar.
    const soloRegistrar = datos.soloRegistrar === true || datos.soloRegistrar === 'true'
                       || datos.sinPago === true || datos.sinPago === 'true';

    const facturaPendiente = {
      id: `fp-${Date.now()}`,
      proveedorId: provFP?.id || null,
      proveedor: proveedorNombre,
      fecha: fechaFP,
      numero: datos.numero || datos.numeroFactura || '',
      tipoLetra,
      cuit,
      monto,
      comprobanteRecibido: {
        tipo: tipoLetra, numero: datos.numero || datos.numeroFactura || '', cuit,
        fecha: fechaFP, neto, iva, alicuota, total: monto,
      },
      obraId: obraFP?.id || null,
      obraNombre: obraFP?.nombre || undefined,
      concepto: (datos.concepto || `Factura ${tipoLetra}${(datos.numero || datos.numeroFactura) ? ` ${datos.numero || datos.numeroFactura}` : ''}`).trim(),
      comprobanteUrl: null,
      estado: soloRegistrar ? 'registrada' : 'pendiente',
      pagos: [],
      saldoPendiente: soloRegistrar ? 0 : monto,
      createdAt: new Date().toISOString(),
      createdBy: user.id || user.user_name,
    };
    // Atómico: append a proveedores.facturasPendientes sin pisar el resto del blob.
    await sbAppendArray2('proveedores', 'facturasPendientes', facturaPendiente);
    if (soloRegistrar) {
      return `✅ Factura registrada: ${tipoLetra}${facturaPendiente.numero ? ` ${facturaPendiente.numero}` : ''} de *${proveedorNombre}* (${fmt(monto)}).\n` +
        `Neto ${fmt(neto)} · IVA ${alicuota}% ${fmt(iva)}\n` +
        `Cuenta para tu Libro IVA Compras del mes. *No es deuda ni movió ninguna caja* (no figura en Cuentas por Pagar).`;
    }
    return `✅ Orden de pago creada: factura ${tipoLetra}${facturaPendiente.numero ? ` ${facturaPendiente.numero}` : ''} de *${proveedorNombre}* (${fmt(monto)}, *pendiente de pago*).\n` +
      `Neto ${fmt(neto)} · IVA ${alicuota}% ${fmt(iva)}\n` +
      `Ya cuenta para tu Libro IVA Compras del mes. No toqué ninguna caja.\n\n` +
      `Avisame cuando la pagues y la marco saldada.`;
  }

  if (tipo === 'factura_compra') {
    // ¿Es una Nota de Crédito de proveedor? (revierte una factura: devolución,
    // bonificación, error). Va SIEMPRE al buzón para que el admin decida en el
    // modal si además devolvió plata a alguna caja — el ajuste fiscal del Libro
    // IVA se hace siempre, la caja es opcional.
    const esNotaCredito = datos.claseComprobante === 'nota_credito';
    // ── Detección de comprobante duplicado ──────────────────────────────────
    // Huella (letra + serial + CUIT + total, con prefijo NC para notas de crédito)
    // cubre: pendings de factura, pendings de movimiento con comprobanteRecibido,
    // movimientos con comprobanteRecibido, y fallback legacy por referencia.
    const dup = await buscarDuplicadoRecibidoBot({
      tipo: datos.tipoFactura,
      numero: datos.numeroFactura,
      cuit: datos.cuit,
      total: datos.montoTotal != null ? datos.montoTotal : datos.monto,
      proveedor: datos.proveedor,
      fecha: datos.fecha,
      clase: esNotaCredito ? 'nota_credito' : 'factura',
    });
    if (dup) {
      const fmt = n => `$${Math.round(n || 0).toLocaleString('es-AR')}`;
      const ref = dup.ref;
      const cuando = dup.en === 'movimiento'
        ? `ya está cargada como gasto el ${ref.fecha}`
        : dup.en === 'factura_pendiente'
        ? `ya está cargada como orden de pago`
        : `ya está en el buzón pendiente de aprobar`;
      const montoRef = ref.comprobanteRecibido?.total
                    || (ref.movimiento && (ref.movimiento.comprobanteRecibido?.total || ref.movimiento.monto))
                    || ref.montoTotal || ref.monto || 0;
      return `⚠️ *Factura duplicada*\nLa factura${datos.numeroFactura ? ` N° *${datos.numeroFactura}*` : ''} de *${datos.proveedor || 'ese proveedor'}* ${cuando}` +
        (montoRef ? ` (${fmt(montoRef)})` : '') +
        `.\n\nNo la cargué de nuevo. Si es otra distinta, verificá los datos.`;
    }

    // ── Auto-carga para Admin (sin pasar por buzón) ───────────────────────────
    // Si el que envió es Admin y el bot extrajo el monto total, lo cargamos
    // DIRECTO como gasto con todos los datos fiscales (tipo, CUIT, neto, IVA,
    // alícuota) en comprobanteRecibido — listos para el Libro IVA Compras.
    // Casos sin monto o de usuarios no-admin siguen al buzón (admin revisa).
    // Si la LLM marcó esto con categoriaFiscal de un comprobante NO comercial
    // (recibo de sueldo, cargas, sindicato, IIBB) — defensa: no lo procesamos
    // como factura comercial con IVA crédito. Sería raro porque factura_compra
    // implica factura formal, pero por las dudas.
    const SIN_IVA_CREDITO_FACT = new Set(['sueldo', 'cs-soc', 'sind', 'iibb']);
    // Guard: el monto representa el TOTAL del comprobante (lo que sale de caja, con
    // IVA y percepciones). Acepta tanto el nuevo `monto` como el viejo `montoTotal`
    // por si algún flujo aún manda con la nomenclatura anterior.
    const totalGastoBot = datos.monto != null && Number(datos.monto) > 0
      ? Math.round(Number(datos.monto))
      : (datos.montoTotal != null ? Math.round(Number(datos.montoTotal)) : 0);

    // ── CUENTAS POR PAGAR (default): la factura llega → la cargamos como FACTURA
    // PENDIENTE DE PAGO (proveedores.facturasPendientes), NO debitamos la caja.
    // Lleva comprobanteRecibido fiscal → cuenta para el Libro IVA desde su fecha
    // (devengado, aunque no esté paga). El pago se registra después con
    // pago_proveedor y ahí se debita la caja. SOLO si el admin aclara que YA la
    // pagó (datos.yaPagada=true), sigue al flujo de auto-carga como gasto (abajo).
    const yaPagada = datos.yaPagada === true || datos.yaPagada === 'true';
    // Solo registrar = factura solo fiscal (cuenta para Libro IVA pero NO es deuda
    // ni mueve caja). Caso: factura personal a nombre de la empresa sin gasto a pagar.
    const soloRegistrarFC = datos.soloRegistrar === true || datos.soloRegistrar === 'true'
                         || datos.sinPago === true || datos.sinPago === 'true';
    if (user.user_rol === 'Admin' && totalGastoBot > 0 && !SIN_IVA_CREDITO_FACT.has(datos.categoriaFiscal) && !esNotaCredito && !yaPagada) {
      const tipoLetra = String(datos.tipoFactura || 'B').toUpperCase().charAt(0); // 'A' / 'B' / 'C'
      const total = totalGastoBot;
      const perc = (datos.percepcionIIBB != null && Number(datos.percepcionIIBB) > 0)
                     ? Math.round(Number(datos.percepcionIIBB)) : 0;
      const percIVA = (datos.percepcionIVA != null && Number(datos.percepcionIVA) > 0)
                     ? Math.round(Number(datos.percepcionIVA)) : 0;
      const { neto, iva, alicuota } = desglosarCompraBot({
        total, tipoLetra, percepcionIIBB: perc, percepcionIVA: percIVA, montoNeto: datos.montoNeto,
      });
      // Resolver el proveedor (por id o nombre) para linkear la factura a su ficha.
      const provFP = (datos.proveedorId && ctx.proveedores.find(p => p.id === datos.proveedorId))
                  || (datos.proveedor && ctx.proveedores.find(p => p.nombre && (
                       p.nombre.toLowerCase().includes(datos.proveedor.toLowerCase()) ||
                       datos.proveedor.toLowerCase().includes(p.nombre.toLowerCase()))));
      const fechaFP = datos.fecha || new Date().toISOString().split('T')[0];
      const obraFP = datos.obraId ? ctx.obras.find(o => o.id === datos.obraId) : null;
      const facturaPendiente = {
        id: `fp-${Date.now()}`,
        proveedorId: provFP?.id || null,
        proveedor: provFP?.nombre || datos.proveedor || '',
        fecha: fechaFP,
        numero: datos.numeroFactura || '',
        tipoLetra,
        cuit: datos.cuit || '',
        monto: total,
        comprobanteRecibido: {
          tipo: tipoLetra, numero: datos.numeroFactura || '', cuit: datos.cuit || '',
          fecha: fechaFP, neto, iva, alicuota, total,
        },
        percepcionIIBB: perc > 0 ? perc : undefined,
        jurisdiccionIIBB: (perc > 0 && datos.jurisdiccionIIBB && datos.jurisdiccionIIBB !== 'PBA') ? datos.jurisdiccionIIBB : undefined,
        percepcionIVA: percIVA > 0 ? percIVA : undefined,
        obraId: obraFP?.id || null,
        obraNombre: obraFP?.nombre || undefined,
        concepto: datos.concepto || `Factura ${tipoLetra}${datos.numeroFactura ? ` ${datos.numeroFactura}` : ''}`.trim(),
        comprobanteUrl: mediaUrl || null,
        estado: soloRegistrarFC ? 'registrada' : 'pendiente',
        pagos: [],
        saldoPendiente: soloRegistrarFC ? 0 : total,
        createdAt: new Date().toISOString(),
        createdBy: user.id || user.user_name,
      };
      // Atómico: append a proveedores.facturasPendientes sin pisar el resto del blob.
      await sbAppendArray2('proveedores', 'facturasPendientes', facturaPendiente);
      const fmt = n => `$${Math.round(n || 0).toLocaleString('es-AR')}`;
      const lineaPerc = perc > 0 ? `\nPercep. IIBB: ${fmt(perc)}` : '';
      const lineaPercIVA = percIVA > 0 ? `\nPercep. IVA: ${fmt(percIVA)}` : '';
      if (soloRegistrarFC) {
        return `✅ Factura registrada: ${tipoLetra} ${datos.numeroFactura || ''} de *${facturaPendiente.proveedor || 'proveedor'}* (${fmt(total)}).\n` +
          `Neto ${fmt(neto)} · IVA ${alicuota}% ${fmt(iva)}${lineaPerc}${lineaPercIVA}\n` +
          `Cuenta para tu Libro IVA Compras del mes. *No es deuda ni movió ninguna caja* (no figura en Cuentas por Pagar).`;
      }
      return `✅ Orden de pago creada: factura ${tipoLetra} ${datos.numeroFactura || ''} de *${facturaPendiente.proveedor || 'proveedor'}* (${fmt(total)}, *pendiente de pago*).\n` +
        `Neto ${fmt(neto)} · IVA ${alicuota}% ${fmt(iva)}${lineaPerc}${lineaPercIVA}\n` +
        `Ya cuenta para tu Libro IVA Compras del mes.\n\n` +
        `Avisame cuando la pagues y la marco saldada.`;
    }

    // ── Flujo "ya pagada": el admin aclaró que la factura YA se pagó → la
    // cargamos DIRECTO como gasto debitando la caja (comportamiento original).
    if (user.user_rol === 'Admin' && totalGastoBot > 0 && !SIN_IVA_CREDITO_FACT.has(datos.categoriaFiscal) && !esNotaCredito) {
      const tipoLetra = String(datos.tipoFactura || 'B').toUpperCase().charAt(0); // 'A' / 'B' / 'C'
      const total = totalGastoBot;
      // Percepciones detectadas en el ticket: se excluyen de la base fiscal del IVA.
      const perc = (datos.percepcionIIBB != null && Number(datos.percepcionIIBB) > 0)
                     ? Math.round(Number(datos.percepcionIIBB)) : 0;
      const percIVA = (datos.percepcionIVA != null && Number(datos.percepcionIVA) > 0)
                     ? Math.round(Number(datos.percepcionIVA)) : 0;
      // Desglose fiscal centralizado (ver desglosarCompraBot).
      const { neto, iva, alicuota } = desglosarCompraBot({
        total, tipoLetra, percepcionIIBB: perc, percepcionIVA: percIVA, montoNeto: datos.montoNeto,
      });
      // Caja efectivo del admin (ARS). Sino, primera ARS visible. Si nada → buzón.
      const caja = ctx.cajas.find(c => c.tipo === 'efectivo' && c.usuarioId === user.email && c.moneda === 'ARS')
                || ctx.cajas.find(c => c.moneda === 'ARS' && cajaEsVisible(user, c));
      if (caja) {
        const concepto = datos.concepto || `Factura ${tipoLetra}${datos.numeroFactura ? ` ${datos.numeroFactura}` : ''}${datos.proveedor ? ` · ${datos.proveedor}` : ''}`.trim();
        const fechaMov = datos.fecha || new Date().toISOString().split('T')[0];
        const mov = {
          id: `mov-${Date.now()}`,
          tipo: 'gasto',
          descripcion: concepto,
          monto: total,
          fecha: fechaMov,
          obraId: datos.obraId || null,
          obraNombre: datos.obraId ? (ctx.obras.find(o => o.id === datos.obraId)?.nombre || '') : 'General',
          cajaId: caja.id,
          cajaDestinoId: null,
          proveedor: datos.proveedor || '',
          categoria: 'factura-proveedor',
          medioPago: 'Transferencia',
          referencia: datos.numeroFactura || '',
          comprobante: 'blanco',
          comprobanteUrl: mediaUrl || null,
          fondoReparo: false,
          creadoPorWA: true,
          creadoPor: user.user_name,
          percepcionIIBB: perc > 0 ? perc : undefined,
          jurisdiccionIIBB: (perc > 0 && datos.jurisdiccionIIBB && datos.jurisdiccionIIBB !== 'PBA') ? datos.jurisdiccionIIBB : undefined,
          percepcionIVA: percIVA > 0 ? percIVA : undefined,
          comprobanteRecibido: {
            tipo: tipoLetra, numero: datos.numeroFactura || '', cuit: datos.cuit || '',
            // total = total del ticket (con percepciones), para fingerprint estable.
            fecha: fechaMov, neto, iva, alicuota, total,
          },
        };
        await appendMovimiento(mov);
        const fmt = n => `$${Math.round(n || 0).toLocaleString('es-AR')}`;
        const lineaPerc = perc > 0 ? `\nPercep. IIBB: ${fmt(perc)} (descuenta del IIBB del mes)` : '';
        const lineaPercIVA = percIVA > 0 ? `\nPercep. IVA: ${fmt(percIVA)} (pago a cuenta del IVA del mes)` : '';
        return `✅ *Factura ${tipoLetra} cargada* — ${fmt(total)}\n` +
          `Proveedor: *${datos.proveedor || '—'}*${datos.numeroFactura ? ` · N° ${datos.numeroFactura}` : ''}\n` +
          `Neto ${fmt(neto)} · IVA ${alicuota}% ${fmt(iva)}${lineaPerc}${lineaPercIVA}\n` +
          `Salió de: *${caja.nombre}*\n\n` +
          `Editable desde la app. Cuenta para tu Libro IVA Compras del mes.`;
      }
      // Sin caja → cae al buzón normal abajo.
    }

    await sbAppendArray('whatsapp_pending', { // atómico
      id:            `wp-${Date.now()}`,
      tipoPendiente: 'factura',
      tipoFactura:   datos.tipoFactura   || '',
      numeroFactura: datos.numeroFactura || '',
      proveedor:     datos.proveedor     || '',
      cuit:          datos.cuit          || '',
      fecha:         datos.fecha         || new Date().toISOString().split('T')[0],
      concepto:      datos.concepto      || '',
      // monto = total del gasto (sale de caja, con IVA y percepciones).
      // montoNeto (opcional) = neto sin IVA si el ticket lo discrimina.
      // Aceptamos `datos.montoTotal` legacy por si algún flujo viejo lo manda.
      monto:         (datos.monto != null && Number(datos.monto) > 0)
                      ? Math.round(Number(datos.monto))
                      : (datos.montoTotal != null ? Math.round(Number(datos.montoTotal)) : null),
      montoNeto:     (datos.montoNeto != null && Number(datos.montoNeto) > 0)
                      ? Math.round(Number(datos.montoNeto)) : null,
      percepcionIIBB: (datos.percepcionIIBB != null && Number(datos.percepcionIIBB) > 0)
                        ? Math.round(Number(datos.percepcionIIBB)) : null,
      jurisdiccionIIBB: (Number(datos.percepcionIIBB) > 0 && datos.jurisdiccionIIBB) ? datos.jurisdiccionIIBB : null,
      percepcionIVA:  (datos.percepcionIVA != null && Number(datos.percepcionIVA) > 0)
                        ? Math.round(Number(datos.percepcionIVA)) : null,
      // Clase del comprobante: 'nota_credito' → el modal lo aprueba como NC.
      claseComprobante: esNotaCredito ? 'nota_credito' : 'factura',
      // Solo registrar (factura solo-fiscal): se propaga para que al aprobar NO
      // se cargue como gasto que debita caja, sino como factura 'registrada'.
      soloRegistrar: soloRegistrarFC || undefined,
      obraId:        datos.obraId        || null,  // si el texto mencionó obra
      mediaType:     mediaUrl?.endsWith('.pdf') ? 'pdf' : 'image',
      mediaUrl:      mediaUrl || null,
      from:          user.phone,
      creadoPor:     user.user_name,
      receivedAt:    new Date().toISOString(),
      status:        'pendiente',
    });

    const admins = await getAllAdmins();
    const montoTotalAviso = (datos.monto != null && Number(datos.monto) > 0)
                              ? Math.round(Number(datos.monto))
                              : (datos.montoTotal != null ? Math.round(Number(datos.montoTotal)) : null);
    const montoStr = montoTotalAviso != null ? `$${montoTotalAviso.toLocaleString('es-AR')}` : '—';
    const docLabel = esNotaCredito ? 'Nota de Crédito' : 'factura';
    for (const admin of admins) {
      await sendWA(admin.phone,
        `📄 *Nueva ${docLabel} recibida*\n\n` +
        `*${user.user_name}* envió una ${docLabel}${datos.tipoFactura ? ` ${datos.tipoFactura}` : ''}:\n` +
        `• Proveedor: ${datos.proveedor || '—'}\n` +
        `• Monto: ${montoStr}\n` +
        `• N°: ${datos.numeroFactura || '—'}\n\n` +
        `Revisala en la app Kamak → Buzón WhatsApp.`
      );
    }

    // Campanita + push a los Admin (legacy → solo push; ya se ve in-app en
    // Autorizaciones). Best-effort, no rompe la respuesta al que envió la factura.
    await crearNotifServidor('wa_factura_pendiente', {
      actorId: user.id || null, // no auto-notificar a quien la envió (si fuera Admin)
      cuerpo: `${user.user_name}: ${esNotaCredito ? 'NC' : 'factura'} de ${datos.proveedor || '—'}${montoTotalAviso != null ? ` · ${montoStr}` : ''}`,
    });

    return `✅ ${esNotaCredito ? 'Nota de Crédito' : 'Factura'}${datos.tipoFactura ? ` ${datos.tipoFactura}` : ''} de *${datos.proveedor || 'proveedor'}* recibida.\n${montoTotalAviso != null ? `Monto: *${montoStr}*\n` : ''}Los administradores la revisarán para aprobarla.`;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PAGO A PROVEEDOR (contra cuenta corriente)
  // ─────────────────────────────────────────────────────────────────────────
  if (tipo === 'pago_proveedor') {
    const monto = Math.round(parseFloat(datos.monto) || 0);
    if (!monto || monto <= 0) return '❌ El monto del pago debe ser mayor a 0.';
    const prov = ctx.proveedores.find(p => p.id === datos.proveedorId) ||
                 ctx.proveedores.find(p => p.nombre?.toLowerCase().includes((datos.proveedorNombre || '').toLowerCase()));
    if (!prov) return '❌ No encontré ese proveedor.';
    const obra = datos.obraId ? ctx.obras.find(o => o.id === datos.obraId) : null;
    const caja = ctx.cajas.find(c => c.id === datos.cajaId) ||
                 ctx.cajas.find(c => c.tipo === 'efectivo' && c.usuarioId === user.email && c.moneda === 'ARS');
    if (!caja) return '⚠️ No sé de qué caja sale el pago. Decime la caja o configurá tu caja efectivo.';

    const fmt = n => `$${Math.round(n).toLocaleString('es-AR')}`;
    const concepto = datos.concepto || `Pago a ${prov.nombre}${obra ? ` · ${obra.nombre}` : ''}`;

    if (user.user_rol !== 'Admin') {
      return '⚠️ Los pagos a proveedor los registra un Admin.';
    }

    // ── Match pago → factura pendiente de pago (Cuentas por Pagar) ────────────
    // ANTES de crear el movimiento: ¿hay alguna factura ABIERTA de este proveedor
    // cuyo saldo ≈ monto del pago (tolerancia 0,5%)? Si la factura ya viene
    // resuelta (datos.facturaPendienteId, vía el flujo de confirmación) o se pidió
    // saltear el match (datos._skipMatch), no buscamos de nuevo.
    let facturaSaldar = null;
    if (datos.facturaPendienteId) {
      facturaSaldar = (ctx.facturasPendientes || []).find(f => f.id === datos.facturaPendienteId) || null;
      // Defensa: nunca saldar (ni mover caja contra) una factura que no está abierta
      // — registrada (solo fiscal), pagada o anulada NO reciben pago.
      if (facturaSaldar && !esFacturaAbiertaBot(facturaSaldar)) facturaSaldar = null;
    } else if (!datos._skipMatch && user.phone) {
      const matches = matchFacturasPorPagoBot(ctx.facturasPendientes || [], {
        proveedorId: prov.id, proveedor: prov.nombre, monto, tolerancia: 1,
      });
      if (matches.length === 1) {
        // 1 factura calza → pedir confirmación al admin (estado dedicado).
        const f = matches[0];
        await saveConversation(user.phone, {
          state: 'awaiting_factura_pago_confirm',
          data: { pagoDatos: { ...datos, proveedorId: prov.id, cajaId: caja.id }, facturaId: f.id, mediaUrl },
        });
        return `🧾 Tenés una factura PENDIENTE que coincide:\n*${f.proveedor || prov.nombre}*${f.numero ? ` · N° ${f.numero}` : ''} · saldo ${fmt(saldoFacturaPendienteBot(f))}\n\n¿Este pago de ${fmt(monto)} es de esa factura? (sí/no)\nSi decís *no*, lo registro como pago suelto.`;
      }
      if (matches.length > 1) {
        // Varias calzan → listar para que el admin elija. Los ids llevan prefijo
        // 'pick:' para que el handler de interactive los devuelva como messageText
        // limpio (= el id de la factura), igual que el resto de las listas del bot.
        const opciones = matches.slice(0, 9).map(f => ({
          id: `pick:${f.id}`,
          title: `${(f.proveedor || prov.nombre).slice(0, 14)}${f.numero ? ` N°${f.numero}` : ''}`,
          description: `saldo ${fmt(saldoFacturaPendienteBot(f))}${f.fecha ? ` · ${f.fecha}` : ''}`,
        }));
        await saveConversation(user.phone, {
          state: 'awaiting_factura_pago_pick',
          data: { pagoDatos: { ...datos, proveedorId: prov.id, cajaId: caja.id }, opcionesFacturas: matches.slice(0, 9).map(f => f.id), mediaUrl },
        });
        const lineas = matches.slice(0, 9).map((f, i) => `${i + 1}. ${f.proveedor || prov.nombre}${f.numero ? ` · N° ${f.numero}` : ''} · saldo ${fmt(saldoFacturaPendienteBot(f))}`).join('\n');
        await sendWAList(user.phone, `🧾 Hay varias facturas pendientes que coinciden con ${fmt(monto)}. ¿Cuál estás pagando?\n\n${lineas}\n\nO escribí *ninguna* para registrarlo como pago suelto.`, 'Elegir factura', opciones);
        return null; // la lista ya se envió; el caller no debe mandar otro texto
      }
      // 0 matches → sigue abajo: pago suelto (comportamiento actual intacto).
    }

    // Movimiento gasto (categoria subcontrato). La CC del proveedor se deriva.
    // Si salda una factura pendiente, linkeamos con facturaPendienteId (igual que
    // RegistrarPagoModal en la app) — ese pago NO lleva comprobanteRecibido (no se
    // duplica el IVA: el comprobante fiscal ya vive en la factura pendiente).
    const mov = {
      id: `mov-${Date.now()}`,
      tipo: 'gasto',
      descripcion: concepto,
      monto,
      fecha: datos.fecha || new Date().toISOString().split('T')[0],
      obraId: obra?.id || null,
      obraNombre: obra?.nombre || 'General',
      cajaId: caja.id,
      cajaDestinoId: null,
      proveedor: prov.nombre,
      proveedorId: prov.id,
      categoria: 'subcontrato',
      medioPago: datos.medioPago || 'Transferencia',
      facturaPendienteId: facturaSaldar?.id || undefined,
      referencia: facturaSaldar?.numero || datos.numeroFactura || '',
      comprobanteUrl: mediaUrl || null, // foto/PDF del pago (transferencia/echeq) si se mandó
      creadoPorWA: true,
      creadoPor: user.user_name,
    };
    // Pago ATÓMICO: movimiento + pago en la factura en una transacción (RPC) o
    // fallback verificado con re-lectura fresca. Antes: appendMovimiento + patch
    // con pagos[] STALE del ctx → un pago concurrente de la app se perdía y la
    // factura se podía pagar dos veces.
    const pago = facturaSaldar
      ? { movimientoId: mov.id, monto, fecha: mov.fecha, cajaId: caja.id, comprobanteUrl: mediaUrl || null }
      : null;
    const resPago = await sbRegistrarPago(mov, facturaSaldar?.id || null, pago);
    if (!resPago.ok) {
      return `❌ No pude registrar el pago: ${(resPago.error || '').includes('excede el saldo') ? 'el monto excede el saldo de la factura (quizás alguien la pagó recién desde la app). Escribí *pendientes de pago* para ver el saldo actual.' : 'error del servidor. Probá de nuevo en un momento.'}`;
    }

    if (facturaSaldar) {
      // Para el mensaje: usamos la factura fresca del fallback si está; sino
      // estimamos con la stale + este pago (solo texto — lo persistido es atómico).
      const fRef = resPago.factura || { ...facturaSaldar, pagos: [...(facturaSaldar.pagos || []), pago] };
      const nuevoSaldo = saldoFacturaPendienteBot(fRef);
      const nuevoEstado = estadoFacturaPendienteBot(fRef);
      const lineaEstado = nuevoEstado === 'pagada'
        ? `✅ Factura *${facturaSaldar.numero || facturaSaldar.proveedor}* SALDADA.`
        : `🟡 Factura *${facturaSaldar.numero || facturaSaldar.proveedor}* abonada parcialmente · saldo restante ${fmt(nuevoSaldo)}.`;
      return `✅ *Pago registrado*\n${fmt(monto)} a *${prov.nombre}*${obra ? ` · ${obra.nombre}` : ''}\nSale de: ${caja.nombre}\n${lineaEstado}`;
    }

    // Libro único: NO escribimos asiento 'haber' en la CC del proveedor. Lo
    // pagado se DERIVA del movimiento de gasto (por proveedorId/nombre) tanto en
    // la app como en el bot. Los 'debe' (deuda: certificaciones/facturas) sí
    // viven en ccEntries. Así no se duplica el pago.
    return `✅ *Pago registrado*\n${fmt(monto)} a *${prov.nombre}*${obra ? ` · ${obra.nombre}` : ''}\nSale de: ${caja.nombre}` + (obra ? `\nImputado a la CC del proveedor.` : '');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TRASPASO entre cajas (FASE 2)
  // ─────────────────────────────────────────────────────────────────────────
  if (tipo === 'traspaso') {
    const cajaOrigen  = ctx.cajas.find(c => c.id === datos.cajaId);
    const cajaDestino = ctx.cajas.find(c => c.id === datos.cajaDestinoId);
    const monto = Math.round(parseFloat(datos.monto) || 0);
    if (!cajaOrigen || !cajaDestino) return '❌ No encontré alguna de las cajas. Verificá los nombres.';
    if (cajaOrigen.id === cajaDestino.id) return '❌ La caja origen y destino son la misma.';
    if (!monto || monto <= 0) return '❌ El monto del traspaso debe ser mayor a 0.';

    const montoDestino = parseFloat(datos.montoDestino) || monto;
    const fmt = (n, mon) => `${mon === 'USD' ? 'U$S' : '$'} ${Math.round(n).toLocaleString('es-AR')}`;

    if (user.user_rol === 'Admin') {
      const movData = await loadSharedData('movimientos');
      const movs    = movData?.movimientos || [];
      const cajas   = movData?.cajas || ctx.cajas;
      const nuevoMov = {
        id:           `mov-${Date.now()}`,
        tipo:         'traspaso',
        descripcion:  datos.descripcion || `Traspaso ${cajaOrigen.nombre} → ${cajaDestino.nombre}`,
        monto,
        montoDestino,
        fecha:        datos.fecha || new Date().toISOString().split('T')[0],
        obraId:       null,
        obraNombre:   'General',
        cajaId:       cajaOrigen.id,
        cajaDestinoId: cajaDestino.id,
        proveedor:    '',
        categoria:    'traspaso',
        medioPago:    'Interno',
        creadoPorWA:  true,
        creadoPor:    user.user_name,
      };
      await appendMovimiento(nuevoMov);
      return (
        `✅ *Traspaso registrado*\n\n` +
        `${fmt(monto, cajaOrigen.moneda)} de *${cajaOrigen.nombre}*\n` +
        `→ ${fmt(montoDestino, cajaDestino.moneda)} a *${cajaDestino.nombre}*` +
        (cajaOrigen.moneda !== cajaDestino.moneda ? ` _(cross-moneda)_` : '')
      );
    } else {
      return '⚠️ Los traspasos entre cajas los puede hacer solo un Admin.';
    }
  }

  if (tipo === 'cheque_recibido') {
    const monto = Math.round(parseFloat(datos.monto) || 0);
    const fmt = n => `$${Math.round(n).toLocaleString('es-AR')}`;
    if (!monto) return '🤔 ¿Cuál es el monto del cheque?';
    if (!datos.fechaVencimiento) return '🤔 ¿Para qué fecha es el cheque? (fecha de cobro, ej. 2026-07-20)';
    // La caja la decide el usuario: un ingreso es importante, no lo metemos en
    // una caja por adivinanza. Si dijo la caja, la usamos; si no, preguntamos.
    // (NO se infiere de la obra: la obra es solo atribución.)
    const caja = datos.cajaId ? ctx.cajas.find(c => c.id === datos.cajaId && cajaEsVisible(user, c)) : null;
    if (!caja) {
      const opciones = ctx.cajas
        .filter(c => cajaEsVisible(user, c) && c.moneda === 'ARS')
        .slice(0, 8).map(c => `• ${c.nombre}`).join('\n');
      return `🧾 Cheque de *${fmt(monto)}*${datos.banco ? ` · ${datos.banco}` : ''}${datos.numero ? ` · #${datos.numero}` : ''} listo.\n\n*¿A qué caja entra?*\n${opciones || '(no tenés cajas accesibles)'}\n\nDecime el nombre de la caja.`;
    }
    const obra = datos.obraId ? ctx.obras.find(o => o.id === datos.obraId) : null;
    const esEcheq = !!datos.esEcheq;
    const hoy = new Date().toISOString().split('T')[0];

    // 1) Ingreso a la caja (al recibirlo entra, igual que en la app).
    const movData = await loadSharedData('movimientos');
    const movs  = movData?.movimientos || [];
    const cajas = movData?.cajas || ctx.cajas;
    const movId = `mov-${Date.now()}`;
    const nuevoMov = {
      id: movId, tipo: 'ingreso',
      descripcion: `Cheque recibido${datos.numero ? ` #${datos.numero}` : ''}${datos.banco ? ` · ${datos.banco}` : ''}`,
      monto, fecha: datos.fecha || hoy,
      obraId: obra?.id || null, obraNombre: obra?.nombre || 'General',
      cajaId: caja.id, cajaDestinoId: null,
      proveedor: datos.clienteNombre || datos.titular || '',
      categoria: 'cheque', medioPago: esEcheq ? 'E-cheq' : 'Cheque',
      referencia: datos.numero || '', comprobanteUrl: mediaUrl || null,
      creadoPorWA: true, creadoPor: user.user_name,
    };
    await appendMovimiento(nuevoMov);

    // 2) Cheque en cartera (se agrega atómicamente más abajo).
    const nuevoCheque = {
      id: `chq-${Date.now()}`,
      tipo: esEcheq ? 'echeq_tercero' : 'tercero',
      numero: datos.numero || '', banco: datos.banco || '', titular: datos.titular || '',
      monto, moneda: 'ARS',
      fechaIngreso: datos.fecha || hoy, fechaVencimiento: datos.fechaVencimiento,
      obraId: obra?.id || null, obraNombre: obra?.nombre || '',
      clienteNombre: datos.clienteNombre || '', proveedorNombre: '',
      estado: 'cartera', cajaId: caja.id,
      cajaDestinoId: null, cajaDestinoNombre: null, fechaDeposito: null, movimientoId: movId,
      endosadoA: null, fechaEndoso: null, traspasoA: null, fechaTraspaso: null,
      fechaRechazo: null, motivoRechazo: null,
      observacion: '', createdAt: new Date().toISOString(), creadoPorWA: true, creadoPor: user.user_name,
    };
    await sbAppendArray('cheques', nuevoCheque); // atómico

    return `🧾 *Cheque en cartera*\n${fmt(monto)}${datos.banco ? ` · ${datos.banco}` : ''}${datos.numero ? ` · #${datos.numero}` : ''}\nVence: ${datos.fechaVencimiento}\nEntró a tu caja *${caja.nombre}*. Editable desde la app.`;
  }

  if (tipo === 'avance_obra') {
    const obraQ = (datos.obraId || '').toLowerCase();
    const obra  = ctx.obras.find(o => o.id === datos.obraId) ||
                  ctx.obras.find(o => o.nombre?.toLowerCase().includes(obraQ));
    if (!obra) return '❌ Obra no encontrada. Indicá el nombre de la obra.';

    const [obrasData, provData] = await Promise.all([
      loadSharedData('obras'),
      loadSharedData('proveedores'),
    ]);
    const detalles = obrasData?.detalles || {};
    const detalle  = detalles[obra.id] || { rubros: [], fotos: [] };

    // Buscar rubro y tarea para actualizar avance
    let rubroIdx = -1, tareaIdx = -1, tarea = null, rubro = null;
    if (datos.tareaId) {
      for (let ri = 0; ri < detalle.rubros.length; ri++) {
        const r = detalle.rubros[ri];
        const ti = (r.tareas || []).findIndex(t => t.id === datos.tareaId);
        if (ti >= 0) { rubroIdx = ri; tareaIdx = ti; tarea = r.tareas[ti]; rubro = r; break; }
      }
    }
    if (!rubro && datos.rubroId) {
      rubroIdx = detalle.rubros.findIndex(r => r.id === datos.rubroId);
      if (rubroIdx >= 0) rubro = detalle.rubros[rubroIdx];
    }

    // Calcular avance y valor a certificar (costoMat + costoSub = valor total del trabajo)
    const esCorreccion = !!datos.esCorreccion;
    let avanceAgregado = 0;
    let valorCertificado = 0;
    const cantAvance = parseFloat(datos.cantidadAvance) || 0;
    if (tarea && cantAvance > 0) {
      const cantTotal   = tarea.cantidad || 1;
      const costoUnit   = (tarea.costoMat || 0) + (tarea.costoSub || 0);
      avanceAgregado    = Math.round((cantAvance / cantTotal) * 100);
      valorCertificado  = Math.round(costoUnit * cantAvance);
    } else if (datos.porcentajeAvance) {
      avanceAgregado = parseFloat(datos.porcentajeAvance) || 0;
      if (tarea) {
        const costoUnit  = (tarea.costoMat || 0) + (tarea.costoSub || 0);
        valorCertificado = Math.round(costoUnit * (tarea.cantidad || 0) * avanceAgregado / 100);
      }
    }
    // Para correcciones: SET en vez de ADD
    const avancePrevio = tarea?.avance || 0;
    const avanceFinalUncapped = esCorreccion
      ? Math.round((cantAvance / (tarea?.cantidad || 1)) * 100)
      : avancePrevio + avanceAgregado;
    const avanceFinal = Math.min(100, avanceFinalUncapped);
    if (esCorreccion && tarea) avanceAgregado = avanceFinal - avancePrevio;

    // Detectar exceso sobre presupuesto
    let excesoMsg = '';
    let nuevoAdicional = null;
    if (tarea && avanceAgregado !== 0) {
      const nuevoAvanceRaw = avanceFinalUncapped;
      if (nuevoAvanceRaw > 100) {
        const excesoPct  = nuevoAvanceRaw - 100;
        const costoUnit  = (tarea.costoMat || 0) + (tarea.costoSub || 0);
        const excesoQty  = parseFloat(((excesoPct / 100) * (tarea.cantidad || 0)).toFixed(3));
        const excesoValor = Math.round(costoUnit * excesoQty);
        const qtyStr     = cantAvance > 0
          ? `${excesoQty}${datos.unidad || tarea.unidad || ''} sobre presupuesto`
          : `${excesoPct.toFixed(0)}% sobre presupuesto`;
        nuevoAdicional = {
          id:            `adic-${Date.now()}`,
          descripcion:   `⚠️ Exceso ${tarea.nombre} — ${qtyStr} (vía WhatsApp por ${user.user_name})`,
          fecha:         new Date().toISOString().split('T')[0],
          estado:        'pendiente',
          tarea:         tarea.nombre,
          cantidad:      excesoQty,
          unidad:        datos.unidad || tarea.unidad || '',
          // Costo (lo que le pagamos al proveedor)
          costoUnit:     costoUnit,
          costoTotal:    excesoValor,
          // Venta (lo que le cobramos al cliente — a completar en la app, por defecto igual al costo)
          valorVentaUnit:  null,
          valorVentaTotal: null,
          // Resumen
          monto:           excesoValor,   // alias para compatibilidad
          montoProveedor:  null,          // null = pendiente de decidir si se le cobra al proveedor
        };
        const montoFmt = String(excesoValor).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        excesoMsg = `\n⚠️ *Exceso de presupuesto:* ${qtyStr}. Se creó un adicional pendiente por $${montoFmt}.`;
      }
    }

    // Actualizar avance en rubros — SET para correcciones, ADD para avances normales
    let updatedRubros = detalle.rubros;
    if (rubroIdx >= 0 && tareaIdx >= 0 && tarea && avanceFinal !== avancePrevio) {
      updatedRubros = detalle.rubros.map((r, ri) =>
        ri !== rubroIdx ? r : {
          ...r,
          tareas: r.tareas.map((t, ti) => ti === tareaIdx ? { ...t, avance: avanceFinal } : t),
        }
      );
    }

    // Sync al Gantt: la task del cronograma con tareaId === tarea.id se
    // actualiza con el nuevo avance. Sin esto, el % cargado por WA no se ve
    // reflejado en el Gantt visual hasta que el user toque el slider.
    let updatedGantt = detalle.gantt;
    if (tarea && detalle.gantt?.tasks && avanceFinal !== avancePrevio) {
      updatedGantt = {
        ...detalle.gantt,
        tasks: detalle.gantt.tasks.map(gt =>
          gt.tareaId === tarea.id ? { ...gt, avance: avanceFinal } : gt
        ),
      };
    }

    // Sync al contrato MO: recalcular avancePct PONDERADO por costo de
    // todas las tareas del rubro (mismo cálculo que hace el Gantt frontend).
    let updatedContratos = detalle.contratos || [];
    if (rubro && rubro.nombre && avanceFinal !== avancePrevio) {
      // Sumar costo total y costo ejecutado de todas las tareas del rubro
      // (usando los avances ya aplicados en updatedRubros).
      const rubroActualizado = updatedRubros.find(r => r.id === rubro.id);
      // Excluir tareas importadas (con contratoId): pertenecen a su contrato
      // 'adjunto', no al contrato MO manual del gremio (paridad con ObraGantt #5).
      const tareasNoSec = (rubroActualizado?.tareas || []).filter(t => t.tipo !== 'seccion' && !t.contratoId);
      let totalCosto = 0, ejecutado = 0;
      for (const t of tareasNoSec) {
        const costoUnit = (t.costoMat || 0) + (t.costoSub || 0);
        const costoTot = costoUnit * (t.cantidad || 0);
        totalCosto += costoTot;
        ejecutado  += costoTot * ((t.avance || 0) / 100);
      }
      const nuevoAvancePct = totalCosto > 0
        ? Math.round(ejecutado / totalCosto * 100)
        : Math.round(tareasNoSec.reduce((s, t) => s + (t.avance || 0), 0) / Math.max(1, tareasNoSec.length));
      // Aplicar el nuevo % a contratos cuyo gremio matchea el rubro.
      const matchGr = (rNom, gr) => {
        const r = (rNom || '').toUpperCase().trim(), g = (gr || '').toUpperCase().trim();
        if (!r || !g) return false; // sin gremio NO matchea (antes '' pisaba TODOS los contratos)
        return r.includes(g) || g.includes(r);
      };
      // No pisar el avancePct de contratos 'adjunto': su avance se deriva de sus
      // propias tareas (avanceContrato), no del promedio del rubro (paridad #5).
      updatedContratos = updatedContratos.map(c =>
        (matchGr(rubro.nombre, c.gremio) && c.origen !== 'adjunto') ? { ...c, avancePct: nuevoAvancePct } : c
      );
    }

    const nuevaFoto = mediaUrl ? {
      id:        `foto-${Date.now()}`,
      url:       mediaUrl,
      fecha:     new Date().toISOString().split('T')[0],
      label:     datos.descripcion || 'Avance de obra',
      rubro:     tarea?.nombre || datos.tareaId || '',
      // Las fotos que manda el bot por avance caen en la carpeta "Avance de obra".
      carpeta:   'Avance de obra',
      creadoPor: user.user_name,
    } : null;

    const detalleActualizado = {
      ...detalle,
      rubros:     updatedRubros,
      gantt:      updatedGantt,
      contratos:  updatedContratos,
      fotos:      [...(detalle.fotos || []), ...(nuevaFoto ? [nuevaFoto] : [])],
      adicionales: esCorreccion
        ? [
            // Si la corrección ya no excede el 100%, quitar el adicional de exceso previo de esta tarea
            ...(detalle.adicionales || []).filter(a =>
              !(avanceFinalUncapped <= 100 && a.descripcion?.includes('Exceso') && a.tarea === tarea?.nombre)
            ),
            ...(nuevoAdicional ? [nuevoAdicional] : []),
          ]
        : [...(detalle.adicionales || []), ...(nuevoAdicional ? [nuevoAdicional] : [])],
    };
    // Atómico: parchea SOLO el detalle de esta obra (no pisa las demás).
    await sbPatchDetalleObra(obra.id, {
      rubros:      updatedRubros,
      gantt:       updatedGantt,
      contratos:   updatedContratos,
      fotos:       detalleActualizado.fotos,
      adicionales: detalleActualizado.adicionales,
    });

    // Agregar certificación a cuenta corriente del proveedor
    let ccMsg = '';
    console.log(`CC check: rubro.proveedor="${rubro?.proveedor}" valorCertificado=${valorCertificado} tarea.costoMat=${tarea?.costoMat} tarea.costoSub=${tarea?.costoSub}`);
    if (!rubro) {
      ccMsg = '\n⚠️ No se encontró el rubro en el presupuesto, no se creó cert. en CC.';
    } else if (!rubro.proveedor) {
      ccMsg = `\n⚠️ El rubro *${rubro.nombre}* no tiene proveedor asignado. Asignalo en la app para que la cert. se registre automáticamente.`;
    } else if (valorCertificado === 0) {
      ccMsg = `\n⚠️ El presupuesto de la tarea tiene costo $0. Verificá los costos en el presupuesto.`;
    } else if (provData) {
      const provNomQ = rubro.proveedor.toLowerCase();
      const prov = (provData.proveedores || []).find(p => {
        const pNom = p.nombre?.toLowerCase() || '';
        return pNom.includes(provNomQ) || provNomQ.includes(pNom) || pNom.split(' ')[0] === provNomQ.split(' ')[0];
      });
      if (!prov) {
        ccMsg = `\n⚠️ Proveedor "*${rubro.proveedor}*" no encontrado en el sistema. Revisá el nombre en el rubro.`;
      } else {
        const cantStr = cantAvance > 0 ? `${cantAvance}${datos.unidad || ''}` : `${Math.abs(avanceAgregado)}%`;
        const hoyCert = new Date().toISOString().split('T')[0];
        // ¿Hay una cert previa de esta tarea para CORREGIR en su lugar? (caso raro)
        let certPrevia = null;
        if (esCorreccion) {
          const tareaKey = (tarea?.nombre || '').toLowerCase();
          const cc = provData.ccEntries || [];
          for (let i = cc.length - 1; i >= 0; i--) {
            const e = cc[i];
            if (e.obraId === obra.id && e.tipo === 'cert' && (e.concepto || '').toLowerCase().includes(tareaKey)) { certPrevia = e; break; }
          }
        }
        if (certPrevia) {
          // Corrección en su lugar: edita SOLO ese asiento por id (caso raro).
          // No hay RPC de patch para ccEntries todavía → read-modify-write acotado.
          const provFresh = await loadSharedData('proveedores');
          const ccFresh = provFresh?.ccEntries || [];
          const updated = ccFresh.map(e => e.id !== certPrevia.id ? e : {
            ...e, fecha: hoyCert,
            concepto: `Corrección: ${tarea?.nombre || 'Avance'} (${cantStr}) — por ${user.user_name}`,
            debe: valorCertificado,
          });
          await saveSharedData('proveedores', { ...(provFresh || {}), ccEntries: updated });
        } else {
          // Cert nueva → agregar atómicamente (no pisa el resto de la CC).
          await sbAppendCCEntry({
            id:          `cc-${Date.now()}`,
            proveedorId: prov.id,
            obraId:      obra.id,
            obraNombre:  obra.nombre,
            fecha:       hoyCert,
            concepto:    esCorreccion
              ? `Corrección: ${tarea?.nombre || 'Avance'} (${cantStr})`
              : `Cert: ${datos.descripcion || tarea?.nombre || 'Avance'} (${cantStr})`,
            tipo:        'cert',
            debe:        valorCertificado,
            haber:       0,
          });
        }
        const montoFmt = String(valorCertificado).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        ccMsg = esCorreccion
          ? `\n💰 CC de *${prov.nombre}* actualizada → $${montoFmt}`
          : `\n💰 Cert. $${montoFmt} agregada a CC de *${prov.nombre}*`;
      }
    }

    // Alertas financieras solo van a admins, no al que reportó
    const alertasAdmin = [excesoMsg, ccMsg].filter(m => m && m.startsWith('\n⚠️')).map(m => m.trim());
    if (alertasAdmin.length > 0) {
      const admins = await getAllAdmins();
      const cantStr = cantAvance > 0 ? `${cantAvance}${datos.unidad || ''}` : `${avanceAgregado}%`;
      const msgAdmin =
        `📋 *Avance registrado en ${obra.nombre}*\n` +
        `Por: *${user.user_name}*\n` +
        `Tarea: ${tarea?.nombre || '—'} · ${cantStr}\n\n` +
        alertasAdmin.join('\n');
      for (const admin of admins) await sendWA(admin.phone, msgAdmin);

      // Guardar también en shared_data 'alertas' para el dashboard
      try {
        const nuevasAlertas = alertasAdmin.map((msg, i) => ({
          id:        `alerta-${Date.now()}-${i}`,
          tipo:      msg.includes('Exceso') ? 'exceso' : 'proveedor_faltante',
          texto:     msg,
          obra:      obra.nombre,
          obraId:    obra.id,
          tarea:     tarea?.nombre || '',
          fecha:     new Date().toISOString(),
          leida:     false,
          fuente:    'whatsapp',
          creadoPor: user.user_name,
        }));
        for (const a of nuevasAlertas) await sbAppendArray('alertas', a); // atómico
      } catch (e) { console.error('saveAlertas error:', e.message); }
    }

    const tareaMsg  = tarea ? ` · ${tarea.nombre}` : '';
    const avanceMsg = esCorreccion
      ? ` · ${avancePrevio}% → ${avanceFinal}%`
      : avanceAgregado > 0 ? ` · +${Math.min(avanceAgregado, 100 - avancePrevio)}%` : '';
    // Al que reportó: confirmación limpia (sin precios ni alertas). El detalle de
    // la cert ($ = costo del subcontrato) es un COSTO → SOLO al Admin. El resto
    // (capataz, jefe de obra) ve solo la confirmación del avance, sin plata.
    const ccOkMsg = (ccMsg && ccMsg.startsWith('\n💰') && isAdmin(user)) ? ccMsg : '';
    const accionMsg = esCorreccion ? '🔧 Corrección guardada' : '✅ Avance guardado';
    return `${accionMsg} en *${obra.nombre}*${tareaMsg}${avanceMsg}${mediaUrl ? ' · con foto' : ''}${ccOkMsg}`;
  }

  if (tipo === 'comando') {
    return await ejecutarComando(datos.comando, datos, user, ctx);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // COMERCIAL (FASE 4) — crear prospecto / mover etapa del embudo.
  // Crear o mover oportunidades por chat es SOLO Admin (un Administración no
  // crea obras por chat). Delegamos al módulo intents-comercial (escrituras
  // atómicas); acá solo gateamos, validamos y formateamos la respuesta.
  // ─────────────────────────────────────────────────────────────────────────
  if (tipo === 'crear_prospecto') {
    if (user.user_rol !== 'Admin') return '⚠️ Crear oportunidades por chat es solo para un Admin.';
    const nombreObra = String(datos.obraNombre || datos.nombreObra || '').trim();
    // Si compartieron un contacto, su nombre/teléfono mandan sobre lo que haya
    // inferido Claude del texto: el primer contacto es de ESE contacto, no del
    // que escribe. Fallback al clienteNombre del texto y al phone del usuario.
    const compartido = user.contactoCompartido || null;
    const telefonoContacto = compartido?.telefono || user.phone || null;
    // Nombre del cliente: el del contacto compartido manda sobre el del texto.
    // Borde: contacto SIN nombre pero CON teléfono → sintetizamos un nombre con
    // el teléfono ("Contacto +549...") para que crearProspecto cree la ficha y
    // guarde el teléfono (si va vacío, no crea cliente ni persiste el número).
    let clienteNombre = (compartido?.nombre || String(datos.clienteNombre || '').trim()) || null;
    if (!clienteNombre && compartido && telefonoContacto) clienteNombre = `Contacto ${telefonoContacto}`;
    // Necesitamos al menos un cliente o un nombre de oportunidad. Si hay cliente
    // pero no obra, crearProspecto arma "Consulta — <cliente>" (igual que la web).
    // Con un contacto compartido sin nombre pero con teléfono, igual seguimos:
    // crearProspecto puede crear/vincular el cliente por teléfono.
    if (!nombreObra && !clienteNombre && !(compartido && telefonoContacto)) return '❌ ¿De quién es el primer contacto? Ej: *primer contacto Pérez* o *nuevo prospecto Shell Ruta 3 cliente Pérez*.';
    try {
      const nueva = await crearProspecto({
        nombreObra, clienteNombre, usuario: user.user_name,
        telefono: telefonoContacto, fuente: 'WhatsApp', nota: '',
      });
      if (nueva.duplicada) return `⚠️ Ya existe una obra *${nueva.existente.nombre}*${nueva.existente.etapa ? ` (etapa ${nueva.existente.etapa})` : ''}. Si la querés mover, decime: *pasá ${nueva.existente.nombre} a cotizado*.`;
      const cliMsg = nueva.clienteId
        ? `\n👤 Cliente: *${nueva.cliente}*${nueva.clienteCreado ? ' (ficha nueva, prospecto)' : ''}`
        : (clienteNombre ? `\n👤 Cliente: *${clienteNombre}* (lo dejé como texto)` : '');
      return `✅ *Primer contacto cargado*\n🏗 *${nueva.nombre}*${cliMsg}\nQuedó en la columna *Prospecto* del embudo (sin presupuesto). Editable desde Comercial.`;
    } catch (e) {
      console.error('[webhook] crear_prospecto', e.message);
      return '❌ No pude guardar el primer contacto (error de base). Reintentá en un momento; si sigue, avisá.';
    }
  }

  if (tipo === 'mover_etapa') {
    if (user.user_rol !== 'Admin') return '⚠️ Mover oportunidades por chat es solo para un Admin.';
    const ETAPAS_OK = ['prospecto', 'cotizado', 'negociacion', 'ganado', 'perdido'];
    const obraNombre = String(datos.obraNombre || '').trim();
    const etapaNueva = String(datos.etapaNueva || '').trim().toLowerCase();
    if (!obraNombre) return '❌ ¿Qué obra movemos? Ej: *pasá Shell Ruta 3 a ganado*.';
    if (!ETAPAS_OK.includes(etapaNueva)) return '❌ ¿A qué etapa? Las opciones son: prospecto, cotizado, negociación, ganado o perdido.';
    try {
      const r = await moverEtapaObra({ obraNombre, etapaNueva, usuario: user.user_name });
      if (r?.error === 'obra_no_encontrada') return `❌ No encontré una obra que matchee con "${obraNombre}".`;
      if (r?.error === 'obra_ambigua') return `🤔 Hay varias obras que matchean con "${obraNombre}":\n${(r.candidatos || []).map(n => `• ${n}`).join('\n')}\nDecime el nombre exacto.`;
      const extra = etapaNueva === 'ganado' ? '\n🎉 La pasé a *activa* (ganada).'
                  : etapaNueva === 'perdido' ? '\n📁 La archivé como *perdida*.' : '';
      return `✅ *${r.obra}* movida a *${etapaNueva}*.${extra}\nQuedó registrado en el timeline.`;
    } catch (e) {
      console.error('[webhook] mover_etapa', e.message);
      return '❌ No pude mover la etapa (error de base). Reintentá en un momento; si sigue, avisá.';
    }
  }

  // ── Nueva tarea desde WhatsApp ──────────────────────────────────────────────
  // Admin puede crear y asignar a cualquiera. No-admin solo puede auto-asignarse.
  // Por la ventana de 24h de WA, NO notificamos por WhatsApp al asignado — el
  // sistema lo notifica via badge in-app cuando entra a la app web.
  if (tipo === 'nueva_tarea') {
    const esAdmin = user.user_rol === 'Admin';
    const appUsers = await sbGet('app_users', '?select=*');
    const creadorId = user.user_id || user.id;

    // Resolver asignado: si admin, busca por nombre; si no admin, fuerza self.
    let asignadoId = creadorId;
    let asignadoNombre = appUsers.find(u => u.id === creadorId)?.nombre || 'vos';
    if (esAdmin && datos.asignadoNombre) {
      const q = String(datos.asignadoNombre).toLowerCase().trim();
      const match = appUsers.find(u =>
        u.nombre?.toLowerCase() === q ||
        u.nombre?.toLowerCase().includes(q) ||
        u.email?.toLowerCase() === q
      );
      if (!match) return `❌ No encontré un usuario con nombre/email "${datos.asignadoNombre}".`;
      asignadoId = match.id;
      asignadoNombre = match.nombre;
    } else if (!esAdmin && datos.asignadoNombre) {
      const q = String(datos.asignadoNombre).toLowerCase().trim();
      const selfNombre = (appUsers.find(u => u.id === creadorId)?.nombre || '').toLowerCase();
      if (!selfNombre.includes(q) && q !== 'mi' && q !== 'a mi' && q !== 'self') {
        return '❌ Solo el Admin puede crear tareas para otros usuarios. Podés crear tareas para vos mismo.';
      }
    }

    if (!datos.titulo || !String(datos.titulo).trim()) {
      return '❌ Falta el título de la tarea. Probá: "crear tarea: comprar cemento para Juan, mañana, prioridad alta".';
    }

    const newId = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const nowIso = new Date().toISOString();
    const checklistItems = (datos.checklist || []).map(texto => ({
      id: newId('item'),
      texto: String(texto).trim(),
      completado: false,
      completadoPor: null,
      completadoAt: null,
    }));
    const nueva = {
      id: newId('tarea'),
      titulo: String(datos.titulo).trim(),
      descripcion: String(datos.descripcion || '').trim(),
      asignadoA: [asignadoId],
      creadoPor: creadorId,
      obraId: datos.obraId || null,
      estado: 'pendiente',
      prioridad: datos.prioridad || 'media',
      fechaLimite: datos.fechaLimite || null,
      checklist: checklistItems,
      comentarios: [],
      vistaPor: [creadorId],
      creadoAt: nowIso,
      actualizadoAt: nowIso,
      completadoAt: null,
    };

    await sbAppendArray('tareas', nueva); // atómico

    const items = checklistItems.length > 0
      ? `\n📋 ${checklistItems.length} item${checklistItems.length === 1 ? '' : 's'} en el checklist`
      : '';
    const venc = nueva.fechaLimite ? `\n📅 Vence: ${nueva.fechaLimite.split('-').reverse().join('/')}` : '';
    const prio = nueva.prioridad === 'alta' ? ' 🔴' : nueva.prioridad === 'media' ? ' 🟡' : '';
    const destino = asignadoId === creadorId ? 'para vos' : `para *${asignadoNombre}*`;

    // Si la tarea es para OTRA persona y esa persona escribió al bot en las
    // últimas 24h (ventana abierta), le avisamos por WhatsApp. Si no, lo verá
    // en la app (Meta no deja texto libre fuera de la ventana de 24h).
    let notifInfo = '';
    if (asignadoId !== creadorId) {
      try {
        const waUsers = await sbGet('whatsapp_users', '?select=user_id,phone');
        const asignadoPhone = waUsers.find(w => w.user_id === asignadoId)?.phone;
        let enVentana = false;
        if (asignadoPhone) {
          const convs = await sbGet('whatsapp_conversations', `?phone=eq.${asignadoPhone}&select=updated_at`);
          const lastAt = convs[0]?.updated_at;
          enVentana = lastAt && (Date.now() - new Date(lastAt).getTime()) < 24 * 60 * 60 * 1000;
        }
        if (enVentana) {
          const aviso = `📋 *${asignadoNombre}*, te asignaron una tarea:\n*${nueva.titulo}*` +
            (nueva.descripcion ? `\n${nueva.descripcion}` : '') +
            venc + items + `\n\nEscribí *tareas* para verla.`;
          const r = await sendWA(asignadoPhone, aviso);
          notifInfo = r?.ok
            ? `\n\n📲 Le avisé a *${asignadoNombre}* por WhatsApp.`
            : `\n\n_(No pude avisarle por WhatsApp ahora; lo verá en la app.)_`;
        } else {
          notifInfo = asignadoPhone
            ? `\n\n_(${asignadoNombre} no escribió al bot en las últimas 24h, así que lo verá cuando entre a la app.)_`
            : `\n\n_(${asignadoNombre} no tiene WhatsApp vinculado; lo verá cuando entre a la app.)_`;
        }
      } catch (e) {
        console.error('aviso tarea asignado error:', e.message);
        notifInfo = `\n\n_(Lo verá cuando entre a la app.)_`;
      }
    }
    return `✅ Tarea creada ${destino}:\n*${nueva.titulo}*${prio}${venc}${items}${notifInfo}`;
  }

  return '✅ Acción registrada correctamente.';
}

async function ejecutarComando(comando, datos, user, ctx) {
  if (comando === 'ayuda') {
    const esAdmin = isAdmin(user);
    return (
      `👋 *Hola ${user.user_name?.split(' ')[0] || ''}, así me podés hablar:*\n\n` +
      `*◆ AVANCE DE OBRA* (foto + texto)\n` +
      `Indicá *qué tarea*, *en qué obra* y cuánto se hizo. Tres formas:\n` +
      ` ✓ Cuanto se hizo HOY (se suma a lo que ya había):\n` +
      `    _"150 m² de revoque grueso en Baradero"_\n` +
      ` ✓ TOTAL acumulado (corrige el avance):\n` +
      `    _"van 850 m² de revoque en total en Baradero"_\n` +
      ` ✓ Porcentaje directo:\n` +
      `    _"30% de pintura en Belgrano"_\n` +
      `Mandá foto del trabajo y el bot registra avance + sube la foto al portal del cliente.\n\n` +

      `*◆ GASTO* (foto de factura o texto)\n` +
      `Ej: _"pagué $50.000 de materiales en Baradero"_\n` +
      `O mandá foto/PDF de factura — el bot extrae proveedor, monto, CUIT.\n` +
      `📋 *Varios juntos:* _"cargá: 50k cemento baradero, 12k flete, 3k comida"_\n\n` +

      `*◆ INGRESO / COBRO*\n` +
      `Ej: _"cobré U$S 5.000 de cuota 2 en Baradero"_\n` +
      `La cuota se marca pagada automáticamente.\n\n` +

      `*◆ CHEQUE RECIBIDO*\n` +
      `Mandá foto del cheque, el bot lo registra en cartera.\n\n` +

      `*◆ TAREAS ASIGNADAS*\n` +
      `• *tareas* — ver tus pendientes\n` +
      `• *tarea N* — detalle de la tarea N\n` +
      `• *hice el item X* — marca un item completado\n` +
      (esAdmin ? `• _"crear tarea para Juan: comprar cemento"_ — asignar nueva\n` : '') +

      `\n*◆ CONSULTAS RÁPIDAS*\n` +
      `• *saldo* — saldo de tus cajas\n` +
      `• *pendientes* — aprobaciones pendientes\n` +
      (esAdmin ? `• *cheques* — cheques por vencer\n` : '') +
      (esAdmin ? `• *resumen [obra] [fecha]* — resumen del día\n` : '') +
      (esAdmin
        ? `• _"como va [obra]"_ — KPIs: avance, gastado, próx. cuota, top gastos\n`
        : `• _"como va [obra]"_ — avance y tareas de la obra\n`) +
      (esAdmin ? `• _"últimos 5 gastos de [obra]"_ — buscar gastos\n` : '') +
      (esAdmin ? `• _"cuánto le debo a [proveedor]"_ — CC + últimas certs/pagos\n` : '') +
      `• _"contacto [proveedor]"_ — tel/wa/email\n` +
      (esAdmin ? `• _"pagué $300k a [proveedor] de [obra]"_ — pago contra CC\n` : '') +
      `• _"dejá nota en [obra]: ..."_ — guardar recordatorio en la obra\n` +
      `• *resumen de hoy* — tu resumen del día (tareas y, si sos admin, pendientes/vencimientos)\n` +
      (esAdmin ? `• _"deposité el cheque 4421"_ / _"se cobró el 4421"_ — estado de cheque\n` : '') +
      (esAdmin ? `• _"aprobar N"_ / _"rechazar N"_ — sobre pendientes (escribí *pendientes* para verlos)\n` : '') +
      (esAdmin ? `• _"pasá $200k de Caja X a Caja Y"_ — traspaso entre cajas\n` : '') +
      `• *deshacer* — revierte tu último movimiento cargado\n` +

      `\n_Escribí *ayuda* cuando quieras volver a ver este menú._`
    );
  }

  // ── Tareas ────────────────────────────────────────────────────────────────
  // Listado de tareas pendientes del usuario, numeradas. Guarda el mapping
  // numero→tareaId en la conversación para que despues pueda decir "tarea 2".
  if (comando === 'tareas') {
    const tareas = (await loadSharedData('tareas')) || [];
    const mias = tareas.filter(t =>
      Array.isArray(t.asignadoA) &&
      t.asignadoA.includes(user.user_id || user.id) &&
      t.estado !== 'completada' &&
      t.estado !== 'cancelada'
    );
    if (!mias.length) return '✅ No tenés tareas pendientes. ¡Buen trabajo!';

    const prioRank = { alta: 0, media: 1, baja: 2 };
    mias.sort((a, b) => {
      const va = a.fechaLimite ? 0 : 1, vb = b.fechaLimite ? 0 : 1;
      if (va !== vb) return va - vb;
      if (a.fechaLimite && b.fechaLimite && a.fechaLimite !== b.fechaLimite) return a.fechaLimite < b.fechaLimite ? -1 : 1;
      return (prioRank[a.prioridad] ?? 9) - (prioRank[b.prioridad] ?? 9);
    });

    // Guardar mapping para referencia posterior por numero.
    if (user.phone) {
      const conv = await loadConversation(user.phone);
      await saveConversation(user.phone, {
        state: conv.state || 'idle',
        data: { ...(conv.data || {}), lastTareasList: mias.map(t => t.id) },
      });
    }

    const lineas = mias.slice(0, 10).map((t, i) => {
      const totalItems = (t.checklist || []).length;
      const completos = (t.checklist || []).filter(it => it.completado).length;
      const progress = totalItems > 0 ? ` (${completos}/${totalItems})` : '';
      const venc = t.fechaLimite ? ` · vence ${t.fechaLimite.split('-').reverse().join('/')}` : '';
      const prio = t.prioridad === 'alta' ? '🔴' : t.prioridad === 'media' ? '🟡' : '⚪';
      return `${i + 1}. ${prio} *${t.titulo}*${progress}${venc}`;
    });

    const extra = mias.length > 10 ? `\n\n_…y ${mias.length - 10} más. Vé la lista completa en la app._` : '';
    return `📋 *Tus tareas pendientes (${mias.length}):*\n\n${lineas.join('\n')}${extra}\n\nEscribí *tarea N* para ver el detalle.`;
  }

  // Detalle de una tarea por numero (1-based desde la última lista).
  if (comando === 'tarea_detalle') {
    const num = parseInt(datos.numero, 10);
    if (!num || num < 1) return 'Decime qué tarea querés ver. Ej: *tarea 2*';

    const conv = user.phone ? await loadConversation(user.phone) : { data: {} };
    const tareaId = (conv.data?.lastTareasList || [])[num - 1];
    if (!tareaId) return 'No encontré esa tarea. Escribí *tareas* primero para ver la lista.';

    const tareas = (await loadSharedData('tareas')) || [];
    const t = tareas.find(x => x.id === tareaId);
    if (!t) return 'La tarea ya no existe.';

    // Guardar la última tarea vista para que despues pueda decir "completé item 3"
    if (user.phone) {
      await saveConversation(user.phone, {
        state: conv.state || 'idle',
        data: { ...(conv.data || {}), lastTareaId: tareaId },
      });
    }

    const totalItems = (t.checklist || []).length;
    const completos = (t.checklist || []).filter(it => it.completado).length;
    const progressBar = totalItems > 0 ? ` (${completos}/${totalItems})` : '';
    const venc = t.fechaLimite ? `\n📅 Vence: ${t.fechaLimite.split('-').reverse().join('/')}` : '';
    const prio = t.prioridad === 'alta' ? '🔴 Alta' : t.prioridad === 'media' ? '🟡 Media' : '⚪ Baja';
    const desc = t.descripcion ? `\n\n${t.descripcion}` : '';
    const items = (t.checklist || []).length === 0
      ? '\n\n_Sin items en el checklist._'
      : '\n\n*Checklist:*\n' + (t.checklist || []).map((it, i) =>
          `${i + 1}. ${it.completado ? '✅' : '⬜'} ${it.texto}`
        ).join('\n');

    return `*${t.titulo}*${progressBar}\n${prio}${venc}${desc}${items}\n\n_Para marcar un item: "hice el item 2"_`;
  }

  // Completar un item del checklist por numero (de la ultima tarea vista).
  if (comando === 'completar_item') {
    const num = parseInt(datos.numero, 10);
    if (!num || num < 1) return 'Decime qué item querés marcar. Ej: *hice el item 2*';

    const conv = user.phone ? await loadConversation(user.phone) : { data: {} };
    const tareaId = conv.data?.lastTareaId;
    if (!tareaId) return 'No sé de qué tarea hablás. Escribí *tareas* y luego *tarea N* primero.';

    const tareas = (await loadSharedData('tareas')) || [];
    const t = tareas.find(x => x.id === tareaId);
    if (!t) return 'La tarea ya no existe.';
    const item = (t.checklist || [])[num - 1];
    if (!item) return `Esa tarea solo tiene ${(t.checklist || []).length} item${(t.checklist || []).length === 1 ? '' : 's'}.`;
    if (item.completado) return `Ese item ya estaba marcado: "${item.texto}". ✅`;

    // Actualizar tarea — atómico: parchea SOLO esa tarea por id (no pisa otras).
    const userId = user.user_id || user.id;
    const nowIso = new Date().toISOString();
    const newChecklist = (t.checklist || []).map((it, i) =>
      i === num - 1 ? { ...it, completado: true, completadoPor: userId, completadoAt: nowIso } : it
    );
    const completosAhora = newChecklist.filter(it => it.completado).length;
    const totalAhora = newChecklist.length;
    let estado = 'pendiente';
    if (completosAhora === totalAhora && totalAhora > 0) estado = 'completada';
    else if (completosAhora > 0) estado = 'en_progreso';
    await sbPatchItem('tareas', tareaId, {
      checklist: newChecklist,
      estado,
      actualizadoAt: nowIso,
      completadoAt: estado === 'completada' ? nowIso : null,
    });

    const tareaActualizada = { ...t, checklist: newChecklist, estado };
    const totalItems = tareaActualizada.checklist.length;
    const completos = tareaActualizada.checklist.filter(it => it.completado).length;
    const allDone = completos === totalItems && totalItems > 0;

    return allDone
      ? `✅ Item "${item.texto}" marcado.\n\n🎉 *¡Tarea completa!* "${t.titulo}" — ${completos}/${totalItems} items.`
      : `✅ Item "${item.texto}" marcado.\n\nProgreso: *${completos}/${totalItems}* items.`;
  }

  if (comando === 'saldo') {
    const cajasUsuario = ctx.cajas.filter(c => cajaEsVisible(user, c));
    if (!cajasUsuario.length) return 'No tenés cajas asignadas.';
    const lineas = cajasUsuario.map(c =>
      `• ${c.nombre}: *$${calcSaldoCajaBot(c, ctx.movimientos).toLocaleString('es-AR')}* ${c.moneda}`
    );
    return `💰 *Saldo de tus cajas:*\n\n${lineas.join('\n')}`;
  }

  if (comando === 'pendientes') {
    const pendingRows = await sbGet('shared_data', '?key=eq.whatsapp_pending&select=data');
    const pending = Array.isArray(pendingRows[0]?.data) ? pendingRows[0].data : [];
    let activos = pending.filter(p => p.status !== 'confirmed' && p.status !== 'rejected');
    // No-admin: ve SOLO sus propios pendientes (no los montos cargados por otros).
    if (!isAdmin(user)) {
      activos = activos.filter(p => p.creadoPor === user.user_name || p.creadoPor === user.id || p.creadoPor === user.email);
    }
    if (!activos.length) return '✅ No hay pendientes de aprobación.';

    // Guardar IDs para que el admin pueda decir "aprobar 1" / "rechazar 2".
    if (user.phone) {
      const conv = await loadConversation(user.phone);
      await saveConversation(user.phone, {
        state: conv.state || 'idle',
        data: { ...(conv.data || {}), lastPendientesList: activos.slice(0, 10).map(p => p.id) },
      });
    }

    const lineas = activos.slice(0, 10).map((p, i) => {
      const num = `*${i + 1}.*`;
      if (p.tipoPendiente === 'factura') {
        return `${num} 🧾 Factura ${p.proveedor || '—'} · $${Math.round(p.monto || p.montoTotal || 0).toLocaleString('es-AR')}`;
      }
      const mov = p.movimiento || {};
      const icono = mov.tipo === 'ingreso' ? '🔺' : '🔻';
      return `${num} ${icono} ${p.creadoPor}: $${Math.round(mov.monto || 0).toLocaleString('es-AR')} — ${mov.descripcion || '—'}`;
    });
    const esAdmin = user.user_rol === 'Admin';
    const ayuda = esAdmin
      ? `\n\nPara aprobar/rechazar: *aprobar N* o *rechazar N*`
      : '';
    return `⏳ *Pendientes (${activos.length}):*\n\n${lineas.join('\n')}${ayuda}`;
  }

  // Admin: aprobar pendiente por número de la última lista vista.
  if (comando === 'aprobar_pendiente' || comando === 'rechazar_pendiente') {
    if (user.user_rol !== 'Admin') return '❌ Solo un admin puede aprobar/rechazar pendientes.';
    const num = parseInt(datos.numero, 10);
    if (!num || num < 1) return 'Decime qué número. Ej: *aprobar 1*. Escribí *pendientes* primero para ver la lista.';
    const conv = user.phone ? await loadConversation(user.phone) : { data: {} };
    const pendienteId = (conv.data?.lastPendientesList || [])[num - 1];
    if (!pendienteId) return 'No encontré ese pendiente. Escribí *pendientes* primero para ver la lista.';

    const pendingRows = await sbGet('shared_data', '?key=eq.whatsapp_pending&select=data');
    const pending = Array.isArray(pendingRows[0]?.data) ? pendingRows[0].data : [];
    const item = pending.find(p => p.id === pendienteId);
    if (!item) return 'El pendiente ya no existe (quizás fue resuelto desde la app).';
    // FIX crítico: los resueltos nunca se borran del array — sin este check,
    // "aprobar 1" dos veces (lista stale) o la carrera chat↔app re-aprobaba el
    // mismo pendiente y creaba DOS movimientos por el mismo gasto.
    if ((item.status || 'pending') !== 'pending') {
      return `Ese pendiente ya fue ${item.status === 'confirmed' ? 'aprobado' : 'rechazado'}${item.resolvedBy ? ` por ${item.resolvedBy}` : ''}. Escribí *pendientes* para ver la lista actualizada.`;
    }

    const accion = comando === 'aprobar_pendiente' ? 'confirmed' : 'rejected';

    // Si es aprobación de MOVIMIENTO → aplicarlo de verdad. Camino preferido:
    // RPC aprobar_pendiente_atomico (migración 0006) = test-and-set del status +
    // alta del movimiento en UNA transacción (mata la carrera de doble aprobación).
    if (accion === 'confirmed' && item.tipoPendiente === 'movimiento' && item.movimiento) {
      const mov = { ...item.movimiento, id: `mov-${Date.now()}`, creadoPorWA: true };
      try {
        await sbRpc('aprobar_pendiente_atomico', { p_item_id: pendienteId, p_mov: mov, p_resuelto_por: user.user_name });
        await broadcastChange('whatsapp_pending');
        await broadcastChange('movimientos');
        return `✅ Aprobado pendiente #${num} — gasto cargado.`;
      } catch (e) {
        if (!/ 404/.test(e.message || '')) {
          // Error de validación (ej. ya resuelto en el medio): informar, no duplicar.
          console.error('[aprobar_pendiente RPC]:', e.message);
          return 'Ese pendiente ya fue resuelto (quizás desde la app justo ahora). Escribí *pendientes* para ver la lista.';
        }
        // RPC no desplegada → camino anterior (con el check de status de arriba).
        await sbPatchItem('whatsapp_pending', pendienteId, {
          status: accion, resolvedBy: user.user_name, resolvedAt: new Date().toISOString(),
        });
        await appendMovimiento(mov);
        return `✅ Aprobado pendiente #${num} — gasto cargado.`;
      }
    }

    await sbPatchItem('whatsapp_pending', pendienteId, {
      status: accion, resolvedBy: user.user_name, resolvedAt: new Date().toISOString(),
    });

    // Si es aprobación de FACTURA → crear el gasto. La factura no trae caja
    // (la app la pide), pero desde WA usamos la caja efectivo del usuario y
    // la obra del pending si la tiene. Si falta caja, avisamos.
    if (accion === 'confirmed' && item.tipoPendiente === 'factura') {
      // ── Nota de crédito de proveedor ──────────────────────────────────────
      // Por chat la aprobamos como ajuste fiscal puro: reduce IVA crédito y
      // compras del mes (Libro IVA), pero NO toca caja. Si el proveedor devolvió
      // plata, el admin marca la caja abriéndola en la app.
      if (item.claseComprobante === 'nota_credito') {
        const montoNC = (item.monto != null && Number(item.monto) > 0)
          ? Math.round(Number(item.monto))
          : (item.montoTotal != null ? Math.round(Number(item.montoTotal)) : 0);
        const fechaNC = item.fecha || new Date().toISOString().split('T')[0];
        const letraNC = String(item.tipoFactura || 'B').toUpperCase().charAt(0);
        const obraNC  = item.obraId ? ctx.obras.find(o => o.id === item.obraId) : null;
        const { neto, iva, alicuota } = desglosarCompraBot({ total: montoNC, tipoLetra: letraNC, montoNeto: item.montoNeto });
        const movNC = {
          id: `mov-${Date.now()}`,
          tipo: 'nota_credito_compra',
          descripcion: item.concepto || `NC ${item.tipoFactura || ''} ${item.numeroFactura || ''} · ${item.proveedor || ''}`.trim(),
          monto: montoNC,
          fecha: fechaNC,
          obraId: item.obraId || null,
          obraNombre: obraNC?.nombre || 'General',
          cajaId: null,
          afectaCaja: false,
          proveedor: item.proveedor || '',
          categoria: 'factura-proveedor',
          referencia: item.numeroFactura || '',
          comprobante: 'blanco',
          comprobanteUrl: item.mediaUrl || null,
          creadoPorWA: true,
          creadoPor: user.user_name,
          ...(montoNC > 0 ? {
            comprobanteRecibido: {
              clase: 'nota_credito',
              tipo: letraNC, numero: item.numeroFactura || '', cuit: item.cuit || '',
              fecha: fechaNC, neto, iva, alicuota, total: montoNC,
            },
          } : {}),
        };
        await appendMovimiento(movNC);
        const fmtN = n => `$${Math.round(n).toLocaleString('es-AR')}`;
        return `✅ Nota de crédito aprobada: ${fmtN(montoNC)} de *${item.proveedor || 'proveedor'}*.\nReduce el IVA crédito y las compras del mes en el Libro IVA. *No tocó ninguna caja* — si el proveedor devolvió plata, marcalo abriéndola en la app → Movimientos.`;
      }
      // ── Solo registrar (factura solo-fiscal) ──────────────────────────────────
      // La factura cuenta para el Libro IVA pero NO es deuda ni mueve caja: la
      // cargamos como facturaPendiente estado:'registrada' (saldoPendiente:0), NO
      // como gasto. Sin esto, una factura personal mandada por un no-admin terminaba
      // debitando una caja al aprobarla.
      if (item.soloRegistrar) {
        const fmtR = n => `$${Math.round(n || 0).toLocaleString('es-AR')}`;
        const montoR = (item.monto != null && Number(item.monto) > 0)
          ? Math.round(Number(item.monto))
          : (item.montoTotal != null ? Math.round(Number(item.montoTotal)) : 0);
        if (!(montoR > 0)) {
          return `⚠️ Aprobé pero no pude registrar la factura: no me quedó el monto. Cargala desde la app → Autorizaciones, destino "Solo registrar".`;
        }
        const fechaR = item.fecha || new Date().toISOString().split('T')[0];
        const letraR = String(item.tipoFactura || 'B').toUpperCase().charAt(0);
        const obraR  = item.obraId ? ctx.obras.find(o => o.id === item.obraId) : null;
        const provR  = item.proveedor && ctx.proveedores.find(p => p.nombre && (
          p.nombre.toLowerCase().includes(item.proveedor.toLowerCase()) ||
          item.proveedor.toLowerCase().includes(p.nombre.toLowerCase())));
        const cuitR = (item.cuit || provR?.cuit || '').trim();
        const { neto, iva, alicuota } = desglosarCompraBot({ total: montoR, tipoLetra: letraR, montoNeto: item.montoNeto });
        const facturaReg = {
          id: `fp-${Date.now()}`,
          proveedorId: provR?.id || null,
          proveedor: provR?.nombre || item.proveedor || '',
          fecha: fechaR,
          numero: item.numeroFactura || '',
          tipoLetra: letraR,
          cuit: cuitR,
          monto: montoR,
          comprobanteRecibido: { tipo: letraR, numero: item.numeroFactura || '', cuit: cuitR, fecha: fechaR, neto, iva, alicuota, total: montoR },
          obraId: obraR?.id || null,
          obraNombre: obraR?.nombre || undefined,
          concepto: item.concepto || `Factura ${letraR}${item.numeroFactura ? ` ${item.numeroFactura}` : ''}`.trim(),
          comprobanteUrl: item.mediaUrl || null,
          estado: 'registrada',
          pagos: [],
          saldoPendiente: 0,
          createdAt: new Date().toISOString(),
          createdBy: user.id || user.user_name,
        };
        await sbAppendArray2('proveedores', 'facturasPendientes', facturaReg);
        return `✅ Factura registrada: ${letraR}${facturaReg.numero ? ` ${facturaReg.numero}` : ''} de *${facturaReg.proveedor || 'proveedor'}* (${fmtR(montoR)}).\n` +
          `Neto ${fmtR(neto)} · IVA ${alicuota}% ${fmtR(iva)}\n` +
          `Cuenta para tu Libro IVA Compras del mes. *No es deuda ni movió ninguna caja* (no figura en Cuentas por Pagar).`;
      }
      const movData = await loadSharedData('movimientos');
      const movs  = movData?.movimientos || [];
      const cajas = movData?.cajas || ctx.cajas;
      const cajaEf = cajas.find(c => c.tipo === 'efectivo' && c.usuarioId === user.email && c.moneda === 'ARS');
      const cajaId = item.cajaId || cajaEf?.id || null;
      if (!cajaId) {
        return `⚠️ Aprobé la factura pero no pude cargar el gasto: no tenés una caja efectivo configurada. Cargala desde la app → Autorizaciones, o pedile a un admin que te enlace una caja.`;
      }
      // item.monto = total del comprobante (con IVA y percepciones). El fallback
      // a montoTotal cubre items legacy del buzón. Es lo que sale de caja.
      const monto = (item.monto != null && Number(item.monto) > 0)
                      ? Math.round(Number(item.monto))
                      : (item.montoTotal != null ? Math.round(Number(item.montoTotal)) : 0);
      const obra  = item.obraId ? ctx.obras.find(o => o.id === item.obraId) : null;
      const fechaMov = item.fecha || new Date().toISOString().split('T')[0];
      // Desglose fiscal: mismo cálculo que AprobarFacturaModal y que el path
      // auto-load Admin del bot, para que aprobar por chat NO pierda el IVA
      // crédito ni la percepción IIBB.
      const tipoLetra = String(item.tipoFactura || 'B').toUpperCase().charAt(0); // 'A'/'B'/'C'
      const perc = (item.percepcionIIBB != null && Number(item.percepcionIIBB) > 0)
                     ? Math.round(Number(item.percepcionIIBB)) : 0;
      const percIVA = (item.percepcionIVA != null && Number(item.percepcionIVA) > 0)
                     ? Math.round(Number(item.percepcionIVA)) : 0;
      // Desglose fiscal centralizado (mismo cálculo que el modal y las otras ramas
      // del bot) — aprobar por chat no pierde ni el IVA crédito ni las percepciones.
      const { neto, iva, alicuota } = desglosarCompraBot({
        total: monto, tipoLetra, percepcionIIBB: perc, percepcionIVA: percIVA, montoNeto: item.montoNeto,
      });
      const mov = {
        id: `mov-${Date.now()}`,
        tipo: 'gasto',
        descripcion: item.concepto || `Factura ${item.tipoFactura || ''} ${item.numeroFactura || ''} · ${item.proveedor || ''}`.trim(),
        monto: Math.round(monto),
        fecha: fechaMov,
        obraId: item.obraId || null,
        obraNombre: obra?.nombre || 'General',
        cajaId,
        cajaDestinoId: null,
        proveedor: item.proveedor || '',
        categoria: 'factura-proveedor',
        medioPago: 'Transferencia',
        referencia: item.numeroFactura || '',
        comprobante: 'blanco',
        comprobanteUrl: item.mediaUrl || null,
        creadoPorWA: true,
        creadoPor: user.user_name,
        percepcionIIBB: perc > 0 ? perc : undefined,
        jurisdiccionIIBB: (perc > 0 && item.jurisdiccionIIBB && item.jurisdiccionIIBB !== 'PBA') ? item.jurisdiccionIIBB : undefined,
        percepcionIVA: percIVA > 0 ? percIVA : undefined,
        ...(monto > 0 ? {
          comprobanteRecibido: {
            tipo: tipoLetra,
            numero: item.numeroFactura || '',
            cuit: item.cuit || '',
            fecha: fechaMov,
            neto, iva, alicuota,
            total: monto,
          },
        } : {}),
      };
      await appendMovimiento(mov);
      const fmt = n => `$${Math.round(n).toLocaleString('es-AR')}`;
      const linePerc = perc > 0 ? `\nPercep. IIBB: ${fmt(perc)} (descuenta del IIBB del mes)` : '';
      const linePercIVA = percIVA > 0 ? `\nPercep. IVA: ${fmt(percIVA)} (pago a cuenta del IVA del mes)` : '';
      const lineIva  = (monto > 0 && iva > 0) ? `\nNeto ${fmt(neto)} · IVA ${alicuota}% ${fmt(iva)}` : '';
      return `✅ Factura aprobada y cargada como gasto: ${fmt(mov.monto)}${obra ? ` en ${obra.nombre}` : ' (General)'}.${lineIva}${linePerc}${linePercIVA}${!item.obraId ? '\n_Quedó en General — si era de una obra, editala desde Movimientos._' : ''}`;
    }

    const verbo = accion === 'confirmed' ? '✅ Aprobado' : '❌ Rechazado';
    return `${verbo} pendiente #${num}.`;
  }

  if (comando === 'cheques') {
    if (user.user_rol !== 'Admin') return '❌ Este comando es solo para administradores.';
    const chequesData = await loadSharedData('cheques');
    const cheques = Array.isArray(chequesData) ? chequesData : (chequesData?.cheques || []);
    const hoy = new Date();
    const en7dias = new Date(hoy.getTime() + 7 * 24 * 60 * 60 * 1000);
    const proximos = cheques.filter(c => {
      if (c.estado !== 'cartera') return false;
      const venc = new Date(c.fechaVencimiento);
      return venc <= en7dias && venc >= hoy;
    });
    if (!proximos.length) return '✅ No hay cheques por vencer en los próximos 7 días.';
    const lineas = proximos.map(c =>
      `• ${c.banco} N°${c.numero} — $${Math.round(c.monto).toLocaleString('es-AR')} — Vence: ${c.fechaVencimiento}`
    );
    return `⚠️ *Cheques por vencer (próximos 7 días):*\n\n${lineas.join('\n')}`;
  }

  if (comando === 'resumen') {
    if (user.user_rol !== 'Admin') return '❌ Este comando es solo para administradores.';
    const obraId = datos.obraId;
    const fecha  = datos.fecha || new Date().toISOString().split('T')[0];
    const obra   = ctx.obras.find(o => o.id === obraId || o.nombre?.toLowerCase().includes(obraId?.toLowerCase()));
    if (!obra) return '❌ No encontré esa obra. Escribí el nombre completo.';
    const movData = await loadSharedData('movimientos');
    const movs    = (movData?.movimientos || []).filter(m => m.obraId === obra.id && m.fecha === fecha);
    if (!movs.length) return `📊 Sin movimientos en *${obra.nombre}* el ${fecha}.`;
    const gastos  = movs.filter(m => m.tipo === 'gasto');
    const ingresos = movs.filter(m => m.tipo === 'ingreso');
    const totalG  = gastos.reduce((s, m) => s + (m.monto || 0), 0);
    const totalI  = ingresos.reduce((s, m) => s + (m.monto || 0), 0);
    return (
      `📊 *Resumen ${obra.nombre} — ${fecha}*\n\n` +
      `Gastos (${gastos.length}): *$${Math.round(totalG).toLocaleString('es-AR')}*\n` +
      `Ingresos (${ingresos.length}): *$${Math.round(totalI).toLocaleString('es-AR')}*\n\n` +
      gastos.slice(0, 5).map(m => `• ${m.descripcion}: $${Math.round(m.monto).toLocaleString('es-AR')}`).join('\n')
    );
  }

  // "resumen de hoy" / "/digest" → un mensaje con el estado del día, por rol.
  // No-admin: SOLO sus tareas (cero montos). Admin: además pendientes (count+$),
  // cheques por vencer y movimientos del día. Reusa el comando 'tareas' ya probado.
  if (comando === 'digest') {
    const admin = isAdmin(user);
    const fmt = n => `$${Math.round(n).toLocaleString('es-AR')}`;
    const hoy = new Date().toISOString().split('T')[0];
    const partes = [`🗓 *Tu resumen de hoy* — ${hoy.split('-').reverse().join('/')}`];
    if (admin) {
      const pendRows = await sbGet('shared_data', '?key=eq.whatsapp_pending&select=data');
      const pend = Array.isArray(pendRows[0]?.data) ? pendRows[0].data : [];
      const activos = pend.filter(p => p.status !== 'confirmed' && p.status !== 'rejected');
      if (activos.length) {
        const tot = activos.reduce((s, p) => s + (p.monto || p.montoTotal || p.movimiento?.monto || 0), 0);
        partes.push(`⏳ *Para aprobar:* ${activos.length}${tot ? ` · ${fmt(tot)}` : ''}  _(escribí *pendientes*)_`);
      }
      const chData = await loadSharedData('cheques');
      const cheques = Array.isArray(chData) ? chData : (chData?.cheques || []);
      const ahora = new Date(); const en7 = new Date(ahora.getTime() + 7 * 24 * 3600 * 1000);
      const chP = cheques.filter(c => c.estado === 'cartera' && c.fechaVencimiento && new Date(c.fechaVencimiento) <= en7 && new Date(c.fechaVencimiento) >= ahora);
      if (chP.length) partes.push(`🧾 *Cheques por vencer (≤7d):* ${chP.length} · ${fmt(chP.reduce((s, c) => s + (c.monto || 0), 0))}`);
      const movsHoy = (ctx.movimientos || []).filter(m => m.fecha === hoy);
      const g = movsHoy.filter(m => m.tipo === 'gasto'); const ing = movsHoy.filter(m => m.tipo === 'ingreso');
      if (g.length || ing.length) partes.push(`💸 *Hoy:* ${g.length} gasto(s) ${fmt(g.reduce((s, m) => s + (m.monto || 0), 0))} · ${ing.length} ingreso(s) ${fmt(ing.reduce((s, m) => s + (m.monto || 0), 0))}`);
    }
    const tareasMsg = await ejecutarComando('tareas', {}, user, ctx);
    partes.push('━━━━━━━━━━');
    partes.push(tareasMsg);
    return partes.join('\n\n');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FASE 2 — Comandos de consulta y operación
  // ─────────────────────────────────────────────────────────────────────────

  // "Cómo va [obra]" → KPIs en texto: avance, presupuesto vs gastado,
  // saldo cuotas, próxima cuota, top gastos del mes, tareas pendientes.
  if (comando === 'como_va_obra') {
    const obraQuery = (datos.obra || '').toLowerCase().trim();
    if (!obraQuery) return '🤔 ¿De qué obra? Ej: *cómo va Baradero*';
    const obra = ctx.obras.find(o =>
      o.id?.toLowerCase() === obraQuery ||
      o.nombre?.toLowerCase().includes(obraQuery) ||
      obraQuery.includes(o.nombre?.toLowerCase())
    );
    if (!obra) return `❌ No encontré una obra con "${datos.obra}". Obras activas: ${ctx.obras.slice(0,5).map(o => o.nombre).join(', ')}`;

    const det = ctx.detalles?.[obra.id] || {};
    const rubros = (det.rubros || []).filter(r => r.tipo !== 'seccion');
    // Avance ponderado por costo (mismo cálculo que el Gantt)
    let totalCosto = 0, ejecutado = 0;
    for (const r of rubros) {
      for (const t of (r.tareas || []).filter(t => t.tipo !== 'seccion')) {
        const c = ((t.costoMat || 0) + (t.costoSub || 0)) * (t.cantidad || 0);
        totalCosto += c;
        ejecutado  += c * ((t.avance || 0) / 100);
      }
    }
    const avancePct = totalCosto > 0 ? Math.round((ejecutado / totalCosto) * 100) : 0;

    // Movimientos de la obra
    const movs = (ctx.movimientos || []).filter(m => m.obraId === obra.id);
    const gastado = movs.filter(m => m.tipo === 'gasto').reduce((s, m) => s + (m.monto || 0), 0);
    const cobrado = movs.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + (m.monto || 0), 0);
    const presupuesto = (totalCosto || obra.presupuesto || 0);

    // Cuotas
    const cuotas = det.cuotas || [];
    const cuotasPagadas = cuotas.filter(c => c.cobrado || c.pagado).length;
    const proximaCuota = cuotas
      .filter(c => !(c.cobrado || c.pagado) && c.fecha)
      .sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''))[0];

    // Top 3 gastos del mes en curso
    const mesActual = new Date().toISOString().slice(0, 7); // YYYY-MM
    const gastosMes = movs
      .filter(m => m.tipo === 'gasto' && (m.fecha || '').startsWith(mesActual))
      .sort((a, b) => (b.monto || 0) - (a.monto || 0))
      .slice(0, 3);

    // Tareas pendientes vinculadas a la obra
    const tareasData = (await loadSharedData('tareas')) || [];
    const tareasPend = tareasData.filter(t =>
      t.obraId === obra.id && t.estado !== 'completada' && t.estado !== 'cancelada'
    );

    const fmt = n => `$${Math.round(n).toLocaleString('es-AR')}`;
    const dateF = iso => iso ? iso.split('-').reverse().join('/') : '—';

    // Costos/cobros/montos: SOLO Admin. El resto de los roles (jefe de obra,
    // capataz, logística, administración) ve avance + tareas, sin plata.
    const verCostos = isAdmin(user);
    let r = `📊 *${obra.nombre}*`;
    if (obra.cliente) r += ` · ${obra.cliente}`;
    r += `\n\n`;
    r += `🏗 Avance: *${avancePct}%*\n`;
    if (verCostos) {
      r += `💸 Gastado: *${fmt(gastado)}*`;
      if (presupuesto > 0) r += ` / ${fmt(presupuesto)} (${Math.round(gastado/presupuesto*100)}%)`;
      r += `\n`;
      r += `💰 Cobrado: *${fmt(cobrado)}*\n`;
    }
    if (cuotas.length) r += `🧾 Cuotas: ${cuotasPagadas}/${cuotas.length} pagadas\n`;
    if (proximaCuota) r += verCostos
      ? `📅 Próx. cuota: ${dateF(proximaCuota.fecha)} · ${fmt(proximaCuota.monto || proximaCuota.montoARS || 0)}\n`
      : `📅 Próx. cuota: ${dateF(proximaCuota.fecha)}\n`;
    if (verCostos && gastosMes.length) {
      r += `\n*Top gastos del mes:*\n`;
      gastosMes.forEach(m => { r += `• ${m.descripcion || m.proveedor || '—'}: ${fmt(m.monto)}\n`; });
    }
    if (tareasPend.length) r += `\n☑ Tareas pendientes: *${tareasPend.length}*`;
    return r;
  }

  // "Cuánto le debo a [proveedor]" → saldo + últimas certs/pagos.
  if (comando === 'cc_proveedor') {
    // Saldos/cuentas corrientes de proveedores = costos → SOLO Admin.
    if (!isAdmin(user)) return '🔒 Los saldos de cuenta corriente de proveedores están reservados a Dirección (Admin).';
    const query = (datos.proveedor || '').toLowerCase().trim();
    if (!query) return '🤔 ¿De qué proveedor? Ej: *cuánto le debo a Pérez*';
    const prov = ctx.proveedores.find(p =>
      p.nombre?.toLowerCase().includes(query) || query.includes(p.nombre?.toLowerCase())
    );
    if (!prov) return `❌ No encontré "${datos.proveedor}". Proveedores: ${ctx.proveedores.slice(0,5).map(p => p.nombre).join(', ')}`;

    // Movimientos del proveedor (para el detalle de últimos movs)
    const movs = (ctx.movimientos || []).filter(m =>
      m.proveedor === prov.nombre || m.proveedorId === prov.id
    );

    // CC con crédito — MISMA semántica que la app (src/lib/proveedorCC.js):
    //  deuda   = Σ saldo de facturas pendientes no anuladas/no 'registrada'
    //          + Σ (debe − haber) de ccEntries legacy
    //  crédito = Σ anticipos (gastos anticipo:true) − Σ aplicaciones (pagos tipo 'credito')
    //  saldo   = deuda − crédito (>0 le debemos · <0 a favor nuestro)
    // Antes: debe(ccEntries) − TODOS los gastos → cualquier pago sin deuda
    // registrada (impuestos tipo ARCA) inventaba un "a favor" falso, y las
    // facturas pendientes no contaban como deuda.
    const provDataCC = await loadSharedData('proveedores');
    const facturasProv = (provDataCC?.facturasPendientes || []).filter(f => {
      const esDelProv = f.proveedorId ? f.proveedorId === prov.id
        : (f.proveedor || '').toLowerCase().trim() === (prov.nombre || '').toLowerCase().trim();
      if (!esDelProv) return false;
      const e = estadoFacturaPendienteBot(f);
      return e !== 'anulada' && e !== 'registrada';
    });
    const deudaFacturas = facturasProv.reduce((s, f) => s + saldoFacturaPendienteBot(f), 0);
    const deudaLegacy = (provDataCC?.ccEntries || [])
      .filter(e => e.proveedorId === prov.id)
      .reduce((s, e) => s + (e.debe || 0) - (e.haber || 0), 0);
    const anticipado = movs
      .filter(m => m.tipo === 'gasto' && m.anticipo === true)
      .reduce((s, m) => s + (m.monto || 0), 0);
    const aplicado = facturasProv
      .flatMap(f => (f.pagos || []).filter(p => p.tipo === 'credito'))
      .reduce((s, p) => s + (Number(p.monto) || 0), 0);
    const credito = Math.max(0, Math.round(anticipado - aplicado));
    const deudaTotal = Math.round(deudaFacturas + deudaLegacy);
    const saldo = deudaTotal - credito;
    const fmt = n => `$${Math.round(n).toLocaleString('es-AR')}`;

    let r = `🏢 *${prov.nombre}*${prov.tipo ? ` · ${prov.tipo}` : ''}\n\n`;
    if (saldo > 1) r += `💸 Le debemos: *${fmt(saldo)}*\n`;
    else if (saldo < -1) r += `💰 A favor nuestro: *${fmt(-saldo)}* (se descuenta del próximo pedido)\n`;
    else r += `✓ Al día\n`;
    if (deudaTotal > 0) r += `Deuda registrada: ${fmt(deudaTotal)}\n`;
    if (credito > 0) r += `Crédito disponible: ${fmt(credito)}\n`;

    // Últimos 3 movimientos
    const recientes = movs.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '')).slice(0, 3);
    if (recientes.length) {
      r += `\n*Últimos movs:*\n`;
      recientes.forEach(m => {
        const d = (m.fecha || '').split('-').reverse().join('/');
        r += `• ${d} ${m.tipo === 'gasto' ? '🔻' : '🔺'} ${fmt(m.monto)} ${m.obraNombre ? `· ${m.obraNombre}` : ''}\n`;
      });
    }
    return r;
  }

  // "Deshacer" — revierte el último movimiento que el usuario cargó por WA.
  // Útil cuando se equivocó (monto, obra, etc.) — borra el mov y restaura saldo.
  if (comando === 'deshacer') {
    const movData = await loadSharedData('movimientos');
    const movs    = movData?.movimientos || [];
    // Último movimiento creado por WA por este usuario (los ids llevan timestamp).
    const mio = movs
      .filter(m => m.creadoPorWA && m.creadoPor === user.user_name)
      .sort((a, b) => (b.id || '').localeCompare(a.id || ''))[0];
    if (!mio) return '🤷 No encontré ningún movimiento reciente tuyo para deshacer.';

    // Efectos cruzados que el borrado pelado dejaba rotos:
    //  • si el mov era el PAGO de una factura → la factura quedaba 'pagada' con
    //    movimientoId muerto (deuda desaparecida). La revertimos: el pago sale
    //    de pagos[] y estado/saldo se recalculan.
    //  • si el mov está vinculado a un CHEQUE (ingreso al recibirlo / traspaso
    //    de depósito) NO se deshace por chat: hay que revertir el cheque también
    //    y eso se hace desde la app (pantalla Cheques).
    const provData = await loadSharedData('proveedores');
    const facturaPagada = (provData?.facturasPendientes || [])
      .find(f => (f.pagos || []).some(p => p.movimientoId === mio.id));
    const chequesData = await loadSharedData('cheques');
    const chequeVinc = (Array.isArray(chequesData) ? chequesData : []).find(c => c.movimientoId === mio.id);
    if (chequeVinc) {
      return `⚠️ Ese movimiento está vinculado al cheque${chequeVinc.numero ? ` #${chequeVinc.numero}` : ''}. Deshacelo desde la app (pantalla Cheques) para que el cheque se revierta junto con la plata.`;
    }

    // Borrado ATÓMICO por ítem (antes: saveSharedData del blob ENTERO → pisaba
    // cualquier movimiento agregado por la app u otro webhook en el medio).
    try {
      await sbRpc('remove_shared_object_item', { p_key: 'movimientos', p_collection: 'movimientos', p_id: mio.id });
      await broadcastChange('movimientos');
    } catch (e) {
      console.error('[deshacer] RPC no disponible, fallback RMW fresco:', e.message);
      const fresco = await loadSharedData('movimientos');
      await saveSharedData('movimientos', { ...(fresco || {}), movimientos: (fresco?.movimientos || []).filter(m => m.id !== mio.id) });
    }

    if (facturaPagada) {
      const pagos = (facturaPagada.pagos || []).filter(p => p.movimientoId !== mio.id);
      const facturaActualizada = { ...facturaPagada, pagos };
      await sbPatchObjectItem('proveedores', 'facturasPendientes', facturaPagada.id, {
        pagos,
        saldoPendiente: saldoFacturaPendienteBot(facturaActualizada),
        estado: estadoFacturaPendienteBot(facturaActualizada),
      });
    }

    const fmt = n => `$${Math.round(n).toLocaleString('es-AR')}`;
    const notaFactura = facturaPagada ? `\n↩️ La factura *${facturaPagada.numero || facturaPagada.proveedor}* volvió a deber ese pago.` : '';
    return `↩️ Deshecho: *${mio.tipo}* de ${fmt(mio.monto)}${mio.obraNombre && mio.obraNombre !== 'General' ? ` en ${mio.obraNombre}` : ''}.\n_${mio.descripcion || ''}_${notaFactura}`;
  }

  // ── Búsqueda cross-obra: "últimos N gastos de [obra]" / "gastos de cemento" ──
  if (comando === 'buscar_gastos') {
    // Búsqueda de gastos (montos cross-obra) = costos → SOLO Admin.
    if (!isAdmin(user)) return '🔒 La búsqueda de gastos por monto está reservada a Dirección (Admin).';
    const obraQuery = (datos.obra || '').toLowerCase().trim();
    const concepto  = (datos.concepto || '').toLowerCase().trim();
    const limite    = datos.limite || 5;
    let movs = (ctx.movimientos || []).filter(m => m.tipo === 'gasto');
    if (obraQuery) {
      const obra = ctx.obras.find(o => o.nombre?.toLowerCase().includes(obraQuery) || obraQuery.includes(o.nombre?.toLowerCase()));
      if (obra) movs = movs.filter(m => m.obraId === obra.id);
    }
    if (concepto) {
      movs = movs.filter(m =>
        (m.descripcion || '').toLowerCase().includes(concepto) ||
        (m.proveedor || '').toLowerCase().includes(concepto)
      );
    }
    movs = movs.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '')).slice(0, limite);
    if (!movs.length) return '🔍 No encontré gastos con ese criterio.';
    const fmt = n => `$${Math.round(n).toLocaleString('es-AR')}`;
    const lineas = movs.map(m => {
      const d = (m.fecha || '').split('-').reverse().join('/');
      return `• ${d} · ${fmt(m.monto)} · ${m.descripcion || m.proveedor || '—'}${m.obraNombre && m.obraNombre !== 'General' ? ` (${m.obraNombre})` : ''}`;
    });
    return `🔍 *Gastos encontrados (${movs.length}):*\n\n${lineas.join('\n')}`;
  }

  // ── Nota rápida en obra: "dejá nota en Baradero: faltan ladrillos" ──────────
  if (comando === 'nota_obra') {
    const obraQuery = (datos.obra || '').toLowerCase().trim();
    const texto = (datos.texto || '').trim();
    if (!obraQuery || !texto) return '🤔 Decime la obra y la nota. Ej: *dejá nota en Baradero: faltan ladrillos*';
    const obra = ctx.obras.find(o => o.nombre?.toLowerCase().includes(obraQuery) || obraQuery.includes(o.nombre?.toLowerCase()));
    if (!obra) return `❌ No encontré la obra "${datos.obra}".`;
    const obrasData = await loadSharedData('obras');
    const det = obrasData?.detalles?.[obra.id] || {};
    const nuevaNota = {
      id: `nota-${Date.now()}`,
      texto,
      autor: user.user_name,
      fecha: new Date().toISOString(),
      origen: 'whatsapp',
    };
    // Atómico: parchea SOLO el detalle de esta obra.
    await sbPatchDetalleObra(obra.id, { notasRapidas: [nuevaNota, ...(det.notasRapidas || [])] });
    return `📝 Nota guardada en *${obra.nombre}*:\n_"${texto}"_`;
  }

  // ── Estado de cheque: "deposité el cheque 4421" / "se cobró el 4421" ────────
  if (comando === 'estado_cheque') {
    // El monto del cheque (plata que el usuario quizá no cargó) y la mutación de
    // cajas son datos/operación financiera → SOLO Admin (igual que el comando 'cheques').
    if (!isAdmin(user)) return '🔒 El estado de los cheques lo maneja Dirección (Admin).';
    const numero = (datos.numero || '').toString().trim();
    const nuevoEstado = datos.estado; // 'depositado' | 'cobrado' | 'rechazado' | 'anulado'
    if (!numero) return '🤔 Decime el número de cheque. Ej: *deposité el cheque 4421*';
    const chequesData = await loadSharedData('cheques');
    const cheques = Array.isArray(chequesData) ? chequesData : (chequesData?.cheques || []);
    const chq = cheques.find(c => (c.numero || '').toString().replace(/\D/g, '') === numero.replace(/\D/g, ''));
    if (!chq) return `❌ No encontré un cheque N° ${numero}.`;
    const fmt = n => `$${Math.round(n).toLocaleString('es-AR')}`;
    const fechaHoy = new Date().toISOString().split('T')[0];
    const esTercero = chq.tipo === 'tercero' || chq.tipo === 'echeq_tercero';
    const esEcheq = chq.tipo === 'echeq_tercero' || chq.tipo === 'echeq_propio';
    const newMovId = () => `mov-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    // El cambio de estado del cheque DEBE ajustar la caja igual que la app, sino
    // un depósito no llega al banco y un rechazo deja "plata fantasma" sumando.
    const movBase = (tipo, motivo, cajaId) => ({
      id: newMovId(), tipo, descripcion: `${motivo}${chq.numero ? ` #${chq.numero}` : ''}`,
      monto: chq.monto, fecha: fechaHoy, cajaId, cajaDestinoId: null,
      obraId: chq.obraId || null, obraNombre: chq.obraNombre || 'General',
      proveedor: chq.clienteNombre || chq.titular || chq.proveedorNombre || '',
      categoria: 'cheque', medioPago: esEcheq ? 'E-cheq' : 'Cheque',
      referencia: chq.numero || '', fondoReparo: false, creadoPorWA: true, creadoPor: user.user_name,
    });

    // RECHAZO / ANULACIÓN → revertir el movimiento (tercero entró como ingreso →
    // se revierte con gasto; propio salió como gasto → se revierte con ingreso).
    if (nuevoEstado === 'rechazado' || nuevoEstado === 'anulado') {
      // Idempotencia: si ya está resuelto, no volver a mover la caja.
      if (chq.estado === 'rechazado' || chq.estado === 'anulado') {
        return `ℹ️ El cheque N° *${chq.numero}* ya estaba *${chq.estado}*. No volví a tocar la caja.`;
      }
      // Si ya estaba depositado, la plata está en el BANCO (cajaDestinoId): hay que
      // revertir contra esa caja, no contra la de origen (que ya quedó en cero).
      const cajaRev = (chq.estado === 'depositado' && chq.cajaDestinoId) ? chq.cajaDestinoId : chq.cajaId;
      let revirtio = false;
      if (cajaRev && chq.monto > 0) {
        await appendMovimiento(movBase(esTercero ? 'gasto' : 'ingreso', nuevoEstado === 'rechazado' ? 'Cheque rechazado' : 'Cheque anulado', cajaRev));
        revirtio = true;
      }
      await sbPatchItem('cheques', chq.id, { estado: nuevoEstado, ...(nuevoEstado === 'rechazado' ? { fechaRechazo: fechaHoy } : {}) });
      return `✅ Cheque N° *${chq.numero}* (${fmt(chq.monto)}) marcado como *${nuevoEstado}*.` +
        (revirtio ? `\nRevertí el efecto en la caja.` : '');
    }

    // CHEQUE PROPIO cobrado/acreditado → solo estado, SIN movimiento (la caja ya
    // se descontó al emitirlo). Antes el bot lo dejaba como gasto fantasma o sin tocar nada.
    if (!esTercero) {
      if (chq.estado === 'acreditado') return `ℹ️ El cheque propio N° *${chq.numero}* ya estaba acreditado.`;
      if (chq.estado !== 'cartera') return `⚠️ El cheque N° *${chq.numero}* está *${chq.estado}*, no en cartera — no lo acredité. Revisalo en la app.`;
      await sbPatchItem('cheques', chq.id, { estado: 'acreditado', fechaDeposito: fechaHoy });
      return `✅ Cheque propio N° *${chq.numero}* (${fmt(chq.monto)}) marcado como *acreditado*.\nNo genera movimiento: la plata ya se descontó al emitirlo.`;
    }

    // CHEQUE DE TERCERO depositado/cobrado → traspaso de la caja de origen al banco.
    // Solo desde cartera (idempotencia: no depositar dos veces).
    if (chq.estado === 'depositado') return `ℹ️ El cheque N° *${chq.numero}* ya estaba depositado${chq.cajaDestinoNombre ? ` en ${chq.cajaDestinoNombre}` : ''}.`;
    if (chq.estado !== 'cartera') return `⚠️ El cheque N° *${chq.numero}* está *${chq.estado}*, no en cartera — no lo deposité.`;
    if (chq.cajaId) {
      const banco = ctx.cajas.find(c => c.tipo === 'banco' && (c.moneda || 'ARS') === (chq.moneda || 'ARS') && c.id !== chq.cajaId && cajaEsVisible(user, c))
                 || ctx.cajas.find(c => c.tipo === 'banco' && (c.moneda || 'ARS') === (chq.moneda || 'ARS') && c.id !== chq.cajaId);
      if (banco) {
        await appendMovimiento({
          ...movBase('traspaso', `Depósito cheque`, chq.cajaId),
          descripcion: `Depósito cheque${chq.numero ? ` #${chq.numero}` : ''} en ${banco.nombre}`,
          cajaDestinoId: banco.id, montoDestino: chq.monto, categoria: 'traspaso', medioPago: 'Interno',
        });
        await sbPatchItem('cheques', chq.id, { estado: 'depositado', cajaDestinoId: banco.id, cajaDestinoNombre: banco.nombre, fechaDeposito: fechaHoy });
        const cajaOrig = ctx.cajas.find(c => c.id === chq.cajaId);
        return `✅ Cheque N° *${chq.numero}* (${fmt(chq.monto)}) depositado en *${banco.nombre}*.\nTraspasé la plata de ${cajaOrig?.nombre || 'la caja'} al banco.`;
      }
      // No pude resolver la caja banco → marco estado pero aviso que falta el traspaso.
      await sbPatchItem('cheques', chq.id, { estado: 'depositado', fechaDeposito: fechaHoy });
      return `✅ Cheque N° *${chq.numero}* (${fmt(chq.monto)}) marcado como *depositado*.\n⚠️ No identifiqué la caja banco destino: completá el traspaso desde la app para que la plata figure en el banco.`;
    }

    // Tercero sin caja de origen (legacy, nunca contado) → solo estado.
    await sbPatchItem('cheques', chq.id, { estado: 'depositado', fechaDeposito: fechaHoy });
    return `✅ Cheque N° *${chq.numero}* (${fmt(chq.monto)}) marcado como *depositado*.`;
  }

  // "Teléfono/contacto de [proveedor]"
  if (comando === 'contacto_proveedor') {
    const query = (datos.proveedor || '').toLowerCase().trim();
    if (!query) return '🤔 ¿De qué proveedor? Ej: *contacto Pérez*';
    const prov = ctx.proveedores.find(p =>
      p.nombre?.toLowerCase().includes(query) || query.includes(p.nombre?.toLowerCase())
    );
    if (!prov) return `❌ No encontré "${datos.proveedor}".`;
    let r = `🏢 *${prov.nombre}*\n`;
    if (prov.tipo)     r += `${prov.tipo}\n`;
    if (prov.cuit)     r += `CUIT: ${prov.cuit}\n`;
    if (prov.telefono) r += `📱 ${prov.telefono}  →  wa.me/${prov.telefono.replace(/\D/g, '')}\n`;
    if (prov.email)    r += `✉ ${prov.email}\n`;
    if (prov.direccion) r += `📍 ${prov.direccion}\n`;
    return r;
  }

  return '❓ Comando no reconocido. Escribí *ayuda* para ver los disponibles.';
}

// ── Detectores de comandos en lenguaje natural ────────────────────────────────

// "Como va Baradero" / "Cómo está Sismat" / "Estado de Pilar" → como_va_obra.
// Devuelve la query del nombre de obra o null si no matchea.
function pideEstadoObra(texto) {
  const t = (texto || '').toLowerCase().trim().replace(/[¡!¿?.,]/g, '');
  if (!t) return null;
  const patrones = [
    /^(como|cómo)\s+va\s+(.+)$/,
    /^(como|cómo)\s+(esta|está)\s+(.+)$/,
    /^(estado|status)\s+(de\s+)?(.+)$/,
  ];
  for (const re of patrones) {
    const m = t.match(re);
    if (m) {
      const obra = (m[m.length - 1] || '').trim();
      if (obra && obra.length > 1 && !/^(la\s+)?obra$/.test(obra)) return obra;
    }
  }
  return null;
}

// "Cuanto le debo a Perez" / "saldo Juancito" / "que le debo a..." → cc_proveedor.
function pideCCProveedor(texto) {
  const t = (texto || '').toLowerCase().trim().replace(/[¡!¿?.,]/g, '');
  if (!t) return null;
  const patrones = [
    /^(cuanto|cuánto)\s+(le\s+)?debo\s+(a\s+)?(.+)$/,
    /^saldo\s+(de\s+)?(.+)$/,
    /^que\s+le\s+debo\s+(a\s+)?(.+)$/,
    /^cc\s+(.+)$/,
  ];
  for (const re of patrones) {
    const m = t.match(re);
    if (m) {
      const prov = (m[m.length - 1] || '').trim();
      if (prov && prov.length > 1) return prov;
    }
  }
  return null;
}

// "pasame la lista del corralón de la obra Km711" / "materiales de electricidad
// de Km711" / "cotización de sanitarios en Shell Ruta 3" → { obraQuery, grupoQuery }.
// Atajo READ-ONLY: lista de materiales de una obra filtrados por proveedor tipo.
// EXIGE 'material(es)' o 'cotiz' o 'lista de' para no chocar con otros detectores.
function pideCotizarProveedor(texto) {
  const t = (texto || '').toLowerCase().trim().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[¡!¿?.,;:]/g, '');
  if (!t) return null;
  // Gatillo: tiene que hablar de materiales / cotización / "lista de".
  if (!/\b(materiales?|cotiz\w*)\b/.test(t) && !/\blista de\b/.test(t)) return null;

  // Sinónimos laxos → label canónico de PROVEEDORES. La PRIMERA keyword que
  // aparezca en el texto define el grupo (orden de especificidad razonable).
  const SINONIMOS = [
    [['corralon', 'corralones', 'ferreteria de obra'], 'Corralón de materiales'],
    [['electricidad', 'electrico', 'electrica', 'casa de electricidad'], 'Casa de electricidad'],
    [['sanitarios', 'sanitario', 'plomeria', 'plomero'], 'Sanitarios / Plomería'],
    [['revestimientos', 'revestimiento', 'ceramicos', 'porcelanato', 'pisos'], 'Casa de revestimientos'],
    [['pintureria', 'pinturas', 'pintura'], 'Pinturería'],
    [['aberturas', 'abertura', 'ventanas', 'puertas'], 'Aberturas'],
    [['maderera', 'madera', 'maderas', 'carpinteria'], 'Maderera / Carpintería'],
    [['vidrieria', 'vidrio', 'vidrios', 'cristales', 'espejos'], 'Vidriería'],
    [['marmoleria', 'marmol', 'marmoles', 'granito', 'granitos'], 'Marmolería'],
    [['durlock', 'construccion en seco', 'steel framing', 'placa de yeso'], 'Construcción en seco'],
    [['climatizacion', 'equipamiento', 'aire acondicionado', 'calefaccion'], 'Climatización / Equipamiento'],
    [['ferreteria', 'herrajes', 'herraje', 'herramientas'], 'Ferretería / Herrajes'],
    [['mobiliario', 'muebles', 'amoblamiento'], 'Mobiliario (San Francisco)'],
    [['grafica', 'cartel', 'carteles', 'carteleria', 'senaletica'], 'Gráfica'],
    [['servicios', 'logistica', 'alquiler'], 'Servicios / Otros'],
  ];
  let grupoQuery = null;
  let grupoIdx = -1; // posición del keyword en el texto, para poder recortar la obra
  let grupoKw = '';
  for (const [kws, label] of SINONIMOS) {
    for (const kw of kws) {
      const idx = t.indexOf(kw);
      if (idx >= 0 && (grupoIdx === -1 || idx < grupoIdx)) {
        grupoQuery = label; grupoIdx = idx; grupoKw = kw;
      }
    }
  }

  // Obra: lo que viene tras "de la obra" / "obra" / "en" / "de" / "para".
  // Probamos los conectores más específicos primero.
  let obraQuery = '';
  const conectores = [/de la obra\s+(.+)$/, /\bobra\s+(.+)$/, /\bpara\s+(.+)$/, /\ben\s+(.+)$/, /\bde\s+(.+)$/];
  // Si tenemos keyword del grupo, recortamos lo que está DESPUÉS del grupo para
  // no capturar el propio nombre del proveedor como obra ("de electricidad de X").
  const cola = grupoIdx >= 0 ? t.slice(grupoIdx + grupoKw.length) : t;
  for (const re of conectores) {
    const m = cola.match(re);
    if (m && m[1]) {
      obraQuery = m[1].trim()
        // limpiar palabras de relleno frecuentes al inicio
        .replace(/^(la\s+obra|obra|de|del|en|para)\s+/i, '')
        .trim();
      if (obraQuery.length > 1) break;
      obraQuery = '';
    }
  }

  // Sin grupo Y sin obra no hay nada útil que hacer (lo agarra Claude).
  if (!grupoQuery && !obraQuery) return null;
  return { obraQuery: obraQuery || '', grupoQuery: grupoQuery || '' };
}

// "dejá nota en Baradero: faltan ladrillos" → { obra, texto }.
function pideNotaObra(texto) {
  const t = (texto || '').trim();
  const m = t.match(/^(?:dej[aá]|anot[aá]|nota)\s+(?:una\s+)?nota\s+(?:en|a|para)\s+([^:]+):\s*(.+)$/i)
        || t.match(/^nota\s+([^:]+):\s*(.+)$/i);
  if (m) return { obra: m[1].trim(), texto: m[2].trim() };
  return null;
}

// "últimos 5 gastos de Baradero" / "gastos de cemento" → { obra?, concepto?, limite }.
function pideBuscarGastos(texto) {
  const t = (texto || '').toLowerCase().trim().replace(/[¡!¿?.,]/g, '');
  if (!/\bgastos?\b/.test(t)) return null;
  // "ultimos N gastos de X"
  const mNum = t.match(/ultimos?\s+(\d+)\s+gastos?\s+(?:de\s+|en\s+)?(.+)?/);
  if (mNum) return { limite: parseInt(mNum[1], 10), obra: (mNum[2] || '').trim() };
  // "gastos de X" / "gastos en X"
  const mDe = t.match(/gastos?\s+(?:de\s+|en\s+)(.+)/);
  if (mDe) {
    const q = mDe[1].trim();
    return { obra: q, concepto: q, limite: 8 };
  }
  return null;
}

// "deposité el cheque 4421" / "se cobró el cheque 4421" → { numero, estado }.
function pideEstadoCheque(texto) {
  const t = (texto || '').toLowerCase().trim().replace(/[¡!¿?.,]/g, '');
  if (!/\b(cheque|echeq)\b/.test(t)) return null;
  const num = (t.match(/\b(\d{3,})\b/) || [])[1];
  if (!num) return null;
  let estado = null;
  if (/\b(deposit[eé]|deposit[aá]r?|deposite)\b/.test(t)) estado = 'depositado';
  else if (/\b(cobr[oó]|cobr[eé]|se cobr[oó]|cobrado)\b/.test(t)) estado = 'cobrado';
  else if (/\b(rechaz)\b/.test(t)) estado = 'rechazado';
  else if (/\b(anul)\b/.test(t)) estado = 'anulado';
  if (!estado) return null;
  return { numero: num, estado };
}

// "aprobar 1" / "aprobar pendiente 2" → aprobar_pendiente con datos.numero=N.
// Devuelve { accion, numero } o null.
function pideAprobacion(texto) {
  const t = (texto || '').toLowerCase().trim().replace(/[¡!¿?.,]/g, '');
  if (!t) return null;
  const m = t.match(/^(aprobar|aprobá|approve|ok)\s+(?:pendiente\s+)?(\d+)$/i)
        || t.match(/^(rechazar|rechazá|reject|no)\s+(?:pendiente\s+)?(\d+)$/i);
  if (m) {
    const accion = /^(aprobar|aprobá|approve|ok)/i.test(m[1]) ? 'aprobar_pendiente' : 'rechazar_pendiente';
    return { accion, numero: parseInt(m[2], 10) };
  }
  return null;
}

// "Telefono de Perez" / "contacto del electricista" / "wa de..." → contacto_proveedor.
function pideContactoProveedor(texto) {
  const t = (texto || '').toLowerCase().trim().replace(/[¡!¿?.,]/g, '');
  if (!t) return null;
  const patrones = [
    /^(telefono|teléfono|tel|wa|whatsapp|contacto)\s+(de\s+|del\s+)?(.+)$/,
  ];
  for (const re of patrones) {
    const m = t.match(re);
    if (m) {
      const prov = (m[m.length - 1] || '').trim();
      if (prov && prov.length > 1) return prov;
    }
  }
  return null;
}

// Detecta si el mensaje es un saludo simple (sin contenido extra).
function esSaludo(texto) {
  const t = (texto || '').toLowerCase().trim().replace(/[!¡¿?.,]/g, '');
  if (!t) return false;
  const exactos = ['hola', 'holaa', 'hi', 'buen dia', 'buenas', 'buen día', 'buenos dias', 'buenos días',
                   'buenas tardes', 'buenas noches', 'que tal', 'qué tal', 'que onda', 'qué onda',
                   'hey', 'ey', 'che', 'saludos', 'ola', 'hello'];
  if (exactos.includes(t)) return true;
  const primera = t.split(/\s+/)[0];
  return ['hola', 'buenas', 'hey', 'che', 'saludos'].includes(primera) && t.length < 12;
}

// Detecta si el mensaje pregunta por tareas pendientes — en lenguaje natural.
// Cubre: "tareas", "tareas pendientes", "que tareas tengo", "mis tareas",
// "hola tareas pendientes", "que tengo pendiente", etc.
function pideTareas(texto) {
  const t = (texto || '').toLowerCase().trim().replace(/[!¡¿?.,]/g, '');
  if (!t) return false;
  // "tarea N" (ver detalle) NO es pedir la lista → dejar pasar al parser, sino
  // este atajo devolvía la lista una y otra vez (loop al pedir el detalle).
  if (/\btarea\s+\d+/.test(t)) return false;
  // "hice/completé el item N" tampoco es pedir la lista.
  if (/\b(item|ítem)\b/.test(t)) return false;
  // CREAR/asignar una tarea ("agregar/crear/asignar/ponele tarea a X") NO es
  // pedir la lista → dejar pasar al parser para que la cree (nueva_tarea).
  if (/\b(agreg|cre[aá]|asign|pon[eé]|carg|nueva|hac[eé]le|encarg|nuev[ao])\w*/.test(t) && /\btareas?\b/.test(t)) return false;
  // Mencion directa a "tarea(s)" → lista.
  if (/\btareas?\b/.test(t)) return true;
  // "pendientes" o "que tengo pendiente" sin la palabra tarea
  if (/\b(mis pendientes|que tengo pendiente|pendientes que tengo|que hago hoy|que tengo hoy)\b/.test(t)) return true;
  return false;
}

// Normalizador para match de nombres (minúsculas + sin acentos + trim). Igual al
// searchNorm de la app, para reusar el índice del catálogo por nombre.
function _norm(s) {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

// Handler del atajo "lista de materiales de [obra] del [proveedor]". READ-ONLY:
// cualquier usuario del bot puede pedirlo. Devuelve el texto WhatsApp (Markdown-WA).
//   1) resuelve la obra por nombre (match laxo como en como_va_obra)
//   2) matchea el grupoQuery a un label EXACTO de PROVEEDORES
//   3) junta materiales del detalle (rubros[].tareas[].receta.materiales o, si la
//      tarea no tiene receta, los del APU del catálogo por nombre)
//   4) resuelve el proveedor de cada material (grupo guardado o vía rubro del
//      catálogo por nombre) y filtra los del grupo pedido, agregando por nombre.
async function cotizarProveedorObra({ obraQuery, grupoQuery }, ctx) {
  // (a) obra ─────────────────────────────────────────────────────────────────
  const oq = (obraQuery || '').toLowerCase().trim();
  if (!oq) {
    return '🤔 ¿De qué obra? Ej: *materiales del corralón de Km711*';
  }
  const obra = ctx.obras.find(o =>
    o.id?.toLowerCase() === oq ||
    o.nombre?.toLowerCase().includes(oq) ||
    oq.includes(o.nombre?.toLowerCase())
  );
  if (!obra) {
    const activas = ctx.obras.slice(0, 6).map(o => o.nombre).join(', ');
    return `❌ No encontré una obra con "${obraQuery}". Obras: ${activas}`;
  }

  // (b) grupo → label exacto de PROVEEDORES ────────────────────────────────────
  let grupoLabel = grupoQuery || '';
  if (grupoLabel) {
    const lbl = labelProveedor(grupoLabel);
    const ok = PROVEEDORES.some(p => p.label === lbl);
    grupoLabel = ok ? lbl : '';
  }
  if (!grupoLabel) {
    const lista = PROVEEDORES.map(p => `• ${p.label}`).join('\n');
    return `🤔 ¿De qué proveedor? Decime uno de:\n${lista}`;
  }

  // (c) juntar materiales del detalle ──────────────────────────────────────────
  const det = ctx.detalles?.[obra.id] || {};
  // Índice del catálogo por nombre normalizado (materiales: traen rubro/grupo;
  // tareas: traen su receta de materiales para tareas sin receta propia).
  const catalog = (await loadSharedData('catalog')) || {};
  const catMatByNombre = new Map();
  for (const cm of (catalog.materiales || [])) {
    if (!cm?.nombre) continue;
    const k = _norm(cm.nombre);
    if (!catMatByNombre.has(k)) catMatByNombre.set(k, cm);
  }
  const catTareaByNombre = new Map((catalog.tareas || []).map(ct => [ct.nombre, ct]));

  // nombreMaterial → { nombre, unidad, cantidad }
  const acumulado = new Map();
  for (const rubro of (det.rubros || [])) {
    for (const t of (rubro.tareas || []).filter(t => t.tipo !== 'seccion' && t.cantidad != null)) {
      const recipeMats = (t.receta?.materiales || []).length > 0
        ? t.receta.materiales
        : (catTareaByNombre.get(t.nombre)?.materiales || []);
      for (const m of recipeMats) {
        if (!m?.nombre) continue;
        // Cantidad por unidad de tarea (mismo cálculo que ObraPresupuesto): si el
        // costoUnit no cuadra con cantidad*precio, derivar cantidad de costoUnit.
        const stored = m.cantidad || 0;
        const precio = m.precio || 0;
        const costoUnit = m.costoUnit || 0;
        let cantUnit = stored;
        if (stored > 0 && precio > 0 && costoUnit > 0 && Math.abs(stored * precio - costoUnit) > costoUnit * 0.01 + 0.01) {
          cantUnit = costoUnit / precio;
        } else if (stored === 0 && precio > 0 && costoUnit > 0) {
          cantUnit = costoUnit / precio;
        }
        const qty = cantUnit * (t.cantidad || 0);

        // Resolver el proveedor del material. La receta NO trae rubro/grupo, así
        // que lo buscamos en el catálogo por nombre (que sí tiene grupo/rubro).
        const catMat = catMatByNombre.get(_norm(m.nombre));
        const proveedor = proveedorDeMaterial(
          catMat
            ? { grupo: catMat.grupo, rubro: catMat.rubro, nombre: m.nombre }
            : { grupo: m.grupo, rubro: m.rubro, nombre: m.nombre }
        );
        if (proveedor !== grupoLabel) continue;

        const key = _norm(m.nombre);
        if (acumulado.has(key)) {
          acumulado.get(key).cantidad += qty;
        } else {
          acumulado.set(key, { nombre: m.nombre, unidad: m.unidad || (catMat?.unidad || ''), cantidad: qty });
        }
      }
    }
  }

  // (d) respuesta WhatsApp ─────────────────────────────────────────────────────
  const items = [...acumulado.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  if (!items.length) {
    return `🧾 *Materiales de ${grupoLabel}* — ${obra.nombre}\n\nNo hay materiales de este proveedor en el presupuesto de la obra.`;
  }
  const fmtCant = n => {
    const r = Math.round((n + Number.EPSILON) * 100) / 100;
    return r.toLocaleString('es-AR', { maximumFractionDigits: 2 });
  };
  const CAP = 30;
  const visibles = items.slice(0, CAP);
  let r = `🧾 *Materiales de ${grupoLabel}* — ${obra.nombre}\n\n`;
  r += visibles.map(it => `• ${it.nombre} — ${fmtCant(it.cantidad)}${it.unidad ? ' ' + it.unidad : ''}`).join('\n');
  if (items.length > CAP) r += `\n…y ${items.length - CAP} más`;
  return r;
}

async function handleMainFlow(phone, user, messageText, mediaId, mimeType, conv) {
  const ctx = await getSystemContext();

  let base64Media = null;
  let mediaUrl    = conv.data?.pendingMediaUrl || null;

  if (mediaId) {
    base64Media = await downloadMedia(mediaId);
    if (base64Media) {
      const ext      = mimeType === 'application/pdf' ? 'pdf' : 'jpg';
      const filepath = `${phone.replace(/\D/g, '')}-${Date.now()}.${ext}`;
      mediaUrl = await uploadToStorage(base64Media, mimeType, filepath);
      console.log(`MEDIA uploaded: ${mediaUrl}`);
    }
  } else if (mediaUrl && conv.state === 'conversando') {
    // Caso típico: el usuario mandó la FOTO en un mensaje y el TEXTO en
    // otro ("pagué de baradero"). La foto quedó guardada como pendingMediaUrl
    // pero Claude no la tenía en este turno → no podía leer monto/medio.
    // La re-descargamos del storage para volver a pasársela al modelo.
    try {
      const r = await fetch(mediaUrl);
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        base64Media = buf.toString('base64');
        mimeType = mediaUrl.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg';
        console.log(`MEDIA re-descargada de pendingMediaUrl para pasar a Claude`);
      }
    } catch (e) {
      console.error('re-download pendingMedia error:', e.message);
    }
  }

  // ── Digest "resumen de hoy" por rol + comandos directos (menú nativo de TG) ─
  // Evita gastar una llamada a Claude para los comandos de una palabra (el menú
  // /saldo /pendientes /ayuda llega como "/saldo" → strip → "saldo").
  if (!mediaId && conv.state === 'idle') {
    const td = (messageText || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[¡!¿?.,]/g, '').trim();
    if (/^(digest|resumen de hoy|resumen del dia|resumen diario|resumen hoy|mi dia|mi jornada|que hay hoy|que tengo para hoy)$/.test(td)) {
      await sendWA(phone, await ejecutarComando('digest', {}, { ...user, phone }, ctx));
      return;
    }
    if (['saldo', 'pendientes', 'ayuda', 'cheques'].includes(td)) {
      await sendWA(phone, await ejecutarComando(td, {}, { ...user, phone }, ctx));
      return;
    }
  }

  // ── El usuario pide ver sus tareas (en lenguaje natural) ───────────────────
  // Detecta "tareas", "tareas pendientes", "que tareas tengo", "hola tareas
  // pendientes", etc., y responde con la lista. Esto evita que el usuario
  // tenga que escribir el comando exacto.
  if (!mediaId && conv.state === 'idle' && pideTareas(messageText)) {
    const respuesta = await ejecutarComando('tareas', {}, { ...user, phone }, ctx);
    await sendWA(phone, respuesta);
    return;
  }

  // ── Atajos de consulta en lenguaje natural ─────────────────────────────────
  // Estos shortcuts evitan pasar por Claude (más rápido, más barato, sin
  // riesgo de que el LLM repregunte algo trivial).
  if (!mediaId && conv.state === 'idle') {
    const obraQuery = pideEstadoObra(messageText);
    if (obraQuery) {
      const respuesta = await ejecutarComando('como_va_obra', { obra: obraQuery }, { ...user, phone }, ctx);
      await sendWA(phone, respuesta);
      return;
    }
    // "materiales del corralón de Km711" → lista de materiales filtrada por
    // proveedor. ANTES de cc/saldo para que "materiales del corralón en X" no
    // se confunda con un saldo de cuenta corriente.
    const cotiz = pideCotizarProveedor(messageText);
    if (cotiz) {
      const respuesta = await cotizarProveedorObra(cotiz, ctx);
      await sendWA(phone, respuesta);
      return;
    }
    const ccQuery = pideCCProveedor(messageText);
    if (ccQuery) {
      const respuesta = await ejecutarComando('cc_proveedor', { proveedor: ccQuery }, { ...user, phone }, ctx);
      await sendWA(phone, respuesta);
      return;
    }
    const contactoQuery = pideContactoProveedor(messageText);
    if (contactoQuery) {
      const respuesta = await ejecutarComando('contacto_proveedor', { proveedor: contactoQuery }, { ...user, phone }, ctx);
      await sendWA(phone, respuesta);
      return;
    }
    const aprob = pideAprobacion(messageText);
    if (aprob) {
      const respuesta = await ejecutarComando(aprob.accion, { numero: aprob.numero }, { ...user, phone }, ctx);
      await sendWA(phone, respuesta);
      return;
    }
    const nota = pideNotaObra(messageText);
    if (nota) {
      const respuesta = await ejecutarComando('nota_obra', nota, { ...user, phone }, ctx);
      await sendWA(phone, respuesta);
      return;
    }
    const buscar = pideBuscarGastos(messageText);
    if (buscar) {
      const respuesta = await ejecutarComando('buscar_gastos', buscar, { ...user, phone }, ctx);
      await sendWA(phone, respuesta);
      return;
    }
    const estadoChq = pideEstadoCheque(messageText);
    if (estadoChq) {
      const respuesta = await ejecutarComando('estado_cheque', estadoChq, { ...user, phone }, ctx);
      await sendWA(phone, respuesta);
      return;
    }
    // "deshacer" / "deshacé" / "borrá lo último" → revierte el último mov.
    const tDesh = (messageText || '').toLowerCase().trim().replace(/[¡!¿?.,]/g, '');
    if (/^(deshacer|deshace|deshacé|borra lo ultimo|borrá lo último|undo|me equivoque|me equivoqué)$/.test(tDesh)) {
      const respuesta = await ejecutarComando('deshacer', {}, { ...user, phone }, ctx);
      await sendWA(phone, respuesta);
      return;
    }

    // ── MODO DICTADO: gastos múltiples ──────────────────────────────────────
    // "cargá: 50k cemento baradero, 12k flete, 3k almuerzo"
    const dictado = parseDictado(messageText, { obras: ctx.obras });
    if (dictado && dictado.items.length > 0) {
      // Caja efectivo del usuario para los gastos sin caja explícita.
      const cajaEfectivo = ctx.cajas.find(c =>
        c.tipo === 'efectivo' && c.usuarioId === user.email && c.moneda === 'ARS'
      );
      // Completar items: si no tienen obra, usar el default del usuario.
      const items = dictado.items.map(it => ({
        ...it,
        obraId:     it.obraId || conv.defaults?.lastObraId || null,
        cajaId:     cajaEfectivo?.id || null,
      }));
      const fmt = n => `$${Math.round(n).toLocaleString('es-AR')}`;
      const total = items.reduce((s, it) => s + it.monto, 0);
      const resumen =
        `📝 *Voy a cargar ${items.length} gasto${items.length === 1 ? '' : 's'}:*\n\n` +
        items.map((it, i) => {
          const obraN = it.obraId ? (ctx.obras.find(o => o.id === it.obraId)?.nombre || '') : '';
          return `${i + 1}. ${fmt(it.monto)} — ${it.descripcion}${obraN ? ` · ${obraN}` : ' · ⚠️ sin obra'}`;
        }).join('\n') +
        `\n\n*Total: ${fmt(total)}*`;
      await saveConversation(phone, {
        state: 'dictado_confirmando',
        data: { dictadoItems: items },
        // NOTA: no usar `updatedHistory` acá — se declara con const más abajo
        // (línea ~2927) y este bloque corre antes, así que estaría en la zona
        // muerta temporal y tiraba ReferenceError, rompiendo el dictado.
        history: [...conv.history, { rol: 'usuario', texto: messageText || '(foto)', ts: Date.now() }],
        slots: conv.slots || {},
      });
      await sendWAButtons(phone, resumen, BOTONES_CONFIRMAR);
      return;
    }
  }

  // ── Estado: confirmando gastos múltiples del modo dictado ──────────────────
  if (conv.state === 'dictado_confirmando' && Array.isArray(conv.data?.dictadoItems)) {
    const respLower = (messageText || '').trim().toLowerCase();
    const confirma  = ['sí', 'si', 'dale', 'ok', 'confirmo', 'correcto', 's'].some(p => respLower.startsWith(p));
    const cancela   = ['no', 'cancelar', 'mal', 'n'].some(p => respLower.startsWith(p));
    if (confirma) {
      let creados = 0;
      for (const it of conv.data.dictadoItems) {
        if (!it.monto) continue;
        await ejecutarAccion('gasto', {
          monto:       it.monto,
          descripcion: it.descripcion,
          obraId:      it.obraId,
          cajaId:      it.cajaId,
          comprobante: 'negro',
        }, { ...user, phone }, ctx, null);
        creados++;
      }
      await clearConversation(phone);
      await sendWA(phone, `✅ Cargué *${creados}* gasto${creados === 1 ? '' : 's'}. Escribí *deshacer* si te equivocaste en alguno.`);
      return;
    }
    if (cancela) {
      await clearConversation(phone);
      await sendWA(phone, '❌ Cancelado, no cargué nada.');
      return;
    }
    await sendWAButtons(phone, 'Tocá *Confirmar* para cargar los gastos o *Cancelar* para descartar.', BOTONES_CONFIRMAR);
    return;
  }

  // ── Saludo solo (sin pedir tareas): respuesta cortés breve ─────────────────
  // No invadimos con info que el usuario no pidio. Si quiere ver tareas,
  // escribe "tareas" o cualquier variante (manejado arriba).
  if (!mediaId && conv.state === 'idle' && esSaludo(messageText)) {
    const nombre = (user.nombre || '').split(' ')[0] || '';
    await sendWA(phone, `👋 ¡Hola${nombre ? ' ' + nombre : ''}! ¿En qué te ayudo?\n\n_Escribí *ayuda* para ver los comandos o *tareas* para tus pendientes._`);
    return;
  }

  if (conv.state === 'confirmando' && conv.data?.accion) {
    const respLower = messageText.trim().toLowerCase();
    const confirma  = ['sí', 'si', 'dale', 'ok', 'confirmo', 'correcto', 's'].some(p => respLower.startsWith(p));
    const cancela   = ['no', 'cancelar', 'error', 'mal', 'n'].some(p => respLower.startsWith(p));
    const editar    = respLower === 'editar' || respLower === 'corregir' || respLower === 'cambiar';

    if (confirma) {
      const resultado = await ejecutarAccion(conv.data.accion.tipo, conv.data.accion.datos, { ...user, phone }, ctx, mediaUrl || conv.data.pendingMediaUrl);
      // Si la acción dejó la conv en un estado posterior (ej. awaiting_client_notice
      // tras un ingreso de admin, o awaiting_factura_pago_* tras un pago a
      // proveedor con factura pendiente coincidente), respetarlo en vez de limpiar.
      const newConv = await loadConversation(phone);
      if (newConv.state === 'idle' || newConv.state === 'confirmando') {
        await clearConversation(phone);
      }
      // resultado === null cuando la acción ya envió su propio mensaje (ej. lista
      // de facturas pendientes para elegir) — no mandar texto vacío.
      if (resultado) await sendWA(phone, resultado);
      return;
    }
    if (cancela) {
      await clearConversation(phone);
      await sendWA(phone, '❌ Cancelado. ¿En qué más te puedo ayudar?');
      return;
    }
    if (editar) {
      await sendWA(phone,
        '✏️ ¿Qué corregís? Mandame el dato nuevo, ej:\n' +
        '• _"monto 60000"_ o _"60k"_\n' +
        '• _"obra Sismat"_\n' +
        '• _"30 m²"_ (para avances)\n' +
        '• _"tarea revoque grueso"_\n\n' +
        'Lo demás queda igual.'
      );
      return; // sigue en 'confirmando'
    }
    // ── CORRECCIÓN: el user mandó un dato distinto a sí/no/editar ────────────
    // Extraemos lo que cambió y lo mergeamos sobre la acción en curso, sin
    // perder lo que ya estaba. Re-mostramos la confirmación actualizada.
    const ext = extractSlots(messageText || '', {
      obras: ctx.obras, cajas: ctx.cajas, proveedores: ctx.proveedores,
      detalles: ctx.detalles, defaults: conv.defaults || {},
    });
    const datos = { ...(conv.data.accion.datos || {}) };
    let cambios = 0;
    if (ext.monto != null)    { datos.monto = ext.monto; cambios++; }
    if (ext.obraId)           { datos.obraId = ext.obraId; cambios++; }
    if (ext.cajaId)           { datos.cajaId = ext.cajaId; cambios++; }
    if (ext.cantidad != null) { datos.cantidadAvance = ext.cantidad; cambios++; }
    if (ext.unidad)           { datos.unidad = ext.unidad; cambios++; }
    if (ext.tareaId)          { datos.tareaId = ext.tareaId; datos.rubroId = ext.rubroId || datos.rubroId; cambios++; }
    if (ext.proveedorId)      { datos.proveedorNombre = ext.proveedorNombre; cambios++; }

    if (cambios > 0) {
      const accionAct = { ...conv.data.accion, datos };
      await saveConversation(phone, {
        state: 'confirmando',
        data: { ...conv.data, accion: accionAct },
        slots: mergeSlots(conv.slots || {}, ext),
      });
      const resumen = resumenAccion(accionAct, ctx);
      await sendWAButtons(phone, `🔁 Actualicé:\n\n${resumen}`, BOTONES_CONFIRMAR);
      return;
    }
    // Si no detectó ninguna corrección concreta, recordá las opciones.
    await sendWAButtons(phone, 'No entendí la corrección. Tocá *Confirmar*, *Editar* (y mandá el dato), o *Cancelar*.', BOTONES_CONFIRMAR);
    return;
  }

  // ── Estado: esperando que el usuario diga a qué caja entra un ingreso ───────
  // Solo ofrecemos las cajas VISIBLES del usuario. Al elegir, re-ejecutamos el
  // ingreso con la caja ya resuelta (sigue luego al aviso al cliente si aplica).
  if (conv.state === 'awaiting_ingreso_caja' && conv.data?.datos) {
    const q = (messageText || '').trim().toLowerCase();
    if (['no', 'cancelar', 'dejalo', 'n', 'cancela'].some(p => q === p)) {
      await clearConversation(phone);
      await sendWA(phone, '❌ Cancelado, no cargué el ingreso.');
      return;
    }
    const ext = extractSlots(messageText || '', {
      obras: ctx.obras, cajas: ctx.cajas, proveedores: ctx.proveedores,
      detalles: ctx.detalles, defaults: conv.defaults || {},
    });
    let cajaId = ext.cajaId;
    if (!cajaId) {
      const match = ctx.cajas.find(c => cajaEsVisible(user, c) &&
        (c.nombre?.toLowerCase().includes(q) || (q.length > 2 && q.includes(c.nombre?.toLowerCase()))));
      cajaId = match?.id;
    }
    const caja = cajaId ? ctx.cajas.find(c => c.id === cajaId && cajaEsVisible(user, c)) : null;
    if (!caja) {
      const opciones = ctx.cajas.filter(c => cajaEsVisible(user, c)).slice(0, 10).map(c => `• ${c.nombre}`).join('\n');
      await sendWA(phone, `No reconocí esa caja. Elegí una de las tuyas:\n${opciones || '(no tenés cajas visibles)'}\n\nO escribí *no* para cancelar.`);
      return;
    }
    const datos = { ...conv.data.datos, cajaId: caja.id };
    const resultado = await ejecutarAccion('ingreso', datos, { ...user, phone }, ctx, conv.data.mediaUrl);
    // ejecutarAccion pudo dejar un estado posterior (aviso al cliente). Si quedó
    // en este estado, ya terminó: lo limpiamos.
    const newConv = await loadConversation(phone);
    if (newConv.state === 'awaiting_ingreso_caja') await clearConversation(phone);
    await sendWA(phone, resultado);
    return;
  }

  // ── Estado: esperando confirmación para avisar al cliente del cobro ─────────
  if (conv.state === 'awaiting_client_notice' && conv.data?.clienteTel) {
    const respLower = (messageText || '').trim().toLowerCase();
    const confirma  = ['sí', 'si', 'dale', 'ok', 'confirmo', 'correcto', 's', 'avisa', 'avisale'].some(p => respLower.startsWith(p));
    const cancela   = ['no', 'cancelar', 'mal', 'n', 'omiti'].some(p => respLower.startsWith(p));

    if (confirma) {
      const { clienteTel, clienteNombre, monto, moneda, obraNombre, recibidoPor } = conv.data;
      try {
        await notifyClienteCobro({ telefono: clienteTel, clienteNombre, monto, moneda, obraNombre, recibidoPor });
        await clearConversation(phone);
        await sendWA(phone, `✅ Listo. Le confirmé el cobro a *${clienteNombre}*.`);
      } catch (e) {
        await clearConversation(phone);
        await sendWA(phone, `⚠️ No pude enviarle el mensaje a *${clienteNombre}*. El ingreso ya quedó cargado igual. (Detalle: ${e.message})`);
      }
      return;
    }
    if (cancela) {
      await clearConversation(phone);
      await sendWA(phone, `👌 No le avisé al cliente. El ingreso quedó cargado igual.`);
      return;
    }
    // No respondió sí/no: cambió de tema. NO lo atrapamos — asumimos "no aviso"
    // (el cobro ya quedó cargado) y procesamos su mensaje nuevo desde cero.
    await clearConversation(phone);
    return handleMainFlow(phone, user, messageText, mediaId, mimeType, {
      state: 'idle', data: {}, slots: conv.slots || {}, defaults: conv.defaults || {}, history: conv.history || [],
    });
  }

  // ── Estado: esperando teléfono del cliente que no estaba cargado ────────────
  if (conv.state === 'awaiting_client_phone' && conv.data?.clienteId) {
    const respLower = (messageText || '').trim().toLowerCase();
    const cancela = ['no', 'omiti', 'omitir', 'despues', 'después', 'luego', 'cancelar', 'n'].some(p => respLower === p || respLower.startsWith(p));

    if (cancela) {
      await clearConversation(phone);
      await sendWA(phone, `👌 No le avisé. Cargá el WhatsApp en la ficha del cliente cuando puedas para que sea automático la próxima vez.`);
      return;
    }

    const tel = normalizePhone(messageText || '');
    if (!tel) {
      await sendWA(phone, `🤔 No reconozco ese número. Mandame solo los dígitos con código país (ej. *5491155551234*), o escribí *no* para omitir.`);
      return;
    }

    // Guardar el teléfono en la ficha del cliente (persistente).
    // Se guarda con "+" para que el campo telefono de la app conserve formato
    // legible (ej. "+5491155551234"). El bot normaliza antes de enviar.
    try {
      await sbPatchItem('clientes', conv.data.clienteId, { telefono: '+' + tel }); // atómico
    } catch (e) {
      console.error('save cliente phone error:', e.message);
    }

    // Mandar el aviso al cliente.
    const { clienteNombre, monto, moneda, obraNombre, recibidoPor } = conv.data;
    try {
      await notifyClienteCobro({ telefono: tel, clienteNombre, monto, moneda, obraNombre, recibidoPor });
      await clearConversation(phone);
      await sendWA(phone, `✅ Listo. Guardé el WhatsApp en la ficha de *${clienteNombre}* y le confirmé el cobro.`);
    } catch (e) {
      await clearConversation(phone);
      await sendWA(phone, `📱 Guardé el WhatsApp en la ficha, pero no pude enviarle el mensaje. (${e.message})`);
    }
    return;
  }

  // ── Estado: confirmando si un pago a proveedor salda una factura pendiente ──
  // Hay UNA factura abierta cuyo saldo ≈ el monto del pago. Si confirma, re-ejecuta
  // el pago linkeado a esa factura; si dice "no", lo registra como pago suelto.
  if (conv.state === 'awaiting_factura_pago_confirm' && conv.data?.pagoDatos) {
    const respLower = (messageText || '').trim().toLowerCase();
    const confirma = ['sí', 'si', 'dale', 'ok', 'confirmo', 'correcto', 's', 'esa', 'esta'].some(p => respLower.startsWith(p));
    const cancela  = ['no', 'n', 'pago suelto', 'suelto', 'ninguna'].some(p => respLower === p || respLower.startsWith(p));
    const datosPago = conv.data.pagoDatos;
    if (confirma) {
      await clearConversation(phone);
      const resultado = await ejecutarAccion('pago_proveedor', { ...datosPago, facturaPendienteId: conv.data.facturaId }, { ...user, phone }, ctx, conv.data.mediaUrl || null);
      if (resultado) await sendWA(phone, resultado);
      return;
    }
    if (cancela) {
      await clearConversation(phone);
      const resultado = await ejecutarAccion('pago_proveedor', { ...datosPago, _skipMatch: true }, { ...user, phone }, ctx, conv.data.mediaUrl || null);
      if (resultado) await sendWA(phone, resultado);
      return;
    }
    await sendWA(phone, 'Decime *sí* si el pago es de esa factura, o *no* para registrarlo como pago suelto.');
    return;
  }

  // ── Estado: eligiendo cuál de varias facturas pendientes salda el pago ──────
  // El admin recibió una lista. Puede elegir por número, por la lista interactiva
  // (button/list reply trae el id de la factura como messageText), o decir "ninguna".
  if (conv.state === 'awaiting_factura_pago_pick' && conv.data?.pagoDatos) {
    const respLower = (messageText || '').trim().toLowerCase();
    const opciones = conv.data.opcionesFacturas || [];
    const datosPago = conv.data.pagoDatos;
    if (['ninguna', 'ningun', 'no', 'suelto', 'pago suelto'].some(p => respLower === p || respLower.startsWith(p))) {
      await clearConversation(phone);
      const resultado = await ejecutarAccion('pago_proveedor', { ...datosPago, _skipMatch: true }, { ...user, phone }, ctx, conv.data.mediaUrl || null);
      if (resultado) await sendWA(phone, resultado);
      return;
    }
    // ¿Vino el id directo de la lista interactiva?
    let facturaId = opciones.find(id => id === (messageText || '').trim()) || null;
    // ¿O un número (1..N)?
    if (!facturaId) {
      const n = parseInt(respLower, 10);
      if (n >= 1 && n <= opciones.length) facturaId = opciones[n - 1];
    }
    if (!facturaId) {
      await sendWA(phone, 'No te entendí. Decime el *número* de la factura (1, 2, …) o *ninguna* para registrarlo como pago suelto.');
      return;
    }
    await clearConversation(phone);
    const resultado = await ejecutarAccion('pago_proveedor', { ...datosPago, facturaPendienteId: facturaId }, { ...user, phone }, ctx, conv.data.mediaUrl || null);
    if (resultado) await sendWA(phone, resultado);
    return;
  }

  const updatedHistory = [
    ...conv.history,
    { rol: 'usuario', texto: messageText || '(foto)', ts: Date.now() },
  ];

  // ── PRE-EXTRACCIÓN DE SLOTS (anti-repreguntas) ──────────────────────────────
  // Antes de llamar a Claude, extraemos lo más posible del mensaje con regex.
  // El resultado se mergea con los slots ya conocidos de turnos previos. Si
  // tenemos todo lo necesario, podemos saltear preguntas redundantes.
  // Esto cubre el caso: "AGENDA AVANCE DE OBRA 25 MTS2 DE COLOCACION DE PISOS"
  // → extrae intent=avance, cantidad=25, unidad=m², tarea=colocacion de pisos
  // → si todo matchea, va directo a confirmar sin preguntar nada.
  const ctxExt = {
    obras:        ctx.obras,
    cajas:        ctx.cajas,
    proveedores:  ctx.proveedores,
    detalles:     ctx.detalles,
    defaults:     conv.defaults || {},
  };
  const extractedSlots = extractSlots(messageText || '', ctxExt);
  const mergedSlots = mergeSlots(conv.slots || {}, extractedSlots);
  conv.slots = mergedSlots;

  // ── BYPASS CORRECCIÓN: "me equivoqué", "corregir avance", etc. ──────────────
  const correccionDetectada = extractCorreccion(messageText || '', ctx.obras, ctx.detalles);
  if (correccionDetectada?.completo) {
    const { _obra, _tarea, cantidadAvance, unidad } = correccionDetectada;
    const pctNuevo = _tarea.cantidad ? Math.round((cantidadAvance / _tarea.cantidad) * 100) : null;
    const pctActual = _tarea.avance || 0;
    const confMsg =
      `🔧 *Corrección de avance:*\n\n` +
      `🏗 Obra: *${_obra.nombre}*\n` +
      `📐 Tarea: *${_tarea.nombre}*\n` +
      `📊 Avance actual: *${pctActual}%*\n` +
      `✏️ Nuevo valor: *${cantidadAvance}${unidad}*${pctNuevo != null ? ` → *${Math.min(pctNuevo, 100)}%*` : ''}\n\n` +
      `Esto *reemplaza* el avance anterior. ¿Confirmás? (sí/no)`;
    const newHist = [...updatedHistory, { rol: 'asistente', texto: confMsg, ts: Date.now() }];
    await saveConversation(phone, { state: 'confirmando', data: { accion: { tipo: 'avance_obra', datos: correccionDetectada }, pendingMediaUrl: mediaUrl }, history: newHist, slots: conv.slots || {} });
    await sendWAButtons(phone, confMsg, BOTONES_CONFIRMAR);
    return;
  }

  // ── BYPASS CLAUDE: extracción directa cuando todo está en el texto ──────────
  // Si detectamos avance + obra + tarea + cantidad del propio mensaje, vamos directo
  // a confirmación sin preguntarle nada al usuario.
  const avanceDetectado = extractAvanceCompleto(messageText || '', ctx.obras, ctx.detalles);
  if (avanceDetectado?.completo && conv.state !== 'conversando') {
    const { _obra, _tarea, cantidadAvance, unidad } = avanceDetectado;
    const cantStr  = `${cantidadAvance}${unidad}`;
    const totalStr = _tarea.cantidad ? ` de ${_tarea.cantidad}${_tarea.unidad || unidad} total` : '';
    const avPct    = _tarea.cantidad ? ` (+${Math.round((cantidadAvance / _tarea.cantidad) * 100)}%)` : '';
    const confMsg  =
      `📋 *Confirmar avance:*\n\n` +
      `🏗 Obra: *${_obra.nombre}*\n` +
      `📐 Tarea: *${_tarea.nombre}*\n` +
      `📊 Cantidad: *${cantStr}*${totalStr}${avPct}\n` +
      (mediaUrl ? `📷 Con foto adjunta\n` : '') +
      `\n¿Confirmás? (sí/no)`;
    const newHist = [...updatedHistory, { rol: 'asistente', texto: confMsg, ts: Date.now() }];
    await saveConversation(phone, { state: 'confirmando', data: { accion: { tipo: 'avance_obra', datos: avanceDetectado }, pendingMediaUrl: mediaUrl }, history: newHist, slots: conv.slots || {} });
    await sendWAButtons(phone, confMsg, BOTONES_CONFIRMAR);
    return;
  }

  const claudeRes = await callClaude(user, messageText, base64Media, mimeType, { ...conv, history: updatedHistory }, ctx, mediaUrl);

  const newHistory = [
    ...updatedHistory,
    { rol: 'asistente', texto: claudeRes.mensaje, ts: Date.now() },
  ];

  if (claudeRes.estado === 'ejecutar') {
    const resultado = await ejecutarAccion(claudeRes.accion.tipo, claudeRes.accion.datos, { ...user, phone }, ctx, mediaUrl);
    // ejecutarAccion puede dejar la conv en un estado posterior (ej.
    // awaiting_client_notice tras un ingreso de admin, o awaiting_factura_pago_*
    // tras un pago a proveedor con factura pendiente). Solo limpiamos si quedó
    // en idle/confirmando.
    const afterExec = await loadConversation(phone);
    if (afterExec.state === 'idle' || afterExec.state === 'confirmando') {
      // Persist defaults: lo último usado queda como sugerencia para próxima
      // sesión. Así "cargá otro gasto" infiere obra/caja sin pedir.
      const accionDatos = claudeRes.accion.datos || {};
      const nuevosDefaults = mergeSlots(conv.defaults || {}, {
        lastObraId:      accionDatos.obraId      || conv.slots?.obraId,
        lastCajaId:      accionDatos.cajaId      || conv.slots?.cajaId,
        lastProveedorId: accionDatos.proveedorId || conv.slots?.proveedorId,
        lastRubroId:     accionDatos.rubroId     || conv.slots?.rubroId,
      });
      // Mantener defaults y history para "y otro gasto más"; limpiar slots
      // de la intención que acaba de ejecutarse.
      await saveConversation(phone, {
        state: 'idle', data: {}, slots: {},
        defaults: nuevosDefaults, history: newHistory,
      });
    }
    // resultado === null cuando la acción ya envió su propio mensaje (lista de
    // facturas pendientes para elegir) — no mandar texto vacío.
    if (resultado) await sendWA(phone, resultado);
    return;
  }

  if (claudeRes.estado === 'confirmando') {
    await saveConversation(phone, { state: 'confirmando', data: { accion: claudeRes.accion, pendingMediaUrl: mediaUrl }, history: newHistory, slots: conv.slots || {} });
    // Guarda anti-JSON: si el LLM no mandó un mensaje legible (vacío o con pinta
    // de objeto), armamos la confirmación humana desde la acción (nunca JSON crudo).
    const m = claudeRes.mensaje;
    const msgConf = (m && typeof m === 'string' && m.trim() && !m.trim().startsWith('{'))
      ? m
      : resumenAccion(claudeRes.accion || {}, ctx);
    await sendWAButtons(phone, msgConf, BOTONES_CONFIRMAR);
    return;
  }

  if (claudeRes.estado === 'cancelar') {
    await clearConversation(phone);
    await sendWA(phone, '❌ Cancelado. ¿En qué más te puedo ayudar?');
    return;
  }

  if (claudeRes.estado === 'comando') {
    const resultado = await ejecutarComando(claudeRes.accion?.datos?.comando, claudeRes.accion?.datos || {}, { ...user, phone }, ctx);
    await saveConversation(phone, { state: 'idle', data: {}, slots: {}, history: newHistory });
    await sendWA(phone, resultado);
    return;
  }

  await saveConversation(phone, { state: 'conversando', data: { ...(conv.data || {}), pendingMediaUrl: mediaUrl }, history: newHistory, slots: conv.slots || {} });
  await sendWA(phone, claudeRes.mensaje);
}

// ── Handler principal ─────────────────────────────────────────────────────────
// ── Bot interno por Telegram: parseo del update + ruteo ─────────────────────
// Traduce un update de Telegram al MISMO (phone, text, mediaId, mimeType) que usa
// el path de WhatsApp y reusa TODO el motor (getLinkedUser → handleMainFlow /
// handleLinkingFlow), la dedup, el lock por media y el RBAC. El "phone" es el
// sentinel "tg:<chatId>" → estado, locks y envíos se enrutan solos a Telegram.
async function handleTelegramUpdate(update) {
  if (!update || typeof update !== 'object') return;

  let chatId = null, text = '', mediaId = null, mimeType = null;
  let contactoCompartido = null, isCallback = false, dedupId = update.update_id;

  if (update.callback_query) {
    // Tap en un botón inline → llega como update aparte (no como mensaje).
    isCallback = true;
    const cq = update.callback_query;
    chatId = cq.message?.chat?.id;
    const data = cq.data || '';
    await tgApi('answerCallbackQuery', { callback_query_id: cq.id }); // corta el spinner
    // Quitamos el teclado del mensaje para evitar doble-tap (re-ejecución de la acción).
    if (cq.message?.message_id != null && cq.message?.chat?.id != null) {
      await tgApi('editMessageReplyMarkup', { chat_id: cq.message.chat.id, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } });
    }
    // Normalización idéntica al handler interactivo de WhatsApp (4678-4691).
    if (data === 'confirmar') text = 'sí';
    else if (data === 'cancelar') text = 'no';
    else if (data === 'editar') text = 'editar';
    else if (data.startsWith('pick:')) text = data.slice(5);
    else text = data;
    dedupId = `cb:${cq.id}`;
  } else if (update.message) {
    const m = update.message;
    chatId = m.chat?.id;
    dedupId = `msg:${m.message_id}`;
    if (m.text) {
      text = m.text;
    } else if (Array.isArray(m.photo) && m.photo.length) {
      // photo = array de tamaños; el último es el de mayor resolución.
      mediaId = `tg:${m.photo[m.photo.length - 1].file_id}`;
      mimeType = 'image/jpeg';
      text = m.caption || '';
    } else if (m.document) {
      mediaId  = `tg:${m.document.file_id}`;
      // callClaude solo adjunta bloques pdf o image/*. Si el mime falta, lo inferimos
      // del nombre y por defecto asumimos PDF (mismo default que WhatsApp) para NO
      // perder la OCR del comprobante.
      const fn = (m.document.file_name || '').toLowerCase();
      mimeType = m.document.mime_type
        || (/\.jpe?g$/.test(fn) ? 'image/jpeg'
          : /\.png$/.test(fn) ? 'image/png'
          : /\.webp$/.test(fn) ? 'image/webp'
          : 'application/pdf');
      // Preferimos el caption sobre el nombre del archivo (suele ser inútil).
      text = m.caption || m.document.file_name || '';
    } else if (m.contact) {
      // Contacto compartido → mismo flujo "primer contacto" que la vCard de WA.
      const c = m.contact;
      const nombre = [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || null;
      let tel = c.phone_number || null;
      if (tel) { tel = String(tel).trim(); if (!tel.startsWith('+')) tel = '+' + tel.replace(/[^\d]/g, ''); }
      contactoCompartido = { nombre, telefono: tel || null };
      const idC = nombre || tel || '';
      text = idC ? `primer contacto ${idC}` : 'primer contacto';
      if (m.caption) text += `. ${m.caption}`;
    } else {
      return; // tipo no soportado (sticker, ubicación, audio, etc.)
    }
  } else {
    return; // edited_message, channel_post, my_chat_member, etc. — no aplican
  }

  if (chatId == null) return;
  const phone = `tg:${chatId}`;

  // ── /start y comandos con barra ────────────────────────────────────────────
  if (!isCallback && typeof text === 'string') {
    const t = text.trim().toLowerCase();
    if (!mediaId && (t === '/start' || t.startsWith('/start '))) {
      const yaVinc = await getLinkedUser(phone);
      if (yaVinc) {
        await sendWA(phone, `👋 ¡Hola de nuevo, *${yaVinc.user_name || ''}*!\n\nProbá: *resumen de hoy* · *tareas* · *saldo*\nO cargá algo: _"150 m² de revoque en Baradero"_ + foto, o _"pagué $50k de materiales en Baradero"_.\nEscribí *ayuda* para ver todo.`);
      } else {
        await clearConversation(phone); // arranca limpio
        await handleLinkingFlow(phone, '', { state: 'idle', data: {}, history: [], slots: {}, defaults: {} });
      }
      return;
    }
    // Telegram manda comandos como "/ayuda", "/saldo": sacamos la barra para que
    // el motor los matchee igual que el texto natural.
    if (text.startsWith('/')) text = text.slice(1);
  }

  // ── Dedup (Telegram reintenta updates no respondidos con 200) ──────────────
  const conv = await loadConversation(phone);
  const procesados = conv.defaults?.lastMsgIds || [];
  const msgId = `tg:${dedupId}`;
  if (dedupId != null && procesados.includes(msgId)) { console.log(`DEDUP tg ${msgId}`); return; }
  if (dedupId != null) {
    const nd = { ...(conv.defaults || {}), lastMsgIds: [...procesados, msgId].slice(-25) };
    await saveConversation(phone, { defaults: nd });
    conv.defaults = nd;
  }

  console.log(`TG chat=${chatId} cb=${isCallback} media=${!!mediaId} state=${conv.state} text=${(text || '').slice(0, 30)}`);

  // ── Lock por media (comprobantes simultáneos) + ruteo INTERNO ──────────────
  const lockAdq = mediaId ? await acquireLock(phone) : false;
  try {
    const user = await getLinkedUser(phone);
    if (user) {
      if (contactoCompartido) user.contactoCompartido = contactoCompartido;
      await handleMainFlow(phone, user, text, mediaId, mimeType, conv);
    } else {
      // Canal interno: SIN flujo de cliente ni onboarding QR → directo a vincular.
      await handleLinkingFlow(phone, text, conv);
    }
  } finally {
    if (lockAdq) await releaseLock(phone);
  }
}

export default async function handler(req, res) {
  // Verificación del webhook (GET de Meta) — solo si vienen los query params
  // tipicos del verify de Meta. Sin esos params, devolvemos el endpoint
  // diagnostico para chequear que las env vars esten OK.
  if (req.method === 'GET') {
    const mode      = req.query['hub.mode'];
    const token     = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode || token || challenge) {
      // Es un intento de verify de Meta — validar token.
      if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        return res.status(200).send(challenge);
      }
      return res.status(403).json({ error: 'Forbidden' });
    }
    // GET sin params → endpoint diagnostico publico (no sensible).
    return res.status(200).json({
      ok: true,
      vars: {
        meta:           !!META_TOKEN,
        phoneId:        !!PHONE_NUMBER_ID,
        verifyToken:    !!VERIFY_TOKEN,
        appSecret:      !!META_APP_SECRET,
        anthropic:      !!ANTHROPIC_KEY,
        supabase:       !!SUPABASE_URL,
        // META_PHONE_NUMBER es el numero humano del bot (no sensible).
        metaPhoneNumber: process.env.META_PHONE_NUMBER || '(no seteado)',
        portalBaseUrl:   process.env.PORTAL_BASE_URL || '(no seteado, usa fallback kamak.com.ar)',
      },
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Leer el cuerpo crudo. Lo parseamos ANTES de validar la firma para poder
    // detectar el canal (WhatsApp/Meta vs Telegram). La firma de Meta se valida
    // igual sobre los bytes crudos, pero SOLO para el path de WhatsApp.
    const { raw, parsed } = await leerBodyCrudo(req);
    let body = parsed;
    if (raw) {
      try { body = JSON.parse(raw.toString('utf8') || '{}'); }
      catch { return res.status(400).json({ error: 'bad json' }); }
    }
    body = body || {};

    // ── Bot INTERNO por Telegram ──────────────────────────────────────────────
    // Los updates de Telegram traen `update_id` y (si seteamos secret en
    // setWebhook) el header X-Telegram-Bot-Api-Secret-Token. Se detecta y procesa
    // ACÁ, antes de la firma de Meta (que no aplica a Telegram). El path de
    // WhatsApp queda intacto: sus requests NO traen update_id ni ese header.
    const tgSecretHeader = req.headers['x-telegram-bot-api-secret-token'];
    if (TELEGRAM_BOT_TOKEN && (body.update_id !== undefined || tgSecretHeader)) {
      // Fail-closed: el bot interno se autentica SOLO por este secret (la identidad
      // es chat.id, no un secreto). Si el secret falta o no coincide, se rechaza —
      // nunca se procesa un update spoofeable. setWebhook DEBE pasar secret_token.
      if (!TELEGRAM_WEBHOOK_SECRET || tgSecretHeader !== TELEGRAM_WEBHOOK_SECRET) {
        console.warn('[telegram] secret token ausente o inválido — request rechazado');
        return res.status(403).json({ error: 'forbidden' });
      }
      try { await handleTelegramUpdate(body); }
      catch (e) { console.error('handleTelegramUpdate error:', e.message); }
      return res.status(200).json({ ok: true });
    }

    // ── WhatsApp (Meta): firma sobre los bytes crudos + tipo de evento ────────
    if (META_APP_SECRET && raw) {
      if (!firmaMetaValida(req.headers['x-hub-signature-256'], raw, META_APP_SECRET)) {
        console.warn('[webhook] X-Hub-Signature-256 inválida — request rechazado');
        return res.status(403).json({ error: 'invalid signature' });
      }
    } else if (META_APP_SECRET && !raw) {
      console.warn('[webhook] no pude leer el body crudo — firma NO validada (revisar bodyParser)');
    }
    if (body?.object !== 'whatsapp_business_account') return res.status(200).json({ ok: true });

    const entry   = body.entry?.[0];
    const change  = entry?.changes?.[0];
    if (change?.field !== 'messages') return res.status(200).json({ ok: true });

    const value   = change.value;

    // Delivery status updates (sent/delivered/read/failed)
    const statusEntry = value?.statuses?.[0];
    if (statusEntry) {
      const { id: wamid, status, errors } = statusEntry;
      console.log(`STATUS wamid=${wamid} status=${status} errors=${JSON.stringify(errors)}`);
      if (wamid && ['sent', 'delivered', 'read', 'failed'].includes(status)) {
        try {
          const tokens = await loadSharedData('portal_tokens');
          if (tokens) {
            const key = Object.keys(tokens).find(k => tokens[k].wamid === wamid);
            if (key) {
              const errMsg = status === 'failed' ? (errors?.[0]?.message || 'No entregado') : null;
              tokens[key] = { ...tokens[key], waStatus: status, ...(errMsg ? { waError: errMsg } : {}) };
              await saveSharedData('portal_tokens', tokens);
            }
          }
        } catch (e) {
          console.error('status update error:', e.message);
        }
      }
      return res.status(200).json({ ok: true });
    }

    const message = value?.messages?.[0];
    if (!message) return res.status(200).json({ ok: true });

    const phone       = message.from;
    const messageType = message.type;

    let text    = '';
    let mediaId = null;
    let mimeType = null;
    // Contacto compartido por WhatsApp ("compartir contacto" → vCard). Cuando
    // viene, el primer contacto va para crear el prospecto: nombre + teléfono
    // son los del CONTACTO compartido, NO los del que escribe. null si no aplica.
    let contactoCompartido = null;

    if (messageType === 'text') {
      text = message.text?.body || '';
    } else if (messageType === 'image') {
      mediaId  = message.image?.id;
      mimeType = message.image?.mime_type || 'image/jpeg';
      text     = message.image?.caption || '';
    } else if (messageType === 'document') {
      mediaId  = message.document?.id;
      mimeType = message.document?.mime_type || 'application/pdf';
      // Preferimos el caption (lo que escribió el usuario al mandar el PDF) sobre
      // el nombre del archivo, que suele ser inútil ("Factura_001.pdf").
      text     = message.document?.caption || message.document?.filename || '';
    } else if (messageType === 'contacts') {
      // El usuario COMPARTIÓ un contacto (función "compartir contacto" de WA).
      // Llega message.contacts = [{ name: {...}, phones: [{ phone, wa_id }] }].
      // Lo interpretamos como un PRIMER CONTACTO de ESE contacto: extraemos su
      // nombre y teléfono y disparamos el intent crear_prospecto con esos datos.
      const c = Array.isArray(message.contacts) ? message.contacts[0] : null;
      const nombre = (
        c?.name?.formatted_name ||
        [c?.name?.first_name, c?.name?.last_name].filter(Boolean).join(' ')
      ).trim() || null;
      const phoneObj = Array.isArray(c?.phones) ? c.phones[0] : null;
      let telCompartido = phoneObj?.phone || phoneObj?.wa_id || null;
      if (telCompartido) {
        telCompartido = String(telCompartido).trim();
        // wa_id suele venir sin '+' (ej "5491122334455"); el campo phone suele
        // traer el '+'. Normalizamos a E.164 con '+' adelante para guardar bien.
        if (!telCompartido.startsWith('+')) telCompartido = '+' + telCompartido.replace(/[^\d]/g, '');
      }
      contactoCompartido = { nombre, telefono: telCompartido || null };
      // Disparamos el flujo de primer contacto. Si el contacto trae nombre lo
      // usamos para que Claude lo tome como clienteNombre; si no, igual marcamos
      // la intención y el handler usa el teléfono compartido.
      const captionContacto = (text || '').trim();
      // Construimos un texto que Claude routea a crear_prospecto. Le pasamos un
      // identificador del cliente (nombre, o el teléfono si no hay nombre) para
      // que NO repregunte "¿de quién es el contacto?" y emita el intent: el
      // handler luego pisa nombre/teléfono con los del contacto compartido.
      const idContacto = nombre || telCompartido || '';
      text = idContacto ? `primer contacto ${idContacto}` : 'primer contacto';
      if (captionContacto) text += `. ${captionContacto}`;
    } else if (messageType === 'interactive') {
      // Respuesta a botón o lista. El id que mandamos vuelve acá. Lo
      // tratamos como texto para que el resto del flujo lo procese igual:
      // - botones de confirmación usan ids 'confirmar'/'cancelar' → mapeamos
      //   a "sí"/"no" para reutilizar la lógica de confirmación existente.
      // - listas de selección usan ids con formato "pick:<valor>".
      const btn  = message.interactive?.button_reply;
      const lst  = message.interactive?.list_reply;
      const rawId = btn?.id || lst?.id || '';
      if (rawId === 'confirmar') text = 'sí';
      else if (rawId === 'cancelar') text = 'no';
      else if (rawId === 'editar') text = 'editar';
      else if (rawId.startsWith('pick:')) text = rawId.slice(5);
      else text = btn?.title || lst?.title || rawId;
    } else {
      return res.status(200).json({ ok: true });
    }

    console.log(`MSG phone=${phone} type=${messageType} id=${message.id} text=${text?.slice(0,30)}`);

    const conv = await loadConversation(phone);

    // ── DEDUPLICACIÓN ───────────────────────────────────────────────────────
    // Meta reintenta el webhook si no respondemos 200 a tiempo, lo que hace
    // que el mismo mensaje se procese (y conteste) 2 veces. Guardamos los
    // últimos message.id en defaults.lastMsgIds y descartamos repetidos.
    const msgId = message.id;
    const procesados = conv.defaults?.lastMsgIds || [];
    if (msgId && procesados.includes(msgId)) {
      console.log(`DEDUP: mensaje ${msgId} ya procesado, ignoro`);
      return res.status(200).json({ ok: true, dedup: true });
    }
    if (msgId) {
      const nuevosDefaults = { ...(conv.defaults || {}), lastMsgIds: [...procesados, msgId].slice(-25) };
      await saveConversation(phone, { defaults: nuevosDefaults });
      conv.defaults = nuevosDefaults;
    }

    // Serializar por teléfono cuando hay media (comprobantes): si llegan varios
    // casi simultáneos, evita que se pisen (antes duplicaba el gasto y guardaba
    // un solo archivo). Lock best-effort con TTL (ver acquireLock).
    const lockAdq = mediaId ? await acquireLock(phone) : false;
    try {
    const user = await getLinkedUser(phone);
    const cliente = !user ? await getLinkedCliente(phone) : null;
    console.log(`USER linked=${!!user} cliente=${!!cliente} state=${conv?.state}`);

    if (user) {
      // Usuario interno (Admin, Compras, Capataz, etc.)
      // Si llegó un contacto compartido, lo adjuntamos al user para que el
      // handler crear_prospecto use el teléfono/nombre del CONTACTO compartido
      // (no los del que escribe). Viaja con el spread { ...user } a ejecutarAccion.
      if (contactoCompartido) user.contactoCompartido = contactoCompartido;
      await handleMainFlow(phone, user, text, mediaId, mimeType, conv);
    } else if (cliente) {
      // Cliente vinculado al portal (read-only, comandos limitados)
      await handleClienteFlow(phone, cliente, text);
    } else {
      // Numero desconocido. Primero ver si esta haciendo onboarding desde el QR.
      const parsedQR = parseClientePrimerMensaje(text);
      if (parsedQR) {
        await onboardCliente(phone, parsedQR.nombreCliente, parsedQR.nombreObra);
      } else {
        // Detectar comandos tipicos de cliente. Si escribe "saldo", "avance",
        // "hola", etc. NO mandar al flujo de vinculacion de admin — ese flujo
        // pide nombre/email de empleado y confunde al cliente.
        const t = (text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
        const esComandoCliente = /^(hola|buen[ao]s|hi|hey|saludos|saldo|cuanto|deuda|avance|como\s+va|estado|proximo|cuota|portal|link|acceso|pago|ayuda|help|\?)/.test(t);
        if (esComandoCliente) {
          await sendWA(phone,
            `Hola 👋\n\nNo te tengo registrado todavia. Si sos cliente de Kamak Desarrollos, ` +
            `tu obra deberia haberte enviado un *codigo QR* en el presupuesto.\n\n` +
            `Escanealo y te vinculo automaticamente.\n\n` +
            `Si no tenes el QR a mano, contactanos al equipo de Kamak para que te lo envien.`
          );
        } else {
          // Caso restante: flujo de vinculacion de usuario interno (empleados).
          await handleLinkingFlow(phone, text, conv);
        }
      }
    }
    } finally {
      if (lockAdq) await releaseLock(phone);
    }

    console.log('DONE');
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ ok: true });
  }
}
