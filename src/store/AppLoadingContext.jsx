import { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';

const CTX = createContext({ allReady: false, markReady: () => {} });

const TOTAL_LOADERS = 11; // configuracion, dolar, obras, catalog, plantillas, gastos_fijos, proveedores, clientes, movimientos, cheques, usuarios

// Timeout maximo de la pantalla "Cargando datos". Despues de esto, la app
// se muestra igual aunque algun provider no haya terminado. Evita que un
// fetch lento o fallido bloquee al usuario eternamente.
const LOADING_TIMEOUT_MS = 5000;

export function AppLoadingProvider({ children }) {
  const [count, setCount] = useState(0);
  const [forceReady, setForceReady] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setForceReady(true);
      console.warn('[AppLoading] Timeout de 5s alcanzado — mostrando app aunque falten providers. Los providers que no terminaron seguiran cargando en background.');
    }, LOADING_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, []);

  const markReady = useCallback(() => setCount(n => Math.min(n + 1, TOTAL_LOADERS)), []);
  const allReady = forceReady || count >= TOTAL_LOADERS;
  const value = useMemo(() => ({ allReady, markReady }), [allReady, markReady]);
  return (
    <CTX.Provider value={value}>
      {children}
    </CTX.Provider>
  );
}

export const useAppLoading = () => useContext(CTX);
