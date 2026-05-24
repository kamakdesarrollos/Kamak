import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { loadSharedData, saveSharedData } from '../lib/dbHelpers';

const CTX = createContext(null);
const KEY = 'whatsapp_pending';

export function WhatsappPendingProvider({ children }) {
  const [pending, setPending] = useState([]);

  const reload = useCallback(() => {
    loadSharedData(KEY).then(data => {
      if (Array.isArray(data)) setPending(data);
    });
  }, []);

  useEffect(() => {
    reload();
    // Poll cada 20s para recibir facturas nuevas del webhook
    const interval = setInterval(reload, 20000);
    return () => clearInterval(interval);
  }, [reload]);

  const save = useCallback((items) => {
    setPending(items);
    saveSharedData(KEY, items);
  }, []);

  const rejectItem = useCallback((id) => {
    save(pending.filter(p => p.id !== id));
  }, [pending, save]);

  const confirmItem = useCallback((id) => {
    save(pending.filter(p => p.id !== id));
  }, [pending, save]);

  const updateItem = useCallback((id, changes) => {
    setPending(prev => prev.map(p => p.id === id ? { ...p, ...changes } : p));
  }, []);

  return (
    <CTX.Provider value={{ pending, reload, rejectItem, confirmItem, updateItem }}>
      {children}
    </CTX.Provider>
  );
}

export const useWhatsappPending = () => useContext(CTX);
