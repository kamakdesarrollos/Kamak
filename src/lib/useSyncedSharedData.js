import { useState, useEffect, useRef, useCallback } from 'react';
import { loadSharedData, saveSharedData } from './dbHelpers';
import { onRemoteChange } from './syncBus';
import { useAppLoading } from '../store/AppLoadingContext';
import { SAVE_DEBOUNCE_MS } from './constants';
import { supabase } from './supabase';

// Save "keepalive" para el unmount/beforeunload. Bypassa el SDK de Supabase
// y usa fetch directo con keepalive:true, que el navegador mantiene en vuelo
// aunque la pagina se este cerrando. Asi un cambio editado + F5 rapido no
// se pierde.
async function saveSharedDataKeepalive(key, value) {
  try {
    const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/shared_data?on_conflict=key`;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    const session = await supabase.auth.getSession();
    const token = session?.data?.session?.access_token || anonKey;
    await fetch(url, {
      method: 'POST',
      keepalive: true,
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({ key, data: value, updated_at: new Date().toISOString() }),
    });
  } catch (e) {
    console.error('[saveSharedDataKeepalive] error:', e);
  }
}

/**
 * Hook que encapsula el patron compartido por casi todos los providers de
 * datos: cargar de localStorage inmediato, despues fetchar de Supabase,
 * suscribirse a cambios remotos (syncBus), debouncear writes, flushear
 * pendientes al desmontar.
 *
 * USO TIPICO:
 *
 *   const [cheques, setCheques] = useSyncedSharedData('cheques', SEED_CHEQUES, {
 *     lsKey: 'kamak_cheques_v1',
 *   });
 *
 * NO MANEJA (cada caller debe hacerlo a mano si lo necesita):
 * - State compuesto (multiples valores en el mismo shared_data key, ej. Obras
 *   tiene obras + detalles). Esos providers siguen con su patron manual.
 * - Logica especial de reseed (CatalogContext con SISMAT_SEED_VERSION).
 * - Merge con defaults (ConfiguracionContext).
 * - Fetch de fuentes externas (DolarContext con dolarapi.com).
 *
 * QUE SI MANEJA:
 * - Carga inicial de localStorage (sincrona) -> render inmediato
 * - Carga remota de Supabase shared_data[key] al montar
 * - Subscripcion a syncBus.onRemoteChange para sincronizar entre tabs
 * - Guard de cancelacion al desmontar (item 2.7)
 * - Debounce de writes (item 2.9 - flush al desmontar)
 * - Llama markReady() del AppLoadingContext
 * - Persiste en localStorage en cada cambio
 *
 * @param {string} key                Key de shared_data en Supabase
 * @param {*}      initial            Valor inicial si no hay nada en LS ni remoto
 * @param {object} opts
 * @param {string} opts.lsKey         Key de localStorage (opcional, sino no se persiste local)
 * @param {boolean} opts.skipMarkReady Si true, no llama markReady() (para Alertas / WAPending)
 * @returns {[state, setState]} igual que useState
 */
export default function useSyncedSharedData(key, initial, { lsKey, skipMarkReady = false } = {}) {
  // Carga inicial: localStorage si esta, sino el initial.
  const [state, setState] = useState(() => {
    if (!lsKey) return initial;
    try {
      const raw = localStorage.getItem(lsKey);
      return raw ? JSON.parse(raw) : initial;
    } catch {
      return initial;
    }
  });

  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  const sbLoaded   = useRef(false);
  const fromRemote = useRef(false);
  const pendingSaveRef = useRef(null);
  // Marca true cuando el usuario edita ANTES de que llegue el primer fetch
  // a Supabase. Sin esto, el remote pisa el cambio del usuario al cargar.
  const userEditedBeforeFirstLoad = useRef(false);

  const { markReady } = useAppLoading();

  // Persist a localStorage en cada cambio.
  useEffect(() => {
    if (!lsKey) return;
    try { localStorage.setItem(lsKey, JSON.stringify(state)); } catch { /* sin storage */ }
  }, [state, lsKey]);

  // Carga remota + suscripcion realtime.
  useEffect(() => {
    let cancelled = false;
    loadSharedData(key).then(data => {
      if (cancelled) return;
      // Si el usuario edito algo ANTES de que llegue este fetch, no pisamos
      // su cambio. En su lugar, lo subimos al remoto (gana el local).
      if (userEditedBeforeFirstLoad.current) {
        saveSharedData(key, stateRef.current);
      } else if (data !== null && data !== undefined) {
        fromRemote.current = true;
        setState(data);
        setTimeout(() => { fromRemote.current = false; }, 0);
      } else {
        // Primer save: subir el initial al remoto (no habia nada).
        saveSharedData(key, stateRef.current);
      }
      sbLoaded.current = true;
      if (!skipMarkReady) markReady();
    });

    const unsub = onRemoteChange(key, () => {
      loadSharedData(key).then(d => {
        if (cancelled || d === null || d === undefined) return;
        fromRemote.current = true;
        setState(d);
        setTimeout(() => { fromRemote.current = false; }, 0);
      });
    });

    return () => { cancelled = true; unsub(); };
  }, [key, markReady, skipMarkReady]);

  // Debounced save al cambiar el state (item 2.9).
  useEffect(() => {
    if (!sbLoaded.current || fromRemote.current) return;
    pendingSaveRef.current = state;
    const t = setTimeout(() => {
      saveSharedData(key, state);
      pendingSaveRef.current = null;
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [state, key]);

  // Flush pendiente al desmontar (item 2.9). Usa fetch con keepalive para
  // que el save sobreviva al unload/F5 — antes el fetch del SDK era cancelado
  // por el browser cuando la pagina se cerraba y el cambio se perdia.
  useEffect(() => () => {
    if (pendingSaveRef.current) saveSharedDataKeepalive(key, pendingSaveRef.current);
  }, [key]);

  // Tambien flusheamos en beforeunload (F5 / cerrar pestana) por las dudas
  // que el cleanup del useEffect no se ejecute a tiempo.
  useEffect(() => {
    const onBeforeUnload = () => {
      if (pendingSaveRef.current) saveSharedDataKeepalive(key, pendingSaveRef.current);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [key]);

  // Wrap setState para devolver una API estable. Si el usuario edita ANTES
  // de que llegue el primer fetch de Supabase, marcamos un flag para que
  // el load remoto no pise estos cambios.
  const setSynced = useCallback((next) => {
    if (!sbLoaded.current) userEditedBeforeFirstLoad.current = true;
    setState(prev => typeof next === 'function' ? next(prev) : next);
  }, []);

  return [state, setSynced];
}
