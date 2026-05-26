import { createClient } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { broadcastChange } from './syncBus';

// Throttle interno para no spamear el mismo toast cuando la red esta caida
// y cada provider intenta guardar al mismo tiempo. Mostramos como mucho un
// toast cada 5 segundos.
let _lastToastAt = 0;
const _fireErrorToast = (msg) => {
  const now = Date.now();
  if (now - _lastToastAt < 5000) return;
  _lastToastAt = now;
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('kamak:toast', { detail: { type: 'error', msg } }));
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
  try {
    const { data, error } = await supabase.from('shared_data').select('data').eq('key', key).maybeSingle();
    if (error) {
      console.error('[loadSharedData] error:', key, error);
      _fireErrorToast('Sin conexión con la base de datos. Reintentando…');
      return undefined; // error -> distinto de "no hay datos"
    }
    return data?.data ?? null;
  } catch (e) {
    console.error('[loadSharedData] exception:', key, e);
    _fireErrorToast('Sin conexión con la base de datos. Reintentando…');
    return undefined; // error -> distinto de "no hay datos"
  }
}

export async function saveSharedData(key, value, { silent = false } = {}) {
  try {
    const { error } = await supabase.from('shared_data').upsert(
      { key, data: value, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
    if (error) {
      console.error('[saveSharedData] error:', key, error);
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
