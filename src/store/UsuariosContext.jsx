import { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { adminAction } from '../lib/dbHelpers';
import { useAppLoading } from './AppLoadingContext';

const CTX = createContext(null);
const SESSION_KEY  = 'kamak_session_v1';
const ROLES_LS_KEY = 'kamak_roles_v1';

const PERMISOS_DEFAULT = {
  verCostos: false, verMargenes: false, verCaja: false,
  cargarGastos: false, cargarAvance: false, editarPresu: false,
  aprobarPagos: false, crearObra: false, verDashboard: false,
};

// Roles del sistema. REGLA GLOBAL: ningún no-admin ve montos generales de obra
// (verCostos/verMargenes false) ni la plata de otros (verCaja = solo su caja, vía
// cajasVisibles). El acceso por sección/pestaña NO sale de estos 9 flags sino del
// Sidebar (allowedRoles) y de rolHiddenTabs por rol — ver Sidebar.jsx / ObraPresupuesto.jsx.
export const ROLES = {
  Admin:                 { verCostos:true,  verMargenes:true,  verCaja:true, cargarGastos:true,  cargarAvance:true,  editarPresu:true,  aprobarPagos:true,  crearObra:true,  verDashboard:true },
  // Administración: backoffice (proveedores/clientes/facturación/gastos fijos completo,
  // registra pagos a proveedores). NO ve costos/márgenes/valor de obra. Caja propia.
  Administración:        { verCostos:false, verMargenes:false, verCaja:true, cargarGastos:true,  cargarAvance:false, editarPresu:false, aprobarPagos:true,  crearObra:false, verDashboard:true },
  // Jefe de obra: ejecución (tareas, avance, materiales, archivos). Caja propia. Sin plata general.
  'Jefe de obra':        { verCostos:false, verMargenes:false, verCaja:true, cargarGastos:true,  cargarAvance:true,  editarPresu:false, aprobarPagos:false, crearObra:false, verDashboard:false },
  // Logística y compras: compra materiales (carga gastos, ve proveedores). Caja propia.
  // El precio de los materiales para comprar se ve en la pestaña Materiales (no en el total de obra).
  'Logística y compras': { verCostos:false, verMargenes:false, verCaja:true, cargarGastos:true,  cargarAvance:false, editarPresu:false, aprobarPagos:false, crearObra:false, verDashboard:false },
  // Contador externo: solo Facturación (rol especial, se mantiene).
  'Contador externo':    { verCostos:false, verMargenes:false, verCaja:true, cargarGastos:false, cargarAvance:false, editarPresu:false, aprobarPagos:false, crearObra:false, verDashboard:false },
};

// Pestañas DENTRO de la obra ocultas por rol (solo aplica a no-admin; Admin ve todo).
// TABS_DEF: Resumen, Cuenta corriente, Presupuesto, Materiales, Gantt, Movimientos,
// Contratos MO, Archivos, Portal cliente. Resumen/Cuenta corriente/Presupuesto/
// Movimientos exponen montos generales de obra → ocultos a TODO no-admin.
export const ROL_TABS_OCULTAS_DEFAULT = ['Resumen', 'Cuenta corriente', 'Presupuesto', 'Movimientos', 'Contratos MO', 'Portal cliente'];
export const ROL_TABS_OCULTAS = {
  Administración:        ['Resumen', 'Cuenta corriente', 'Presupuesto', 'Movimientos', 'Portal cliente'],                                     // ve: Materiales, Gantt, Contratos MO, Archivos
  'Jefe de obra':        ['Resumen', 'Cuenta corriente', 'Presupuesto', 'Movimientos', 'Contratos MO', 'Portal cliente'],                     // ve: Materiales, Gantt, Archivos
  'Logística y compras': ['Resumen', 'Cuenta corriente', 'Presupuesto', 'Gantt', 'Movimientos', 'Contratos MO', 'Portal cliente'],           // ve: Materiales, Archivos
  'Contador externo':    ['Resumen', 'Cuenta corriente', 'Presupuesto', 'Materiales', 'Gantt', 'Movimientos', 'Contratos MO', 'Archivos', 'Portal cliente'],
};

// ── Conversión entre formato DB y formato app ─────────────────────────────────
function rowToUser(row) {
  return {
    id: row.id,
    nombre: row.nombre,
    email: row.email,
    rol: row.rol,
    permisos: row.permisos || {},
    obrasVisibles: row.obras_visibles ?? '*',
    cajasVisibles: row.cajas_visibles ?? [],
    tabsOcultos: row.tabs_ocultos ?? [],
  };
}

function userToRow(u) {
  return {
    nombre: u.nombre,
    email: u.email,
    rol: u.rol,
    permisos: u.permisos || {},
    obras_visibles: u.obrasVisibles ?? '*',
    cajas_visibles: u.cajasVisibles ?? [],
    tabs_ocultos: u.tabsOcultos ?? [],
    updated_at: new Date().toISOString(),
  };
}

// ── Session helpers ───────────────────────────────────────────────────────────
function saveSession(user) {
  try {
    if (user) localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    else localStorage.removeItem(SESSION_KEY);
  } catch {}
}

function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
}

function buildSession(u) {
  return {
    id: u.id,
    nombre: u.nombre,
    email: u.email,
    rol: u.rol,
    permisos: u.permisos,
    cajasVisibles: u.cajasVisibles ?? '*',
    obrasVisibles: u.obrasVisibles ?? '*',
    tabsOcultos: u.tabsOcultos ?? [],
  };
}

function loadRoles() {
  try {
    const s = localStorage.getItem(ROLES_LS_KEY);
    if (s) {
      const saved = JSON.parse(s);
      return Object.fromEntries(Object.keys(ROLES).map(r => [r, { ...ROLES[r], ...(saved[r] || {}) }]));
    }
  } catch {}
  return { ...ROLES };
}

function persistRoles(r) {
  try { localStorage.setItem(ROLES_LS_KEY, JSON.stringify(r)); } catch {}
}

// Cache de usuarios en localStorage para que la app no espere a Supabase
// al inicio. Si hay cache, mostramos esa lista al toque y refrescamos en
// background. Sin esto, la app espera ~1s al fetch de app_users en cada
// carga, lo que retrasa el render.
const LS_USUARIOS = 'kamak_usuarios_cache_v1';
const loadUsuariosCache = () => {
  try { const r = localStorage.getItem(LS_USUARIOS); return r ? JSON.parse(r) : []; } catch { return []; }
};
const saveUsuariosCache = (v) => {
  try { localStorage.setItem(LS_USUARIOS, JSON.stringify(v)); } catch { /* sin storage */ }
};

// ── Provider ──────────────────────────────────────────────────────────────────
export function UsuariosProvider({ children }) {
  const [usuarios, setUsuarios] = useState(loadUsuariosCache);
  const [currentUser, setCurrentUser] = useState(loadSession);
  const [roles, setRoles] = useState(loadRoles);
  // Si hay cache de usuarios, loading parte en false (la app puede renderear
  // ya mismo con esa lista). Sin cache, esperamos a Supabase.
  const [loading, setLoading] = useState(() => loadUsuariosCache().length === 0);
  const { markReady } = useAppLoading();

  // Carga desde Supabase al montar (re-corre al remontar tras cambio de usuario)
  useEffect(() => {
    let cancelled = false;
    supabase.from('app_users').select('*').then(({ data, error }) => {
      if (cancelled) return;
      if (!error && data) {
        const u = data.map(rowToUser);
        setUsuarios(u);
        saveUsuariosCache(u);
        // Reconciliar la sesión del usuario logueado con sus datos ACTUALES de la
        // DB. currentUser se arma en login (buildSession → localStorage) y nunca se
        // refrescaba: si un Admin le cambiaba el rol, los permisos o las
        // cajasVisibles, el usuario seguía con la sesión vieja hasta cerrar sesión
        // (ej: "le asigné una caja y no le aparece"). Acá lo refrescamos en cada carga.
        setCurrentUser(prev => {
          if (!prev) return prev;
          const fresh = u.find(x => x.id === prev.id)
            || u.find(x => (x.email || '').toLowerCase() === (prev.email || '').toLowerCase());
          if (!fresh) return prev; // no encontrado: mantener sesión (no forzar logout por un fetch raro)
          const next = buildSession(fresh);
          if (JSON.stringify(next) === JSON.stringify(prev)) return prev;
          saveSession(next);
          return next;
        });
      }
      setLoading(false);
      markReady();
    });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-insertar usuario actual como Admin si la tabla está vacía
  const bootstrapAdmin = useCallback(async (email, nombre) => {
    const { data: existing } = await supabase.from('app_users').select('id').eq('email', email).maybeSingle();
    if (existing) return;
    const row = userToRow({ nombre: nombre || email.split('@')[0], email, rol: 'Admin', permisos: ROLES['Admin'], obrasVisibles: '*', cajasVisibles: '*', tabsOcultos: [] });
    const { data, error } = await supabase.from('app_users').insert(row).select().single();
    if (!error && data) setUsuarios([rowToUser(data)]);
  }, []);

  // ── CRUD ──────────────────────────────────────────────────────────────────
  const addUsuario = useCallback(async (data) => {
    const rol = data.rol || 'Jefe de obra';
    const nuevo = {
      nombre: data.nombre,
      email: data.email,
      rol,
      permisos: { ...PERMISOS_DEFAULT, ...(roles[rol] || {}), ...(data.permisos || {}) },
      obrasVisibles: data.obrasVisibles ?? '*',
      cajasVisibles: data.cajasVisibles ?? [],
      tabsOcultos: data.tabsOcultos ?? [],
    };
    const { data: row, error } = await supabase.from('app_users').insert(userToRow(nuevo)).select().single();
    if (!error && row) setUsuarios(prev => [...prev, rowToUser(row)]);
    return row?.id;
  }, [roles]);

  const updateUsuario = useCallback(async (id, changes) => {
    const u = usuarios.find(u => u.id === id);
    if (!u) return { error: { message: 'Usuario no encontrado en la lista.' } };
    const merged = { ...u, ...changes };
    // El guardado lo hace el SERVIDOR con la service key (endpoint /api/admin/update-user):
    // así NO depende de la policy RLS is_admin(). El UPDATE directo desde el browser
    // afectaba 0 filas EN SILENCIO cuando is_admin() evaluaba en falso, y el cambio
    // (rol / cajas visibles / permisos / accesos) nunca persistía. El server valida
    // con la service key que el que llama es Admin antes de escribir.
    let resp;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return { error: { message: 'No hay sesión activa. Cerrá sesión y volvé a entrar.' } };
      const r = await fetch('/api/admin/update-user', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, changes }),
      });
      resp = await r.json().catch(() => ({}));
      if (!r.ok || resp?.error) {
        console.error('[updateUsuario] endpoint falló:', r.status, resp?.error);
        return { error: { message: resp?.error || `Error ${r.status} al guardar` } };
      }
    } catch (e) {
      console.error('[updateUsuario] error de red:', e);
      return { error: { message: e.message || 'Error de red al guardar' } };
    }
    // Éxito: reconciliar con la fila que devolvió el servidor (fuente de verdad).
    const fresh = resp?.user ? rowToUser(resp.user) : merged;
    setUsuarios(prev => prev.map(x => x.id === id ? fresh : x));
    setCurrentUser(prev => {
      if (prev?.id !== id) return prev;
      const next = { ...prev, ...changes };
      saveSession(next);
      return next;
    });
    // Devolvemos `user` con lo realmente grabado (del server) para confirmarlo en UI.
    return { error: null, user: fresh };
  }, [usuarios]);

  const removeUsuario = useCallback(async (id) => {
    const u = usuarios.find(u => u.id === id);
    const { error } = await supabase.from('app_users').delete().eq('id', id);
    if (!error) {
      setUsuarios(prev => prev.filter(u => u.id !== id));
      if (u?.email) adminAction('deleteUser', { email: u.email });
    }
  }, [usuarios]);

  const togglePermiso = useCallback(async (id, permiso) => {
    const u = usuarios.find(u => u.id === id);
    if (!u) return;
    const newPermisos = { ...u.permisos, [permiso]: !u.permisos[permiso] };
    await updateUsuario(id, { permisos: newPermisos });
  }, [usuarios, updateUsuario]);

  const applyRol = useCallback(async (id, rol) => {
    await updateUsuario(id, { rol, permisos: { ...PERMISOS_DEFAULT, ...(roles[rol] || {}) } });
  }, [updateUsuario, roles]);

  // ── Roles (localStorage) ──────────────────────────────────────────────────
  const updateRol = useCallback((rolName, permiso) => {
    setRoles(prev => {
      const next = { ...prev, [rolName]: { ...prev[rolName], [permiso]: !prev[rolName][permiso] } };
      persistRoles(next);
      return next;
    });
  }, []);

  const removeRol = useCallback((rolName) => {
    setRoles(prev => {
      const { [rolName]: _, ...next } = prev;
      persistRoles(next);
      return next;
    });
  }, []);

  // ── Sesión ────────────────────────────────────────────────────────────────
  const loginByEmail = useCallback((email) => {
    const u = usuarios.find(u => u.email.toLowerCase() === email.trim().toLowerCase());
    if (u) {
      const session = buildSession(u);
      saveSession(session);
      setCurrentUser(session);
    } else {
      // Usuario no registrado en app_users → sin acceso.
      // (Antes habia un fallback que auto-promovia a Admin si la tabla estaba
      // vacia o si la query fallaba — escalada de privilegios trivial.)
      saveSession(null);
      setCurrentUser(null);
    }
  }, [usuarios]);

  const logout = useCallback(() => {
    saveSession(null);
    setCurrentUser(null);
    // Item 3.10: limpiar todas las keys kamak_* del localStorage al logout
    // asi el siguiente usuario en la misma maquina no ve residuos del anterior
    // (preferencias del dashboard, sesion, roles editados localmente, etc.).
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith('kamak_'))
        .forEach(k => localStorage.removeItem(k));
    } catch { /* sessionStorage / localStorage puede no estar disponible */ }
  }, []);

  // Memoizar el value: critico porque casi todas las paginas leen este context.
  const value = useMemo(
    () => ({ usuarios, currentUser, loading, loginByEmail, logout, addUsuario, updateUsuario, removeUsuario, togglePermiso, applyRol, bootstrapAdmin, roles, updateRol, removeRol }),
    [usuarios, currentUser, loading, loginByEmail, logout, addUsuario, updateUsuario, removeUsuario, togglePermiso, applyRol, bootstrapAdmin, roles, updateRol, removeRol]
  );

  return (
    <CTX.Provider value={value}>
      {children}
    </CTX.Provider>
  );
}

export const useUsuarios = () => useContext(CTX);
