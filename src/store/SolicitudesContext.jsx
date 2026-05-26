import { createContext, useContext, useCallback, useMemo } from 'react';
import useSyncedSharedData from '../lib/useSyncedSharedData';
import { newId } from '../lib/id';

// Item 3.3: refactor para usar useSyncedSharedData.
// Solicitudes no llama markReady (no es loader bloqueante del splash),
// usa { skipMarkReady: true }.

const CTX = createContext(null);

export function SolicitudesProvider({ children }) {
  const [solicitudes, setSolicitudes] = useSyncedSharedData('solicitudes', [], {
    lsKey: 'kamak_solicitudes_v1',
    skipMarkReady: true,
  });

  const addSolicitud = useCallback((data) => {
    const nueva = {
      ...data,
      id: newId('sol'),
      estado: 'pendiente',
      creadoAt: new Date().toISOString(),
    };
    setSolicitudes(prev => [nueva, ...prev]);
    return nueva.id;
  }, [setSolicitudes]);

  const resolveSolicitud = useCallback((id, estado, resolvedBy) => {
    setSolicitudes(prev => prev.map(s =>
      s.id === id ? { ...s, estado, resolvedBy, resolvedAt: new Date().toISOString() } : s
    ));
  }, [setSolicitudes]);

  const value = useMemo(
    () => ({ solicitudes, addSolicitud, resolveSolicitud }),
    [solicitudes, addSolicitud, resolveSolicitud]
  );

  return (
    <CTX.Provider value={value}>
      {children}
    </CTX.Provider>
  );
}

export const useSolicitudes = () => useContext(CTX);
