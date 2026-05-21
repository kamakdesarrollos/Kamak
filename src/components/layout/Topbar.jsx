import { Link } from 'react-router-dom';
import { Logo, Stripes } from '../ui';
import { T } from '../../theme';
import { useDolar } from '../../store/DolarContext';
import { useUsuarios } from '../../store/UsuariosContext';

const fmtN = (n) => Math.round(n).toLocaleString('es-AR');

export default function Topbar({ breadcrumb = [], right, search = true }) {
  const { dolarVenta, dolarCompra, loading: dolarLoading } = useDolar();
  const { currentUser, logout } = useUsuarios();

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 16px', background: T.dark, color: '#fff', position: 'relative', overflow: 'hidden', flexShrink: 0 }}>
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

      {search && (
        <div style={{ width: 260, marginLeft: 'auto', background: '#171818', border: '1px solid #3a3a3e', borderRadius: 4, padding: '5px 10px', fontSize: 12, color: '#9a9892', fontFamily: `'JetBrains Mono', monospace`, letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>⌕</span><span>buscar obra, proveedor, factura…</span>
        </div>
      )}

      {right ?? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: search ? 0 : 'auto' }}>

          {/* Notificaciones */}
          <span style={{ position: 'relative', display: 'inline-block', color: '#9a9892' }}>
            <span style={{ fontSize: 16 }}>🔔</span>
            <span style={{ position: 'absolute', top: -2, right: -4, width: 12, height: 12, background: T.accent, color: '#fff', fontSize: 9, borderRadius: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: `'JetBrains Mono', monospace`, fontWeight: 700 }}>3</span>
          </span>

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
              {(currentUser?.nombre || 'U')[0].toUpperCase()}
            </div>
            <div style={{ fontSize: 11, color: '#9a9892', lineHeight: 1.3 }}>
              <div style={{ color: '#fff', fontWeight: 700, fontSize: 12 }}>{currentUser?.nombre}</div>
              <div style={{ fontSize: 10 }}>{currentUser?.rol}</div>
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
