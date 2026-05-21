import { createContext, useContext, useState, useEffect } from 'react';

const newId = () => `cat-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;
const today = () => new Date().toISOString().split('T')[0];

export const calcTarea = (t) => {
  const mat = (t.materiales||[]).reduce((s,m) => s + m.cantidad * m.precio, 0);
  const sub = (t.subcontratos||[]).reduce((s,sc) => s + sc.cantidad * sc.precio, 0);
  const mo  = (t.mo||[]).reduce((s,m) => s + m.horas * m.precioHora, 0);
  const gen = (t.generales||[]).reduce((s,g) => s + (g.cantidad||1) * g.precio, 0);
  return { mat, sub, mo, gen, total: mat + sub + mo + gen };
};

const SEED = {
  rubros: [
    { id: 'r1', nombre: 'ALBAÑILERÍA' },
    { id: 'r2', nombre: 'CONSTRUCCION EN SECO' },
    { id: 'r3', nombre: 'ELECTRICIDAD' },
    { id: 'r4', nombre: 'PINTURA' },
    { id: 'r5', nombre: 'CARPINTERIA DE ALUMINIO' },
    { id: 'r6', nombre: 'MOBILIARIO' },
    { id: 'r7', nombre: 'PLOMERIA' },
    { id: 'r8', nombre: 'EXTRACCION' },
    { id: 'r9', nombre: 'LOGISTICA' },
    { id: 'r10', nombre: 'PROYECTO Y DIRECCION' },
    { id: 'r11', nombre: 'LIMPIEZA' },
  ],
  materiales: [],
  mo: [],
  generales: [],
  subcontratos: [],
  tareas: [],
};

const CatalogContext = createContext(null);

function load() {
  try {
    const s3 = localStorage.getItem('kamak_catalog_v4');
    if (s3) return JSON.parse(s3);

    // Migrar desde versión anterior: tomar v2 (donde el usuario cargó sus datos reales)
    const raw = localStorage.getItem('kamak_catalog_v2');
    if (raw) {
      const old = JSON.parse(raw);
      return {
        ...SEED,
        materiales:   old.materiales   || [],
        mo:           old.mo           || [],
        generales:    old.generales    || [],
        subcontratos: old.subcontratos || [],
        tareas:       old.tareas       || [],
      };
    }
  } catch {}
  return SEED;
}

export function CatalogProvider({ children }) {
  const [catalog, setCatalog] = useState(load);
  useEffect(() => { localStorage.setItem('kamak_catalog_v4', JSON.stringify(catalog)); }, [catalog]);

  const add    = (coll, item)        => setCatalog(c => ({ ...c, [coll]: [...c[coll], { id: newId(), ...item, updatedAt: today() }] }));
  const update = (coll, id, changes) => setCatalog(c => ({ ...c, [coll]: c[coll].map(i => i.id === id ? { ...i, ...changes, updatedAt: today() } : i) }));
  const remove = (coll, id)          => setCatalog(c => ({ ...c, [coll]: c[coll].filter(i => i.id !== id) }));

  return (
    <CatalogContext.Provider value={{ catalog, add, update, remove }}>
      {children}
    </CatalogContext.Provider>
  );
}

export function useCatalog() { return useContext(CatalogContext); }
