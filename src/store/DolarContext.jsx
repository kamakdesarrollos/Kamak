import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
      // Defensa: un refresh AUTOMÁTICO nunca saca del modo manual (si otro admin
      // fijó el dólar a mano mientras este fetch estaba en vuelo, gana el manual;
      // salir del modo manual es una acción explícita → setAutoMode).
      patch(prev => prev.manual ? prev : ({ ...prev, compra, venta, updatedAt: new Date().toISOString(), manual: false }));
    } catch (e) {
      setError(`No se pudo obtener el dólar BNA: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [patch]);

  // Auto-fetch si está en modo automático y los datos tienen más de 1 hora.
  // FIX CRÍTICO: en un dispositivo nuevo (sin localStorage) el fetch inmediato
  // marcaba el estado auto como "edición del usuario" ANTES del primer load
  // remoto → subía manual:false y pisaba el dólar MANUAL fijado por el admin
  // para toda la organización. Ahora: si no hay cache local, se espera a que
  // llegue el estado remoto (o 10s como tope) antes de decidir.
  const dolarChequeado = useRef(false);
  useEffect(() => {
    if (dolarChequeado.current) return;
    let d;
    try { d = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { d = null; }
    if (!d) {
      // Dispositivo fresco: `data` todavía es DEFAULT hasta que el hook mergee
      // el remoto. Cuando cambie, este effect re-corre y decide con datos reales.
      const esDefault = data.updatedAt == null && !data.manual;
      if (esDefault) {
        const t = setTimeout(() => {
          // Tope: si a los 10s sigue en default (org sin registro remoto), fetch.
          if (!dolarChequeado.current) { dolarChequeado.current = true; fetchBNA(); }
        }, 10000);
        return () => clearTimeout(t);
      }
      d = data;
    }
    dolarChequeado.current = true;
    if (!d.manual) {
      const age = d.updatedAt ? Date.now() - new Date(d.updatedAt).getTime() : Infinity;
      if (age > REFRESH_MS) fetchBNA();
    }
  }, [data, fetchBNA]);

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
