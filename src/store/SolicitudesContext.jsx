import { createContext, useContext, useCallback, useMemo } from 'react';
import useSyncedSharedData from '../lib/useSyncedSharedData';
import { newId } from '../lib/id';
import { useNotificaciones } from './NotificacionesContext';

// Item 3.3: refactor para usar useSyncedSharedData.
// Solicitudes no llama markReady (no es loader bloqueante del splash),
// usa { skipMarkReady: true }.

const CTX = createContext(null);

export function SolicitudesProvider({ children }) {
  const [solicitudes, setSolicitudes] = useSyncedSharedData('solicitudes', [], {
    lsKey: 'kamak_solicitudes_v1',
    skipMarkReady: true,
  });
  const { crearNotificacion } = useNotificaciones() ?? {};

  const addSolicitud = useCallback((data) => {
    const nueva = {
      ...data,
      id: newId('sol'),
      estado: 'pendiente',
      creadoAt: new Date().toISOString(),
    };
    setSolicitudes(prev => [nueva, ...prev]);
    crearNotificacion?.('solicitud_eliminacion', { descripcion: data?.movimiento?.descripcion || data?.motivo || '' });
    return nueva.id;
  }, [setSolicitudes, crearNotificacion]);

  const resolveSolicitud = useCallback((id, estado, resolvedBy) => {
    let solicitante = null;
    setSolicitudes(prev => prev.map(s => {
      if (s.id !== id) return s;
      solicitante = s.solicitadoPor?.id || null;
      return { ...s, estado, resolvedBy, resolvedAt: new Date().toISOString() };
    }));
    if (solicitante) crearNotificacion?.('solicitud_resuelta', { estado, userIds: [solicitante] });
  }, [setSolicitudes, crearNotificacion]);

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
