import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { loadSharedData, saveSharedData } from '../lib/dbHelpers';

const CTX = createContext(null);
const KEY = 'whatsapp_pending';
const POLL_MS = 20000;

export function WhatsappPendingProvider({ children }) {
  const [pending, setPending] = useState([]);
  const pendingRef = useRef([]);
  useEffect(() => { pendingRef.current = pending; }, [pending]);

  const reload = useCallback(() => {
    loadSharedData(KEY).then(data => {
      if (Array.isArray(data)) setPending(data);
    });
  }, []);

  useEffect(() => {
    reload();
    // Polling para recibir facturas nuevas del webhook.
    // Se pausa cuando la pestana esta oculta para no gastar red/CPU innecesario.
    let interval = null;
    const start = () => { if (!interval) interval = setInterval(reload, POLL_MS); };
    const stop  = () => { if (interval) { clearInterval(interval); interval = null; } };
    if (!document.hidden) start();
    const onVis = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      stop();
    };
  }, [reload]);

  const save = useCallback((items) => {
    setPending(items);
    saveSharedData(KEY, items);
  }, []);

  // Bug previo: reject y confirm eran identicos (ambos borraban el item),
  // perdiendo el rastro de cuales fueron aprobados vs rechazados.
  // Ahora marcamos status para auditoria y los sacamos del listado activo
  // (la pagina ya filtra por p.status !== 'rejected'/'confirmed').
  const rejectItem = useCallback((id) => {
    const next = pendingRef.current.map(p =>
      p.id === id ? { ...p, status: 'rejected', resolvedAt: new Date().toISOString() } : p
    );
    save(next);
  }, [save]);

  const confirmItem = useCallback((id) => {
    const next = pendingRef.current.map(p =>
      p.id === id ? { ...p, status: 'confirmed', resolvedAt: new Date().toISOString() } : p
    );
    save(next);
  }, [save]);

  // Bug previo: updateItem solo cambiaba estado local, no persistia.
  const updateItem = useCallback((id, changes) => {
    const next = pendingRef.current.map(p => p.id === id ? { ...p, ...changes } : p);
    save(next);
  }, [save]);

  return (
    <CTX.Provider value={{ pending, reload, rejectItem, confirmItem, updateItem }}>
      {children}
    </CTX.Provider>
  );
}

export const useWhatsappPending = () => useContext(CTX);
