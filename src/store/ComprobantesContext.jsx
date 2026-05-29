import { createContext, useContext, useCallback, useMemo } from 'react';
import useSyncedSharedData from '../lib/useSyncedSharedData';
import { newId } from '../lib/id';

// Comprobantes de facturación (AFIP/ARCA). Se guardan del lado app en
// shared_data 'comprobantes' con el mismo sync robusto que el resto (hook
// useSyncedSharedData). Por ahora los crea SOLO la app (no el bot), así que no
// necesita los RPC atómicos del bot.
//
// Estados de un comprobante:
//   'borrador'  → armado y validado en la app, listo para enviar a AFIP.
//   'emitido'   → (futuro) ya autorizado por AFIP, con cae + número definitivo.
//   'anulado'   → dado de baja (se factura una nota de crédito que lo revierte).
//
// El número y el CAE los asigna AFIP al emitir; mientras tanto quedan vacíos.

const CTX = createContext(null);

export function ComprobantesProvider({ children }) {
  const [comprobantes, setComprobantes] = useSyncedSharedData('comprobantes', [], {
    lsKey: 'kamak_comprobantes_v1',
  });

  const addComprobante = useCallback((data) => {
    const nuevo = {
      estado: 'borrador',
      numero: null,        // lo asigna AFIP al emitir
      cae: null,           // idem
      caeVto: null,
      ...data,
      id: newId('cbte'),
      creadoAt: new Date().toISOString(),
    };
    setComprobantes(prev => [nuevo, ...prev]);
    return nuevo.id;
  }, [setComprobantes]);

  const updateComprobante = useCallback((id, changes) => {
    setComprobantes(prev => prev.map(c => c.id === id ? { ...c, ...changes } : c));
  }, [setComprobantes]);

  const removeComprobante = useCallback((id) => {
    setComprobantes(prev => prev.filter(c => c.id !== id));
  }, [setComprobantes]);

  const value = useMemo(
    () => ({ comprobantes, addComprobante, updateComprobante, removeComprobante }),
    [comprobantes, addComprobante, updateComprobante, removeComprobante]
  );

  return <CTX.Provider value={value}>{children}</CTX.Provider>;
}

export const useComprobantes = () => useContext(CTX);
