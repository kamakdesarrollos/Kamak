import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Logo, Stripes } from '../ui';
import { T } from '../../theme';
import { useDolar } from '../../store/DolarContext';
import { useAuth } from '../../store/AuthContext';
import { useUsuarios } from '../../store/UsuariosContext';
import { useAlertas } from '../../store/AlertasContext';
import { useWhatsappPending } from '../../store/WhatsappPendingContext';
import { useSolicitudes } from '../../store/SolicitudesContext';
import { useCheques } from '../../store/ChequesContext';
import { useTareas } from '../../store/TareasContext';
import { useObras } from '../../store/ObrasContext';
import { cuotaMontoUSD, cobradoObraUSD, repartirCobroEnCuotas, cuotaEstadoDesdeCobrado } from '../../pages/obra/helpers';
import { useMovimientos } from '../../store/MovimientosContext';
import { useNotificaciones } from '../../store/NotificacionesContext';
import { activarPush, desactivarPush, pushActivo, pushSoportado } from '../../lib/push';
import GlobalSearch from '../GlobalSearch';

const fmtN = (n) => Math.round(n).toLocaleString('es-AR');
const fmtFecha = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

function NotifPanel({ alertas, pending, solicitudesPendientes, chequesUrgentes, cuotasUrgentes, tareasNuevas, noLeidas, marcarLeida, marcarTodasLeidas, onClose, navigate, isMobile = false, esBackoffice = false, misNotifs = [], noLeidasCount = 0, currentUserId = null, marcarNotifLeida = () => {}, marcarTodasNotifLeidas = () => {}, pushOn = false, togglePush = () => {} }) {
  const items = [];

  // Cuotas vencidas o próximas a vencer (≤3 días). Vencidas primero.
  (cuotasUrgentes || []).slice(0, 8).forEach(q => {
    const fmtFechaCorta = q.fecha ? q.fecha.split('-').reverse().join('/') : '';
    const titulo = q.urgencia === 'vencida'
      ? `Cuota vencida${q.dias < 0 ? ` (${Math.abs(q.dias)}d)` : ' hoy'} — ${q.obraNombre}`
      : `Cuota vence ${q.dias === 1 ? 'mañana' : `en ${q.dias}d`} — ${q.obraNombre}`;
    items.push({
      id: q.id,
      icon: q.urgencia === 'vencida' ? '●' : '◐',
      titulo,
      subtit: `Cuota ${q.cuotaN} · ${q.cuotaDesc} · U$S ${Math.round(q.montoUSD).toLocaleString('es-AR')} · vence ${fmtFechaCorta}`,
      fecha: '',
      leida: false,
      ruta: `/obras/${q.obraId}/presupuesto?tab=1`,
      tipo: 'cuota',
    });
  });

  // Tareas nuevas asignadas al usuario (no vistas, no completadas)
  (tareasNuevas || []).slice(0, 5).forEach(t => {
    items.push({
      id:     `tarea-${t.id}`,
      icon:   '☑',
      titulo: `Te asignaron una tarea: ${t.titulo}`,
      subtit: t.descripcion || `Prioridad ${t.prioridad}${t.fechaLimite ? ` · vence ${t.fechaLimite.split('-').reverse().join('/')}` : ''}`,
      fecha:  fmtFecha(t.creadoAt),
      leida:  false,
      ruta:   `/tareas?id=${t.id}`,
      tipo:   'tarea',
    });
  });

  // Solicitudes de eliminación pendientes (para admins)
  (solicitudesPendientes || []).slice(0, 5).forEach(sol => {
    const mov = sol.movimiento || {};
    items.push({
      id:     sol.id,
      icon:   '🗑',
      titulo: `Solicitud de eliminación · ${sol.solicitadoPor?.nombre || '—'}`,
      subtit: `${mov.descripcion || '—'} · $${Math.round(mov.monto || 0).toLocaleString('es-AR')}`,
      fecha:  fmtFecha(sol.creadoAt),
      leida:  false,
      ruta:   '/autorizaciones',
      tipo:   'solicitud',
    });
  });

  // Cheques próximos a vencer
  (chequesUrgentes || []).slice(0, 5).forEach(c => {
    const d = diasHasta(c.fechaVencimiento);
    const esHoy = d === 0;
    items.push({
      id:     c.id,
      icon:   esHoy ? '🔴' : '🟡',
      titulo: esHoy
        ? `¡Cheque vence HOY — ${c.banco || ''}!`
        : `Cheque vence en ${d}d — ${c.banco || ''}`,
      subtit: `#${c.numero || '—'} · ${c.titular || c.proveedorNombre || '—'} · $${Math.round(c.monto || 0).toLocaleString('es-AR')}`,
      fecha:  c.fechaVencimiento ? c.fechaVencimiento.split('-').reverse().join('/') : '',
      leida:  false,
      ruta:   '/cheques',
      tipo:   'cheque',
    });
  });

  // Pending WhatsApp approvals
  const pendientesWA = (pending || []).filter(p => p.status === 'pendiente').slice(0, 10);
  pendientesWA.forEach(p => {
    const esFactura = p.tipoPendiente === 'factura';
    items.push({
      id:     p.id,
      icon:   esFactura ? '🧾' : '💸',
      titulo: esFactura
        ? `Factura de ${p.proveedor || '—'}`
        : `${p.movimiento?.tipo === 'ingreso' ? 'Ingreso' : 'Gasto'} de ${p.creadoPor}`,
      subtit: esFactura
        ? `$${(p.montoTotal || 0).toLocaleString('es-AR')}`
        : `$${(p.movimiento?.monto || 0).toLocaleString('es-AR')} · ${p.movimiento?.descripcion || ''}`,
      fecha:  fmtFecha(p.receivedAt),
      leida:  false,
      // El click navega al hub unificado, filtrado por origen WhatsApp.
      ruta:   '/autorizaciones?origen=whatsapp',
      tipo:   'pending',
    });
  });

  // WA alerts (unread). La alerta "faltan seguros" es de backoffice: solo la ven
  // Admin/Administración (esBackoffice). El resto de las alertas globales (obra
  // iniciada, exceso…) las ve todo el equipo, como hasta ahora.
  alertas
    .filter(a => !a.leida)
    .filter(a => a.tipo !== 'seguros_faltantes' || esBackoffice)
    .slice(0, 15)
    .forEach(a => {
      items.push({
        id:     a.id,
        icon:   a.tipo === 'exceso' ? '📊' : a.tipo === 'obra_iniciada' ? '🏗️' : a.tipo === 'seguros_faltantes' ? '🛡️' : '⚠️',
        titulo: a.obra ? `${a.obra}${a.tarea ? ' · ' + a.tarea : ''}` : 'Alerta',
        subtit: a.texto,
        fecha:  fmtFecha(a.fecha),
        leida:  false,
        // La de seguros lleva directo a la pestaña Seguros de la obra (tab 9).
        ruta:   a.tipo === 'seguros_faltantes' && a.obraId ? `/obras/${a.obraId}/presupuesto?tab=9` : '/',
        tipo:   'alerta',
        alertaId: a.id,
      });
    });

  const handleClick = (item) => {
    if (item.tipo === 'alerta') marcarLeida(item.alertaId);
    onClose();
    navigate(item.ruta);
  };

  return (
    <div style={{
      // En mobile el panel se ancla al viewport (no a la campana) para que
      // nunca se salga de pantalla por derecha/izquierda: fixed + left/right 8.
      // En desktop queda igual que antes (absolute, colgando de la campana).
      ...(isMobile
        ? {
            position: 'fixed', top: 56, left: 8, right: 8, width: 'auto',
            maxWidth: 'min(360px, 92vw)', marginLeft: 'auto',
            maxHeight: '80vh',
          }
        : {
            position: 'absolute', top: '100%', right: 0,
            width: 360, maxHeight: 480,
          }),
      zIndex: 9999, overflow: 'hidden',
      background: '#1e1e22', border: '1px solid #3a3a3e', borderRadius: 6,
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #3a3a3e', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>
          Notificaciones {items.length > 0 ? `(${items.length})` : ''}
        </span>
        {noLeidas > 0 && (
          <span
            onClick={() => { marcarTodasLeidas(); }}
            style={{ fontSize: 10, color: '#9a9892', cursor: 'pointer', textDecoration: 'underline' }}>
            Marcar todas leídas
          </span>
        )}
      </div>

      {/* Lista */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {/* Notificaciones del sistema (feed por rol) */}
        <div style={{ padding: '8px 14px', borderBottom: '1px solid #3a3a3e', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700, fontSize: 12, color: '#fff' }}>Notificaciones{noLeidasCount ? ` (${noLeidasCount})` : ''}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {noLeidasCount > 0 && <button onClick={marcarTodasNotifLeidas} style={{ fontSize: 10, cursor: 'pointer', background: 'none', border: 'none', color: '#9a9892', padding: 0 }}>marcar leídas</button>}
            {pushSoportado() && <button onClick={togglePush} style={{ fontSize: 10, cursor: 'pointer', background: 'none', border: 'none', color: pushOn ? '#9a9892' : T.accent, padding: 0 }}>{pushOn ? '🔔 push on' : '🔔 activar push'}</button>}
          </div>
        </div>
        {misNotifs.slice(0, 15).map(n => {
          const leida = (n.leidaPor || []).includes(currentUserId);
          return (
            <div key={n.id} onClick={() => { marcarNotifLeida(n.id); onClose(); navigate(n.link); }}
              style={{ padding: '8px 14px', borderBottom: '1px solid #2a2a2e', cursor: 'pointer', background: leida ? 'transparent' : 'rgba(26,155,156,0.12)' }}
              onMouseEnter={e => e.currentTarget.style.background = '#2a2a2e'}
              onMouseLeave={e => e.currentTarget.style.background = leida ? 'transparent' : 'rgba(26,155,156,0.12)'}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>{n.titulo}</div>
              {n.cuerpo && <div style={{ fontSize: 11, color: '#9a9892', marginTop: 2 }}>{n.cuerpo}</div>}
              <div style={{ fontSize: 10, color: '#5a5a58', fontFamily: T.fontMono, marginTop: 2 }}>{new Date(n.creadoAt).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
            </div>
          );
        })}
        {items.length === 0 && misNotifs.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: '#9a9892' }}>
            ✓ Sin notificaciones pendientes
          </div>
        ) : (
          items.map((item, i) => (
            <div
              key={item.id}
              onClick={() => handleClick(item)}
              style={{
                display: 'flex', gap: 10, padding: '10px 14px',
                borderBottom: i < items.length - 1 ? '1px solid #2a2a2e' : 'none',
                cursor: 'pointer', transition: 'background .1s',
                background: 'transparent',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#2a2a2e'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{item.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.titulo}
                </div>
                <div style={{ fontSize: 11, color: '#9a9892', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                  {item.subtit}
                </div>
                {item.fecha && (
                  <div style={{ fontSize: 10, color: '#5a5a58', marginTop: 2 }}>{item.fecha}</div>
                )}
              </div>
              <span style={{ fontSize: 10, color: T.accent, flexShrink: 0, alignSelf: 'center' }}>›</span>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      {items.length > 0 && (
        <div style={{ borderTop: '1px solid #3a3a3e', padding: '8px 14px', display: 'flex', gap: 8 }}>
          <span
            onClick={() => { onClose(); navigate('/autorizaciones?origen=whatsapp'); }}
            style={{ fontSize: 11, color: '#9a9892', cursor: 'pointer', flex: 1, textAlign: 'center' }}
            onMouseEnter={e => e.currentTarget.style.color = '#fff'}
            onMouseLeave={e => e.currentTarget.style.color = '#9a9892'}>
            Ver autorizaciones →
          </span>
          <span
            onClick={() => { onClose(); navigate('/'); }}
            style={{ fontSize: 11, color: '#9a9892', cursor: 'pointer', flex: 1, textAlign: 'center' }}
            onMouseEnter={e => e.currentTarget.style.color = '#fff'}
            onMouseLeave={e => e.currentTarget.style.color = '#9a9892'}>
            Ver dashboard →
          </span>
        </div>
      )}
    </div>
  );
}

function diasHasta(fecha) {
  if (!fecha) return null;
  const hoy = new Date().toISOString().split('T')[0];
  const d1 = new Date(hoy), d2 = new Date(fecha);
  return Math.round((d2 - d1) / 86400000);
}

export default function Topbar({ breadcrumb = [], right, search = true, isMobile = false, onHamburger }) {
  const { dolarVenta, dolarCompra, loading: dolarLoading } = useDolar();
  const { user: authUser, signOut } = useAuth();
  const { currentUser } = useUsuarios();
  const { alertas, noLeidas, marcarLeida, marcarTodasLeidas } = useAlertas();
  const { pending } = useWhatsappPending();
  const { solicitudes } = useSolicitudes();
  const { cheques } = useCheques();
  const { tareas } = useTareas() ?? { tareas: [] };
  const { obras, detalles } = useObras();
  const { movimientos, cajas } = useMovimientos();
  const navigate = useNavigate();
  const { notificaciones: misNotifs, noLeidasCount, marcarLeida: marcarNotifLeida, marcarTodasLeidas: marcarTodasNotifLeidas } = useNotificaciones() ?? { notificaciones: [], noLeidasCount: 0 };
  const [showNotif, setShowNotif] = useState(false);
  const [pushOn, setPushOn] = useState(false);
  const bellRef = useRef(null);

  useEffect(() => { pushActivo().then(setPushOn).catch(() => {}); }, []);
  const togglePush = async () => {
    try {
      if (pushOn) { await desactivarPush(); setPushOn(false); }
      else { await activarPush(currentUser?.id); setPushOn(true); }
    } catch (e) { window.alert(e.message); }
  };

  const logout = signOut;
  const displayName = currentUser?.nombre || authUser?.email?.split('@')[0] || 'Usuario';
  const displayRol  = currentUser?.rol || 'Administrador';
  const isAdmin = currentUser?.rol === 'Admin';
  // Backoffice = Admin o Administración. La alerta "faltan seguros" es para ellos.
  const esBackoffice = currentUser?.rol === 'Admin' || currentUser?.rol === 'Administración';

  const pendientesWA = (pending || []).filter(p => p.status === 'pendiente').length;
  const solicitudesPendientes = isAdmin ? solicitudes.filter(s => s.estado === 'pendiente') : [];

  // Cheques próximos a vencer — solo admin
  const chequesUrgentes = isAdmin
    ? (cheques || []).filter(c => {
        if (c.estado !== 'cartera') return false;
        const d = diasHasta(c.fechaVencimiento);
        return d !== null && d >= 0 && d <= 7;
      })
    : [];

  // Cuotas vencidas o próximas a vencer (≤3 días) de obras activas — solo
  // admin. Se calculan barriendo todas las obras y sus cuotas. Cada item
  // tiene info para navegar al estado de cuenta de la obra.
  const cuotasUrgentes = isAdmin ? (() => {
    const items = [];
    const tcAhora = dolarVenta || 1070;
    const hoy = new Date();
    const hoyStr = hoy.toISOString().slice(0, 10);
    (obras || []).forEach(o => {
      // Solo obras CONFIRMADAS: las cuotas de una propuesta (en-presupuesto) no
      // son cobros reales, no deben notificar vencimientos.
      if (o.estado !== 'activa' && o.estado !== 'finalizada') return;
      const det = detalles?.[o.id];
      if (!det || !det.cuotas) return;
      const reparto = repartirCobroEnCuotas(det.cuotas, cobradoObraUSD(movimientos, cajas, o.id, tcAhora), o.moneda || 'ARS', tcAhora);
      det.cuotas.forEach(c => {
        const estado = cuotaEstadoDesdeCobrado(c, reparto[c.id], o.moneda || 'ARS', tcAhora);
        if (estado === 'pagado') return;
        if (!c.fecha) return;
        const d = diasHasta(c.fecha);
        if (d === null) return;
        if (d <= 3) {
          items.push({
            id: `cuota-${o.id}-${c.id}`,
            obraId: o.id,
            obraNombre: o.nombre,
            cuotaDesc: c.descripcion,
            cuotaN: c.n,
            fecha: c.fecha,
            dias: d,
            montoUSD: cuotaMontoUSD(c, o.moneda || 'ARS', tcAhora),
            urgencia: d < 0 || d === 0 ? 'vencida' : 'proxima',
          });
        }
      });
    });
    // Orden: vencidas primero (peor primero), luego próximas (más cerca primero).
    items.sort((a, b) => a.dias - b.dias);
    return items;
  })() : [];

  // Tareas asignadas al usuario que aun no vio (no incluye completadas).
  const tareasNuevas = currentUser
    ? tareas.filter(t =>
        (t.asignadoA || []).includes(currentUser.id) &&
        !(t.vistaPor || []).includes(currentUser.id) &&
        t.estado !== 'completada' &&
        t.estado !== 'cancelada'
      )
    : [];

  // Las alertas "faltan seguros" solo cuentan para el badge si el usuario es
  // backoffice (es la única que filtramos por rol en el panel). Para el resto
  // de los usuarios no inflan el contador de una notificación que no van a ver.
  const noLeidasVisible = esBackoffice
    ? noLeidas
    : (alertas || []).filter(a => !a.leida && a.tipo !== 'seguros_faltantes').length;

  const totalNotif = noLeidasVisible + pendientesWA + solicitudesPendientes.length + chequesUrgentes.length + tareasNuevas.length + cuotasUrgentes.length + noLeidasCount;

  // Cerrar panel al hacer click fuera
  useEffect(() => {
    if (!showNotif) return;
    const handler = (e) => {
      if (bellRef.current && !bellRef.current.contains(e.target)) setShowNotif(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showNotif]);

  return (
    <div className="k-stripes-bg k-topbar" style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 14, padding: isMobile ? '10px 12px' : '10px 16px', backgroundColor: T.dark, color: '#fff', position: 'relative', overflow: 'visible', flexShrink: 0, zIndex: 100 }}>
      {/* Las rayas vienen del background fixed (clase k-stripes-bg) — asi
          se alinean con las del PageHero y parecen "continuar" detras del
          area clara intermedia.
          La clase k-topbar agrega la sombra inferior + barra accent
          decorativa a la izquierda (ver index.css). */}

      {/* Hamburguesa: solo en mobile, abre/cierra el drawer del Sidebar. */}
      {isMobile && (
        <button
          onClick={onHamburger}
          aria-label="Menú"
          style={{ background: 'none', border: 'none', color: '#fff', fontSize: 22, cursor: 'pointer', padding: '4px 6px', lineHeight: 1, flexShrink: 0 }}>
          ☰
        </button>
      )}

      <Link to="/" className="k-topbar-logo" style={{ display: 'block', lineHeight: 0 }}><Logo h={26} dark /></Link>

      {!isMobile && breadcrumb.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#9a9892', marginLeft: 8, paddingLeft: 14, borderLeft: `1px solid #3a3a3e`, fontFamily: `'JetBrains Mono', monospace`, letterSpacing: 1, textTransform: 'uppercase' }}>
          {breadcrumb.map((b, i) => {
            // Acepta string u objeto { label, to }. Si tiene `to`, es clickeable
            // (navegación directa con navigate(), no Link, para que los hover
            // handlers no interfieran con el click).
            const isObj = typeof b === 'object' && b !== null;
            const label = isObj ? b.label : b;
            const to = isObj ? b.to : null;
            const isLast = i === breadcrumb.length - 1;
            const baseColor = isLast ? T.accent : '#9a9892';
            const clickable = !!to && !isLast;
            return (
              <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  onClick={clickable ? () => navigate(to) : undefined}
                  onMouseEnter={e => { if (clickable) { e.currentTarget.style.color = '#fff'; e.currentTarget.style.textShadow = `0 0 8px ${T.accent}66`; } }}
                  onMouseLeave={e => { if (clickable) { e.currentTarget.style.color = baseColor; e.currentTarget.style.textShadow = 'none'; } }}
                  style={{
                    color: baseColor,
                    fontWeight: 700,
                    cursor: clickable ? 'pointer' : 'default',
                    transition: 'color 0.15s, text-shadow 0.15s',
                    userSelect: 'none',
                  }}>
                  {label}
                </span>
                {!isLast && <span style={{ color: '#5a5a58' }}>›</span>}
              </span>
            );
          })}
        </div>
      )}

      {!isMobile && search && <GlobalSearch />}

      {right ?? (
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 10, marginLeft: isMobile ? 'auto' : (search ? 0 : 'auto') }}>

          {/* Notificaciones — campana con panel dropdown */}
          <div ref={bellRef} style={{ position: 'relative' }}>
            <span
              onClick={() => setShowNotif(v => !v)}
              style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 4, cursor: 'pointer', background: showNotif ? '#2a2a2e' : 'transparent', transition: 'background .15s' }}
              onMouseEnter={e => { if (!showNotif) e.currentTarget.style.background = '#2a2a2e'; }}
              onMouseLeave={e => { if (!showNotif) e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ fontSize: 16 }}>🔔</span>
              {totalNotif > 0 && (
                <span style={{
                  position: 'absolute', top: 2, right: 2,
                  minWidth: 14, height: 14,
                  background: T.accent, color: '#fff',
                  fontSize: 9, borderRadius: 7,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: `'JetBrains Mono', monospace`, fontWeight: 700, padding: '0 2px',
                  pointerEvents: 'none',
                }}>
                  {totalNotif > 99 ? '99+' : totalNotif}
                </span>
              )}
            </span>

            {showNotif && (
              <NotifPanel
                alertas={alertas}
                pending={pending}
                solicitudesPendientes={solicitudesPendientes}
                chequesUrgentes={chequesUrgentes}
                cuotasUrgentes={cuotasUrgentes}
                tareasNuevas={tareasNuevas}
                noLeidas={noLeidas}
                marcarLeida={marcarLeida}
                marcarTodasLeidas={marcarTodasLeidas}
                onClose={() => setShowNotif(false)}
                navigate={navigate}
                isMobile={isMobile}
                esBackoffice={esBackoffice}
                misNotifs={misNotifs}
                noLeidasCount={noLeidasCount}
                currentUserId={currentUser?.id}
                marcarNotifLeida={marcarNotifLeida}
                marcarTodasNotifLeidas={marcarTodasNotifLeidas}
                pushOn={pushOn}
                togglePush={togglePush}
              />
            )}
          </div>

          {/* Dólar oficial — bloque ancho, oculto en mobile. */}
          {!isMobile && (
          <div style={{ fontSize: 10, color: '#9a9892', fontFamily: `'JetBrains Mono', monospace`, letterSpacing: 1, borderLeft: '1px solid #3a3a3e', paddingLeft: 10 }}>
            <div style={{ color: T.accent }}>USD OFICIAL BNA</div>
            {dolarLoading ? (
              <div style={{ color: '#9a9892' }}>actualizando…</div>
            ) : (
              <>
                <div style={{ color: '#fff', fontWeight: 700 }}>
                  Vta $ {fmtN(dolarVenta)}
                </div>
                <div style={{ color: '#9a9892', fontSize: 9 }}>
                  Cpr $ {fmtN(dolarCompra)}
                </div>
              </>
            )}
          </div>
          )}

          {/* Avatar + nombre — click va a /perfil */}
          <div
            onClick={() => navigate('/perfil')}
            title="Mi perfil"
            style={{ display: 'flex', alignItems: 'center', gap: 8, borderLeft: '1px solid #3a3a3e', paddingLeft: 10, cursor: 'pointer', borderRadius: 4, padding: '4px 4px 4px 10px', transition: 'background 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: T.accent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: `'Montserrat', sans-serif`, fontSize: 12, fontWeight: 800, flexShrink: 0 }}>
              {displayName[0].toUpperCase()}
            </div>
            {/* Nombre/rol: bloque ancho, oculto en mobile (queda solo el avatar). */}
            {!isMobile && (
            <div style={{ fontSize: 11, color: '#9a9892', lineHeight: 1.3 }}>
              <div style={{ color: '#fff', fontWeight: 700, fontSize: 12 }}>{displayName}</div>
              <div style={{ fontSize: 10 }}>{displayRol}</div>
            </div>
            )}
          </div>

          {/* Cerrar sesión — en mobile queda solo el icono (label oculto). */}
          <div onClick={logout}
            title={isMobile ? 'Salir' : undefined}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: isMobile ? '5px 8px' : '5px 10px', borderRadius: 4, border: '1px solid #3a3a3e', cursor: 'pointer', fontSize: 11, color: '#9a9892', fontWeight: 600, userSelect: 'none', transition: 'border-color 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.borderColor = T.accent}
            onMouseLeave={e => e.currentTarget.style.borderColor = '#3a3a3e'}>
            <span style={{ fontSize: 13 }}>⏻</span>{!isMobile && ' Salir'}
          </div>

        </div>
      )}
    </div>
  );
}
