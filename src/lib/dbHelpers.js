import { createClient } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { broadcastChange } from './syncBus';

// Throttle interno para no spamear el mismo toast cuando la red esta caida
// y cada provider intenta guardar al mismo tiempo. Mostramos como mucho un
// toast cada 30 segundos (antes 5s — molestaba al usuario en intermitencias
// cortas de red que se resolvian solas).
let _lastToastAt = 0;
const _fireErrorToast = (msg) => {
  const now = Date.now();
  if (now - _lastToastAt < 30000) return;
  _lastToastAt = now;
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('kamak:toast', { detail: { type: 'error', msg } }));
};

// Reintento exponencial corto: 200ms, 500ms, 1.2s. Si todos fallan, ahi si
// disparamos el toast. Cubre el caso comun de un blip de red de 1-2 segundos.
const _retry = async (fn, attempts = 3) => {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fn();
      // Si la respuesta trae error, lo tratamos como excepcion para reintentar.
      if (res && res.error) { lastErr = res.error; }
      else return res;
    } catch (e) { lastErr = e; }
    if (i < attempts - 1) await new Promise(r => setTimeout(r, [200, 500, 1200][i]));
  }
  // Devolvemos un objeto con error para que el caller lo loggee/notifique.
  return { error: lastErr };
};

// Llama la Edge Function admin-users (requiere que exista en Supabase)
export async function adminAction(action, payload) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return { error: 'Sin sesión activa' };

    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    });

    if (!res.ok && res.status !== 200) {
      const text = await res.text();
      console.error('adminAction error response:', res.status, text);
      return { error: `Error ${res.status}: ${text.slice(0, 200)}` };
    }

    return res.json();
  } catch (e) {
    console.error('adminAction exception:', e);
    return { error: e.message || 'Error de red' };
  }
}

// loadUserData/saveUserData eliminados: no se usaban en ningun lado.
// Si en el futuro hace falta data per-usuario, ver el git log para
// recuperar la implementacion.

// Crea un usuario en Supabase Auth sin afectar la sesión actual del admin
export async function createAuthUser(email, password) {
  const tempClient = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
  );
  return tempClient.auth.signUp({ email, password });
}

// Devuelve:
//   - el dato si existe en la tabla
//   - null si la query funciono pero no hay registro para esa key
//   - undefined si hubo error de red/permiso (importante: los providers
//     usan esto para NO disparar un save de SEED que tambien fallaria
//     con el mismo error, evitando spam de 401)
export async function loadSharedData(key) {
  // Guard: sin sesion, NO disparar toast. El portal publico del cliente carga
  // providers (ObrasContext etc.) sin auth — esos fetchs darian 401/403 y le
  // mostrarian "Sin conexion..." al cliente, lo cual es incorrecto (no es un
  // problema de red, es que esta ruta usa el endpoint /api/portal/data).
  const { data: { session } } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
  if (!session) return undefined;

  const res = await _retry(async () => {
    const r = await supabase.from('shared_data').select('data').eq('key', key).maybeSingle();
    return r;
  });
  if (res && res.error) {
    console.error('[loadSharedData] error tras reintentos:', key, res.error);
    _fireErrorToast('Sin conexión con la base de datos. Reintentando…');
    return undefined;
  }
  return res?.data?.data ?? null;
}

// Edita (merge) UN ítem por id dentro de una key cuyo data es un array, de forma
// ATÓMICA (RPC server-side patch_item_in_shared_array): NO reescribe el array
// entero, así no pisa ítems que el bot u otra pestaña agregaron en paralelo.
// Fallback a read-modify-write si el RPC no está disponible.
export async function patchItemInSharedArray(key, id, patch) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return false;
    const { error } = await supabase.rpc('patch_item_in_shared_array', { p_key: key, p_id: id, p_patch: patch });
    if (error) throw error;
    broadcastChange(key);
    return true;
  } catch (e) {
    console.error('[patchItemInSharedArray] fallback RMW:', key, e?.message || e);
    const data = await loadSharedData(key);
    const arr = Array.isArray(data) ? data : [];
    return saveSharedData(key, arr.map(x => x.id === id ? { ...x, ...patch } : x));
  }
}

export async function saveSharedData(key, value, { silent = false } = {}) {
  try {
    // Guard: si no hay sesion auth activa, no intentar guardar.
    // El portal publico del cliente carga los providers sin auth — esos
    // saves fallarian con 401/403 y mostrarian el toast "No se pudo
    // guardar..." al cliente, lo cual es feo y confuso (el cliente solo
    // lee, no necesita guardar nada).
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return false; // silencioso, sin toast
    }

    const res = await _retry(async () => supabase.from('shared_data').upsert(
      { key, data: value, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    ));
    if (res && res.error) {
      console.error('[saveSharedData] error tras reintentos:', key, res.error);
      _fireErrorToast('No se pudo guardar. Tus cambios quedan en este dispositivo y se reenvían cuando haya conexión.');
      return false;
    }
    if (!silent) broadcastChange(key);
    return true;
  } catch (e) {
    console.error('[saveSharedData] exception:', key, e);
    _fireErrorToast('No se pudo guardar. Tus cambios quedan en este dispositivo y se reenvían cuando haya conexión.');
    return false;
  }
}
