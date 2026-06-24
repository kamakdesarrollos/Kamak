import { createContext, useContext, useMemo } from 'react';
import useSyncedSharedData from '../lib/useSyncedSharedData';

// Item 3.3: refactor para usar useSyncedSharedData.

const CTX = createContext(null);

const INIT = [
  { id: 'gf-1', nombre: 'Alquiler oficina / galpón', monto: 0 },
  { id: 'gf-2', nombre: 'Salarios administrativos', monto: 0 },
  { id: 'gf-3', nombre: 'Vehículos y combustible', monto: 0 },
  { id: 'gf-4', nombre: 'Servicios (luz, internet, etc.)', monto: 0 },
  { id: 'gf-5', nombre: 'Seguros', monto: 0 },
];

export function GastosFijosProvider({ children }) {
  const [items, setItems] = useSyncedSharedData('gastos_fijos', INIT, {
    lsKey: 'kamak_gastos_fijos',
  });

  // Guard: si `items` no fuera array (migración/SQL/blob corrupto), no crasheamos
  // el render — el provider está ARRIBA del ErrorBoundary, un throw acá blanquea
  // toda la app. El hook ya valida la forma; esto es defensa en profundidad.
  const arr = Array.isArray(items) ? items : [];
  const totalMensual = useMemo(() => arr.reduce((s, i) => s + (i.monto || 0), 0), [arr]);

  const value = useMemo(() => ({ items: arr, setItems, totalMensual }), [arr, setItems, totalMensual]);

  return <CTX.Provider value={value}>{children}</CTX.Provider>;
}

export const useGastosFijos = () => useContext(CTX);
