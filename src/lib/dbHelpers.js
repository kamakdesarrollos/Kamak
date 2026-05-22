import { createClient } from '@supabase/supabase-js';
import { supabase } from './supabase';

// Llama la Edge Function admin-users (requiere que exista en Supabase)
export async function adminAction(action, payload) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return { error: 'Sin sesión' };

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  return res.json();
}

export async function loadUserData(key) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data, error } = await supabase
      .from('user_data')
      .select('data')
      .eq('user_id', user.id)
      .eq('key', key)
      .maybeSingle();
    if (error || !data) return null;
    return data.data;
  } catch { return null; }
}

// Crea un usuario en Supabase Auth sin afectar la sesión actual del admin
export async function createAuthUser(email, password) {
  const tempClient = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
  );
  return tempClient.auth.signUp({ email, password });
}

export async function saveUserData(key, value) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('user_data').upsert(
      { user_id: user.id, key, data: value, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,key' }
    );
  } catch (e) { console.error('saveUserData:', e); }
}
