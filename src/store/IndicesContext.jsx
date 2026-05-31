import { createContext, useContext, useCallback, useMemo } from 'react';
import useSyncedSharedData from '../lib/useSyncedSharedData';

// Índices de redeterminación (CAC) por mes. Estructura:
//   { 'YYYY-MM': { cacGeneral, cacMateriales, cacManoObra, updatedAt } }
// Se cargan a mano cada mes (CAC publica el 25; no hay API oficial). La
// redeterminación usa estos valores GUARDADOS (ver src/lib/indices.js) para que
// los recálculos sean estables y auditables.

const CTX = createContext(null);

export function IndicesProvider({ children }) {
  const [indices, setIndices] = useSyncedSharedData('indices_cac', {}, { lsKey: 'kamak_indices_v1' });

  // Carga/actualiza los valores de un mes (merge parcial, conserva los que no se tocan).
  const setMesIndice = useCallback((mes, valores) => {
    setIndices(prev => ({
      ...prev,
      [mes]: { ...(prev[mes] || {}), ...valores, updatedAt: new Date().toISOString() },
    }));
  }, [setIndices]);

  const removeMesIndice = useCallback((mes) => {
    setIndices(prev => {
      const next = { ...prev };
      delete next[mes];
      return next;
    });
  }, [setIndices]);

  const value = useMemo(() => ({ indices, setMesIndice, removeMesIndice }), [indices, setMesIndice, removeMesIndice]);
  return <CTX.Provider value={value}>{children}</CTX.Provider>;
}

export const useIndices = () => useContext(CTX);
