import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageLayout from '../components/layout/PageLayout';
import { Box, Btn } from '../components/ui';
import PageHero from '../components/ui/PageHero';
import { T } from '../theme';
import { useUsuarios } from '../store/UsuariosContext';
import { useObras } from '../store/ObrasContext';
import { useMovimientos } from '../store/MovimientosContext';
import { useProveedores } from '../store/ProveedoresContext';
import { useDolar } from '../store/DolarContext';
import { useSolicitudes } from '../store/SolicitudesContext';
import { useWhatsappPending } from '../store/WhatsappPendingContext';
import AprobarFacturaModal from './modales/AprobarFacturaModal';

// Hub unificado de aprobaciones admin:
// - Solicitudes de eliminacion (creadas por no-admins en /movimientos)
// - Facturas de WhatsApp (bot detecto fotos/PDFs)
// - Movimientos de WhatsApp (bot interpreto texto)
//
// Layout:
// - Tabs por estado (Pendientes / Aprobadas / Rechazadas)
// - Dentro de cada tab, 3 secciones colapsables por origen.
//
// Query params:
// - ?origen=eliminacion|whatsapp -> filtra que secciones se muestran
// - ?tab=aprobadas|rechazadas -> abre directamente ese tab

const fmtN = (n) => n != null ? Math.round(n).toLocaleString('es-AR') : '—';
const fmtFecha = (iso) => { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
const fmtDatetime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' +
    d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
};

const newPagoId = () => `pago-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;
const newAdicId = () => `adic-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;

const cuotaMontoFn   = (c, moneda, tc) => (c._usd || moneda !== 'USD') ? (c.monto||0) : Math.round((c.monto||0)/tc);
const cuotaCobradoFn = (c, moneda, tc) =>
  (c.pagos||[]).reduce((s,p) =>
    moneda==='USD'
      ? s+(p.moneda==='ARS' ? Math.round((p.monto||0)/(p.tc||tc)) : (p.monto||0))
      : s+(p.moneda==='USD' ? Math.round((p.monto||0)*(p.tc||tc)) : (p.monto||0))
  , 0);
const cuotaEstado = (c, moneda, tc) => {
  const cob = cuotaCobradoFn(c, moneda, tc);
  if (cob<=0) return 'pendiente';
  if (cob>=cuotaMontoFn(c, moneda, tc)) return 'pagado';
  return 'parcial';
};

// ── Cards/filas por tipo ──────────────────────────────────────────────────────

function SolicitudRow({ sol, isPendiente, onAprobar, onRechazar }) {
  const mov = sol.movimiento || {};
  return (
    <div style={{ display: 'flex', alignItems: 'center', borderBottom: `1px solid ${T.faint2}`, padding: '10px 14px', gap: 8, background: isPendiente ? '#fff7ed' : 'transparent' }}>
      <div style={{ flex: 3, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mov.descripcion || '—'}</div>
        <div style={{ fontSize: 10, color: T.ink3, fontFamily: T.fontMono, marginTop: 2 }}>
          {mov.tipo} · ${fmtN(mov.monto)} · {mov.fecha}
          {mov.obraNombre && mov.obraNombre !== 'General' && ` · ${mov.obraNombre}`}
        </div>
      </div>
      <div style={{ flex: 2, fontSize: 12, color: T.ink2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={sol.motivo}>
        {sol.motivo}
      </div>
      <div style={{ flex: 1.2, fontSize: 11, color: T.ink2 }}>{sol.solicitadoPor?.nombre || '—'}</div>
      <div style={{ flex: 1, fontSize: 10, color: T.ink3, fontFamily: T.fontMono }}>{fmtDatetime(sol.creadoAt)}</div>
      <div style={{ width: 140, flexShrink: 0, display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        {isPendiente ? (
          <>
            <button onClick={onAprobar}
              style={{ padding: '4px 10px', background: '#059669', color: '#fff', border: 'none', borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              ✓ Aprobar
            </button>
            <button onClick={onRechazar}
              style={{ padding: '4px 10px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              ✕ Rechazar
            </button>
          </>
        ) : (
          <span style={{ fontSize: 10, color: T.ink3 }}>Resuelto por {sol.resolvedBy}</span>
        )}
      </div>
    </div>
  );
}

function FacturaCard({ item, isPendiente, onReview, onReject }) {
  return (
    <Box style={{ padding: '12px 16px', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      {item.mediaUrl && item.mediaType !== 'pdf' ? (
        <a href={item.mediaUrl} target="_blank" rel="noreferrer" style={{ flexShrink: 0 }}>
          <img src={item.mediaUrl} alt="factura" style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 6, border: `1.5px solid ${T.faint2}`, display: 'block' }} />
        </a>
      ) : (
        <a href={item.mediaUrl || undefined} target="_blank" rel="noreferrer"
          style={{ width: 60, height: 60, borderRadius: 6, background: '#e8f4f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0, textDecoration: 'none' }}>
          {item.mediaUrl ? '📄' : (item.mediaType === 'image' ? '🖼' : '📄')}
        </a>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{item.proveedor || 'Proveedor no detectado'}</div>
            {item.cuit && <div style={{ fontSize: 10, color: T.ink3 }}>CUIT {item.cuit}</div>}
          </div>
          {item.montoTotal != null && (
            <div style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 15, color: T.warn, flexShrink: 0 }}>
              $ {fmtN(item.montoTotal)}
            </div>
          )}
        </div>

        <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11, color: T.ink2 }}>
          {item.tipoFactura   && <span style={{ background: T.faint2, borderRadius: 3, padding: '1px 6px', fontWeight: 700 }}>Factura {item.tipoFactura}</span>}
          {item.numeroFactura && <span>{item.numeroFactura}</span>}
          {item.fecha         && <span>{fmtFecha(item.fecha)}</span>}
          {item.concepto      && <span style={{ color: T.ink3 }}>{item.concepto}</span>}
        </div>

        <div style={{ marginTop: 4, fontSize: 10, color: T.ink3 }}>
          Recibido de +{item.from} · {item.receivedAt && new Date(item.receivedAt).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
          {item.resolvedAt && <> · resuelto {fmtDatetime(item.resolvedAt)}</>}
        </div>
      </div>

      {isPendiente && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flexShrink: 0 }}>
          <Btn sm fill onClick={onReview} style={{ background: '#25803a', fontSize: 11 }}>📝 Revisar y aprobar</Btn>
          <Btn sm onClick={onReject} style={{ fontSize: 11, color: T.ink3 }}>✕ Rechazar</Btn>
        </div>
      )}
      {!isPendiente && (
        <div style={{ flexShrink: 0, padding: '4px 8px', borderRadius: 3, fontSize: 10, fontWeight: 700,
          background: item.status === 'confirmed' ? '#d1fae5' : '#fee2e2',
          color:      item.status === 'confirmed' ? '#059669' : '#dc2626' }}>
          {item.status === 'confirmed' ? '✓ Aprobada' : '✕ Rechazada'}
        </div>
      )}
    </Box>
  );
}

function MovimientoCard({ item, isPendiente, navigate, proveedores, obras, getDetalle, dolarVenta, onApprove, onReject }) {
  const m = item.movimiento || {};
  const esGasto = m.tipo === 'gasto';
  const [esAdicional, setEsAdicional] = useState(false);
  const [cuotaId, setCuotaId] = useState('');

  const tc = dolarVenta || 1070;
  const obraObj    = obras.find(o => o.id === m.obraId);
  const obraMoneda = obraObj?.moneda || 'ARS';
  const cuotas     = !esGasto && m.obraId ? (getDetalle(m.obraId)?.cuotas || []) : [];
  const cuotasPend = cuotas.filter(c => cuotaEstado(c, obraMoneda, tc) !== 'pagado');
  const totalCuotas    = cuotas.reduce((s, c) => s + cuotaMontoFn(c, obraMoneda, tc), 0);
  const totalCobrado   = cuotas.reduce((s, c) => s + cuotaCobradoFn(c, obraMoneda, tc), 0);
  const saldoPendiente = Math.max(0, totalCuotas - totalCobrado);
  const fmtC = n => obraMoneda === 'USD' ? `U$S ${fmtN(n)}` : `$ ${fmtN(n)}`;

  const inputStLocal = { padding: '6px 10px', border: `1.2px solid ${T.faint2}`, borderRadius: 4, fontFamily: T.font, fontSize: 12, background: T.paper, boxSizing: 'border-box', outline: 'none', width: '100%' };

  return (
    <Box style={{ padding: '12px 16px', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      <div style={{ width: 36, height: 36, borderRadius: 6, background: esGasto ? '#fff0e8' : '#e8f4f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
        {esGasto ? '💸' : '💰'}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{m.descripcion || '—'}</div>
            <div style={{ fontSize: 11, color: T.ink2, marginTop: 2 }}>
              {item.creadoPor} · {m.obraId
                ? <span style={{ color: T.accent, cursor: 'pointer', textDecoration: 'underline' }} onClick={() => navigate(`/obras/${m.obraId}/presupuesto`)}>{m.obraNombre || 'General'}</span>
                : (m.obraNombre || 'General')}
            </div>
          </div>
          <div style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 15, color: esGasto ? T.warn : T.ok, flexShrink: 0 }}>
            {esGasto ? '−' : '+'}$ {fmtN(m.monto)}
          </div>
        </div>

        <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11, color: T.ink2 }}>
          <span style={{ background: esGasto ? '#fff0e8' : '#e8f4f0', borderRadius: 3, padding: '1px 6px', fontWeight: 700, color: esGasto ? T.warn : T.ok, textTransform: 'capitalize' }}>
            {m.tipo}
          </span>
          {m.categoria && <span>{m.categoria}</span>}
          {m.proveedor && (() => {
            const prov = proveedores.find(p => p.nombre === m.proveedor);
            return prov
              ? <span style={{ color: T.accent, cursor: 'pointer', textDecoration: 'underline' }} onClick={() => navigate(`/proveedores/${prov.id}`)}>{m.proveedor}</span>
              : <span>{m.proveedor}</span>;
          })()}
          {m.fecha     && <span>{fmtFecha(m.fecha)}</span>}
          <span style={{ padding: '1px 6px', borderRadius: 3, background: m.comprobante === 'blanco' ? '#e8f4f0' : '#f5f0e0', color: m.comprobante === 'blanco' ? T.ok : T.ink3, fontWeight: 600 }}>
            {m.comprobante === 'blanco' ? '✓ Con factura' : 'Sin factura'}
          </span>
        </div>

        <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: T.ink3 }}>
          <span>Enviado desde WhatsApp · {item.receivedAt && new Date(item.receivedAt).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
          {m.comprobanteUrl && (
            <a href={m.comprobanteUrl} target="_blank" rel="noreferrer"
              style={{ color: '#25803a', fontWeight: 700, textDecoration: 'none', background: '#e8f4f0', borderRadius: 3, padding: '1px 6px' }}>
              {(() => { try { return new URL(m.comprobanteUrl).pathname.endsWith('.pdf') ? '📄 Ver PDF' : '🖼 Ver foto'; } catch { return '📎 Ver archivo'; } })()}
            </a>
          )}
          {item.resolvedAt && <span>· resuelto {fmtDatetime(item.resolvedAt)}</span>}
        </div>

        {/* Estado de cobros de la obra (solo ingresos con obra) */}
        {isPendiente && !esGasto && m.obraId && cuotas.length > 0 && (
          <div style={{ marginTop: 8, padding: '8px 10px', background: '#e8f4f0', borderRadius: 5, fontSize: 11 }}>
            <div style={{ fontWeight: 700, color: T.ok, marginBottom: 4 }}>Estado cobros de la obra</div>
            <div style={{ display: 'flex', gap: 16 }}>
              <span>Cobrado: <b style={{ fontFamily: 'monospace' }}>{fmtC(totalCobrado)}</b></span>
              <span>Pendiente: <b style={{ fontFamily: 'monospace', color: saldoPendiente > 0 ? T.warn : T.ok }}>{fmtC(saldoPendiente)}</b></span>
              <span style={{ color: T.ink3 }}>de {fmtC(totalCuotas)} total</span>
            </div>
            {cuotasPend.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <label style={{ fontSize: 10, color: T.ink3, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Vincular a cuota</label>
                <select value={cuotaId} onChange={e => setCuotaId(e.target.value)}
                  style={{ ...inputStLocal, marginTop: 3, fontSize: 11 }}>
                  <option value="">— Sin vincular —</option>
                  {cuotasPend.map(c => {
                    const montoC  = cuotaMontoFn(c, obraMoneda, tc);
                    const cobC    = cuotaCobradoFn(c, obraMoneda, tc);
                    const est     = cuotaEstado(c, obraMoneda, tc);
                    return (
                      <option key={c.id} value={c.id}>
                        {`${c.n ? `#${c.n} · ` : ''}${c.descripcion} · ${est === 'parcial' ? `saldo ${fmtC(montoC-cobC)}` : fmtC(montoC)}`}
                      </option>
                    );
                  })}
                </select>
              </div>
            )}
          </div>
        )}
      </div>

      {isPendiente && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flexShrink: 0 }}>
          <Btn sm fill onClick={() => onApprove(esAdicional, cuotaId)} style={{ background: '#25803a', fontSize: 11 }}>✓ Aprobar</Btn>
          <Btn sm onClick={onReject} style={{ fontSize: 11, color: T.ink3 }}>✕ Rechazar</Btn>
          {esGasto && m.obraId && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, cursor: 'pointer', color: T.ink2, userSelect: 'none' }}>
              <input type="checkbox" checked={esAdicional} onChange={e => setEsAdicional(e.target.checked)} />
              + Adicional
            </label>
          )}
        </div>
      )}
      {!isPendiente && (
        <div style={{ flexShrink: 0, padding: '4px 8px', borderRadius: 3, fontSize: 10, fontWeight: 700,
          background: item.status === 'confirmed' ? '#d1fae5' : '#fee2e2',
          color:      item.status === 'confirmed' ? '#059669' : '#dc2626' }}>
          {item.status === 'confirmed' ? '✓ Aprobado' : '✕ Rechazado'}
        </div>
      )}
    </Box>
  );
}

// ── Pagina principal ──────────────────────────────────────────────────────────

export default function Autorizaciones() {
  const { currentUser } = useUsuarios();
  const navigate = useNavigate();
  const isAdmin = currentUser?.rol === 'Admin';
  // Guard: solo Admin.
  useEffect(() => {
    if (currentUser && !isAdmin) navigate('/', { replace: true });
  }, [currentUser, isAdmin, navigate]);

  const [searchParams, setSearchParams] = useSearchParams();
  const origenParam = searchParams.get('origen'); // 'eliminacion' | 'whatsapp' | null
  const tabParam    = searchParams.get('tab');    // 'aprobadas' | 'rechazadas' | null

  const { obras, patchDetalle, getDetalle } = useObras();
  const { addMovimiento, removeMovimiento, cajas } = useMovimientos();
  const { proveedores } = useProveedores();
  const { dolarVenta } = useDolar();
  const { solicitudes, resolveSolicitud } = useSolicitudes();
  const { pending, reload, rejectItem, confirmItem } = useWhatsappPending();

  const initialTab = tabParam === 'aprobadas' ? 'aprobadas'
    : tabParam === 'rechazadas' ? 'rechazadas'
    : 'pendientes';
  const [tab, setTab] = useState(initialTab);

  const [collapsed, setCollapsed] = useState({ eliminacion: false, facturas: false, movimientos: false });
  const toggleSection = (k) => setCollapsed(s => ({ ...s, [k]: !s[k] }));

  const [reviewFactura, setReviewFactura] = useState(null);

  // Bucketizar items por estado
  const buckets = useMemo(() => {
    const solP = solicitudes.filter(s => s.estado === 'pendiente');
    const solA = solicitudes.filter(s => s.estado === 'aprobada');
    const solR = solicitudes.filter(s => s.estado === 'rechazada');

    const facturasAll    = pending.filter(p => p.tipoPendiente !== 'movimiento');
    const movimientosAll = pending.filter(p => p.tipoPendiente === 'movimiento');

    const isPending  = (p) => !p.status || (p.status !== 'confirmed' && p.status !== 'rejected');
    const isApproved = (p) => p.status === 'confirmed';
    const isRejected = (p) => p.status === 'rejected';

    return {
      pendientes:  { eliminacion: solP, facturas: facturasAll.filter(isPending),  movimientos: movimientosAll.filter(isPending) },
      aprobadas:   { eliminacion: solA, facturas: facturasAll.filter(isApproved), movimientos: movimientosAll.filter(isApproved) },
      rechazadas:  { eliminacion: solR, facturas: facturasAll.filter(isRejected), movimientos: movimientosAll.filter(isRejected) },
    };
  }, [solicitudes, pending]);

  const current = buckets[tab];

  // Counts para los tabs
  const countPendientes = buckets.pendientes.eliminacion.length + buckets.pendientes.facturas.length + buckets.pendientes.movimientos.length;
  const countAprobadas  = buckets.aprobadas.eliminacion.length  + buckets.aprobadas.facturas.length  + buckets.aprobadas.movimientos.length;
  const countRechazadas = buckets.rechazadas.eliminacion.length + buckets.rechazadas.facturas.length + buckets.rechazadas.movimientos.length;

  // Visibilidad de secciones segun origen filter
  const showEliminacion = origenParam !== 'whatsapp';
  const showFacturas    = origenParam !== 'eliminacion';
  const showMovimientos = origenParam !== 'eliminacion';

  // ── Handlers ──

  const handleAprobarSol = (sol) => {
    removeMovimiento(sol.movimientoId);
    resolveSolicitud(sol.id, 'aprobada', currentUser?.nombre || 'Admin');
  };
  const handleRechazarSol = (sol) => {
    resolveSolicitud(sol.id, 'rechazada', currentUser?.nombre || 'Admin');
  };

  const handleRechazarFactura = (id) => {
    if (window.confirm('¿Rechazás esta factura? No se guardará como gasto.')) rejectItem(id);
  };

  const resolveCaja = (item, m) => {
    if (m.cajaId) return m.cajaId;
    const sender  = (item.creadoPor || '').toLowerCase().trim();
    const moneda  = m.moneda || 'ARS';
    const activas = cajas.filter(c => c.activa);
    if (m.tipo === 'ingreso') {
      const exact   = activas.find(c => (c.propietario || '').toLowerCase() === sender && c.moneda === moneda);
      if (exact) return exact.id;
      const partial = activas.find(c => (c.propietario || '').toLowerCase().includes(sender) && c.moneda === moneda);
      return partial?.id || activas.find(c => c.moneda === moneda)?.id || null;
    } else {
      if (m.cajaTipo === 'personal') {
        const exact   = activas.find(c => (c.propietario || '').toLowerCase() === sender && c.moneda === moneda);
        if (exact) return exact.id;
        return activas.find(c => (c.propietario || '').toLowerCase().includes(sender) && c.moneda === moneda)?.id || null;
      }
      if (m.cajaTipo === 'banco') {
        return activas.find(c => c.tipo === 'banco' && c.moneda === moneda)?.id || null;
      }
      return null;
    }
  };

  const handleAprobarMovimiento = (item, esAdicional, cuotaId) => {
    const m = item.movimiento;
    if (!m) return;
    const cajaResuelta = resolveCaja(item, m);
    const movId = addMovimiento({
      tipo:           m.tipo,
      descripcion:    m.descripcion,
      monto:          m.monto,
      fecha:          m.fecha,
      obraId:         m.obraId || null,
      obraNombre:     m.obraNombre || 'General',
      cajaId:         cajaResuelta,
      cajaDestinoId:  null,
      proveedor:      m.proveedor || '',
      categoria:      m.categoria || 'general',
      medioPago:      m.medioPago || 'Transferencia',
      comprobante:    m.comprobante || 'negro',
      comprobanteUrl: m.comprobanteUrl || null,
      fondoReparo:    false,
      cuotaId:        cuotaId || null,
    });

    // Aplicar pago a cuota si fue vinculado
    if (m.tipo === 'ingreso' && cuotaId && m.obraId) {
      const tc = dolarVenta || 1070;
      const obraMoneda = obras.find(o => o.id === m.obraId)?.moneda || 'ARS';
      const cobradoPor = currentUser?.nombre || currentUser?.email || '';
      patchDetalle(m.obraId, d => {
        const cuotas = [...(d.cuotas || [])];
        let remaining = m.monto;
        let idx = cuotas.findIndex(c => c.id === cuotaId);
        while (remaining > 0 && idx < cuotas.length) {
          const c = cuotas[idx];
          const montoC  = cuotaMontoFn(c, obraMoneda, tc);
          const cobC    = cuotaCobradoFn(c, obraMoneda, tc);
          const saldoC  = montoC - cobC;
          if (saldoC <= 0) { idx++; continue; }
          const toApply = Math.min(remaining, saldoC);
          cuotas[idx] = {
            ...c,
            pagos: [...(c.pagos||[]), {
              id: newPagoId(),
              movimientoId: movId || null,
              monto: toApply,
              moneda: 'ARS',
              tc,
              fecha: m.fecha,
              cobradoPor,
              fotoUrl: m.comprobanteUrl || null,
            }],
          };
          remaining -= toApply;
          idx++;
        }
        return { ...d, cuotas };
      });
    }
    if (esAdicional && m.obraId) {
      patchDetalle(m.obraId, d => ({
        ...d,
        adicionales: [...(d.adicionales || []), {
          id: newAdicId(),
          descripcion: m.descripcion,
          tarea: '', cantidad: null, unidad: '',
          costoUnit: null, costoTotal: m.monto,
          valorVentaUnit: null, valorVentaTotal: null,
          montoProveedor: m.monto, cantidadProveedor: null, costoUnitProveedor: null,
          aplicadoAContrato: false,
          monto: m.monto, fecha: m.fecha, estado: 'pendiente',
          aplicaACliente: true, aplicaAProveedor: false,
        }],
      }));
    }
    confirmItem(item.id);
  };

  const handleRechazarMovimiento = (id) => {
    if (window.confirm('¿Rechazás este movimiento? No se guardará.')) rejectItem(id);
  };

  // ── Render ──

  const isPendienteTab = tab === 'pendientes';

  // Helper para el header de secciones
  const SectionHeader = ({ titulo, count, sectionKey }) => (
    <div onClick={() => toggleSection(sectionKey)}
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 4px', cursor: 'pointer', userSelect: 'none', borderBottom: `1px solid ${T.faint2}`, marginBottom: 10 }}>
      <span style={{ fontSize: 11, color: T.ink3 }}>{collapsed[sectionKey] ? '▶' : '▼'}</span>
      <span style={{ fontWeight: 800, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5 }}>{titulo}</span>
      <span style={{ background: T.faint, borderRadius: 10, padding: '1px 8px', fontSize: 11, fontWeight: 700, color: T.ink2 }}>{count}</span>
    </div>
  );

  return (
    <PageLayout breadcrumb={['Autorizaciones']} active="Autorizaciones">
      <PageHero
        label="APROBACIONES"
        title="Autorizaciones"
        subtitle="Eliminaciones de movimientos + items recibidos por WhatsApp"
        actions={<Btn sm onClick={reload}>↺ Actualizar</Btn>}
        kpis={[
          { label: 'Pendientes',  value: countPendientes,                                                       sub: 'requieren acción', color: countPendientes > 0 ? T.warn : T.ink },
          { label: 'WhatsApp',    value: buckets.pendientes.facturas.length + buckets.pendientes.movimientos.length, sub: 'del bot',          color: T.accent },
          { label: 'Aprobadas',   value: countAprobadas,                                                        sub: 'historial',        color: T.ok },
          { label: 'Rechazadas',  value: countRechazadas,                                                       sub: 'historial',        color: T.ink3 },
        ]}
      />

      {/* Tabs por estado */}
      <div className="k-tabs" style={{ margin: '8px 0 10px' }}>
        <span className={`k-tab${tab === 'pendientes' ? ' k-tab-on' : ''}`}
          onClick={() => { setTab('pendientes'); setSearchParams(p => { p.delete('tab'); return p; }); }}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          Pendientes
          {countPendientes > 0 && (
            <span style={{ background: '#c0392b', color: '#fff', borderRadius: 10, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>
              {countPendientes}
            </span>
          )}
        </span>
        <span className={`k-tab${tab === 'aprobadas' ? ' k-tab-on' : ''}`}
          onClick={() => { setTab('aprobadas'); setSearchParams(p => { p.set('tab', 'aprobadas'); return p; }); }}>
          Aprobadas · {countAprobadas}
        </span>
        <span className={`k-tab${tab === 'rechazadas' ? ' k-tab-on' : ''}`}
          onClick={() => { setTab('rechazadas'); setSearchParams(p => { p.set('tab', 'rechazadas'); return p; }); }}>
          Rechazadas · {countRechazadas}
        </span>
      </div>

      {/* Filtro origen (si esta aplicado por query) */}
      {origenParam && (
        <div style={{ marginBottom: 12, padding: '6px 10px', background: T.accentSoft, borderRadius: 4, fontSize: 11, color: T.accent, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>Filtro activo: solo <b>{origenParam === 'whatsapp' ? 'WhatsApp' : 'Eliminaciones'}</b></span>
          <span style={{ cursor: 'pointer', textDecoration: 'underline' }}
            onClick={() => setSearchParams(p => { p.delete('origen'); return p; })}>
            quitar filtro
          </span>
        </div>
      )}

      {/* Contenido */}
      <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 280px)' }}>

        {/* Solicitudes de eliminacion */}
        {showEliminacion && (
          <div style={{ marginBottom: 18 }}>
            <SectionHeader titulo="Solicitudes de eliminación" count={current.eliminacion.length} sectionKey="eliminacion" />
            {!collapsed.eliminacion && (
              current.eliminacion.length === 0
                ? <div style={{ padding: 24, textAlign: 'center', color: T.ink3, fontSize: 12 }}>Sin items</div>
                : current.eliminacion.map(sol => (
                  <SolicitudRow
                    key={sol.id}
                    sol={sol}
                    isPendiente={isPendienteTab}
                    onAprobar={() => handleAprobarSol(sol)}
                    onRechazar={() => handleRechazarSol(sol)}
                  />
                ))
            )}
          </div>
        )}

        {/* Facturas WhatsApp */}
        {showFacturas && (
          <div style={{ marginBottom: 18 }}>
            <SectionHeader titulo="Facturas de WhatsApp" count={current.facturas.length} sectionKey="facturas" />
            {!collapsed.facturas && (
              current.facturas.length === 0
                ? <div style={{ padding: 24, textAlign: 'center', color: T.ink3, fontSize: 12 }}>Sin items</div>
                : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {current.facturas.map(item => (
                      <FacturaCard
                        key={item.id}
                        item={item}
                        isPendiente={isPendienteTab}
                        onReview={() => setReviewFactura(item)}
                        onReject={() => handleRechazarFactura(item.id)}
                      />
                    ))}
                  </div>
                )
            )}
          </div>
        )}

        {/* Movimientos WhatsApp */}
        {showMovimientos && (
          <div style={{ marginBottom: 18 }}>
            <SectionHeader titulo="Movimientos de WhatsApp" count={current.movimientos.length} sectionKey="movimientos" />
            {!collapsed.movimientos && (
              current.movimientos.length === 0
                ? <div style={{ padding: 24, textAlign: 'center', color: T.ink3, fontSize: 12 }}>Sin items</div>
                : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {current.movimientos.map(item => (
                      <MovimientoCard
                        key={item.id}
                        item={item}
                        isPendiente={isPendienteTab}
                        navigate={navigate}
                        proveedores={proveedores}
                        obras={obras}
                        getDetalle={getDetalle}
                        dolarVenta={dolarVenta}
                        onApprove={(esAdic, cuotaId) => handleAprobarMovimiento(item, esAdic, cuotaId)}
                        onReject={() => handleRechazarMovimiento(item.id)}
                      />
                    ))}
                  </div>
                )
            )}
          </div>
        )}

        {/* Mensaje si no hay nada */}
        {countPendientes === 0 && tab === 'pendientes' && (
          <div style={{ padding: 48, textAlign: 'center', color: T.ink3, fontSize: 13 }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>✓</div>
            Sin aprobaciones pendientes
          </div>
        )}
      </div>

      {/* Modal de revision de factura */}
      {reviewFactura && (
        <AprobarFacturaModal
          item={reviewFactura}
          onConfirm={() => { confirmItem(reviewFactura.id); setReviewFactura(null); }}
          onClose={() => setReviewFactura(null)}
        />
      )}
    </PageLayout>
  );
}
