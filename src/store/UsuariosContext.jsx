import { createContext, useContext, useState, useCallback } from 'react';

const CTX = createContext(null);
const LS_KEY = 'kamak_usuarios_v1';
const SESSION_KEY = 'kamak_session_v1';
const ROLES_LS_KEY = 'kamak_roles_v1';

const newId = () => `usr-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;

const PERMISOS_DEFAULT = {
  verCostos: false, verMargenes: false, verCaja: false,
  cargarGastos: false, cargarAvance: false, editarPresu: false,
  aprobarPagos: false, crearObra: false, verDashboard: false,
};

// Hardcoded defaults — exported for backward compat; prefer roles from context
export const ROLES = {
  Admin:              { verCostos:true, verMargenes:true, verCaja:true, cargarGastos:true, cargarAvance:true, editarPresu:true, aprobarPagos:true, crearObra:true, verDashboard:true },
  Administración:     { verCostos:true, verMargenes:false, verCaja:true, cargarGastos:true, cargarAvance:false, editarPresu:false, aprobarPagos:true, crearObra:false, verDashboard:true },
  Comprador:          { verCostos:true, verMargenes:false, verCaja:false, cargarGastos:true, cargarAvance:false, editarPresu:false, aprobarPagos:false, crearObra:false, verDashboard:false },
  'Director de obra': { verCostos:false, verMargenes:false, verCaja:false, cargarGastos:false, cargarAvance:true, editarPresu:false, aprobarPagos:false, crearObra:false, verDashboard:false },
  'Contador externo': { verCostos:true, verMargenes:false, verCaja:true, cargarGastos:false, cargarAvance:false, editarPresu:false, aprobarPagos:false, crearObra:false, verDashboard:true },
};

const SEED = [
  { id: 'usr-pablo',  nombre: 'Pablo',  email: 'kamakdesarrollos@gmail.com', password: '1234',       rol: 'Admin',            obrasVisibles: '*', cajasVisibles: '*', tabsOcultos: [], permisos: ROLES['Admin'] },
  { id: 'usr-socio',  nombre: 'Socio',  email: 'socio@kamak',                password: 'socio123',  rol: 'Admin',            obrasVisibles: '*', cajasVisibles: '*', tabsOcultos: [], permisos: ROLES['Admin'] },
  { id: 'usr-maria',  nombre: 'María',  email: 'maria@kamak',  password: 'maria123',  rol: 'Administración',   obrasVisibles: '*', cajasVisibles: ['cj-galicia','cj-mp','cj-gal-u'], tabsOcultos: ['Contratos MO'], permisos: ROLES['Administración'] },
  { id: 'usr-juan',   nombre: 'Juan',   email: 'juan@kamak',   password: 'juan123',   rol: 'Comprador',        obrasVisibles: ['baradero','san-isidro'], cajasVisibles: ['cj-juan-r','cj-bara'], tabsOcultos: ['Resumen','Presupuesto','Cuenta cliente','Contratos MO'], permisos: ROLES['Comprador'] },
  { id: 'usr-marcos', nombre: 'Marcos', email: 'marcos@kamak', password: 'marcos123', rol: 'Comprador',        obrasVisibles: ['pilar','recoleta'], cajasVisibles: ['cj-marcos-r'], tabsOcultos: ['Resumen','Presupuesto','Cuenta cliente','Contratos MO'], permisos: ROLES['Comprador'] },
  { id: 'usr-carlos', nombre: 'Carlos', email: 'carlos@kamak', password: 'carlos123', rol: 'Director de obra', obrasVisibles: ['baradero','tigre'], cajasVisibles: [], tabsOcultos: ['Presupuesto','Cuenta cliente','Contratos MO'], permisos: ROLES['Director de obra'] },
  { id: 'usr-lucia',  nombre: 'Lucía',  email: 'lucia@kamak',  password: 'lucia123',  rol: 'Director de obra', obrasVisibles: ['san-isidro'], cajasVisibles: [], tabsOcultos: ['Presupuesto','Cuenta cliente','Contratos MO'], permisos: ROLES['Director de obra'] },
  { id: 'usr-diego',  nombre: 'Diego',  email: 'contador@ext', password: 'diego123',  rol: 'Contador externo', obrasVisibles: '*', cajasVisibles: ['cj-galicia','cj-mp','cj-gal-u','cj-pablo','cj-socio','cj-pablo-u','cj-socio-u'], tabsOcultos: [], permisos: ROLES['Contador externo'] },
];

// ── Persistence helpers ───────────────────────────────────────────────────────

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

function load() {
  try {
    const s = localStorage.getItem(LS_KEY);
    if (s) {
      const saved = JSON.parse(s);
      const savedIds = new Set(saved.map(x => x.id));
      const missing = SEED.filter(x => !savedIds.has(x.id));
      const patched = saved.map(u => {
        const seed = SEED.find(s => s.id === u.id);
        if (seed) return {
          ...u,
          email: seed.email,
          password: seed.password,
          obrasVisibles: Array.isArray(u.obrasVisibles) || u.obrasVisibles === '*' ? u.obrasVisibles : seed.obrasVisibles,
          cajasVisibles: Array.isArray(u.cajasVisibles) || u.cajasVisibles === '*' ? u.cajasVisibles : seed.cajasVisibles,
          tabsOcultos: Array.isArray(u.tabsOcultos) ? u.tabsOcultos : seed.tabsOcultos,
        };
        return {
          ...u,
          password: u.password || '1234',
          obrasVisibles: Array.isArray(u.obrasVisibles) || u.obrasVisibles === '*' ? u.obrasVisibles : '*',
          cajasVisibles: Array.isArray(u.cajasVisibles) || u.cajasVisibles === '*' ? u.cajasVisibles : [],
          tabsOcultos: Array.isArray(u.tabsOcultos) ? u.tabsOcultos : [],
        };
      });
      return missing.length ? [...patched, ...missing] : patched;
    }
  } catch {}
  return SEED;
}

function persist(data) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch {}
}

function saveSession(user) {
  try {
    if (user) localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    else localStorage.removeItem(SESSION_KEY);
  } catch {}
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

// Loads users + refreshes session from latest user data in one shot
function initStore() {
  const users = load();
  let currentUser = null;
  try {
    const raw = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (raw) {
      const u = users.find(u => u.id === raw.id);
      if (u) {
        currentUser = buildSession(u);
        saveSession(currentUser);
      } else {
        currentUser = raw;
      }
    }
  } catch {}
  return [users, currentUser];
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function UsuariosProvider({ children }) {
  const [[initUsers, initSession]] = useState(initStore);
  const [usuarios, setUsuarios] = useState(initUsers);
  const [currentUser, setCurrentUser] = useState(initSession);
  const [roles, setRoles] = useState(loadRoles);

  const set = useCallback((fn) => {
    setUsuarios(prev => {
      const next = typeof fn === 'function' ? fn(prev) : fn;
      persist(next);
      return next;
    });
  }, []);

  const login = useCallback((email, password) => {
    const u = usuarios.find(
      u => u.email.toLowerCase() === email.trim().toLowerCase() && u.password === password
    );
    if (!u) return { ok: false, error: 'Usuario o contraseña incorrectos.' };
    const session = buildSession(u);
    saveSession(session);
    setCurrentUser(session);
    return { ok: true };
  }, [usuarios]);

  // Auto-login por email (usado cuando Supabase Auth ya autenticó al usuario)
  const loginByEmail = useCallback((email) => {
    const u = usuarios.find(u => u.email.toLowerCase() === email.trim().toLowerCase());
    if (u) {
      const session = buildSession(u);
      saveSession(session);
      setCurrentUser(session);
    } else {
      // Email no existe en UsuariosContext → sesión Admin por defecto
      const session = { id: 'supabase', nombre: email.split('@')[0], email, rol: 'Admin', permisos: ROLES['Admin'], cajasVisibles: '*', obrasVisibles: '*', tabsOcultos: [] };
      saveSession(session);
      setCurrentUser(session);
    }
  }, [usuarios]);

  const logout = useCallback(() => {
    saveSession(null);
    setCurrentUser(null);
  }, []);

  const addUsuario = useCallback((data) => {
    const rol = data.rol || 'Comprador';
    const nuevo = {
      cajasVisibles: [],
      obrasVisibles: '*',
      tabsOcultos: [],
      ...data,
      id: newId(),
      password: data.password || '1234',
      permisos: { ...PERMISOS_DEFAULT, ...(roles[rol] || {}), ...(data.permisos || {}) },
    };
    set(prev => [...prev, nuevo]);
    return nuevo.id;
  }, [set, roles]);

  const updateUsuario = useCallback((id, changes) => {
    set(prev => prev.map(u => u.id === id ? { ...u, ...changes } : u));
    setCurrentUser(prev => {
      if (prev?.id !== id) return prev;
      const next = { ...prev, ...changes };
      saveSession(next);
      return next;
    });
  }, [set]);

  const removeUsuario = useCallback((id) => {
    set(prev => prev.filter(u => u.id !== id));
  }, [set]);

  const togglePermiso = useCallback((id, permiso) => {
    set(prev => prev.map(u => u.id === id
      ? { ...u, permisos: { ...u.permisos, [permiso]: !u.permisos[permiso] } }
      : u));
  }, [set]);

  const applyRol = useCallback((id, rol) => {
    set(prev => prev.map(u => u.id === id
      ? { ...u, rol, permisos: { ...PERMISOS_DEFAULT, ...(roles[rol] || {}) } }
      : u));
  }, [set, roles]);

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

  return (
    <CTX.Provider value={{ usuarios, currentUser, login, loginByEmail, logout, addUsuario, updateUsuario, removeUsuario, togglePermiso, applyRol, roles, updateRol, removeRol }}>
      {children}
    </CTX.Provider>
  );
}

export const useUsuarios = () => useContext(CTX);
