import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import PageLayout from '../components/layout/PageLayout';
import { Box, Btn, Chip } from '../components/ui';
import { T } from '../theme';
import { useUsuarios } from '../store/UsuariosContext';
import { useObras } from '../store/ObrasContext';
import { useMovimientos } from '../store/MovimientosContext';
import { adminAction, createAuthUser } from '../lib/dbHelpers';

// Esta pagina se extrajo de Autorizaciones.jsx: contenia el CRUD de usuarios,
// permisos y roles. La separamos para que /autorizaciones quede solo como
// hub de aprobaciones (eliminaciones + items WhatsApp).

const inputSt = { padding: '6px 10px', border: `1.2px solid ${T.faint2}`, borderRadius: 4, fontFamily: T.font, fontSize: 12, background: T.paper, boxSizing: 'border-box', outline: 'none', width: '100%' };
const labelSt = { fontSize: 10, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 3, display: 'block' };

const PERM_COLS = [
  { key: 'verCostos',    label: 'Ver costos' },
  { key: 'verMargenes',  label: 'Ver márgenes' },
  { key: 'verCaja',      label: 'Ver caja' },
  { key: 'cargarGastos', label: 'Cargar gastos' },
  { key: 'cargarAvance', label: 'Cargar avance' },
  { key: 'editarPresu',  label: 'Editar presu' },
  { key: 'aprobarPagos', label: 'Aprobar pagos' },
  { key: 'crearObra',    label: 'Crear obra' },
  { key: 'verDashboard', label: 'Ver dashboard' },
];

const TABS_OCULTOS_OPTS = [
  'Resumen', 'Presupuesto', 'Materiales', 'Adicionales', 'Gantt',
  'Movimientos', 'Cuenta cliente', 'Contratos MO', 'Documentos', 'Fotos', 'Financiación',
];

function PermToggle({ on, onChange }) {
  return (
    <div onClick={onChange}
      style={{ width: 22, height: 13, borderRadius: 7, background: on ? T.ok : T.faint2, cursor: 'pointer', position: 'relative', transition: 'background 0.15s', flexShrink: 0 }}>
      <div style={{ position: 'absolute', top: 2, left: on ? 11 : 2, width: 9, height: 9, borderRadius: '50%', background: T.paper, transition: 'left 0.15s', boxShadow: '0 1px 2px rgba(0,0,0,.3)' }} />
    </div>
  );
}

function ChipToggle({ label, active, onClick, color }) {
  return (
    <div onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', padding: '3px 10px',
      borderRadius: 20, fontSize: 11, cursor: 'pointer', userSelect: 'none',
      background: active ? (color || T.accent) : T.faint,
      color: active ? T.paper : T.ink2,
      border: `1.5px solid ${active ? (color || T.accent) : T.faint2}`,
      transition: 'all 0.12s',
    }}>
      {label}
    </div>
  );
}

function EditarAccesosModal({ usuario, obras, cajas, onClose }) {
  const { updateUsuario } = useUsuarios();

  const [obrasAll, setObrasAll] = useState(usuario.obrasVisibles === '*');
  const [obrasSelected, setObrasSelected] = useState(
    Array.isArray(usuario.obrasVisibles) ? usuario.obrasVisibles : []
  );
  const [cajasAll, setCajasAll] = useState(usuario.cajasVisibles === '*');
  const [cajasSelected, setCajasSelected] = useState(
    Array.isArray(usuario.cajasVisibles) ? usuario.cajasVisibles : []
  );
  const [tabsOcultos, setTabsOcultos] = useState(Array.isArray(usuario.tabsOcultos) ? usuario.tabsOcultos : []);

  const toggleObra = (id) => setObrasSelected(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  );
  const toggleCaja = (id) => setCajasSelected(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  );
  const toggleTab = (tab) => setTabsOcultos(prev =>
    prev.includes(tab) ? prev.filter(x => x !== tab) : [...prev, tab]
  );

  const guardar = () => {
    updateUsuario(usuario.id, {
      obrasVisibles: obrasAll ? '*' : obrasSelected,
      cajasVisibles: cajasAll ? '*' : cajasSelected,
      tabsOcultos,
    });
    onClose();
  };

  return (
    <div className="k-modal-overlay" onClick={onClose}>
      <div className="k-modal" style={{ width: 520, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', background: T.dark, color: T.paper, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 16, fontFamily: T.font }}>Accesos · {usuario.nombre}</div>
          <span style={{ cursor: 'pointer', fontSize: 20, opacity: 0.7 }} onClick={onClose}>✕</span>
        </div>

        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 18, overflowY: 'auto' }}>
          {/* Obras visibles */}
          <div>
            <label style={labelSt}>Obras visibles</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <input type="checkbox" id={`obras-all-${usuario.id}`} checked={obrasAll}
                onChange={e => setObrasAll(e.target.checked)} style={{ cursor: 'pointer' }} />
              <label htmlFor={`obras-all-${usuario.id}`} style={{ fontSize: 12, cursor: 'pointer' }}>Todas las obras</label>
            </div>
            {!obrasAll && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {obras.map(o => (
                  <ChipToggle key={o.id} label={o.nombre} active={obrasSelected.includes(o.id)} color={T.ok} onClick={() => toggleObra(o.id)} />
                ))}
                {obras.length === 0 && <div style={{ fontSize: 11, color: T.ink3 }}>No hay obras disponibles</div>}
              </div>
            )}
          </div>

          {/* Cajas visibles */}
          <div>
            <label style={labelSt}>Cajas visibles</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <input type="checkbox" id={`cajas-all-${usuario.id}`} checked={cajasAll}
                onChange={e => setCajasAll(e.target.checked)} style={{ cursor: 'pointer' }} />
              <label htmlFor={`cajas-all-${usuario.id}`} style={{ fontSize: 12, cursor: 'pointer' }}>Todas las cajas</label>
            </div>
            {!cajasAll && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {cajas.map(c => (
                  <ChipToggle key={c.id} label={c.nombre} active={cajasSelected.includes(c.id)} color="#3d7a4a" onClick={() => toggleCaja(c.id)} />
                ))}
                {cajas.length === 0 && <div style={{ fontSize: 11, color: T.ink3 }}>No hay cajas disponibles</div>}
              </div>
            )}
          </div>

          {/* Tabs ocultos */}
          <div>
            <label style={labelSt}>Pestañas ocultas en obra</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
              {TABS_OCULTOS_OPTS.map(tab => (
                <ChipToggle key={tab} label={tab} active={tabsOcultos.includes(tab)} color="#c0392b" onClick={() => toggleTab(tab)} />
              ))}
            </div>
            <div style={{ fontSize: 10, color: T.ink3 }}>Las pestañas marcadas en rojo NO serán visibles para este usuario dentro de cada obra.</div>
          </div>
        </div>

        <div style={{ padding: '10px 18px', borderTop: `1.5px solid ${T.faint2}`, display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
          <Btn sm onClick={onClose}>Cancelar</Btn>
          <Btn sm fill onClick={guardar}>Guardar accesos</Btn>
        </div>
      </div>
    </div>
  );
}

function NuevoUsuarioModal({ obras, cajas, onClose }) {
  const { addUsuario, roles } = useUsuarios();
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [rol, setRol] = useState('Comprador');
  const [obrasAll, setObrasAll] = useState(false);
  const [obrasSelected, setObrasSelected] = useState([]);
  const [cajasAll, setCajasAll] = useState(false);
  const [cajasSelected, setCajasSelected] = useState([]);
  const [tabsOcultos, setTabsOcultos] = useState([]);

  const [creating, setCreating] = useState(false);
  const [sbError, setSbError] = useState('');

  const ok = nombre.trim() && email.trim() && password.trim();

  const toggleObra = (id) => setObrasSelected(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  );
  const toggleCaja = (id) => setCajasSelected(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  );
  const toggleTab = (tab) => setTabsOcultos(prev =>
    prev.includes(tab) ? prev.filter(x => x !== tab) : [...prev, tab]
  );

  const confirmar = async () => {
    if (!ok || creating) return;
    setCreating(true);
    setSbError('');
    if (password.trim().length < 6) {
      setSbError('La contraseña debe tener al menos 6 caracteres.');
      setCreating(false);
      return;
    }
    const { error: authError } = await createAuthUser(email.trim(), password.trim());
    if (authError) {
      setSbError(authError.message);
      setCreating(false);
      return;
    }
    await addUsuario({
      nombre: nombre.trim(),
      email: email.trim(),
      rol,
      obrasVisibles: obrasAll ? '*' : obrasSelected,
      cajasVisibles: cajasAll ? '*' : cajasSelected,
      tabsOcultos,
    });
    onClose();
  };

  return (
    <div className="k-modal-overlay" onClick={onClose}>
      <div className="k-modal" style={{ width: 500, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', background: T.dark, color: T.paper, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 17, fontFamily: T.font }}>Nuevo usuario</div>
          <span style={{ cursor: 'pointer', fontSize: 20, opacity: 0.7 }} onClick={onClose}>✕</span>
        </div>
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
          <div>
            <label style={labelSt}>Nombre</label>
            <input style={inputSt} value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Nombre completo" autoFocus />
          </div>
          <div>
            <label style={labelSt}>Email / usuario</label>
            <input style={inputSt} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="usuario@empresa.com" />
          </div>
          <div>
            <label style={labelSt}>Contraseña</label>
            <div style={{ position: 'relative' }}>
              <input
                style={{ ...inputSt, paddingRight: 34 }}
                type={showPass ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
              />
              <span onClick={() => setShowPass(v => !v)}
                style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', cursor: 'pointer', fontSize: 14, color: T.ink3, userSelect: 'none' }}>
                {showPass ? '🙈' : '👁'}
              </span>
            </div>
          </div>
          <div>
            <label style={labelSt}>Rol base</label>
            <select style={{ ...inputSt, cursor: 'pointer' }} value={rol} onChange={e => setRol(e.target.value)}>
              {Object.keys(roles).map(r => <option key={r}>{r}</option>)}
            </select>
            <div style={{ fontSize: 10, color: T.ink3, marginTop: 3 }}>Los permisos se pre-rellenan según el rol y se pueden editar individualmente.</div>
          </div>

          {/* Obras visibles */}
          <div>
            <label style={labelSt}>Obras visibles</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <input type="checkbox" id="new-obras-all" checked={obrasAll} onChange={e => setObrasAll(e.target.checked)} style={{ cursor: 'pointer' }} />
              <label htmlFor="new-obras-all" style={{ fontSize: 12, cursor: 'pointer' }}>Todas las obras</label>
            </div>
            {!obrasAll && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {obras.map(o => (
                  <ChipToggle key={o.id} label={o.nombre} active={obrasSelected.includes(o.id)} color={T.ok} onClick={() => toggleObra(o.id)} />
                ))}
              </div>
            )}
          </div>

          {/* Cajas visibles */}
          <div>
            <label style={labelSt}>Cajas visibles</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <input type="checkbox" id="new-cajas-all" checked={cajasAll} onChange={e => setCajasAll(e.target.checked)} style={{ cursor: 'pointer' }} />
              <label htmlFor="new-cajas-all" style={{ fontSize: 12, cursor: 'pointer' }}>Todas las cajas</label>
            </div>
            {!cajasAll && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {cajas.map(c => (
                  <ChipToggle key={c.id} label={c.nombre} active={cajasSelected.includes(c.id)} color="#3d7a4a" onClick={() => toggleCaja(c.id)} />
                ))}
              </div>
            )}
          </div>

          {/* Tabs ocultos */}
          <div>
            <label style={labelSt}>Pestañas ocultas en obra</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {TABS_OCULTOS_OPTS.map(tab => (
                <ChipToggle key={tab} label={tab} active={tabsOcultos.includes(tab)} color="#c0392b" onClick={() => toggleTab(tab)} />
              ))}
            </div>
          </div>
        </div>
        {sbError && (
          <div style={{ margin: '0 18px', padding: '8px 12px', background: '#fae6e0', borderRadius: 4, fontSize: 12, color: T.accent, borderLeft: `3px solid ${T.accent}` }}>
            {sbError}
          </div>
        )}
        <div style={{ padding: '10px 18px', borderTop: `1.5px solid ${T.faint2}`, display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
          <Btn sm onClick={onClose}>Cancelar</Btn>
          <Btn sm fill onClick={confirmar} style={{ opacity: ok && !creating ? 1 : 0.5 }}>
            {creating ? 'Creando…' : 'Crear usuario'}
          </Btn>
        </div>
      </div>
    </div>
  );
}

export default function Usuarios() {
  const { usuarios, currentUser, togglePermiso, applyRol, removeUsuario, roles, updateRol, removeRol } = useUsuarios();
  const navigate = useNavigate();
  const isAdmin = currentUser?.rol === 'Admin';
  // Guard: solo Admin. La pagina expone CRUD de usuarios.
  useEffect(() => {
    if (currentUser && !isAdmin) navigate('/', { replace: true });
  }, [currentUser, isAdmin, navigate]);

  const { obras } = useObras();
  const { cajas: allCajas } = useMovimientos();

  const [tab, setTab] = useState('usuarios');
  const [modalNuevo, setModalNuevo] = useState(false);
  const [editAccesos, setEditAccesos] = useState(null);
  const [resetPassId, setResetPassId] = useState(null);
  const [newPass, setNewPass] = useState('');
  const [resetLoading, setResetLoading] = useState(false);

  const cajas = allCajas.filter(c => c.activa);

  const obrasLabel = (u) => {
    const ov = u.obrasVisibles;
    if (ov === '*' || ov === 'Todas') return 'Todas';
    if (!Array.isArray(ov) || ov.length === 0) return 'Ninguna';
    if (ov.length <= 2) return ov.map(id => obras.find(o => o.id === id)?.nombre || id).join(', ');
    return `${ov.length} obras`;
  };

  const cajasLabel = (u) => {
    const cv = u.cajasVisibles;
    if (cv === '*') return 'Todas';
    if (!Array.isArray(cv) || cv.length === 0) return 'Ninguna';
    if (cv.length === 1) return cajas.find(c => c.id === cv[0])?.nombre || cv[0];
    return `${cv.length} cajas`;
  };

  return (
    <PageLayout breadcrumb={['Usuarios']} active="Usuarios">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <div>
          <div className="k-h" style={{ fontSize: 28 }}>Usuarios</div>
          <div style={{ fontSize: 12, color: T.ink2 }}>Gestión de usuarios, permisos y roles</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Btn sm fill onClick={() => setModalNuevo(true)}>+ Nuevo usuario</Btn>
        </div>
      </div>

      <div className="k-tabs" style={{ margin: '8px 0 10px' }}>
        <span className={`k-tab${tab === 'usuarios' ? ' k-tab-on' : ''}`} onClick={() => setTab('usuarios')}>
          Usuarios · {usuarios.length}
        </span>
        <span className={`k-tab${tab === 'roles' ? ' k-tab-on' : ''}`} onClick={() => setTab('roles')}>
          Roles base
        </span>
      </div>

      {tab === 'usuarios' && (
        <Box style={{ padding: 0, overflow: 'auto', maxHeight: 'calc(100vh - 240px)' }}>
          {/* Header */}
          <div style={{ display: 'flex', background: T.faint, borderBottom: `1.5px solid ${T.faint2}`, position: 'sticky', top: 0, zIndex: 1, minWidth: 0 }}>
            <div style={{ width: 160, flexShrink: 0, padding: '8px 10px', fontSize: 10, fontWeight: 700, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5 }}>Usuario</div>
            <div style={{ width: 170, flexShrink: 0, padding: '8px 10px', fontSize: 10, fontWeight: 700, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5 }}>Credenciales</div>
            <div style={{ width: 130, flexShrink: 0, padding: '8px 10px', fontSize: 10, fontWeight: 700, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5 }}>Rol</div>
            <div style={{ width: 110, flexShrink: 0, padding: '8px 10px', fontSize: 10, fontWeight: 700, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5 }}>Obras</div>
            <div style={{ width: 100, flexShrink: 0, padding: '8px 10px', fontSize: 10, fontWeight: 700, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5 }}>Cajas</div>
            {PERM_COLS.map(col => (
              <div key={col.key} style={{ width: 60, flexShrink: 0, padding: '8px 4px', fontSize: 8, fontWeight: 700, color: T.ink2, textAlign: 'center', textTransform: 'uppercase', letterSpacing: 0.3 }}>
                {col.label}
              </div>
            ))}
            <div style={{ width: 70, flexShrink: 0 }}></div>
          </div>

          {/* Rows */}
          {usuarios.map(u => (
            <div key={u.id} style={{ display: 'flex', borderBottom: `1px solid ${T.faint2}`, alignItems: 'center', minWidth: 0 }}>

              {/* Nombre + avatar */}
              <div style={{ width: 160, flexShrink: 0, padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <div style={{ width: 24, height: 24, borderRadius: '50%', background: T.ink2, color: T.paper, fontFamily: `'Montserrat',sans-serif`, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, flexShrink: 0 }}>
                  {(u.nombre || '?')[0].toUpperCase()}
                </div>
                <div style={{ fontWeight: 700, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.nombre}</div>
              </div>

              {/* Credenciales: email + cambiar contraseña */}
              <div style={{ width: 170, flexShrink: 0, padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: T.ink2, fontFamily: T.fontMono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</div>
                {resetPassId === u.id ? (
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <input
                      autoFocus
                      type="password"
                      value={newPass}
                      onChange={e => setNewPass(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Escape') { setResetPassId(null); setNewPass(''); } }}
                      placeholder="Nueva contraseña"
                      style={{ fontSize: 11, padding: '2px 6px', border: `1.5px solid ${T.accent}`, borderRadius: 3, fontFamily: T.fontMono, outline: 'none', width: 100 }}
                    />
                    <span
                      title="Confirmar"
                      style={{ fontSize: 10, color: resetLoading ? T.ink3 : T.ok, cursor: resetLoading ? 'default' : 'pointer', fontWeight: 700 }}
                      onClick={async () => {
                        if (!newPass.trim() || resetLoading) return;
                        if (newPass.trim().length < 6) { alert('La contraseña debe tener al menos 6 caracteres.'); return; }
                        setResetLoading(true);
                        const { error } = await adminAction('updatePassword', { email: u.email, password: newPass.trim() });
                        setResetLoading(false);
                        if (error) { alert('Error: ' + error); return; }
                        setResetPassId(null); setNewPass('');
                      }}>✓</span>
                    <span style={{ fontSize: 10, color: T.accent, cursor: 'pointer' }}
                      onClick={() => { setResetPassId(null); setNewPass(''); }}>✕</span>
                    {resetLoading && <span style={{ fontSize: 9, color: T.ink3 }}>…</span>}
                  </div>
                ) : (
                  <span style={{ fontSize: 9, color: T.accent, cursor: 'pointer', fontWeight: 700 }}
                    onClick={() => { setResetPassId(u.id); setNewPass(''); }}>
                    cambiar contraseña
                  </span>
                )}
              </div>

              {/* Rol */}
              <div style={{ width: 130, flexShrink: 0, padding: '8px 10px' }}>
                <select style={{ fontSize: 10, padding: '3px 6px', borderRadius: 4, border: `1.5px solid ${T.faint2}`, fontFamily: T.font, background: T.paper, cursor: 'pointer', maxWidth: '100%' }}
                  value={u.rol}
                  onChange={e => applyRol(u.id, e.target.value)}>
                  {Object.keys(roles).map(r => <option key={r}>{r}</option>)}
                </select>
              </div>

              {/* Obras */}
              <div style={{ width: 110, flexShrink: 0, padding: '8px 10px', fontSize: 11, color: T.ink2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {obrasLabel(u)}
              </div>

              {/* Cajas */}
              <div style={{ width: 100, flexShrink: 0, padding: '8px 10px', fontSize: 11, color: T.ink2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {cajasLabel(u)}
              </div>

              {PERM_COLS.map(col => (
                <div key={col.key} style={{ width: 60, flexShrink: 0, display: 'flex', justifyContent: 'center', padding: '8px 4px' }}>
                  <PermToggle on={u.permisos?.[col.key]} onChange={() => togglePermiso(u.id, col.key)} />
                </div>
              ))}

              <div style={{ width: 70, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '4px 6px' }}>
                <span
                  title="Editar accesos"
                  style={{ fontSize: 12, color: T.accent, cursor: 'pointer', fontWeight: 700, whiteSpace: 'nowrap' }}
                  onClick={() => setEditAccesos(u)}>
                  accesos
                </span>
                <span style={{ color: T.faint2, fontSize: 16, cursor: 'pointer' }}
                  onClick={() => { if (confirm(`¿Eliminar usuario ${u.nombre}?`)) removeUsuario(u.id); }}>×</span>
              </div>
            </div>
          ))}
        </Box>
      )}

      {tab === 'roles' && (
        <Box style={{ padding: 16 }}>
          <div style={{ fontSize: 12, color: T.ink2, marginBottom: 14 }}>
            Los roles base definen permisos predeterminados. Al asignar un rol a un usuario, sus permisos se resetean a estos valores. Cada permiso puede ajustarse individualmente por usuario en la pestaña Usuarios.
          </div>
          <div style={{ fontSize: 11, overflowX: 'auto' }}>
            <div style={{ display: 'flex', background: T.faint, borderBottom: `1px solid ${T.faint2}` }}>
              <div style={{ width: 160, flexShrink: 0, padding: '6px 12px', fontWeight: 700, fontSize: 10, textTransform: 'uppercase' }}>Rol</div>
              {PERM_COLS.map(col => (
                <div key={col.key} style={{ flex: 1, minWidth: 70, padding: '6px 4px', fontWeight: 700, fontSize: 8, textTransform: 'uppercase', letterSpacing: 0.3, textAlign: 'center' }}>
                  {col.label}
                </div>
              ))}
              <div style={{ width: 30, flexShrink: 0 }} />
            </div>
            {Object.entries(roles).map(([rolName, perms]) => {
              const enUso = usuarios.some(u => u.rol === rolName);
              return (
                <div key={rolName} style={{ display: 'flex', borderBottom: `1px solid ${T.faint2}`, alignItems: 'center' }}>
                  <div style={{ width: 160, flexShrink: 0, padding: '8px 12px' }}>
                    <Chip style={{ fontSize: 10 }}>{rolName}</Chip>
                  </div>
                  {PERM_COLS.map(col => (
                    <div key={col.key} style={{ flex: 1, minWidth: 70, padding: '8px 4px', display: 'flex', justifyContent: 'center' }}>
                      <PermToggle on={perms[col.key]} onChange={() => updateRol(rolName, col.key)} />
                    </div>
                  ))}
                  <div style={{ width: 30, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
                    <span
                      title={enUso ? `${usuarios.filter(u => u.rol === rolName).length} usuario(s) usan este rol` : 'Eliminar rol'}
                      style={{ color: enUso ? T.faint2 : T.accent, cursor: enUso ? 'not-allowed' : 'pointer', fontSize: 16, userSelect: 'none' }}
                      onClick={() => {
                        if (enUso) return;
                        if (confirm(`¿Eliminar el rol "${rolName}"? Esta acción no se puede deshacer.`)) removeRol(rolName);
                      }}>×</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 10, color: T.ink3, marginTop: 10 }}>
            Los cambios en roles base solo afectan a nuevos usuarios o cuando se reasigna el rol. Los permisos individuales existentes no se modifican automáticamente.
          </div>
        </Box>
      )}

      {modalNuevo && <NuevoUsuarioModal obras={obras} cajas={cajas} onClose={() => setModalNuevo(false)} />}
      {editAccesos && <EditarAccesosModal usuario={editAccesos} obras={obras} cajas={cajas} onClose={() => setEditAccesos(null)} />}
    </PageLayout>
  );
}
