import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { loadSharedData, saveSharedData } from '../lib/dbHelpers';
import { onRemoteChange } from '../lib/syncBus';
import { useAppLoading } from './AppLoadingContext';

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
  const sbLoaded   = useRef(false);
  const fromRemote = useRef(false);
  const { markReady } = useAppLoading();

  const patch = useCallback((fn) => {
    setData(prev => {
      const next = typeof fn === 'function' ? fn(prev) : { ...prev, ...fn };
      saveLS(next);
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadSharedData('dolar').then(saved => {
      if (cancelled) return;
      if (saved) {
        fromRemote.current = true;
        setData(saved); saveLS(saved);
        setTimeout(() => { fromRemote.current = false; }, 0);
      } else saveSharedData('dolar', data); // eslint-disable-line react-hooks/exhaustive-deps
      sbLoaded.current = true;
      markReady();
    });

    const unsub = onRemoteChange('dolar', () => {
      loadSharedData('dolar').then(d => {
        if (cancelled || !d) return;
        fromRemote.current = true;
        setData(d); saveLS(d);
        setTimeout(() => { fromRemote.current = false; }, 0);
      });
    });
    return () => { cancelled = true; unsub(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pendingSaveRef = useRef(null);
  useEffect(() => {
    if (!sbLoaded.current || fromRemote.current) return;
    pendingSaveRef.current = data;
    const t = setTimeout(() => {
      saveSharedData('dolar', data);
      pendingSaveRef.current = null;
    }, 800);
    return () => clearTimeout(t);
  }, [data]);

  useEffect(() => () => {
    if (pendingSaveRef.current) saveSharedData('dolar', pendingSaveRef.current, { silent: true });
  }, []);

  const fetchBNA = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('https://dolarapi.com/v1/dolares/oficial', { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json?.compra && !json?.venta) throw new Error('Respuesta inesperada de dolarapi.com');
      // Bug previo: usaba json.compra (no la variable local). Si la API solo
      // mandaba venta, json.compra era undefined y daba NaN.
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
