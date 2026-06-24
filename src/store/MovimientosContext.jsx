import { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { loadSharedData, saveSharedData, patchObjectItem, appendObjectItem, removeObjectItem } from '../lib/dbHelpers';
import { onRemoteChange } from '../lib/syncBus';
import { useAppLoading } from './AppLoadingContext';
import { efectoEnCaja, calcSaldoCaja } from '../lib/caja';

export { calcSaldoCaja }; // re-export para compatibilidad con importadores existentes

const CTX = createContext(null);
const LS_CAJAS = 'kamak_cajas_v1';
const LS_MOVS  = 'kamak_movimientos_v1';

const newId = () => `mov-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;
const cajaId = () => `cj-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;
const today  = () => new Date().toISOString().split('T')[0];

// ── Seeds ─────────────────────────────────────────────────────────────────────
const SEED_CAJAS = [
  { id: 'cj-pablo',  nombre: 'Caja Pablo',       tipo: 'efectivo',    moneda: 'ARS', propietario: 'Pablo',          color: '#3d3d3a', saldo: 850000,    activa: true },
  { id: 'cj-socio',  nombre: 'Caja Socio',        tipo: 'efectivo',    moneda: 'ARS', propietario: 'Socio',          color: '#3d3d3a', saldo: 400000,    activa: true },
  { id: 'cj-galicia',nombre: 'Banco Galicia',     tipo: 'banco',       moneda: 'ARS', propietario: '',               color: '#3d7a4a', saldo: 2300000,   activa: true },
  { id: 'cj-mp',     nombre: 'Mercado Pago',      tipo: 'billetera',   moneda: 'ARS', propietario: '',               color: '#d4923a', saldo: 180000,    activa: true },
  { id: 'cj-bara',   nombre: 'Caja Baradero',     tipo: 'obra',        moneda: 'ARS', propietario: 'Juan (rinde)',   color: '#c0392b', saldo: 18000,     activa: true },
  { id: 'cj-pablo-u',nombre: 'Pablo USD',         tipo: 'efectivo',    moneda: 'USD', propietario: 'Pablo',          color: '#3d3d3a', saldo: 4200,      activa: true },
  { id: 'cj-socio-u',nombre: 'Socio USD',         tipo: 'efectivo',    moneda: 'USD', propietario: 'Socio',          color: '#3d3d3a', saldo: 2800,      activa: true },
  { id: 'cj-gal-u',  nombre: 'Banco Galicia USD', tipo: 'banco',       moneda: 'USD', propietario: '',               color: '#3d7a4a', saldo: 12500,     activa: true },
  { id: 'cj-juan-r', nombre: 'Rendición Juan',    tipo: 'rendicion',   moneda: 'ARS', propietario: 'Juan · adelantado $ 200.000', color: '#3d7a4a', saldo: 180000, activa: true },
  { id: 'cj-marcos-r',nombre:'Rendición Marcos',  tipo: 'rendicion',   moneda: 'ARS', propietario: 'Marcos · empresa le debe',    color: '#c0392b', saldo: -45000, activa: true },
];

const SEED_MOVS = [
  { id: 'mv1', fecha: '2026-05-15', tipo: 'gasto', descripcion: 'Mat. eléctrica · Don Luis SRL', monto: 245000, obraId: 'baradero', obraNombre: 'Baradero', cajaId: 'cj-galicia', cajaDestinoId: null, proveedor: 'Don Luis Electric.', categoria: 'materiales', medioPago: 'Transferencia', referencia: '', fondoReparo: false },
  { id: 'mv2', fecha: '2026-05-14', tipo: 'gasto', descripcion: 'ECHEQ #4421 · Leandro · Const. seco', monto: 350000, obraId: 'baradero', obraNombre: 'Baradero', cajaId: 'cj-galicia', cajaDestinoId: null, proveedor: 'Leandro Vázquez', categoria: 'subcontrato', medioPago: 'E-cheq', referencia: 'ECHEQ-4421', fondoReparo: false },
  { id: 'mv3', fecha: '2026-05-12', tipo: 'gasto', descripcion: 'Impuesto IIBB', monto: 18700, obraId: null, obraNombre: 'General', cajaId: 'cj-galicia', cajaDestinoId: null, proveedor: '', categoria: 'impuesto', medioPago: 'Débito', referencia: '', fondoReparo: false },
  { id: 'mv4', fecha: '2026-05-10', tipo: 'gasto', descripcion: 'Pago Leandro · Const. seco', monto: 500000, obraId: 'baradero', obraNombre: 'Baradero', cajaId: 'cj-galicia', cajaDestinoId: null, proveedor: 'Leandro Vázquez', categoria: 'subcontrato', medioPago: 'Transferencia', referencia: '', fondoReparo: false },
  { id: 'mv5', fecha: '2026-05-08', tipo: 'ingreso', descripcion: 'Cobro cliente · Familia Pérez · cuota 4', monto: 1200000, obraId: 'baradero', obraNombre: 'Baradero', cajaId: 'cj-galicia', cajaDestinoId: null, proveedor: '', categoria: 'cobro-cliente', medioPago: 'Transferencia', referencia: 'TRF-20260508', fondoReparo: false },
  { id: 'mv6', fecha: '2026-05-07', tipo: 'gasto', descripcion: 'Deb. servicio luz EDENOR', monto: 45800, obraId: null, obraNombre: 'General', cajaId: 'cj-galicia', cajaDestinoId: null, proveedor: 'EDENOR', categoria: 'servicio', medioPago: 'Débito', referencia: '', fondoReparo: false },
  { id: 'mv7', fecha: '2026-05-05', tipo: 'gasto', descripcion: 'Comisión mantenimiento', monto: 12500, obraId: null, obraNombre: 'General', cajaId: 'cj-galicia', cajaDestinoId: null, proveedor: '', categoria: 'general', medioPago: 'Transferencia', referencia: '', fondoReparo: false },
  { id: 'mv8', fecha: '2026-05-04', tipo: 'gasto', descripcion: 'Mat. albañilería · Easy Construccion', monto: 380000, obraId: 'pilar', obraNombre: 'Pilar', cajaId: 'cj-galicia', cajaDestinoId: null, proveedor: 'Easy Construcción', categoria: 'materiales', medioPago: 'Transferencia', referencia: '', fondoReparo: false },
  { id: 'mv9', fecha: '2026-05-02', tipo: 'gasto', descripcion: 'Mat. eléctrica · Don Luis SRL', monto: 245000, obraId: 'baradero', obraNombre: 'Baradero', cajaId: 'cj-galicia', cajaDestinoId: null, proveedor: 'Don Luis Electric.', categoria: 'materiales', medioPago: 'Transferencia', referencia: '', fondoReparo: false },
];

function load(key, seed) {
  try {
    const s = localStorage.getItem(key);
    if (s) {
      const saved = JSON.parse(s);
      const savedIds = new Set(saved.map(x => x.id));
      const missing = seed.filter(x => !savedIds.has(x.id));
      return missing.length ? [...saved, ...missing] : saved;
    }
  } catch {}
  return seed;
}

function persist(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch {}
}

// ── Saldo derivado (rediseño "libro único") ─────────────────────────────────
// El saldo de una caja se CALCULA: saldoInicial + suma del efecto de TODOS sus
// movimientos. La lógica pura vive en ../lib/caja.js (testeada). Antes el saldo
// era un número mutado a mano (drift, y el bot lo pisaba).

// Migración one-time: si una caja todavía no tiene saldoInicial, lo
// back-calculamos para que (saldoInicial + suma de movs) == saldo actual.
// Así el saldo mostrado NO cambia ni un peso al pasar a "calculado".
// IMPORTANTE: los movimientos semilla NO estaban aplicados a los saldos
// semilla, por eso usamos el saldo actual como base y restamos el efecto.
function migrarSaldoInicial(cajas, movimientos) {
  return (cajas || []).map(c => {
    if (c.saldoInicial != null) return c; // ya migrada
    const efecto = (movimientos || []).reduce((s, m) => s + efectoEnCaja(m, c.id), 0);
    return { ...c, saldoInicial: Math.round((c.saldo || 0) - efecto) };
  });
}

// ── Provider ──────────────────────────────────────────────────────────────────
export function MovimientosProvider({ children }) {
  const [cajas,       setCajas]       = useState(() => migrarSaldoInicial(load(LS_CAJAS, SEED_CAJAS), load(LS_MOVS, SEED_MOVS)));
  const [movimientos, setMovimientos] = useState(() => load(LS_MOVS,  SEED_MOVS));
  // Saldo de cada caja CALCULADO en vivo desde sus movimientos (única fuente de
  // verdad). Los consumidores leen este `cajasConSaldo` como `cajas`.
  const cajasConSaldo = useMemo(
    () => cajas.map(c => ({ ...c, saldo: calcSaldoCaja(c, movimientos) })),
    [cajas, movimientos]
  );
  const sbLoaded   = useRef(false);
  const fromRemote = useRef(false);
  const cajasRef   = useRef(cajas);
  const movsRef    = useRef(movimientos);
  // Marca true si el usuario edita ANTES del primer fetch (sino el remoto pisaría
  // sus cambios tempranos). Mismo guard que Proveedores.
  const userEditedBeforeFirstLoad = useRef(false);
  // Timestamp del último save local — para ignorar broadcasts inmediatamente
  // posteriores que traen datos viejos del server y pisarían cambios recientes
  // (mismo patrón que useSyncedSharedData, que evitó que se pisaran los cheques).
  const lastLocalSaveAt = useRef(0);
  const { markReady } = useAppLoading();
  // cajasRef apunta al saldo CALCULADO, así lo que se persiste a Supabase
  // lleva el saldo correcto (para el bot y cualquier lector externo).
  useEffect(() => { cajasRef.current = cajasConSaldo; }, [cajasConSaldo]);
  useEffect(() => { movsRef.current = movimientos; }, [movimientos]);

  useEffect(() => {
    // Guard de cancelacion: ver comentario en ObrasContext.
    let cancelled = false;
    loadSharedData('movimientos').then(data => {
      if (cancelled) return;
      if (data && !userEditedBeforeFirstLoad.current) {
        fromRemote.current = true;
        const movs = Array.isArray(data.movimientos) ? data.movimientos : (movsRef.current || []);
        if (Array.isArray(data.movimientos)) { setMovimientos(movs); persist(LS_MOVS, movs); }
        if (Array.isArray(data.cajas))       { const cm = migrarSaldoInicial(data.cajas, movs); setCajas(cm); persist(LS_CAJAS, cm); }
        setTimeout(() => { fromRemote.current = false; }, 0);
      } else if (data === null) {
        // data === null: query OK pero no hay registro (primer save / bootstrap
        // del key). Si fue undefined (error de red/permiso) NO guardamos: sino
        // pisaríamos el remoto con el cache local y se perdería, p.ej., un
        // movimiento que acaba de cargar el bot.
        saveSharedData('movimientos', { cajas: cajasRef.current, movimientos: movsRef.current });
      }
      // Si el usuario ya editó antes del fetch (data truthy + flag), no pisamos
      // su estado local: sus cambios ya se persistieron atómicamente por ítem.
      sbLoaded.current = true;
      markReady();
    });

    const unsub = onRemoteChange('movimientos', () => {
      // Si acabamos de guardar (<3s), ignoramos el broadcast: puede traer datos
      // del server SIN nuestro último cambio y pisarlo. La escritura atómica ya
      // lo persistió. (Mismo guard que usa el sync de cheques.)
      if (lastLocalSaveAt.current && Date.now() - lastLocalSaveAt.current < 3000) return;
      loadSharedData('movimientos').then(d => {
        if (cancelled || !d) return;
        fromRemote.current = true;
        const movs = Array.isArray(d.movimientos) ? d.movimientos : (movsRef.current || []);
        if (Array.isArray(d.movimientos)) { setMovimientos(movs); persist(LS_MOVS, movs); }
        if (Array.isArray(d.cajas))       { const cm = migrarSaldoInicial(d.cajas, movs); setCajas(cm); persist(LS_CAJAS, cm); }
        setTimeout(() => { fromRemote.current = false; }, 0);
      });
    });
    return () => { cancelled = true; unsub(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Persistencia: estado local optimista + escritura ATÓMICA por ítem (ver
  // mutaciones). YA NO se guarda el blob entero {cajas, movimientos} con debounce:
  // eso podía pisar un movimiento que el bot agregó atómicamente
  // (append_movimiento) → bug MOV-05. Cada add/update/remove persiste solo SU
  // ítem. El saldo de la caja lo derivan app y bot desde los movimientos
  // (saldoInicial + Σ efectos), así que no hace falta reescribir las cajas al
  // mover plata — el `saldo` guardado es vestigial.

  // mark(): antes del primer fetch marca que el usuario ya editó (para no pisar
  // sus cambios al cargar) y sella el timestamp del último cambio local (el
  // broadcast guard ignora eventos < 3s que traerían datos sin este cambio).
  const mark = () => {
    if (!sbLoaded.current) userEditedBeforeFirstLoad.current = true;
    lastLocalSaveAt.current = Date.now();
  };

  // ── Cajas CRUD ────────────────────────────────────────────────────────────
  const addCaja = useCallback((data) => {
    // El saldo inicial que carga el form es el saldoInicial (base del cálculo).
    const inicial = data.saldoInicial ?? data.saldo ?? 0;
    const nueva = { ...data, id: cajaId(), saldoInicial: inicial, saldo: inicial, activa: true };
    mark();
    setCajas(prev => { const next = [...prev, nueva]; persist(LS_CAJAS, next); return next; });
    appendObjectItem('movimientos', 'cajas', nueva);
    return nueva.id;
  }, []);

  const updateCaja = useCallback((id, changes) => {
    mark();
    setCajas(prev => { const next = prev.map(c => c.id === id ? { ...c, ...changes } : c); persist(LS_CAJAS, next); return next; });
    patchObjectItem('movimientos', 'cajas', id, changes);
  }, []);

  const removeCaja = useCallback((id) => {
    mark();
    setCajas(prev => { const next = prev.filter(c => c.id !== id); persist(LS_CAJAS, next); return next; });
    removeObjectItem('movimientos', 'cajas', id);
  }, []);

  // ── Movimientos CRUD ──────────────────────────────────────────────────────
  // Ya NO se muta el saldo de la caja acá: el saldo se CALCULA en vivo desde la
  // lista de movimientos (ver cajasConSaldo / calcSaldoCaja). Agregar, editar o
  // borrar un movimiento recalcula el saldo solo — sin drift y sin que el bot
  // y la app peleen por el mismo número.

  const addMovimiento = useCallback((data) => {
    const nuevo = {
      ...data,
      id: newId(),
      fecha: data.fecha || today(),
      creadoPor:   data.creadoPor   ?? 'Sistema',
      creadoPorWA: data.creadoPorWA ?? false,
    };
    mark();
    setMovimientos(prev => { const next = [nuevo, ...prev]; persist(LS_MOVS, next); return next; });
    appendObjectItem('movimientos', 'movimientos', nuevo);
    return nuevo.id;
  }, []);

  const updateMovimiento = useCallback((id, changes) => {
    // No pisar creadoPor/creadoPorWA: son de autoría, solo se setean al crear.
    const { creadoPor: _cp, creadoPorWA: _cpwa, ...safeChanges } = changes;
    mark();
    setMovimientos(prev => { const next = prev.map(m => m.id === id ? { ...m, ...safeChanges } : m); persist(LS_MOVS, next); return next; });
    patchObjectItem('movimientos', 'movimientos', id, safeChanges);
  }, []);

  const removeMovimiento = useCallback((id) => {
    mark();
    setMovimientos(prev => { const next = prev.filter(m => m.id !== id); persist(LS_MOVS, next); return next; });
    removeObjectItem('movimientos', 'movimientos', id);
  }, []);

  // Al renombrar un rubro en el catálogo, los gastos viejos imputados POR NOMBRE
  // (m.rubroNombre, sin rubroId) seguirían apuntando al nombre viejo y dejarían
  // de matchear el rubro del presupuesto (gastadoPorRubro). Renombramos esos
  // movimientos de forma atómica. Los que tienen rubroId no necesitan tocarse
  // (la imputación por id es robusta ante renombres). Devuelve cuántos cambió.
  const renombrarRubroEnMovimientos = useCallback((oldName, newName) => {
    if (!oldName || !newName || oldName === newName) return 0;
    const afectados = (movsRef.current || []).filter(m => m.rubroNombre === oldName).map(m => m.id);
    if (!afectados.length) return 0;
    mark();
    const ids = new Set(afectados);
    setMovimientos(prev => { const next = prev.map(m => ids.has(m.id) ? { ...m, rubroNombre: newName } : m); persist(LS_MOVS, next); return next; });
    afectados.forEach(id => patchObjectItem('movimientos', 'movimientos', id, { rubroNombre: newName }));
    return afectados.length;
  }, []);

  // ── Traspaso ──────────────────────────────────────────────────────────────
  // Bug previo: el destino recibia el mismo monto que el origen, aunque las
  // cajas fueran de distinta moneda. Ahora acepta montoDestino opcional para
  // traspasos cross-moneda.
  const traspasar = useCallback(({ cajaOrigenId, cajaDestinoId, monto, montoDestino, fecha, concepto, tcAplicado }) => {
    const mov = {
      id: newId(), fecha: fecha || today(), tipo: 'traspaso',
      descripcion: concepto || 'Traspaso entre cajas',
      monto: Math.abs(monto),
      montoDestino: montoDestino != null ? Math.abs(montoDestino) : Math.abs(monto),
      obraId: null, obraNombre: 'General',
      cajaId: cajaOrigenId, cajaDestinoId,
      proveedor: '', categoria: 'traspaso', medioPago: 'Interno',
      referencia: '', fondoReparo: false, tcAplicado: tcAplicado || null,
    };
    mark();
    setMovimientos(prev => { const next = [mov, ...prev]; persist(LS_MOVS, next); return next; });
    appendObjectItem('movimientos', 'movimientos', mov);
    return mov.id;
  }, []);

  // ── Computed helpers ──────────────────────────────────────────────────────
  const totalARS = useMemo(() =>
    cajasConSaldo.filter(c => c.moneda === 'ARS' && c.activa).reduce((s, c) => s + (c.saldo || 0), 0),
    [cajasConSaldo]);

  const totalUSD = useMemo(() =>
    cajasConSaldo.filter(c => c.moneda === 'USD' && c.activa).reduce((s, c) => s + (c.saldo || 0), 0),
    [cajasConSaldo]);

  const getMovsByObraId = useCallback((obraId) =>
    movimientos.filter(m => m.obraId === obraId).sort((a, b) => b.fecha.localeCompare(a.fecha)),
    [movimientos]);

  const getMovsByCajaId = useCallback((cajaId) =>
    movimientos.filter(m => m.cajaId === cajaId || m.cajaDestinoId === cajaId)
      .sort((a, b) => b.fecha.localeCompare(a.fecha)),
    [movimientos]);

  // Memoizar el value para evitar re-renders en cascada de los consumidores.
  const value = useMemo(() => ({
    cajas: cajasConSaldo, movimientos,
    addCaja, updateCaja, removeCaja,
    addMovimiento, updateMovimiento, removeMovimiento,
    renombrarRubroEnMovimientos,
    traspasar,
    totalARS, totalUSD,
    getMovsByObraId, getMovsByCajaId,
  }), [
    cajasConSaldo, movimientos,
    addCaja, updateCaja, removeCaja,
    addMovimiento, updateMovimiento, removeMovimiento,
    renombrarRubroEnMovimientos,
    traspasar,
    totalARS, totalUSD,
    getMovsByObraId, getMovsByCajaId,
  ]);

  return (
    <CTX.Provider value={value}>
      {children}
    </CTX.Provider>
  );
}

export const useMovimientos = () => useContext(CTX);

// Selector granular: devuelve los movimientos de una obra puntual con
// referencia estable mientras esa lista no cambie. Si la lista global de
// movimientos cambia pero ninguno de la obra pedida se modifico, el resultado
// mantiene la misma referencia, evitando recomputos costosos aguas abajo.
export function useMovimientosByObra(obraId) {
  const { movimientos } = useMovimientos();
  return useMemo(
    () => obraId ? movimientos.filter(m => m.obraId === obraId) : [],
    [movimientos, obraId]
  );
}

export function useMovimientosByCaja(cId) {
  const { movimientos } = useMovimientos();
  return useMemo(
    () => cId ? movimientos.filter(m => m.cajaId === cId || m.cajaDestinoId === cId) : [],
    [movimientos, cId]
  );
}
