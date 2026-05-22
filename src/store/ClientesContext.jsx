import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { loadSharedData, saveSharedData } from '../lib/dbHelpers';
import { supabase } from '../lib/supabase';

const CTX = createContext(null);
const LS_KEY = 'kamak_clientes_v1';

const newId = () => `cl-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;

const SEED_CLIENTES = [
  { id: 'cl-familia-perez', nombre: 'Familia Pérez',  empresa: '',                      cuit: '',              telefono: '+54 11 5555-1234', email: 'perez@gmail.com',    notas: '' },
  { id: 'cl-shell',         nombre: 'Shell Argentina', empresa: 'Shell CAPSA',            cuit: '30-51297267-0', telefono: '0800-888-7435',    email: 'obras@shell.com.ar', notas: '' },
  { id: 'cl-axion',         nombre: 'Axion Energy',    empresa: 'Axion Energy Argentina', cuit: '30-70929499-1', telefono: '',                 email: '',                   notas: '' },
];

function load(seed) {
  try {
    const s = localStorage.getItem(LS_KEY);
    if (s) {
      const saved = JSON.parse(s);
      const savedIds = new Set(saved.map(x => x.id));
      const missing = seed.filter(x => !savedIds.has(x.id));
      return missing.length ? [...saved, ...missing] : saved;
    }
  } catch {}
  return seed;
}

function save(data) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch {}
}

export function ClientesProvider({ children }) {
  const [clientes, setClientes] = useState(() => load(SEED_CLIENTES));
  const sbLoaded = useRef(false);
  const lastSaveTime = useRef(0);

  useEffect(() => {
    loadSharedData('clientes').then(data => {
      if (data) { setClientes(data); save(data); }
      else saveSharedData('clientes', clientes); // eslint-disable-line react-hooks/exhaustive-deps
      sbLoaded.current = true;
    });

    const channel = supabase
      .channel('shared-clientes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shared_data', filter: 'key=eq.clientes' },
        (payload) => {
          if (!payload.new?.data) return;
          if (Date.now() - lastSaveTime.current < 2000) return;
          setClientes(payload.new.data); save(payload.new.data);
        }
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!sbLoaded.current) return;
    const t = setTimeout(() => { lastSaveTime.current = Date.now(); saveSharedData('clientes', clientes); }, 800);
    return () => clearTimeout(t);
  }, [clientes]);

  const addCliente = useCallback((data) => {
    const nuevo = { nombre: '', empresa: '', cuit: '', telefono: '', email: '', notas: '', ...data, id: newId() };
    setClientes(prev => {
      const next = [...prev, nuevo];
      save(next);
      return next;
    });
    return nuevo.id;
  }, []);

  const updateCliente = useCallback((id, changes) => {
    setClientes(prev => {
      const next = prev.map(c => c.id === id ? { ...c, ...changes } : c);
      save(next);
      return next;
    });
  }, []);

  const removeCliente = useCallback((id) => {
    setClientes(prev => {
      const next = prev.filter(c => c.id !== id);
      save(next);
      return next;
    });
  }, []);

  return (
    <CTX.Provider value={{ clientes, addCliente, updateCliente, removeCliente }}>
      {children}
    </CTX.Provider>
  );
}

export const useClientes = () => useContext(CTX);
