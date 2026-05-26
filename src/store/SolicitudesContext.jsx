import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { loadSharedData, saveSharedData } from '../lib/dbHelpers';
import { onRemoteChange } from '../lib/syncBus';

const CTX = createContext(null);
const LS_KEY = 'kamak_solicitudes_v1';
const newId = () => `sol-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;

function load() {
  try {
    const s = localStorage.getItem(LS_KEY);
    if (s) return JSON.parse(s);
  } catch {}
  return [];
}

function persist(data) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch {}
}

export function SolicitudesProvider({ children }) {
  const [solicitudes, setSolicitudes] = useState(load);
  const sbLoaded   = useRef(false);
  const fromRemote = useRef(false);

  useEffect(() => {
    let cancelled = false;
    loadSharedData('solicitudes').then(data => {
      if (cancelled) return;
      if (data) {
        fromRemote.current = true;
        setSolicitudes(data);
        persist(data);
        setTimeout(() => { fromRemote.current = false; }, 0);
      }
      sbLoaded.current = true;
    });

    const unsub = onRemoteChange('solicitudes', () => {
      loadSharedData('solicitudes').then(d => {
        if (cancelled || !d) return;
        fromRemote.current = true;
        setSolicitudes(d);
        persist(d);
        setTimeout(() => { fromRemote.current = false; }, 0);
      });
    });
    return () => { cancelled = true; unsub(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pendingSaveRef = useRef(null);
  useEffect(() => {
    persist(solicitudes);
    if (!sbLoaded.current || fromRemote.current) return;
    pendingSaveRef.current = solicitudes;
    const t = setTimeout(() => {
      saveSharedData('solicitudes', solicitudes);
      pendingSaveRef.current = null;
    }, 800);
    return () => clearTimeout(t);
  }, [solicitudes]);

  useEffect(() => () => {
    if (pendingSaveRef.current) saveSharedData('solicitudes', pendingSaveRef.current, { silent: true });
  }, []);

  const addSolicitud = useCallback((data) => {
    const nueva = {
      ...data,
      id: newId(),
      estado: 'pendiente',
      creadoAt: new Date().toISOString(),
    };
    setSolicitudes(prev => [nueva, ...prev]);
    return nueva.id;
  }, []);

  const resolveSolicitud = useCallback((id, estado, resolvedBy) => {
    setSolicitudes(prev => prev.map(s =>
      s.id === id ? { ...s, estado, resolvedBy, resolvedAt: new Date().toISOString() } : s
    ));
  }, []);

  return (
    <CTX.Provider value={{ solicitudes, addSolicitud, resolveSolicitud }}>
      {children}
    </CTX.Provider>
  );
}

export const useSolicitudes = () => useContext(CTX);
