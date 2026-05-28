import { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { loadSharedData, saveSharedData } from '../lib/dbHelpers';
import { onRemoteChange } from '../lib/syncBus';
import { useAppLoading } from './AppLoadingContext';
import { resolverItemAPU, resolverMOAPU, buildCatalogIndex } from '../lib/apuPriceResolver';
import { loadSismatCostMap, migrarCatalogoConSismat } from '../lib/sismatCostFallback';

// Versión de la migración SISMAT → catálogo APU. Bumpeala si querés re-correr
// la migración (p.ej. si actualizamos las reglas de conversión).
// v2: fix de encoding (Ã±→ñ) en normalizarNombre — sin esto los nombres del
// catálogo no matcheaban con los del SISMAT.
const CATALOG_SISMAT_MIGRATION_VERSION = '2';

const newId = () => `cat-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;
const today = () => new Date().toISOString().split('T')[0];

// calcTarea calcula el costo total de un APU (tarea del catálogo).
//
// Segundo argumento opcional: pasando el catálogo, los precios y unidades de
// los items se resuelven desde ahí (única fuente de verdad). Sin catálogo,
// usa el precio hardcoded del APU como fallback — comportamiento viejo, pero
// arrastra el bug del SISMAT (precios desactualizados o mal cargados).
//
// PREFERIR siempre pasar el catálogo. El fallback existe sólo para que
// llamadas legacy no rompan.
export const calcTarea = (t, catalog = null) => {
  const matCat = catalog?.materiales;
  const subCat = catalog?.subcontratos;
  const moCat  = catalog?.mo;
  const genCat = catalog?.generales;

  const mat = (t.materiales||[]).reduce((s, m) => s + resolverItemAPU(m, matCat).subtotal, 0);
  const sub = (t.subcontratos||[]).reduce((s, sc) => s + resolverItemAPU(sc, subCat).subtotal, 0);
  const mo  = (t.mo||[]).reduce((s, m) => s + resolverMOAPU(m, moCat).subtotal, 0);
  const gen = (t.generales||[]).reduce((s, g) => s + resolverItemAPU(g, genCat).subtotal, 0);
  return { mat, sub, mo, gen, total: mat + sub + mo + gen };
};

const SEED = {
  rubros:       [],
  materiales:   [],
  mo:           [],
  generales:    [],
  subcontratos: [],
  tareas:       [],
  // Tipos de obra: lista chica para auto-generar tareas base al aprobar
  // un presupuesto. Cada item: { id, nombre, descripcion, tareasBase: [...] }.
  // Las tareasBase tienen el mismo shape que las tareasEstandar de rubros
  // (ver más abajo).
  tiposObra:    [],
};

// Shape de una "tarea estándar" (vive en rubro.tareasEstandar y en
// tipoObra.tareasBase):
// {
//   id: 'te-xxx',
//   titulo: 'Cotizar mueblería',
//   descripcion: '',
//   rol: 'Comprador' | 'Admin' | 'Capataz' | 'Director de obra' | ...,
//   diasOffset: 0,          // días desde aprobación del presupuesto
//   prioridad: 'baja'|'media'|'alta',
//   checklist: ['llamar mueblería', 'agendar entrega', ...],
// }

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

  // Index Map por nombre normalizado — lookup O(1) para calcTarea.
  // Sin esto, resolver precios en presupuestos con muchos APUs y materiales
  // se volvía O(N×M) con string normalization → render lentísimo.
  const catalogIndex = useMemo(() => buildCatalogIndex(catalog), [catalog]);

  // Carga el index de costos SISMAT (materiales + MO×0.5) que sirve para
  // (1) migrar el catálogo una vez al cargar (ver useEffect debajo) y (2)
  // como fallback en lugares como Plantillas si el catálogo todavía está
  // incompleto antes de que termine la migración.
  const [sismatCostMap, setSismatCostMap] = useState(null);
  useEffect(() => {
    let cancelled = false;
    loadSismatCostMap().then(m => { if (!cancelled) setSismatCostMap(m); });
    return () => { cancelled = true; };
  }, []);

  // Migración one-shot: enriquecer APUs del catálogo con sub-contratos
  // derivados de la MO SISMAT (× 0.5). Espera a que (a) sismatCostMap esté
  // disponible y (b) catalog.tareas tenga datos cargados. Idempotente vía
  // CATALOG_SISMAT_MIGRATION_VERSION en localStorage.
  useEffect(() => {
    if (!sismatCostMap || sismatCostMap.size === 0) return;
    if (!catalog?.tareas || catalog.tareas.length === 0) return;
    const ver = localStorage.getItem('kamak_catalog_sismat_migration_v');
    if (ver === CATALOG_SISMAT_MIGRATION_VERSION) return;
    const migrated = migrarCatalogoConSismat(catalog, sismatCostMap);
    if (migrated) {
      setCatalog(migrated);
      // El save a Supabase lo dispara el useEffect [catalog] que ya existe.
    }
    localStorage.setItem('kamak_catalog_sismat_migration_v', CATALOG_SISMAT_MIGRATION_VERSION);
  }, [sismatCostMap, catalog]);

  const value = useMemo(
    () => ({ catalog, catalogIndex, sismatCostMap, add, update, remove, bulkSeed }),
    [catalog, catalogIndex, sismatCostMap, add, update, remove, bulkSeed]
  );

  return (
    <CatalogContext.Provider value={value}>
      {children}
    </CatalogContext.Provider>
  );
}

export function useCatalog() { return useContext(CatalogContext); }
