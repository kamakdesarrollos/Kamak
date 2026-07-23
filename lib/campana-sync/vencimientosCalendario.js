// Planificador PURO de eventos de Google Calendar para vencimientos próximos.
// Lo ejecuta runCalendario (api/whatsapp/jobs.js, dentro del cron diario
// ?job=reminders): acá vive TODA la lógica de reglas — qué cuota/cheque/factura/
// póliza/tarea merece un evento — sin red ni estado, para testearla con fixtures
// (ver vencimientosCalendario.test.js).
//
// Entrada: los mismos blobs de shared_data que runReminders ya carga (obras,
// detalles, cheques, proveedores, movimientos/cajas/dolarVenta para derivar
// cuotas impagas del libro único) + tareas + yaCreados (las claves cal:* ya
// marcadas en notif_cron_sent — objeto {clave: ts}, Set o array).
//
// Salida: [{ clave, titulo, descripcion, fechaISO }] — la clave sigue el formato
// `cal:<tipo>:<id...>:<fechaISO del vencimiento>` y se marca en notif_cron_sent
// tras crear el evento (misma idempotencia/prune que el resto del cron).
//
// VENTANA: hoy .. hoy+7 (inclusive) sobre la fecha del EVENTO. Pólizas: el
// evento va 2 días antes del vencimiento (clampeado a hoy si eso cae en el
// pasado — póliza vencida o a <2 días avisa hoy, una sola vez por la clave).

import { diasHasta } from '../../src/lib/vencimientos.js';
import { estadoFacturaPendiente, saldoFacturaPendiente } from '../../src/lib/facturasPendientes.js';
import { cuotaMontoUSD, cobradoObraUSD, repartirCobroEnCuotas } from '../../src/pages/obra/helpers.js';

const DIAS_VENTANA = 7;   // lookahead del cron: hoy .. hoy+7
const DIAS_AVISO_POLIZA = 2; // el evento de póliza va 2 días antes del vencimiento

const slice10 = (iso) => String(iso).slice(0, 10);
const fmtFecha = (iso) => slice10(iso).split('-').reverse().join('/');
const fmtUSD = (n) => `U$S ${Math.round(n || 0).toLocaleString('es-AR')}`;
const fmtARS = (n) => `$${Math.round(n || 0).toLocaleString('es-AR')}`;

// Suma días a un 'YYYY-MM-DD' en UTC (sin depender de la TZ del proceso).
function sumarDias(iso, n) {
  const d = new Date(`${slice10(iso)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const enVentana = (d) => d !== null && d >= 0 && d <= DIAS_VENTANA;

export function planEventosVencimientos({
  hoy,                 // 'YYYY-MM-DD' (fecha de la corrida)
  obras = [],
  detalles = {},
  cheques = [],
  proveedores = null,  // blob shared_data 'proveedores' (usa .facturasPendientes)
  tareas = [],
  movimientos = [],    // + cajas + dolarVenta: para derivar cuotas impagas
  cajas = [],
  dolarVenta = 1,
  yaCreados = {},      // claves cal:* ya marcadas en notif_cron_sent
} = {}) {
  const ya = yaCreados instanceof Set
    ? yaCreados
    : new Set(Array.isArray(yaCreados) ? yaCreados : Object.keys(yaCreados || {}));
  const eventos = [];

  // ── Cuotas IMPAGAS de obras confirmadas (activa/finalizada) ────────────────
  // "Impaga" se DERIVA del libro único (igual que runReminders): se reparte lo
  // cobrado de la obra sobre las cuotas en orden; cubierta al 100% = paga.
  for (const obra of obras) {
    if (obra.estado !== 'activa' && obra.estado !== 'finalizada') continue;
    const cuotas = detalles?.[obra.id]?.cuotas || [];
    if (!cuotas.length) continue;
    const obraMoneda = obra.moneda || 'ARS';
    const cobrado = cobradoObraUSD(movimientos, cajas, obra.id, dolarVenta);
    const reparto = repartirCobroEnCuotas(cuotas, cobrado, obraMoneda, dolarVenta);
    for (const c of cuotas) {
      const montoUSD = cuotaMontoUSD(c, obraMoneda, dolarVenta);
      if (montoUSD <= 0) continue;
      const cubierto = reparto[c.id] || 0;
      if (cubierto >= montoUSD) continue;             // paga (derivado): sin evento
      if (!c.fecha) continue;
      const fecha = slice10(c.fecha);
      if (!enVentana(diasHasta(fecha, hoy))) continue;
      const estado = cubierto > 0
        ? `parcial (cubierto ${fmtUSD(cubierto)} de ${fmtUSD(montoUSD)})`
        : 'impaga';
      eventos.push({
        clave: `cal:cuota:${obra.id}:${c.id}:${fecha}`,
        titulo: `💰 Cobrar cuota ${c.n ?? '—'} — ${obra.nombre} — ${fmtUSD(montoUSD)}`,
        descripcion: [
          `Cliente: ${obra.cliente || '—'}`,
          `Estado: ${estado}`,
          c.descripcion ? `Cuota: ${c.descripcion}` : null,
          `Vence ${fmtFecha(fecha)}`,
        ].filter(Boolean).join(' · '),
        fechaISO: fecha,
      });
    }
  }

  // ── Cheques EN CARTERA por vencer ──────────────────────────────────────────
  for (const ch of (cheques || [])) {
    if (!ch || ch.estado !== 'cartera' || !ch.fechaVencimiento) continue;
    const fecha = slice10(ch.fechaVencimiento);
    if (!enVentana(diasHasta(fecha, hoy))) continue;
    const titular = ch.titular || ch.clienteNombre || ch.proveedorNombre || '';
    eventos.push({
      clave: `cal:cheque:${ch.id}:${fecha}`,
      titulo: `🏦 Depositar cheque ${ch.banco || '—'} #${ch.numero || '—'} — ${fmtARS(ch.monto)}`,
      descripcion: [
        titular ? `Titular: ${titular}` : null,
        ch.obraNombre ? `Obra: ${ch.obraNombre}` : null,
        `Vence ${fmtFecha(fecha)}`,
      ].filter(Boolean).join(' · '),
      fechaISO: fecha,
    });
  }

  // ── Facturas de proveedor ABIERTAS (pendiente/parcial) con vencimiento ─────
  for (const f of (proveedores?.facturasPendientes || [])) {
    if (!f || !f.fechaVencimiento) continue;           // fechaVencimiento es opcional
    const estado = estadoFacturaPendiente(f);
    if (estado !== 'pendiente' && estado !== 'parcial') continue;
    const fecha = slice10(f.fechaVencimiento);
    if (!enVentana(diasHasta(fecha, hoy))) continue;
    eventos.push({
      clave: `cal:factura:${f.id}:${fecha}`,
      titulo: `📄 Vence factura ${f.proveedor || 'Proveedor'} — ${fmtARS(f.monto)}`,
      descripcion: [
        f.numero ? `N° ${f.numero}` : null,
        estado === 'parcial' ? `pago parcial · saldo ${fmtARS(saldoFacturaPendiente(f))}` : null,
        `Vence ${fmtFecha(fecha)}`,
      ].filter(Boolean).join(' · '),
      fechaISO: fecha,
    });
  }

  // ── Pólizas de obras ACTIVAS ───────────────────────────────────────────────
  // Evento 2 días ANTES del vencimiento, creado cuando esa fecha cae en la
  // ventana hoy..hoy+7. Borde: vencida o a <2 días → el evento cae HOY (no en
  // el pasado); la clave (por vencimiento real) evita repetirlo.
  const planPoliza = ({ obra, id, quien, vence, extra }) => {
    const fechaVto = slice10(vence);
    const d = diasHasta(fechaVto, hoy);
    if (d === null) return;
    const fechaEvento = d >= DIAS_AVISO_POLIZA ? sumarDias(fechaVto, -DIAS_AVISO_POLIZA) : hoy;
    if (!enVentana(diasHasta(fechaEvento, hoy))) return;
    eventos.push({
      clave: `cal:poliza:${obra.id}:${id}:${fechaVto}`,
      titulo: `🛡️ Renovar póliza ${quien} — ${obra.nombre}`,
      descripcion: [
        extra,
        d < 0 ? `Póliza VENCIDA el ${fmtFecha(fechaVto)}` : `La póliza vence el ${fmtFecha(fechaVto)}`,
      ].filter(Boolean).join(' · '),
      fechaISO: fechaEvento,
    });
  };
  for (const obra of obras) {
    if (obra.estado !== 'activa') continue;            // pólizas: solo obra ACTIVA
    const det = detalles?.[obra.id] || {};
    const contratos = det.contratos || [];
    // (a) Póliza por contratista: detalle.segurosPorContrato[contratoId].polizaVence
    for (const [contratoId, seg] of Object.entries(det.segurosPorContrato || {})) {
      if (!seg?.polizaVence) continue;
      const contratista = contratos.find((c) => c.id === contratoId)?.proveedor || 'contratista';
      planPoliza({ obra, id: contratoId, quien: contratista, vence: seg.polizaVence, extra: null });
    }
    // (b) Nómina manual: detalle.nominaSeguros[].vencimiento
    for (const s of (det.nominaSeguros || [])) {
      if (!s?.vencimiento) continue;
      planPoliza({
        obra,
        id: s.id || s.nombre || 'nomina',
        quien: s.nombre || 'asegurado',
        vence: s.vencimiento,
        extra: [s.aseguradora, s.poliza ? `póliza ${s.poliza}` : null].filter(Boolean).join(' · ') || null,
      });
    }
  }

  // ── Tareas con fecha límite en la ventana ──────────────────────────────────
  // Solo tareas de PERSONAS: creadas a mano en la app (origen 'manual', el
  // default de TareasContext.addTarea) o por el bot (nueva_tarea en
  // api/whatsapp/webhook.js NO setea origen → undefined). Las autogeneradas al
  // aprobar presupuesto llevan origen 'auto-tipo'/'auto-rubro'/'auto-apu'
  // (generarTareasObra.js) → fuera, serían decenas de eventos por obra.
  // También fuera: sin asignado, completadas y canceladas.
  for (const t of (tareas || [])) {
    if (!t || !t.fechaLimite) continue;
    if (!Array.isArray(t.asignadoA) || t.asignadoA.length === 0) continue;
    if (/^auto/.test(String(t.origen || ''))) continue;
    if (t.estado === 'completada' || t.estado === 'cancelada') continue;
    const fecha = slice10(t.fechaLimite);
    if (!enVentana(diasHasta(fecha, hoy))) continue;
    const obraNombre = t.obraId ? (obras.find((o) => o.id === t.obraId)?.nombre || null) : null;
    eventos.push({
      clave: `cal:tarea:${t.id}:${fecha}`,
      titulo: `☑ ${t.titulo || 'Tarea'}`,
      descripcion: [
        `Asignada a: ${t.asignadoA.join(', ')}`,
        obraNombre ? `Obra: ${obraNombre}` : null,
        `Límite ${fmtFecha(fecha)}`,
      ].filter(Boolean).join(' · '),
      fechaISO: fecha,
    });
  }

  return eventos.filter((e) => !ya.has(e.clave));
}
