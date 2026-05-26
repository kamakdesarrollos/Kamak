import { createContext, useContext, useCallback, useMemo } from 'react';
import useSyncedSharedData from '../lib/useSyncedSharedData';
import { newId } from '../lib/id';
import { today } from '../lib/dates';

// Item 3.3: provider refactorizado para usar useSyncedSharedData.
// Antes ~145 lineas, ahora ~70 — toda la logica de sync/debounce/flush vive
// en el hook. Aca queda solo lo especifico de Cheques: defaults del nuevo
// cheque y las acciones (depositar, endosar, etc.).

const CTX = createContext(null);

export function ChequesProvider({ children }) {
  const [cheques, setCheques] = useSyncedSharedData('cheques', [], {
    lsKey: 'kamak_cheques_v1',
  });

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
      id: newId('chq'),
    };
    setCheques(prev => [nuevo, ...prev]);
    return nuevo.id;
  }, [setCheques]);

  const updateCheque = useCallback((id, changes) => {
    setCheques(prev => prev.map(c => c.id === id ? { ...c, ...changes } : c));
  }, [setCheques]);

  const removeCheque = useCallback((id) => {
    setCheques(prev => prev.filter(c => c.id !== id));
  }, [setCheques]);

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
