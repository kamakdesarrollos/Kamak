import { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { loadSharedData, saveSharedData } from '../lib/dbHelpers';
import { onRemoteChange } from '../lib/syncBus';
import { useAppLoading } from './AppLoadingContext';

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
  rubros:       [],
  materiales:   [],
  mo:           [],
  generales:    [],
  subcontratos: [],
  tareas:       [],
};

const SISMAT_SEED_VERSION = '4';

async function fetchSismatSeed() {
  try {
    const res = await fetch('/sismat_seed.json');
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

const CatalogContext = createContext(null);

function load() {
  try {
    const s3 = localStorage.getItem('kamak_catalog_v4');
    if (s3) return JSON.parse(s3);

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
  const sbLoaded   = useRef(false);
  const fromRemote = useRef(false);
  const { markReady } = useAppLoading();

  useEffect(() => {
    let cancelled = false;
    loadSharedData('catalog').then(async data => {
      if (cancelled) return;
      const needsReseed = localStorage.getItem('kamak_sismat_v') !== SISMAT_SEED_VERSION;

      if (data && !needsReseed) {
        fromRemote.current = true;
        setCatalog(data); localStorage.setItem('kamak_catalog_v4', JSON.stringify(data));
        setTimeout(() => { fromRemote.current = false; }, 0);
      } else {
        // Primera vez o versión desactualizada: importar catálogo Sismat
        const sismatData = await fetchSismatSeed();
        if (cancelled) return;
        const finalData = sismatData || data || catalog; // eslint-disable-line react-hooks/exhaustive-deps
        fromRemote.current = true;
        setCatalog(finalData);
        localStorage.setItem('kamak_catalog_v4', JSON.stringify(finalData));
        localStorage.setItem('kamak_sismat_v', SISMAT_SEED_VERSION);
        setTimeout(() => { fromRemote.current = false; }, 0);
        saveSharedData('catalog', finalData);
      }
      sbLoaded.current = true;
      markReady();
    });

    const unsub = onRemoteChange('catalog', () => {
      loadSharedData('catalog').then(d => {
        if (cancelled || !d) return;
        fromRemote.current = true;
        setCatalog(d);
        localStorage.setItem('kamak_catalog_v4', JSON.stringify(d));
        setTimeout(() => { fromRemote.current = false; }, 0);
      });
    });
    return () => { cancelled = true; unsub(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pendingSaveRef = useRef(null);
  useEffect(() => {
    localStorage.setItem('kamak_catalog_v4', JSON.stringify(catalog));
    if (!sbLoaded.current || fromRemote.current) return;
    pendingSaveRef.current = catalog;
    const t = setTimeout(() => {
      saveSharedData('catalog', catalog);
      pendingSaveRef.current = null;
    }, 800);
    return () => clearTimeout(t);
  }, [catalog]);

  useEffect(() => () => {
    if (pendingSaveRef.current) saveSharedData('catalog', pendingSaveRef.current, { silent: true });
  }, []);

  const add    = useCallback((coll, item)        => setCatalog(c => ({ ...c, [coll]: [...(c[coll]||[]), { id: newId(), ...item, updatedAt: today() }] })), []);
  const update = useCallback((coll, id, changes) => setCatalog(c => ({ ...c, [coll]: c[coll].map(i => i.id === id ? { ...i, ...changes, updatedAt: today() } : i) })), []);
  const remove = useCallback((coll, id)          => setCatalog(c => ({ ...c, [coll]: c[coll].filter(i => i.id !== id) })), []);
  const bulkSeed = useCallback((additions) => {
    setCatalog(prev => {
      const next = {
        ...prev,
        materiales:   [...(prev.materiales||[]),   ...(additions.materiales||[]).map(i => ({ id: newId(), ...i, updatedAt: today() }))],
        subcontratos: [...(prev.subcontratos||[]), ...(additions.subcontratos||[]).map(i => ({ id: newId(), ...i, updatedAt: today() }))],
        tareas:       [...(prev.tareas||[]),       ...(additions.tareas||[]).map(i => ({ id: newId(), ...i, updatedAt: today() }))],
      };
      localStorage.setItem('kamak_catalog_v4', JSON.stringify(next));
      saveSharedData('catalog', next, { silent: true });
      return next;
    });
  }, []);

  const value = useMemo(() => ({ catalog, add, update, remove, bulkSeed }), [catalog, add, update, remove, bulkSeed]);

  return (
    <CatalogContext.Provider value={value}>
      {children}
    </CatalogContext.Provider>
  );
}

export function useCatalog() { return useContext(CatalogContext); }
