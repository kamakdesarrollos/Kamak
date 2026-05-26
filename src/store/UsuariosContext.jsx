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

export const ROLES = {
  Admin:              { verCostos:true, verMargenes:true, verCaja:true, cargarGastos:true, cargarAvance:true, editarPresu:true, aprobarPagos:true, crearObra:true, verDashboard:true },
  Administración:     { verCostos:true, verMargenes:false, verCaja:true, cargarGastos:true, cargarAvance:false, editarPresu:false, aprobarPagos:true, crearObra:false, verDashboard:true },
  Comprador:          { verCostos:true, verMargenes:false, verCaja:false, cargarGastos:true, cargarAvance:false, editarPresu:false, aprobarPagos:false, crearObra:false, verDashboard:false },
  'Director de obra': { verCostos:false, verMargenes:false, verCaja:false, cargarGastos:false, cargarAvance:true, editarPresu:false, aprobarPagos:false, crearObra:false, verDashboard:false },
  'Contador externo': { verCostos:true, verMargenes:false, verCaja:true, cargarGastos:false, cargarAvance:false, editarPresu:false, aprobarPagos:false, crearObra:false, verDashboard:true },
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

// ── Provider ──────────────────────────────────────────────────────────────────
export function UsuariosProvider({ children }) {
  const [usuarios, setUsuarios] = useState([]);
  const [currentUser, setCurrentUser] = useState(loadSession);
  const [roles, setRoles] = useState(loadRoles);
  const [loading, setLoading] = useState(true);
  const { markReady } = useAppLoading();

  // Carga desde Supabase al montar (re-corre al remontar tras cambio de usuario)
  useEffect(() => {
    let cancelled = false;
    supabase.from('app_users').select('*').then(({ data, error }) => {
      if (cancelled) return;
      if (!error && data) setUsuarios(data.map(rowToUser));
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
    const rol = data.rol || 'Comprador';
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
    if (!u) return;
    const merged = { ...u, ...changes };
    const { error } = await supabase.from('app_users').update(userToRow(merged)).eq('id', id);
    if (!error) {
      setUsuarios(prev => prev.map(u => u.id === id ? merged : u));
      setCurrentUser(prev => {
        if (prev?.id !== id) return prev;
        const next = { ...prev, ...changes };
        saveSession(next);
        return next;
      });
    }
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
