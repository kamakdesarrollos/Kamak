import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { loadUserData, saveUserData } from '../lib/dbHelpers';

const CTX = createContext(null);
const LS_KEY = 'kamak_dolar_v1';
const REFRESH_MS = 60 * 60 * 1000; // 1 hora

function loadLS() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { return null; }
}

function saveLS(data) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch {}
}

const DEFAULT = { venta: 1070, compra: 1060, updatedAt: null, manual: false, manualVal: 1070 };

export function DolarProvider({ children }) {
  const [data, setData] = useState(() => loadLS() || DEFAULT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const sbLoaded = useRef(false);

  const patch = useCallback((fn) => {
    setData(prev => {
      const next = typeof fn === 'function' ? fn(prev) : { ...prev, ...fn };
      saveLS(next);
      return next;
    });
  }, []);

  useEffect(() => {
    loadUserData('dolar').then(saved => {
      if (saved) {
        setData(saved);
        saveLS(saved);
      } else {
        saveUserData('dolar', data); // eslint-disable-line react-hooks/exhaustive-deps
      }
      sbLoaded.current = true;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!sbLoaded.current) return;
    const t = setTimeout(() => saveUserData('dolar', data), 800);
    return () => clearTimeout(t);
  }, [data]);

  const fetchBNA = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('https://dolarapi.com/v1/dolares/oficial', { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json?.compra && !json?.venta) throw new Error('Respuesta inesperada de dolarapi.com');
      const compra = json.compra || json.venta;
      const venta = (json.venta && json.venta >= json.compra) ? json.venta : json.compra * 1.005;
      patch(prev => ({ ...prev, compra, venta, updatedAt: new Date().toISOString(), manual: false }));
    } catch (e) {
      setError(`No se pudo obtener el dólar BNA: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [patch]);

  // Auto-fetch al montar si está en modo automático y los datos tienen más de 1 hora
  useEffect(() => {
    const d = loadLS();
    if (!d?.manual) {
      const age = d?.updatedAt ? Date.now() - new Date(d.updatedAt).getTime() : Infinity;
      if (age > REFRESH_MS) fetchBNA();
    }
  }, [fetchBNA]);

  const setManual = useCallback((val) => {
    const n = Math.round(+val) || 1070;
    patch({ manual: true, manualVal: n, venta: n });
  }, [patch]);

  const setAutoMode = useCallback(() => {
    patch(prev => ({ ...prev, manual: false }));
    fetchBNA();
  }, [patch, fetchBNA]);

  const dolarVenta = data.manual ? (data.manualVal || 1070) : (data.venta || 1070);
  const dolarCompra = data.compra || 1060;

  return (
    <CTX.Provider value={{ dolarVenta, dolarCompra, updatedAt: data.updatedAt, loading, error, manual: data.manual, setManual, setAutoMode, fetchBNA }}>
      {children}
    </CTX.Provider>
  );
}

export const useDolar = () => useContext(CTX);
