import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { loadSharedData, saveSharedData } from '../lib/dbHelpers';
import { supabase } from '../lib/supabase';

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
  const sbLoaded = useRef(false);
  const lastSaveTime = useRef(0);

  useEffect(() => {
    loadSharedData('gastos_fijos').then(data => {
      if (data) { setItemsState(data); localStorage.setItem(LS_KEY, JSON.stringify(data)); }
      else saveSharedData('gastos_fijos', items); // eslint-disable-line react-hooks/exhaustive-deps
      sbLoaded.current = true;
    });

    const channel = supabase
      .channel('shared-gastos-fijos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shared_data', filter: 'key=eq.gastos_fijos' },
        (payload) => {
          if (!payload.new?.data) return;
          if (Date.now() - lastSaveTime.current < 2000) return;
          setItemsState(payload.new.data);
          localStorage.setItem(LS_KEY, JSON.stringify(payload.new.data));
        }
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!sbLoaded.current) return;
    const t = setTimeout(() => { lastSaveTime.current = Date.now(); saveSharedData('gastos_fijos', items); }, 800);
    return () => clearTimeout(t);
  }, [items]);

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
