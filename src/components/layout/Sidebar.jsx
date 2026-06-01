import { useNavigate, useLocation } from 'react-router-dom';
import { Diamond } from '../ui';
import { T } from '../../theme';
import { useUsuarios } from '../../store/UsuariosContext';
import { useSolicitudes } from '../../store/SolicitudesContext';
import { useWhatsappPending } from '../../store/WhatsappPendingContext';
import { useTareas } from '../../store/TareasContext';

const ALL_ITEMS = [
  { section: 'Operación' },
  { icon: '◧', label: 'Dashboard',      path: '/',             perm: 'verDashboard' },
  { icon: '🏗', label: 'Obras',          path: '/obras' },
  { icon: '☑', label: 'Tareas',         path: '/tareas' },
  { section: 'Administración' },
  { icon: '◉', label: 'Proveedores',    path: '/proveedores',  allowedRoles: ['Admin', 'Administración', 'Logística y compras'] },
  { icon: '◎', label: 'Clientes',       path: '/clientes',     allowedRoles: ['Admin', 'Administración'] },
  { icon: '⇄', label: 'Movimientos',    path: '/movimientos',  perm: 'verCaja' },
  { icon: '$', label: 'Cajas',          path: '/cajas',        perm: 'verCaja' },
  { icon: '✓', label: 'Cheques',        path: '/cheques',      allowedRoles: ['Admin', 'Administración'] },
  { icon: '🧾', label: 'Facturación',    path: '/facturacion',  allowedRoles: ['Admin', 'Administración', 'Contador externo'] },
  { icon: '⌗', label: 'Gastos Fijos',   path: '/prorrateo',    allowedRoles: ['Admin', 'Administración'] },
  { section: 'Datos' },
  { icon: '▤', label: 'Catálogos',      path: '/catalogos',   adminOnly: true },
  { icon: '▦', label: 'Plantillas',     path: '/plantillas',  adminOnly: true },
  { icon: '▦', label: 'Reportes',       path: '/reportes',    adminOnly: true },
  { section: 'Sistema' },
  { icon: '◐', label: 'Autorizaciones', path: '/autorizaciones', adminOnly: true },
  { icon: '👤', label: 'Usuarios',       path: '/usuarios',       adminOnly: true },
  { icon: '⚙', label: 'Configuración', path: '/configuracion', adminOnly: true },
];

export default function Sidebar({ active }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser } = useUsuarios();
  const { solicitudes } = useSolicitudes();
  const { pending: waPending } = useWhatsappPending();
  const { tareas } = useTareas() ?? { tareas: [] };
  const p = currentUser?.permisos ?? {};
  const isAdmin = currentUser?.rol === 'Admin';

  // Badge "Autorizaciones": ahora cuenta TODAS las pendings:
  // solicitudes de eliminacion + items activos del bot de WhatsApp.
  // Solo se muestra para Admin (no-admin no ve /autorizaciones).
  const waPendientes = isAdmin
    ? waPending.filter(p => !p.status || (p.status !== 'confirmed' && p.status !== 'rejected')).length
    : 0;
  const solPendientes = (isAdmin
    ? solicitudes.filter(s => s.estado === 'pendiente').length
    : 0) + waPendientes;

  // Badge "Tareas": tareas NUEVAS asignadas al usuario que aún no abrió
  // (no figura en vistaPor). El badge llama la atención solo cuando otra
  // persona te asignó algo nuevo — no por la carga de trabajo total.
  const tareasPendientes = currentUser
    ? tareas.filter(t =>
        (t.asignadoA || []).includes(currentUser.id) &&
        !(t.vistaPor || []).includes(currentUser.id) &&
        t.estado !== 'completada' &&
        t.estado !== 'cancelada'
      ).length
    : 0;

  // El rol Contador SOLO ve Facturación — escondemos todo lo demás (incluso
  // los encabezados de sección, así no le queda una sección vacía).
  const isContador = currentUser?.rol === 'Contador externo';
  const items = ALL_ITEMS.filter(it => {
    if (isContador) return it.label === 'Facturación';
    if (it.section) return true;
    if (it.adminOnly && !isAdmin) return false;
    if (it.allowedRoles && !it.allowedRoles.includes(currentUser?.rol)) return false;
    if (it.perm && !p[it.perm]) return false;
    return true;
  });

  return (
    <div className="k-sidebar">
      {items.map((it, i) => {
        if (it.section) {
          return (
            <div key={i} className="k-sidebar-section" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Diamond size={5} color="rgba(255,255,255,0.7)" />
              <span>{it.section}</span>
            </div>
          );
        }
        const isActive = active ? active === it.label : location.pathname === it.path || (it.path !== '/' && location.pathname.startsWith(it.path));
        const isAutorizBadge = it.label === 'Autorizaciones' && solPendientes > 0 && isAdmin;
        const isTareasBadge = it.label === 'Tareas' && tareasPendientes > 0;
        const hasBadge = isAutorizBadge || isTareasBadge;
        const badgeCount = isAutorizBadge ? solPendientes : tareasPendientes;
        return (
          <div
            key={i}
            className={`k-sidebar-item${isActive ? ' active' : ''}`}
            onClick={() => it.path && navigate(it.path)}
          >
            <span style={{ width: 16, textAlign: 'center', fontSize: 13, flexShrink: 0, lineHeight: 1 }}>{it.icon || '·'}</span>
            {/* Label: se trunca con "..." solo si hay badge (asi el badge
                nunca se corta). Sin badge, el label se ve completo siempre. */}
            <span style={hasBadge
              ? { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
              : { whiteSpace: 'nowrap' }}>
              {it.label}
            </span>
            {hasBadge && (
              <span style={{
                background: '#e74c3c',
                color: '#fff',
                borderRadius: 10,
                padding: '0 6px',
                minWidth: 18,
                height: 18,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 10,
                fontWeight: 700,
                lineHeight: 1,
                flexShrink: 0,
                boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
              }}>
                {badgeCount}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
