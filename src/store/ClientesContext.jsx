import { createContext, useContext, useState, useCallback } from 'react';

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
