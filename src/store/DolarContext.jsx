import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import useSyncedSharedData from '../lib/useSyncedSharedData';
import { DOLAR_VENTA_FALLBACK, DOLAR_COMPRA_FALLBACK } from '../lib/constants';

const CTX = createContext(null);
const LS_KEY = 'kamak_dolar_v1';
const REFRESH_MS = 60 * 60 * 1000; // 1 hora

const DEFAULT = {
  venta:     DOLAR_VENTA_FALLBACK,
  compra:    DOLAR_COMPRA_FALLBACK,
  updatedAt: null,
  manual:    false,
  manualVal: DOLAR_VENTA_FALLBACK,
};

export function DolarProvider({ children }) {
  const [data, setData] = useSyncedSharedData('dolar', DEFAULT, { lsKey: LS_KEY });
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const patch = useCallback((fn) => {
    setData(prev => typeof fn === 'function' ? fn(prev) : { ...prev, ...fn });
  }, [setData]);

  const fetchBNA = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('https://dolarapi.com/v1/dolares/oficial', { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json?.compra && !json?.venta) throw new Error('Respuesta inesperada de dolarapi.com');
      // Si la API solo manda venta, fallback a venta para compra.
      const compra = Number(json.compra) || Number(json.venta);
      const venta  = (Number(json.venta) && Number(json.venta) >= compra)
        ? Number(json.venta)
        : compra * 1.005;
      if (!Number.isFinite(compra) || !Number.isFinite(venta)) {
        throw new Error('Cotizacion invalida desde dolarapi.com');
      }
      patch(prev => ({ ...prev, compra, venta, updatedAt: new Date().toISOString(), manual: false }));
    } catch (e) {
      setError(`No se pudo obtener el dólar BNA: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [patch]);

  // Auto-fetch al montar si esta en modo automatico y los datos tienen mas
  // de 1 hora (lee de localStorage para evitar trigger cuando llega el
  // primer load remoto).
  useEffect(() => {
    let d;
    try { d = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { d = null; }
    if (!d?.manual) {
      const age = d?.updatedAt ? Date.now() - new Date(d.updatedAt).getTime() : Infinity;
      if (age > REFRESH_MS) fetchBNA();
    }
  }, [fetchBNA]);

  const setManual = useCallback((val) => {
    const n = Math.round(+val) || DOLAR_VENTA_FALLBACK;
    patch({ manual: true, manualVal: n, venta: n });
  }, [patch]);

  const setAutoMode = useCallback(() => {
    patch(prev => ({ ...prev, manual: false }));
    fetchBNA();
  }, [patch, fetchBNA]);

  const dolarVenta  = data.manual ? (data.manualVal || DOLAR_VENTA_FALLBACK) : (data.venta || DOLAR_VENTA_FALLBACK);
  const dolarCompra = data.compra || DOLAR_COMPRA_FALLBACK;

  const value = useMemo(
    () => ({ dolarVenta, dolarCompra, updatedAt: data.updatedAt, loading, error, manual: data.manual, setManual, setAutoMode, fetchBNA }),
    [dolarVenta, dolarCompra, data.updatedAt, loading, error, data.manual, setManual, setAutoMode, fetchBNA]
  );

  return (
    <CTX.Provider value={value}>
      {children}
    </CTX.Provider>
  );
}

export const useDolar = () => useContext(CTX);
