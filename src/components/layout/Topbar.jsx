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
import GlobalSearch from '../GlobalSearch';

const fmtN = (n) => Math.round(n).toLocaleString('es-AR');
const fmtFecha = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

function NotifPanel({ alertas, pending, solicitudesPendientes, chequesUrgentes, noLeidas, marcarLeida, marcarTodasLeidas, onClose, navigate }) {
  const items = [];

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

  // WA alerts (unread)
  alertas.filter(a => !a.leida).slice(0, 15).forEach(a => {
    items.push({
      id:     a.id,
      icon:   a.tipo === 'exceso' ? '📊' : '⚠️',
      titulo: a.obra ? `${a.obra}${a.tarea ? ' · ' + a.tarea : ''}` : 'Alerta',
      subtit: a.texto,
      fecha:  fmtFecha(a.fecha),
      leida:  false,
      ruta:   '/',
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
      position: 'absolute', top: '100%', right: 0, zIndex: 9999,
      width: 360, maxHeight: 480, overflow: 'hidden',
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
        {items.length === 0 ? (
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

export default function Topbar({ breadcrumb = [], right, search = true }) {
  const { dolarVenta, dolarCompra, loading: dolarLoading } = useDolar();
  const { user: authUser, signOut } = useAuth();
  const { currentUser } = useUsuarios();
  const { alertas, noLeidas, marcarLeida, marcarTodasLeidas } = useAlertas();
  const { pending } = useWhatsappPending();
  const { solicitudes } = useSolicitudes();
  const { cheques } = useCheques();
  const navigate = useNavigate();
  const [showNotif, setShowNotif] = useState(false);
  const bellRef = useRef(null);

  const logout = signOut;
  const displayName = currentUser?.nombre || authUser?.email?.split('@')[0] || 'Usuario';
  const displayRol  = currentUser?.rol || 'Administrador';
  const isAdmin = currentUser?.rol === 'Admin';

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

  const totalNotif = noLeidas + pendientesWA + solicitudesPendientes.length + chequesUrgentes.length;

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
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 16px', background: T.dark, color: '#fff', position: 'relative', overflow: 'visible', flexShrink: 0, zIndex: 100 }}>
      <Stripes style={{ top: -30, right: -10 }} />

      <Link to="/" style={{ display: 'block', lineHeight: 0 }}><Logo h={26} dark /></Link>

      {breadcrumb.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#9a9892', marginLeft: 8, paddingLeft: 14, borderLeft: `1px solid #3a3a3e`, fontFamily: `'JetBrains Mono', monospace`, letterSpacing: 1, textTransform: 'uppercase' }}>
          {breadcrumb.map((b, i) => (
            <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: i === breadcrumb.length - 1 ? T.accent : '#9a9892', fontWeight: 700 }}>{b}</span>
              {i < breadcrumb.length - 1 && <span style={{ color: '#5a5a58' }}>›</span>}
            </span>
          ))}
        </div>
      )}

      {search && <GlobalSearch />}

      {right ?? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: search ? 0 : 'auto' }}>

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
                noLeidas={noLeidas}
                marcarLeida={marcarLeida}
                marcarTodasLeidas={marcarTodasLeidas}
                onClose={() => setShowNotif(false)}
                navigate={navigate}
              />
            )}
          </div>

          {/* Dólar oficial */}
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

          {/* Avatar + nombre */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderLeft: '1px solid #3a3a3e', paddingLeft: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: T.accent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: `'Montserrat', sans-serif`, fontSize: 12, fontWeight: 800, flexShrink: 0 }}>
              {displayName[0].toUpperCase()}
            </div>
            <div style={{ fontSize: 11, color: '#9a9892', lineHeight: 1.3 }}>
              <div style={{ color: '#fff', fontWeight: 700, fontSize: 12 }}>{displayName}</div>
              <div style={{ fontSize: 10 }}>{displayRol}</div>
            </div>
          </div>

          {/* Cerrar sesión */}
          <div onClick={logout}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 4, border: '1px solid #3a3a3e', cursor: 'pointer', fontSize: 11, color: '#9a9892', fontWeight: 600, userSelect: 'none', transition: 'border-color 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.borderColor = T.accent}
            onMouseLeave={e => e.currentTarget.style.borderColor = '#3a3a3e'}>
            <span style={{ fontSize: 13 }}>⏻</span> Salir
          </div>

        </div>
      )}
    </div>
  );
}
