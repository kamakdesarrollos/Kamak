import { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { loadSharedData, patchItemInSharedArray } from '../lib/dbHelpers';
import { onRemoteChange } from '../lib/syncBus';

const CTX = createContext(null);
const KEY = 'alertas';

export function AlertasProvider({ children }) {
  const [alertas, setAlertas] = useState([]);

  const cancelledRef = useRef(false);
  const alertasRef = useRef(alertas);
  useEffect(() => { alertasRef.current = alertas; }, [alertas]);
  const lastLocalSaveAt = useRef(0); // guard: ignora broadcasts < 3s tras una marca local

  const reload = useCallback(() => {
    loadSharedData(KEY).then(data => {
      if (cancelledRef.current) return;
      setAlertas(Array.isArray(data) ? data : []);
    });
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    reload();
    const unsub = onRemoteChange(KEY, () => {
      // No pisar una marca recién hecha localmente con datos viejos del server.
      if (lastLocalSaveAt.current && Date.now() - lastLocalSaveAt.current < 3000) return;
      reload();
    });
    return () => { cancelledRef.current = true; unsub(); };
  }, [reload]);

  const marcarLeida = useCallback((id) => {
    lastLocalSaveAt.current = Date.now();
    // Patch atómico por id (no pisa alertas que el bot agregó en paralelo).
    setAlertas(prev => prev.map(a => a.id === id ? { ...a, leida: true } : a));
    patchItemInSharedArray(KEY, id, { leida: true });
  }, []);

  const marcarTodasLeidas = useCallback(() => {
    lastLocalSaveAt.current = Date.now();
    // Atómico por ítem (no pisa alertas nuevas del bot que llegaron en paralelo).
    const unread = alertasRef.current.filter(a => !a.leida);
    setAlertas(prev => prev.map(a => ({ ...a, leida: true })));
    unread.forEach(a => patchItemInSharedArray(KEY, a.id, { leida: true }));
  }, []);

  const noLeidas = useMemo(() => alertas.filter(a => !a.leida).length, [alertas]);

  const value = useMemo(
    () => ({ alertas, noLeidas, marcarLeida, marcarTodasLeidas, reload }),
    [alertas, noLeidas, marcarLeida, marcarTodasLeidas, reload]
  );

  return (
    <CTX.Provider value={value}>
      {children}
    </CTX.Provider>
  );
}

export const useAlertas = () => useContext(CTX);
