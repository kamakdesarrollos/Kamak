// Activación/desactivación del push web desde el cliente. Registra el SW propio
// SÓLO cuando el usuario lo pide (no en cada carga). Guarda la subscription en
// shared_data 'push_subscriptions' vía el client de Supabase (sin endpoint).
import { supabase } from './supabase';
import { newId } from './id';

const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY;

export function pushSoportado() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function leerSubs() {
  const { data } = await supabase.from('shared_data').select('data').eq('key', 'push_subscriptions').maybeSingle();
  return Array.isArray(data?.data) ? data.data : [];
}
async function guardarSubs(subs) {
  await supabase.from('shared_data').upsert({ key: 'push_subscriptions', data: subs }, { onConflict: 'key' });
}

export async function pushActivo() {
  if (!pushSoportado()) return false;
  const reg = await navigator.serviceWorker.getRegistration('/sw-push.js');
  if (!reg) return false;
  const sub = await reg.pushManager.getSubscription();
  return !!sub;
}

export async function activarPush(userId) {
  if (!pushSoportado()) throw new Error('Este dispositivo no soporta notificaciones push.');
  if (!VAPID_PUBLIC) throw new Error('Falta VITE_VAPID_PUBLIC_KEY.');
  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') throw new Error('No diste permiso de notificaciones.');
  const reg = await navigator.serviceWorker.register('/sw-push.js');
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC) });
  const subs = await leerSubs();
  const endpoint = sub.endpoint;
  const sinEsta = subs.filter(s => s.sub?.endpoint !== endpoint);
  sinEsta.push({ id: newId('sub'), userId, sub: sub.toJSON(), device: navigator.userAgent.slice(0, 80), creadoAt: new Date().toISOString() });
  await guardarSubs(sinEsta);
  return true;
}

export async function desactivarPush() {
  const reg = await navigator.serviceWorker.getRegistration('/sw-push.js');
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    const subs = await leerSubs();
    await guardarSubs(subs.filter(s => s.sub?.endpoint !== sub.endpoint));
    await sub.unsubscribe();
  }
}
