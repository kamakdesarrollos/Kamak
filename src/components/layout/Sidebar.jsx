import { useNavigate, useLocation } from 'react-router-dom';
import { Diamond } from '../ui';
import { T } from '../../theme';
import { useUsuarios } from '../../store/UsuariosContext';

const ALL_ITEMS = [
  { section: 'Operación' },
  { icon: '◧', label: 'Dashboard',      path: '/',             perm: 'verDashboard' },
  { icon: '🏗', label: 'Obras',          path: '/obras' },
  { icon: '◉', label: 'Proveedores',    path: '/proveedores' },
  { icon: '◎', label: 'Clientes',       path: '/clientes' },
  { icon: '⇄', label: 'Movimientos',    path: '/movimientos' },
  { icon: '$', label: 'Cajas',          path: '/cajas',        perm: 'verCaja' },
  { icon: '⌗', label: 'Prorrateo',      path: '/prorrateo' },
  { section: 'Datos' },
  { icon: '▤', label: 'Catálogos',      path: '/catalogos',   adminOnly: true },
  { icon: '▦', label: 'Plantillas',     path: '/plantillas',  adminOnly: true },
  { icon: '▦', label: 'Reportes',       path: '/reportes',    adminOnly: true },
  { section: 'Sistema' },
  { icon: '◐', label: 'Autorizaciones', path: '/autorizaciones', adminOnly: true },
  { icon: '⚙', label: 'Configuración', path: '/configuracion', adminOnly: true },
];

export default function Sidebar({ active }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser } = useUsuarios();
  const p = currentUser?.permisos ?? {};
  const isAdmin = currentUser?.rol === 'Admin';

  const items = ALL_ITEMS.filter(it => {
    if (it.section) return true;
    if (it.adminOnly && !isAdmin) return false;
    if (it.perm && !p[it.perm]) return false;
    return true;
  });

  return (
    <div className="k-sidebar">
      {items.map((it, i) => {
        if (it.section) {
          return (
            <div key={i} className="k-sidebar-section" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Diamond size={5} color={T.accent} />
              <span>{it.section}</span>
            </div>
          );
        }
        const isActive = active ? active === it.label : location.pathname === it.path || (it.path !== '/' && location.pathname.startsWith(it.path));
        return (
          <div
            key={i}
            className={`k-sidebar-item${isActive ? ' active' : ''}`}
            onClick={() => it.path && navigate(it.path)}
          >
            <span style={{ width: 14, textAlign: 'center', fontSize: 13 }}>{it.icon || '·'}</span>
            <span>{it.label}</span>
          </div>
        );
      })}
    </div>
  );
}
