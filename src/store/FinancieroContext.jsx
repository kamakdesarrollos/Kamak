import { createContext, useContext, useCallback, useMemo } from 'react';
import useSyncedSharedData from '../lib/useSyncedSharedData';

// Cargas mensuales fiscales/laborales del cierre financiero (Facturación →
// tab Financiero). Estructura: { [yyyy-mm]: { iibb, sueldos, csSoc, sind } }
// Las cargas son inputs manuales del contador/admin; ventas y compras del mes
// se calculan automáticamente desde los comprobantes y movimientos.

const CTX = createContext(null);

export function FinancieroProvider({ children }) {
  const [data, setData] = useSyncedSharedData('financiero_mensual', {}, {
    lsKey: 'kamak_financiero_v1',
  });

  const getMes = useCallback((mes) => (data || {})[mes] || {}, [data]);

  const setMesField = useCallback((mes, field, valor) => {
    setData(prev => {
      const prevMes = (prev || {})[mes] || {};
      const valorNum = valor === '' || valor == null ? null : Number(valor);
      return { ...(prev || {}), [mes]: { ...prevMes, [field]: valorNum } };
    });
  }, [setData]);

  const value = useMemo(() => ({ data: data || {}, getMes, setMesField }), [data, getMes, setMesField]);
  return <CTX.Provider value={value}>{children}</CTX.Provider>;
}

export const useFinanciero = () => useContext(CTX);
