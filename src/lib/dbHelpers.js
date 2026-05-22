import { supabase } from './supabase';

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
