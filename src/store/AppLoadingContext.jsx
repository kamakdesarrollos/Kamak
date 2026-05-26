import { createContext, useContext, useState, useCallback, useMemo } from 'react';

const CTX = createContext({ allReady: false, markReady: () => {} });

const TOTAL_LOADERS = 11; // configuracion, dolar, obras, catalog, plantillas, gastos_fijos, proveedores, clientes, movimientos, cheques, usuarios

export function AppLoadingProvider({ children }) {
  const [count, setCount] = useState(0);
  const markReady = useCallback(() => setCount(n => Math.min(n + 1, TOTAL_LOADERS)), []);
  const allReady = count >= TOTAL_LOADERS;
  const value = useMemo(() => ({ allReady, markReady }), [allReady, markReady]);
  return (
    <CTX.Provider value={value}>
      {children}
    </CTX.Provider>
  );
}

export const useAppLoading = () => useContext(CTX);
