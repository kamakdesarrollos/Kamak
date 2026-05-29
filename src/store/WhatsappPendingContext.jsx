import { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { loadSharedData, patchItemInSharedArray } from '../lib/dbHelpers';

const CTX = createContext(null);
const KEY = 'whatsapp_pending';
const POLL_MS = 20000;

export function WhatsappPendingProvider({ children }) {
  const [pending, setPending] = useState([]);
  const cancelledRef = useRef(false);

  const reload = useCallback(() => {
    loadSharedData(KEY).then(data => {
      if (cancelledRef.current) return;
      if (Array.isArray(data)) setPending(data);
    });
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
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
      cancelledRef.current = true;
      document.removeEventListener('visibilitychange', onVis);
      stop();
    };
  }, [reload]);

  // Patch ATÓMICO por id (no reescribe el array entero → no pisa pendientes que
  // el bot agregó en paralelo). Actualiza el estado local optimista al toque.
  const patch = useCallback((id, changes) => {
    setPending(prev => prev.map(p => p.id === id ? { ...p, ...changes } : p));
    patchItemInSharedArray(KEY, id, changes);
  }, []);

  // Bug previo: reject y confirm eran identicos (ambos borraban el item),
  // perdiendo el rastro de cuales fueron aprobados vs rechazados.
  // Ahora marcamos status para auditoria y los sacamos del listado activo
  // (la pagina ya filtra por p.status !== 'rejected'/'confirmed').
  const rejectItem  = useCallback((id) => patch(id, { status: 'rejected',  resolvedAt: new Date().toISOString() }), [patch]);
  const confirmItem = useCallback((id) => patch(id, { status: 'confirmed', resolvedAt: new Date().toISOString() }), [patch]);
  // Bug previo: updateItem solo cambiaba estado local, no persistia.
  const updateItem  = useCallback((id, changes) => patch(id, changes), [patch]);

  const value = useMemo(
    () => ({ pending, reload, rejectItem, confirmItem, updateItem }),
    [pending, reload, rejectItem, confirmItem, updateItem]
  );

  return (
    <CTX.Provider value={value}>
      {children}
    </CTX.Provider>
  );
}

export const useWhatsappPending = () => useContext(CTX);
