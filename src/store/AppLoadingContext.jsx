import { createContext, useContext, useState, useCallback } from 'react';

const CTX = createContext({ allReady: false, markReady: () => {} });

const TOTAL_LOADERS = 11; // configuracion, dolar, obras, catalog, plantillas, gastos_fijos, proveedores, clientes, movimientos, cheques, usuarios

export function AppLoadingProvider({ children }) {
  const [count, setCount] = useState(0);
  const markReady = useCallback(() => setCount(n => Math.min(n + 1, TOTAL_LOADERS)), []);
  return (
    <CTX.Provider value={{ allReady: count >= TOTAL_LOADERS, markReady }}>
      {children}
    </CTX.Provider>
  );
}

export const useAppLoading = () => useContext(CTX);
