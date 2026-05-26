import { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { loadSharedData, saveSharedData } from '../lib/dbHelpers';
import { onRemoteChange } from '../lib/syncBus';
import { useAppLoading } from './AppLoadingContext';

const CTX = createContext(null);
const LS_KEY = 'kamak_cheques_v1';
const newId = () => `chq-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
const today = () => new Date().toISOString().split('T')[0];

function loadLS() {
  try { const s = localStorage.getItem(LS_KEY); return s ? JSON.parse(s) : []; } catch { return []; }
}
function persistLS(data) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch {}
}

export function ChequesProvider({ children }) {
  const [cheques, setCheques] = useState(loadLS);
  const sbLoaded   = useRef(false);
  const fromRemote = useRef(false);
  const chequesRef = useRef(cheques);
  const { markReady } = useAppLoading();
  useEffect(() => { chequesRef.current = cheques; }, [cheques]);

  useEffect(() => {
    let cancelled = false;
    loadSharedData('cheques').then(data => {
      if (cancelled) return;
      if (data) {
        fromRemote.current = true;
        setCheques(data); persistLS(data);
        setTimeout(() => { fromRemote.current = false; }, 0);
      } else {
        saveSharedData('cheques', chequesRef.current);
      }
      sbLoaded.current = true;
      markReady();
    });

    const unsub = onRemoteChange('cheques', () => {
      loadSharedData('cheques').then(d => {
        if (cancelled || !d) return;
        fromRemote.current = true;
        setCheques(d); persistLS(d);
        setTimeout(() => { fromRemote.current = false; }, 0);
      });
    });
    return () => { cancelled = true; unsub(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // pendingSaveRef guarda el estado que esta esperando para guardarse (con
  // debounce de 800ms). Si el provider se desmonta antes de que pase, hacemos
  // un flush inmediato en lugar de perder el cambio.
  const pendingSaveRef = useRef(null);
  useEffect(() => {
    if (!sbLoaded.current || fromRemote.current) return;
    pendingSaveRef.current = chequesRef.current;
    const t = setTimeout(() => {
      saveSharedData('cheques', chequesRef.current);
      pendingSaveRef.current = null;
    }, 800);
    return () => clearTimeout(t);
  }, [cheques]);

  useEffect(() => () => {
    if (pendingSaveRef.current) {
      // Flush: save sincronicamente (silent para no broadcast en unmount).
      saveSharedData('cheques', pendingSaveRef.current, { silent: true });
    }
  }, []);

  // ── CRUD ──────────────────────────────────────────────────────────────────────
  const addCheque = useCallback((data) => {
    const nuevo = {
      numero: '', banco: '', titular: '', monto: 0, moneda: 'ARS',
      fechaIngreso: today(), fechaVencimiento: '',
      obraId: null, obraNombre: '',
      clienteNombre: '', proveedorNombre: '',
      estado: 'cartera',
      cajaId: null,
      cajaDestinoId: null, cajaDestinoNombre: null,
      fechaDeposito: null, movimientoId: null,
      endosadoA: null, fechaEndoso: null,
      traspasoA: null, fechaTraspaso: null,
      fechaRechazo: null, motivoRechazo: null,
      observacion: '', createdAt: new Date().toISOString(),
      ...data,
      id: newId(),
    };
    setCheques(prev => { const next = [nuevo, ...prev]; persistLS(next); return next; });
    return nuevo.id;
  }, []);

  const updateCheque = useCallback((id, changes) => {
    setCheques(prev => {
      const next = prev.map(c => c.id === id ? { ...c, ...changes } : c);
      persistLS(next);
      return next;
    });
  }, []);

  const removeCheque = useCallback((id) => {
    setCheques(prev => { const next = prev.filter(c => c.id !== id); persistLS(next); return next; });
  }, []);

  // ── Acciones ──────────────────────────────────────────────────────────────────
  const depositarCheque = useCallback((id, { cajaDestinoId, cajaDestinoNombre, fechaDeposito, movimientoId }) => {
    updateCheque(id, { estado: 'depositado', cajaDestinoId, cajaDestinoNombre, fechaDeposito, movimientoId: movimientoId || null });
  }, [updateCheque]);

  const endosarCheque = useCallback((id, { endosadoA, fechaEndoso }) => {
    updateCheque(id, { estado: 'endosado', endosadoA, fechaEndoso });
  }, [updateCheque]);

  const rechazarCheque = useCallback((id, { fechaRechazo, motivoRechazo }) => {
    updateCheque(id, { estado: 'rechazado', fechaRechazo, motivoRechazo });
  }, [updateCheque]);

  const anularCheque = useCallback((id) => {
    updateCheque(id, { estado: 'anulado' });
  }, [updateCheque]);

  const reactivarCheque = useCallback((id) => {
    updateCheque(id, {
      estado: 'cartera',
      cajaDestinoId: null, cajaDestinoNombre: null, fechaDeposito: null, movimientoId: null,
      endosadoA: null, fechaEndoso: null, fechaRechazo: null, motivoRechazo: null,
    });
  }, [updateCheque]);

  const value = useMemo(() => ({
    cheques, addCheque, updateCheque, removeCheque,
    depositarCheque, endosarCheque, rechazarCheque, anularCheque, reactivarCheque,
  }), [cheques, addCheque, updateCheque, removeCheque, depositarCheque, endosarCheque, rechazarCheque, anularCheque, reactivarCheque]);

  return (
    <CTX.Provider value={value}>
      {children}
    </CTX.Provider>
  );
}

export const useCheques = () => useContext(CTX);
