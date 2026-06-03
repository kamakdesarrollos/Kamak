import { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { loadSharedData, saveSharedData, patchCatalogItem, appendCatalogItem, removeCatalogItem } from '../lib/dbHelpers';
import { onRemoteChange } from '../lib/syncBus';
import { useAppLoading } from './AppLoadingContext';
import { resolverItemAPU, resolverMOAPU, buildCatalogIndex, normalizarNombre } from '../lib/apuPriceResolver';
import { cascadeRename } from '../lib/catalogCascade';
import { loadSismatCostMap, migrarCatalogoConSismat } from '../lib/sismatCostFallback';
import { aplicarCACalCatalogo } from '../lib/cacUpdate';

// Versión de la migración SISMAT → catálogo APU. Bumpeala si querés re-correr
// la migración (p.ej. si actualizamos las reglas de conversión).
// v2: fix de encoding (Ã±→ñ) en normalizarNombre — sin esto los nombres del
// catálogo no matcheaban con los del SISMAT.
// v3: fixEncoding ampliado a /[ÃÂ]/ (caracteres °/º) + matcher por PREFIJO
//     (findCostoSub) → rescata ~162 APUs cuya MO existía pero con nombre+sufijo
//     (ej. "Mampostería de 15" ↔ MO "Mampostería de 15  ladrillo común").
const CATALOG_SISMAT_MIGRATION_VERSION = '3';

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
  // Anti-pisada: si el usuario edita ANTES de que llegue el primer fetch de
  // Supabase, NO pisamos su trabajo con el remoto; en su lugar subimos lo suyo.
  // (Mismo patrón que ObrasContext — antes el load tardío revertía el cambio recién
  // hecho: el usuario renombraba un APU / agregaba una tarea y volvía al original.)
  const userEditedBeforeFirstLoad = useRef(false);
  const lastLocalSaveAt = useRef(0);
  const catalogRef = useRef(catalog);
  const { markReady } = useAppLoading();
  useEffect(() => { catalogRef.current = catalog; }, [catalog]);
  const markUserEdit = () => { if (!sbLoaded.current) userEditedBeforeFirstLoad.current = true; };
  // Marca un guardado local reciente para que el guard de onRemoteChange (abajo)
  // ignore el broadcast de los próximos 3s y NO pise el cambio recién hecho.
  // (Sin esto el guard estaba inerte: lastLocalSaveAt nunca se actualizaba.)
  const touch = () => { lastLocalSaveAt.current = Date.now(); };

  const pendingSaveRef = useRef(null);
  useEffect(() => {
    let cancelled = false;
    loadSharedData('catalog').then(async data => {
      if (cancelled) return;
      if (data === undefined) {
        // Error de red/permiso en el load: no sembramos ni pisamos nada; usamos el
        // localStorage que ya tenemos. (Evita re-sembrar por un fetch fallido.)
        sbLoaded.current = true;
        markReady();
        return;
      }
      if (userEditedBeforeFirstLoad.current) {
        // El usuario editó ANTES de que llegara el fetch. Esos cambios ya se
        // persistieron de forma ATÓMICA por ítem (add/update/remove → *CatalogItem),
        // así que NO subimos el blob local: subirlo pisaría ediciones que otro
        // usuario haya hecho en paralelo (bug CAT-003). Mantenemos el estado
        // local; los cambios remotos llegan por onRemoteChange.
      } else if (data) {
        // Ya hay catálogo en la base → SIEMPRE se usa ese. NUNCA re-sembrar encima
        // (antes un bump de versión, o el logout borrando kamak_sismat_v, pisaba la
        // base con el seed del SISMAT y se perdían todas las ediciones). Marcamos la
        // versión de seed como vista para no intentar sembrar de nuevo.
        fromRemote.current = true;
        setCatalog(data);
        localStorage.setItem('kamak_catalog_v4', JSON.stringify(data));
        localStorage.setItem('kamak_sismat_v', SISMAT_SEED_VERSION);
        setTimeout(() => { fromRemote.current = false; }, 0);
      } else {
        // Base vacía (primera vez de verdad): recién acá sembramos desde el SISMAT.
        const sismatData = await fetchSismatSeed();
        if (cancelled) return;
        const finalData = sismatData || catalogRef.current;
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
      // Ignorar el broadcast si hay un save local pendiente o muy reciente (<3s):
      // suele traer datos del server sin el cambio local todavía → lo pisaría.
      if (pendingSaveRef.current) return;
      if (lastLocalSaveAt.current && Date.now() - lastLocalSaveAt.current < 3000) return;
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

  // Cache local. La persistencia a Supabase de cada edición va por escritura
  // ATÓMICA por ítem (ver add/update/remove), NO por upsert del blob entero
  // (que con 2 editores se pisaban — bug CAT-003). Las operaciones masivas
  // (seed, CAC, migración SISMAT) guardan el blob explícitamente aparte.
  useEffect(() => {
    localStorage.setItem('kamak_catalog_v4', JSON.stringify(catalog));
  }, [catalog]);

  // add/update/remove: estado local optimista + persistencia ATÓMICA por ítem
  // (NO upsert del blob entero). Con el blob entero, dos personas editando a la
  // vez se pisaban (last-write-wins, bug CAT-003: "edito una APU y no se guarda").
  // Ahora cada edición patchea SOLO ese ítem server-side → no se pisan.
  const add    = useCallback((coll, item)        => { markUserEdit(); touch(); const full = { id: newId(), ...item, updatedAt: today() }; setCatalog(c => ({ ...c, [coll]: [...(c[coll]||[]), full] })); appendCatalogItem(coll, full); }, []);
  const update = useCallback((coll, id, changes) => {
    markUserEdit(); touch();
    const patch = { ...changes, updatedAt: today() };
    // Cascada de rename: las recetas de las APU referencian materiales/MO/grales
    // POR NOMBRE. Si renombrás uno acá sin propagarlo, esas APU quedan "SIN
    // CATÁLOGO". Detectamos el cambio de nombre y actualizamos las tareas que lo usan.
    const c = catalogRef.current;
    const prevItem = ['materiales', 'subcontratos', 'generales'].includes(coll)
      ? (c?.[coll] || []).find(i => i.id === id) : null;
    const cascada = (prevItem?.nombre && changes.nombre && normalizarNombre(changes.nombre) !== normalizarNombre(prevItem.nombre))
      ? cascadeRename(c.tareas, coll, prevItem.nombre, changes.nombre, normalizarNombre) : null;

    setCatalog(prev => {
      const next = { ...prev, [coll]: prev[coll].map(i => i.id === id ? { ...i, ...patch } : i) };
      if (cascada) next.tareas = cascada.tareas;
      return next;
    });
    patchCatalogItem(coll, id, patch);
    if (cascada) for (const cb of cascada.cambios) patchCatalogItem('tareas', cb.id, { [coll]: cb[coll] });
  }, []);
  const remove = useCallback((coll, id)          => { markUserEdit(); touch(); setCatalog(c => ({ ...c, [coll]: c[coll].filter(i => i.id !== id) })); removeCatalogItem(coll, id); }, []);
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

  // Actualización masiva de precios por índice CAC (un solo setCatalog + save).
  // Antes de aplicar, guarda un backup para poder deshacer (restoreCatalog).
  const bulkUpdatePreciosCAC = useCallback(({ mesBase, mesActual, indices, incluirMOLegacy }) => {
    setCatalog(prev => {
      try { localStorage.setItem('kamak_catalog_cac_backup', JSON.stringify({ at: new Date().toISOString(), catalog: prev })); } catch (e) { console.warn('[CAC] no pude guardar el backup del catálogo:', e?.message); }
      const next = aplicarCACalCatalogo(prev, { mesBase, mesActual, indices, incluirMOLegacy });
      localStorage.setItem('kamak_catalog_v4', JSON.stringify(next));
      saveSharedData('catalog', next, { silent: true });
      return next;
    });
  }, []);

  // Restaura el catálogo desde el backup de la última actualización CAC.
  // Devuelve true si había backup para restaurar.
  const restoreCatalogCACBackup = useCallback(() => {
    let bk;
    try { bk = JSON.parse(localStorage.getItem('kamak_catalog_cac_backup') || 'null'); } catch { bk = null; }
    if (!bk || !bk.catalog) return false;
    setCatalog(() => {
      localStorage.setItem('kamak_catalog_v4', JSON.stringify(bk.catalog));
      saveSharedData('catalog', bk.catalog, { silent: true });
      return bk.catalog;
    });
    return true;
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
      // Backup del catálogo pre-migración (reversible si algo sale mal).
      try { localStorage.setItem('kamak_catalog_sismat_premig_backup', JSON.stringify(catalog)); }
      catch (e) { console.warn('[SISMAT migr] no pude guardar backup:', e?.message); }
      setCatalog(migrated);
      // Migración one-shot: persiste el blob explícitamente (ya no hay save
      // automático del blob en el useEffect [catalog]).
      saveSharedData('catalog', migrated, { silent: true });
    }
    localStorage.setItem('kamak_catalog_sismat_migration_v', CATALOG_SISMAT_MIGRATION_VERSION);
  }, [sismatCostMap, catalog]);

  const value = useMemo(
    () => ({ catalog, catalogIndex, sismatCostMap, add, update, remove, bulkSeed, bulkUpdatePreciosCAC, restoreCatalogCACBackup }),
    [catalog, catalogIndex, sismatCostMap, add, update, remove, bulkSeed, bulkUpdatePreciosCAC, restoreCatalogCACBackup]
  );

  return (
    <CatalogContext.Provider value={value}>
      {children}
    </CatalogContext.Provider>
  );
}

export function useCatalog() { return useContext(CatalogContext); }
