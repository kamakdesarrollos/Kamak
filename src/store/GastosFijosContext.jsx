import { createContext, useContext, useState } from 'react';

const CTX = createContext(null);

const INIT = [
  { id: 'gf-1', nombre: 'Alquiler oficina / galpón', monto: 0 },
  { id: 'gf-2', nombre: 'Salarios administrativos', monto: 0 },
  { id: 'gf-3', nombre: 'Vehículos y combustible', monto: 0 },
  { id: 'gf-4', nombre: 'Servicios (luz, internet, etc.)', monto: 0 },
  { id: 'gf-5', nombre: 'Seguros', monto: 0 },
];

const LS_KEY = 'kamak_gastos_fijos';

export function GastosFijosProvider({ children }) {
  const [items, setItemsState] = useState(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      return saved ? JSON.parse(saved) : INIT;
    } catch { return INIT; }
  });

  const setItems = (fn) => {
    setItemsState(prev => {
      const next = typeof fn === 'function' ? fn(prev) : fn;
      localStorage.setItem(LS_KEY, JSON.stringify(next));
      return next;
    });
  };

  const totalMensual = items.reduce((s, i) => s + (i.monto || 0), 0);

  return <CTX.Provider value={{ items, setItems, totalMensual }}>{children}</CTX.Provider>;
}

export const useGastosFijos = () => useContext(CTX);
