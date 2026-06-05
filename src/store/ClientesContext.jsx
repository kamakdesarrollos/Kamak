import { createContext, useContext, useCallback, useMemo } from 'react';
import useSyncedSharedData from '../lib/useSyncedSharedData';
import { appendItemInSharedArray, patchItemInSharedArray, removeItemInSharedArray } from '../lib/dbHelpers';
import { newId } from '../lib/id';

// Item 3.3: este provider antes tenia ~110 lineas de boilerplate identico
// al de otros 9 providers (load/save/sync/debounce/flush/markReady).
// Ahora todo eso vive en el hook useSyncedSharedData. Aca queda solo lo
// especifico de Clientes: seed, helpers CRUD y el value del context.

const CTX = createContext(null);

const SEED_CLIENTES = [
  { id: 'cl-familia-perez', nombre: 'Familia Pérez',  empresa: '',                      cuit: '',              condicionIVA: 'CF', telefono: '+54 11 5555-1234', email: 'perez@gmail.com',    notas: '', tags: [], responsableComercial: null, fechaProximoContacto: null, estado: 'prospecto' },
  { id: 'cl-shell',         nombre: 'Shell Argentina', empresa: 'Shell CAPSA',            cuit: '30-51297267-0', condicionIVA: 'RI', telefono: '0800-888-7435',    email: 'obras@shell.com.ar', notas: '', tags: [], responsableComercial: null, fechaProximoContacto: null, estado: 'prospecto' },
  { id: 'cl-axion',         nombre: 'Axion Energy',    empresa: 'Axion Energy Argentina', cuit: '30-70929499-1', condicionIVA: 'RI', telefono: '',                 email: '',                   notas: '', tags: [], responsableComercial: null, fechaProximoContacto: null, estado: 'prospecto' },
];

export function ClientesProvider({ children }) {
  // atomic: escritura por ítem (no blob entero). El bot vincula el teléfono del
  // cliente en el onboarding de WhatsApp; sin esto la app lo pisaba al guardar.
  const [clientes, setClientes] = useSyncedSharedData('clientes', SEED_CLIENTES, {
    lsKey: 'kamak_clientes_v1',
    atomic: true,
  });

  const addCliente = useCallback((data) => {
    const nuevo = { nombre: '', empresa: '', cuit: '', condicionIVA: 'CF', telefono: '', email: '', notas: '', tags: [], responsableComercial: null, fechaProximoContacto: null, estado: 'prospecto', ...data, id: newId('cl') };
    setClientes(prev => [...prev, nuevo]);
    appendItemInSharedArray('clientes', nuevo);
    return nuevo.id;
  }, [setClientes]);

  const updateCliente = useCallback((id, changes) => {
    setClientes(prev => prev.map(c => c.id === id ? { ...c, ...changes } : c));
    patchItemInSharedArray('clientes', id, changes);
  }, [setClientes]);

  const removeCliente = useCallback((id) => {
    setClientes(prev => prev.filter(c => c.id !== id));
    removeItemInSharedArray('clientes', id);
  }, [setClientes]);

  const value = useMemo(
    () => ({ clientes, addCliente, updateCliente, removeCliente }),
    [clientes, addCliente, updateCliente, removeCliente]
  );

  return (
    <CTX.Provider value={value}>
      {children}
    </CTX.Provider>
  );
}

export const useClientes = () => useContext(CTX);
