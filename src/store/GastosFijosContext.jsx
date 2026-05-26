import { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { loadSharedData, saveSharedData } from '../lib/dbHelpers';
import { onRemoteChange } from '../lib/syncBus';
import { useAppLoading } from './AppLoadingContext';

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
  const sbLoaded   = useRef(false);
  const fromRemote = useRef(false);
  const { markReady } = useAppLoading();

  useEffect(() => {
    let cancelled = false;
    loadSharedData('gastos_fijos').then(data => {
      if (cancelled) return;
      if (data) {
        fromRemote.current = true;
        setItemsState(data); localStorage.setItem(LS_KEY, JSON.stringify(data));
        setTimeout(() => { fromRemote.current = false; }, 0);
      } else saveSharedData('gastos_fijos', items); // eslint-disable-line react-hooks/exhaustive-deps
      sbLoaded.current = true;
      markReady();
    });

    const unsub = onRemoteChange('gastos_fijos', () => {
      loadSharedData('gastos_fijos').then(d => {
        if (cancelled || !d) return;
        fromRemote.current = true;
        setItemsState(d);
        localStorage.setItem(LS_KEY, JSON.stringify(d));
        setTimeout(() => { fromRemote.current = false; }, 0);
      });
    });
    return () => { cancelled = true; unsub(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pendingSaveRef = useRef(null);
  useEffect(() => {
    if (!sbLoaded.current || fromRemote.current) return;
    pendingSaveRef.current = items;
    const t = setTimeout(() => {
      saveSharedData('gastos_fijos', items);
      pendingSaveRef.current = null;
    }, 800);
    return () => clearTimeout(t);
  }, [items]);

  useEffect(() => () => {
    if (pendingSaveRef.current) saveSharedData('gastos_fijos', pendingSaveRef.current, { silent: true });
  }, []);

  const setItems = useCallback((fn) => {
    setItemsState(prev => {
      const next = typeof fn === 'function' ? fn(prev) : fn;
      localStorage.setItem(LS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const totalMensual = useMemo(() => items.reduce((s, i) => s + (i.monto || 0), 0), [items]);

  const value = useMemo(() => ({ items, setItems, totalMensual }), [items, setItems, totalMensual]);

  return <CTX.Provider value={value}>{children}</CTX.Provider>;
}

export const useGastosFijos = () => useContext(CTX);
