import { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { loadSharedData, saveSharedData } from '../lib/dbHelpers';
import { supabase } from '../lib/supabase';

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

// ── Provider ──────────────────────────────────────────────────────────────────
export function MovimientosProvider({ children }) {
  const [cajas,       setCajas]       = useState(() => load(LS_CAJAS, SEED_CAJAS));
  const [movimientos, setMovimientos] = useState(() => load(LS_MOVS,  SEED_MOVS));
  const sbLoaded  = useRef(false);
  const lastSaveTime = useRef(0);
  const cajasRef  = useRef(cajas);
  const movsRef   = useRef(movimientos);
  useEffect(() => { cajasRef.current = cajas; }, [cajas]);
  useEffect(() => { movsRef.current = movimientos; }, [movimientos]);

  useEffect(() => {
    loadSharedData('movimientos').then(data => {
      if (data) {
        if (data.cajas)       { setCajas(data.cajas);             persist(LS_CAJAS, data.cajas); }
        if (data.movimientos) { setMovimientos(data.movimientos); persist(LS_MOVS,  data.movimientos); }
      } else {
        saveSharedData('movimientos', { cajas: cajasRef.current, movimientos: movsRef.current });
      }
      sbLoaded.current = true;
    });

    const channel = supabase
      .channel('shared-movimientos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shared_data', filter: 'key=eq.movimientos' },
        (payload) => {
          console.log('[RT movimientos] evento recibido, dt:', Date.now() - lastSaveTime.current, payload.new?.data ? 'con datos' : 'sin datos');
          if (!payload.new?.data) return;
          if (Date.now() - lastSaveTime.current < 2000) { console.log('[RT movimientos] bloqueado por guard'); return; }
          const d = payload.new.data;
          if (d.cajas)       { setCajas(d.cajas);             persist(LS_CAJAS, d.cajas); }
          if (d.movimientos) { setMovimientos(d.movimientos); persist(LS_MOVS,  d.movimientos); }
        }
      )
      .subscribe((status) => console.log('[RT movimientos] status:', status));
    return () => supabase.removeChannel(channel);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!sbLoaded.current) return;
    const t = setTimeout(() => {
      lastSaveTime.current = Date.now();
      saveSharedData('movimientos', { cajas: cajasRef.current, movimientos: movsRef.current });
    }, 800);
    return () => clearTimeout(t);
  }, [cajas, movimientos]);

  // ── Cajas CRUD ────────────────────────────────────────────────────────────
  const addCaja = useCallback((data) => {
    const nueva = { ...data, id: cajaId(), saldo: data.saldo || 0, activa: true };
    setCajas(prev => { const next = [...prev, nueva]; persist(LS_CAJAS, next); return next; });
    return nueva.id;
  }, []);

  const updateCaja = useCallback((id, changes) => {
    setCajas(prev => {
      const next = prev.map(c => c.id === id ? { ...c, ...changes } : c);
      persist(LS_CAJAS, next);
      return next;
    });
  }, []);

  const removeCaja = useCallback((id) => {
    setCajas(prev => { const next = prev.filter(c => c.id !== id); persist(LS_CAJAS, next); return next; });
  }, []);

  // ── Movimientos CRUD ──────────────────────────────────────────────────────
  const addMovimiento = useCallback((data) => {
    const nuevo = { ...data, id: newId(), fecha: data.fecha || today() };
    setCajas(prev => {
      const next = prev.map(c => {
        if (c.id === data.cajaId) {
          const delta = data.tipo === 'ingreso' ? data.monto : -data.monto;
          return { ...c, saldo: (c.saldo || 0) + delta };
        }
        if (data.tipo === 'traspaso' && c.id === data.cajaDestinoId) {
          return { ...c, saldo: (c.saldo || 0) + data.monto };
        }
        return c;
      });
      persist(LS_CAJAS, next);
      return next;
    });
    setMovimientos(prev => { const next = [nuevo, ...prev]; persist(LS_MOVS, next); return next; });
    return nuevo.id;
  }, []);

  const updateMovimiento = useCallback((id, changes) => {
    setMovimientos(prev => {
      const next = prev.map(m => m.id === id ? { ...m, ...changes } : m);
      persist(LS_MOVS, next);
      return next;
    });
  }, []);

  const removeMovimiento = useCallback((id) => {
    const mov = movimientos.find(m => m.id === id);
    if (!mov) return;
    setCajas(prev => {
      const next = prev.map(c => {
        if (c.id === mov.cajaId) {
          const delta = mov.tipo === 'ingreso' ? -mov.monto : mov.monto;
          return { ...c, saldo: (c.saldo || 0) + delta };
        }
        if (mov.tipo === 'traspaso' && c.id === mov.cajaDestinoId) {
          return { ...c, saldo: (c.saldo || 0) - mov.monto };
        }
        return c;
      });
      persist(LS_CAJAS, next);
      return next;
    });
    setMovimientos(prev => { const next = prev.filter(m => m.id !== id); persist(LS_MOVS, next); return next; });
  }, [movimientos]);

  // ── Traspaso ──────────────────────────────────────────────────────────────
  const traspasar = useCallback(({ cajaOrigenId, cajaDestinoId, monto, fecha, concepto, tcAplicado }) => {
    const id = newId();
    const mov = {
      id, fecha: fecha || today(), tipo: 'traspaso',
      descripcion: concepto || 'Traspaso entre cajas',
      monto: Math.abs(monto), obraId: null, obraNombre: 'General',
      cajaId: cajaOrigenId, cajaDestinoId,
      proveedor: '', categoria: 'traspaso', medioPago: 'Interno',
      referencia: '', fondoReparo: false, tcAplicado: tcAplicado || null,
    };
    setCajas(prev => {
      const next = prev.map(c => {
        if (c.id === cajaOrigenId) return { ...c, saldo: (c.saldo || 0) - Math.abs(monto) };
        if (c.id === cajaDestinoId) return { ...c, saldo: (c.saldo || 0) + Math.abs(monto) };
        return c;
      });
      persist(LS_CAJAS, next);
      return next;
    });
    setMovimientos(prev => { const next = [mov, ...prev]; persist(LS_MOVS, next); return next; });
    return id;
  }, []);

  // ── Computed helpers ──────────────────────────────────────────────────────
  const totalARS = useMemo(() =>
    cajas.filter(c => c.moneda === 'ARS' && c.activa).reduce((s, c) => s + (c.saldo || 0), 0),
    [cajas]);

  const totalUSD = useMemo(() =>
    cajas.filter(c => c.moneda === 'USD' && c.activa).reduce((s, c) => s + (c.saldo || 0), 0),
    [cajas]);

  const getMovsByObraId = useCallback((obraId) =>
    movimientos.filter(m => m.obraId === obraId).sort((a, b) => b.fecha.localeCompare(a.fecha)),
    [movimientos]);

  const getMovsByCajaId = useCallback((cajaId) =>
    movimientos.filter(m => m.cajaId === cajaId || m.cajaDestinoId === cajaId)
      .sort((a, b) => b.fecha.localeCompare(a.fecha)),
    [movimientos]);

  return (
    <CTX.Provider value={{
      cajas, movimientos,
      addCaja, updateCaja, removeCaja,
      addMovimiento, updateMovimiento, removeMovimiento,
      traspasar,
      totalARS, totalUSD,
      getMovsByObraId, getMovsByCajaId,
    }}>
      {children}
    </CTX.Provider>
  );
}

export const useMovimientos = () => useContext(CTX);
