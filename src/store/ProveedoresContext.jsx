import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { loadSharedData, saveSharedData } from '../lib/dbHelpers';
import { supabase } from '../lib/supabase';

const CTX = createContext(null);
const LS_PROVS = 'kamak_proveedores_v1';
const LS_CC    = 'kamak_cc_v1';

const newId = () => `pv-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;
const ccId  = () => `cc-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;
const today = () => new Date().toISOString().split('T')[0];

// ── Seed proveedores ──────────────────────────────────────────────────────────
const SEED_PROVS = [
  { id: 'leandro',  nombre: 'Leandro Vázquez',    tipo: 'Construcción en seco · Plomería', cuit: '20-30123456-9', telefono: '+54 11 1234-5678', email: 'leandro@construccion.ar', condicion: 'Responsable Inscripto', notas: '' },
  { id: 'don-luis', nombre: 'Don Luis Electric.',  tipo: 'Electricidad',                   cuit: '20-25871234-3', telefono: '+54 11 2345-6789', email: 'donluis@elect.ar',          condicion: 'Responsable Inscripto', notas: '' },
  { id: 'easy',     nombre: 'Easy Construcción',   tipo: 'Materiales',                     cuit: '30-12345678-0', telefono: '0810-333-3279',    email: 'ventas@easy.com.ar',        condicion: 'Responsable Inscripto', notas: 'Proveedor de materiales varios' },
  { id: 'ariel',    nombre: 'Ariel Pintura',        tipo: 'Pintura',                        cuit: '20-22334455-1', telefono: '+54 11 3456-7890', email: 'ariel@pintura.ar',          condicion: 'Monotributista',        notas: '' },
  { id: 'distri',   nombre: 'Distri Cemento',       tipo: 'Materiales',                     cuit: '30-55667788-2', telefono: '+54 11 4567-8901', email: 'distri@cemento.ar',         condicion: 'Responsable Inscripto', notas: '' },
];

// ── Seed CC entries ───────────────────────────────────────────────────────────
const SEED_CC = [
  { id: 'cc1', proveedorId: 'leandro', obraId: 'baradero', obraNombre: 'Baradero', fecha: '2026-05-16', concepto: 'Contrato C-0042 · construcción en seco', tipo: 'contrato', debe: 2500000, haber: 0 },
  { id: 'cc2', proveedorId: 'leandro', obraId: 'baradero', obraNombre: 'Baradero', fecha: '2026-05-20', concepto: 'Pago a cuenta · transf Banco Galicia', tipo: 'pago', debe: 0, haber: 500000 },
  { id: 'cc3', proveedorId: 'leandro', obraId: 'baradero', obraNombre: 'Baradero', fecha: '2026-05-28', concepto: 'Certificación 25% · Levantar paredes', tipo: 'cert', debe: 625000, haber: 0 },
  { id: 'cc4', proveedorId: 'leandro', obraId: 'baradero', obraNombre: 'Baradero', fecha: '2026-06-03', concepto: 'Factura 0012 · revoque grueso', tipo: 'factura', debe: 245000, haber: 0 },
  { id: 'cc5', proveedorId: 'leandro', obraId: 'baradero', obraNombre: 'Baradero', fecha: '2026-06-05', concepto: 'Pago contado · efectivo Caja Pablo', tipo: 'pago', debe: 0, haber: 245000 },
  { id: 'cc6', proveedorId: 'leandro', obraId: 'baradero', obraNombre: 'Baradero', fecha: '2026-06-10', concepto: 'Adicional al contrato C-0042', tipo: 'adicional', debe: 180000, haber: 0 },
  { id: 'cc7', proveedorId: 'leandro', obraId: 'baradero', obraNombre: 'Baradero', fecha: '2026-06-22', concepto: 'Cheque ECHEQ #4421 · vto 22/07', tipo: 'echeq', debe: 0, haber: 350000 },
  { id: 'cc8', proveedorId: 'don-luis', obraId: 'baradero', obraNombre: 'Baradero', fecha: '2026-05-15', concepto: 'Materiales eléctricos · factura', tipo: 'factura', debe: 245000, haber: 0 },
  { id: 'cc9', proveedorId: 'don-luis', obraId: 'baradero', obraNombre: 'Baradero', fecha: '2026-05-16', concepto: 'Pago material eléctrico', tipo: 'pago', debe: 0, haber: 245000 },
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

function save(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch {}
}

// ── Calcula saldo de un proveedor a partir de sus CC entries ──────────────────
export function calcSaldoProveedor(proveedorId, ccEntries) {
  return ccEntries
    .filter(e => e.proveedorId === proveedorId)
    .reduce((s, e) => s + (e.debe || 0) - (e.haber || 0), 0);
}

// ── Saldo por obra para un proveedor ─────────────────────────────────────────
export function calcSaldoCC(proveedorId, obraId, ccEntries) {
  return ccEntries
    .filter(e => e.proveedorId === proveedorId && e.obraId === obraId)
    .reduce((s, e) => s + (e.debe || 0) - (e.haber || 0), 0);
}

// ── Provider ──────────────────────────────────────────────────────────────────
export function ProveedoresProvider({ children }) {
  const [proveedores, setProveedores] = useState(() => load(LS_PROVS, SEED_PROVS));
  const [ccEntries,   setCCEntries]   = useState(() => load(LS_CC,    SEED_CC));
  const sbLoaded = useRef(false);
  const lastSaveTime = useRef(0);
  const provsRef = useRef(proveedores);
  const ccRef    = useRef(ccEntries);
  useEffect(() => { provsRef.current = proveedores; }, [proveedores]);
  useEffect(() => { ccRef.current = ccEntries; }, [ccEntries]);

  useEffect(() => {
    loadSharedData('proveedores').then(data => {
      if (data) {
        if (data.proveedores) { setProveedores(data.proveedores); save(LS_PROVS, data.proveedores); }
        if (data.ccEntries)   { setCCEntries(data.ccEntries);     save(LS_CC,    data.ccEntries); }
      } else {
        saveSharedData('proveedores', { proveedores: provsRef.current, ccEntries: ccRef.current });
      }
      sbLoaded.current = true;
    });

    const channel = supabase
      .channel('shared-proveedores')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shared_data', filter: 'key=eq.proveedores' },
        (payload) => {
          if (!payload.new?.data) return;
          if (Date.now() - lastSaveTime.current < 2000) return;
          const d = payload.new.data;
          if (d.proveedores) { setProveedores(d.proveedores); save(LS_PROVS, d.proveedores); }
          if (d.ccEntries)   { setCCEntries(d.ccEntries);     save(LS_CC,    d.ccEntries); }
        }
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!sbLoaded.current) return;
    const t = setTimeout(() => {
      lastSaveTime.current = Date.now();
      saveSharedData('proveedores', { proveedores: provsRef.current, ccEntries: ccRef.current });
    }, 800);
    return () => clearTimeout(t);
  }, [proveedores, ccEntries]);

  // ── Proveedores CRUD ──────────────────────────────────────────────────────
  const addProveedor = useCallback((data) => {
    const nuevo = { ...data, id: newId() };
    setProveedores(prev => {
      const next = [...prev, nuevo];
      save(LS_PROVS, next);
      return next;
    });
    return nuevo.id;
  }, []);

  const updateProveedor = useCallback((id, changes) => {
    setProveedores(prev => {
      const next = prev.map(p => p.id === id ? { ...p, ...changes } : p);
      save(LS_PROVS, next);
      return next;
    });
  }, []);

  const removeProveedor = useCallback((id) => {
    setProveedores(prev => {
      const next = prev.filter(p => p.id !== id);
      save(LS_PROVS, next);
      return next;
    });
    setCCEntries(prev => {
      const next = prev.filter(e => e.proveedorId !== id);
      save(LS_CC, next);
      return next;
    });
  }, []);

  // ── CC CRUD ───────────────────────────────────────────────────────────────
  const addCC = useCallback((entry) => {
    const nuevo = { ...entry, id: ccId(), fecha: entry.fecha || today() };
    setCCEntries(prev => {
      const next = [...prev, nuevo];
      save(LS_CC, next);
      return next;
    });
    return nuevo.id;
  }, []);

  const updateCC = useCallback((id, changes) => {
    setCCEntries(prev => {
      const next = prev.map(e => e.id === id ? { ...e, ...changes } : e);
      save(LS_CC, next);
      return next;
    });
  }, []);

  const removeCC = useCallback((id) => {
    setCCEntries(prev => {
      const next = prev.filter(e => e.id !== id);
      save(LS_CC, next);
      return next;
    });
  }, []);

  const getCC = useCallback((proveedorId, obraId = null) =>
    ccEntries
      .filter(e => e.proveedorId === proveedorId && (obraId === null || e.obraId === obraId))
      .sort((a, b) => a.fecha.localeCompare(b.fecha)),
    [ccEntries]);

  const getSaldo = useCallback((proveedorId, obraId = null) =>
    obraId ? calcSaldoCC(proveedorId, obraId, ccEntries) : calcSaldoProveedor(proveedorId, ccEntries),
    [ccEntries]);

  const getObrasProveedor = useCallback((proveedorId) => {
    const map = {};
    ccEntries
      .filter(e => e.proveedorId === proveedorId && e.obraId)
      .forEach(e => { map[e.obraId] = e.obraNombre || e.obraId; });
    return Object.entries(map).map(([id, nombre]) => ({ id, nombre }));
  }, [ccEntries]);

  return (
    <CTX.Provider value={{
      proveedores, ccEntries,
      addProveedor, updateProveedor, removeProveedor,
      addCC, updateCC, removeCC, getCC, getSaldo, getObrasProveedor,
    }}>
      {children}
    </CTX.Provider>
  );
}

export const useProveedores = () => useContext(CTX);
