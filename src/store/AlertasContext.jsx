import { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { loadSharedData, saveSharedData } from '../lib/dbHelpers';
import { onRemoteChange } from '../lib/syncBus';

const CTX = createContext(null);
const KEY = 'alertas';

export function AlertasProvider({ children }) {
  const [alertas, setAlertas] = useState([]);

  const cancelledRef = useRef(false);

  const reload = useCallback(() => {
    loadSharedData(KEY).then(data => {
      if (cancelledRef.current) return;
      setAlertas(Array.isArray(data) ? data : []);
    });
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    reload();
    const unsub = onRemoteChange(KEY, reload);
    return () => { cancelledRef.current = true; unsub(); };
  }, [reload]);

  const marcarLeida = useCallback((id) => {
    setAlertas(prev => {
      const next = prev.map(a => a.id === id ? { ...a, leida: true } : a);
      saveSharedData(KEY, next);
      return next;
    });
  }, []);

  const marcarTodasLeidas = useCallback(() => {
    setAlertas(prev => {
      const next = prev.map(a => ({ ...a, leida: true }));
      saveSharedData(KEY, next);
      return next;
    });
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
