import { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { loadSharedData, saveSharedData, patchObjectItem, appendObjectItem, removeObjectItem } from '../lib/dbHelpers';
import { onRemoteChange } from '../lib/syncBus';
import { useAppLoading } from './AppLoadingContext';
import { aplicarPagoAFactura, saldoFacturaPendiente, estadoFacturaPendiente } from '../lib/facturasPendientes';

const CTX = createContext(null);
const LS_PROVS = 'kamak_proveedores_v1';
const LS_CC    = 'kamak_cc_v1';
const LS_FAC   = 'kamak_facturas_pend_v1';

const newId = () => `pv-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;
const ccId  = () => `cc-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;
const facId = () => `fp-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;
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

// ── CC del proveedor DERIVADA de los movimientos (libro único) ────────────────
// Lo que le PAGAMOS a un proveedor sale de los movimientos (gastos a ese
// proveedor, por id o por nombre) — no de los 'haber' de ccEntries, que quedan
// vestigiales. Lo que le DEBEMOS (debe: certificaciones/facturas/contratos)
// sigue viniendo de ccEntries. Así un pago cargado por el bot o por la app
// aparece en la CC sin que nadie tenga que duplicar el asiento.
const _normProv = s => (s || '').toLowerCase().trim();

export function pagosProveedorDesdeMovs(prov, movimientos, obraId = null) {
  if (!prov) return [];
  const nombreN = _normProv(prov.nombre);
  return (movimientos || []).filter(m =>
    m.tipo === 'gasto' &&
    (m.proveedorId === prov.id || (m.proveedor && _normProv(m.proveedor) === nombreN)) &&
    (!obraId || m.obraId === obraId)
  );
}

// Asientos DEBE de ccEntries (lo que debemos: certificaciones/facturas/etc).
export function debeEntriesProveedor(proveedorId, ccEntries, obraId = null) {
  return (ccEntries || []).filter(e =>
    e.proveedorId === proveedorId && (e.debe || 0) > 0 && (!obraId || e.obraId === obraId)
  );
}

export function calcSaldoProveedorMov(prov, ccEntries, movimientos, obraId = null) {
  const debe = debeEntriesProveedor(prov?.id, ccEntries, obraId).reduce((s, e) => s + (e.debe || 0), 0);
  const pagado = pagosProveedorDesdeMovs(prov, movimientos, obraId).reduce((s, m) => s + (m.monto || 0), 0);
  return debe - pagado;
}

// ── Provider ──────────────────────────────────────────────────────────────────
export function ProveedoresProvider({ children }) {
  const [proveedores, setProveedores] = useState(() => load(LS_PROVS, SEED_PROVS));
  const [ccEntries,   setCCEntries]   = useState(() => load(LS_CC,    SEED_CC));
  const [facturasPendientes, setFacturasPendientes] = useState(() => load(LS_FAC, []));
  const sbLoaded   = useRef(false);
  const fromRemote = useRef(false);
  const provsRef   = useRef(proveedores);
  const ccRef      = useRef(ccEntries);
  const facRef     = useRef(facturasPendientes);
  // Marca true si el usuario edita ANTES del primer fetch a Supabase (sino el
  // remoto pisaría sus cambios tempranos). Mismo guard que Obras/Movimientos.
  const userEditedBeforeFirstLoad = useRef(false);
  // Timestamp del último save local: el handler de onRemoteChange ignora
  // broadcasts inmediatamente posteriores (traen datos del server sin el cambio
  // local todavía → hacían "desaparecer" cambios recién guardados).
  const lastLocalSaveAt = useRef(0);
  const { markReady } = useAppLoading();
  useEffect(() => { provsRef.current = proveedores; }, [proveedores]);
  useEffect(() => { ccRef.current = ccEntries; }, [ccEntries]);
  useEffect(() => { facRef.current = facturasPendientes; }, [facturasPendientes]);

  useEffect(() => {
    let cancelled = false;
    loadSharedData('proveedores').then(data => {
      if (cancelled) return;
      if (data === undefined) {
        // Error de red/permiso: NO guardamos (terminaría con el mismo error);
        // la app se renderea con lo que ya hay en localStorage.
        sbLoaded.current = true; markReady(); return;
      }
      if (userEditedBeforeFirstLoad.current) {
        // El usuario ya editó antes del fetch → sus cambios YA se persistieron
        // atómicamente (append/patch/remove por ítem). No pisamos su estado local
        // con el remoto. Si el key todavía no existía (fresh install), lo creamos.
        if (data === null) saveSharedData('proveedores', { proveedores: provsRef.current, ccEntries: ccRef.current, facturasPendientes: facRef.current });
      } else if (data) {
        fromRemote.current = true;
        if (data.proveedores) { setProveedores(data.proveedores); save(LS_PROVS, data.proveedores); }
        if (data.ccEntries)   { setCCEntries(data.ccEntries);     save(LS_CC,    data.ccEntries); }
        if (data.facturasPendientes) { setFacturasPendientes(data.facturasPendientes); save(LS_FAC, data.facturasPendientes); }
        setTimeout(() => { fromRemote.current = false; }, 0);
      } else {
        saveSharedData('proveedores', { proveedores: provsRef.current, ccEntries: ccRef.current, facturasPendientes: facRef.current });
      }
      sbLoaded.current = true;
      markReady();
    });

    const unsub = onRemoteChange('proveedores', () => {
      // Ignorar el broadcast recién disparado (< 3s): suele traer datos del
      // server sin el cambio local todavía. La escritura atómica ya lo persistió;
      // al pasar la ventana, el próximo broadcast/recarga trae todo mergeado.
      if (lastLocalSaveAt.current && Date.now() - lastLocalSaveAt.current < 3000) return;
      loadSharedData('proveedores').then(d => {
        if (cancelled || !d) return;
        fromRemote.current = true;
        if (d.proveedores) { setProveedores(d.proveedores); save(LS_PROVS, d.proveedores); }
        if (d.ccEntries)   { setCCEntries(d.ccEntries);     save(LS_CC,    d.ccEntries); }
        if (d.facturasPendientes) { setFacturasPendientes(d.facturasPendientes); save(LS_FAC, d.facturasPendientes); }
        setTimeout(() => { fromRemote.current = false; }, 0);
      });
    });
    return () => { cancelled = true; unsub(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Persistencia: estado local optimista + escritura ATÓMICA por ítem (ver
  // mutaciones). YA NO se guarda el blob entero {proveedores, ccEntries} con
  // debounce: eso pisaba lo que el bot escribía atómico en ccEntries
  // (certificaciones/facturas) → la deuda del proveedor "desaparecía"
  // (bug PROV-CC-001). Cada add/update/remove persiste solo SU ítem.

  // mark(): antes del primer fetch marca que el usuario ya editó (para no pisar
  // sus cambios al cargar) y sella el timestamp del último cambio local (el
  // broadcast guard ignora eventos < 3s que traerían datos sin este cambio).
  const mark = () => {
    if (!sbLoaded.current) userEditedBeforeFirstLoad.current = true;
    lastLocalSaveAt.current = Date.now();
  };

  // ── Proveedores CRUD ──────────────────────────────────────────────────────
  const addProveedor = useCallback((data) => {
    mark();
    // grupos: labels de "proveedor tipo" (de lib/proveedoresMateriales) a los que
    // pertenece este proveedor real (1 o varios; ej. corralón → 'Corralón de
    // materiales'). Default [] para que el campo exista siempre en el shape.
    const nuevo = { grupos: [], ...data, id: newId() };
    if (!Array.isArray(nuevo.grupos)) nuevo.grupos = [];
    setProveedores(prev => { const next = [...prev, nuevo]; save(LS_PROVS, next); return next; });
    appendObjectItem('proveedores', 'proveedores', nuevo);
    return nuevo.id;
  }, []);

  const updateProveedor = useCallback((id, changes) => {
    mark();
    setProveedores(prev => { const next = prev.map(p => p.id === id ? { ...p, ...changes } : p); save(LS_PROVS, next); return next; });
    patchObjectItem('proveedores', 'proveedores', id, changes);
  }, []);

  const removeProveedor = useCallback((id) => {
    mark();
    setProveedores(prev => { const next = prev.filter(p => p.id !== id); save(LS_PROVS, next); return next; });
    removeObjectItem('proveedores', 'proveedores', id);
    // Borrar también, atómicamente, los asientos de CC de ese proveedor (es un
    // borrado por proveedorId, no por id → un remove por cada asiento que matchea).
    const ccDel = (ccRef.current || []).filter(e => e.proveedorId === id);
    setCCEntries(prev => { const next = prev.filter(e => e.proveedorId !== id); save(LS_CC, next); return next; });
    ccDel.forEach(e => removeObjectItem('proveedores', 'ccEntries', e.id));
  }, []);

  // ── CC CRUD ───────────────────────────────────────────────────────────────
  const addCC = useCallback((entry) => {
    mark();
    const nuevo = { ...entry, id: ccId(), fecha: entry.fecha || today() };
    setCCEntries(prev => { const next = [...prev, nuevo]; save(LS_CC, next); return next; });
    appendObjectItem('proveedores', 'ccEntries', nuevo);
    return nuevo.id;
  }, []);

  const updateCC = useCallback((id, changes) => {
    mark();
    setCCEntries(prev => { const next = prev.map(e => e.id === id ? { ...e, ...changes } : e); save(LS_CC, next); return next; });
    patchObjectItem('proveedores', 'ccEntries', id, changes);
  }, []);

  const removeCC = useCallback((id) => {
    mark();
    setCCEntries(prev => { const next = prev.filter(e => e.id !== id); save(LS_CC, next); return next; });
    removeObjectItem('proveedores', 'ccEntries', id);
  }, []);

  // ── Facturas pendientes (cuentas por pagar) ───────────────────────────────
  // Una factura de proveedor que aún NO se pagó. Lleva sus datos fiscales
  // (comprobanteRecibido) → cuenta para Libro IVA. El pago se registra aparte
  // (movimiento de caja) y se linkea vía registrarPagoFactura. Mismo patrón
  // atómico que ccEntries (append/patch/remove por ítem en key 'proveedores').
  const addFacturaPendiente = useCallback((data) => {
    mark();
    const pagos = data.pagos || [];
    const nuevo = {
      ...data,
      id: facId(),
      estado: data.estado || 'pendiente',
      pagos,
      createdAt: new Date().toISOString(),
    };
    // 'registrada' = factura solo fiscal (cuenta para Libro IVA pero no es deuda ni
    // mueve caja) → saldoPendiente 0 para que no figure como adeudada.
    nuevo.saldoPendiente = nuevo.estado === 'registrada' ? 0 : saldoFacturaPendiente(nuevo);
    setFacturasPendientes(prev => { const next = [...prev, nuevo]; save(LS_FAC, next); return next; });
    appendObjectItem('proveedores', 'facturasPendientes', nuevo);
    return nuevo.id;
  }, []);

  const updateFacturaPendiente = useCallback((id, changes) => {
    mark();
    setFacturasPendientes(prev => { const next = prev.map(f => f.id === id ? { ...f, ...changes } : f); save(LS_FAC, next); return next; });
    patchObjectItem('proveedores', 'facturasPendientes', id, changes);
  }, []);

  const removeFacturaPendiente = useCallback((id) => {
    mark();
    setFacturasPendientes(prev => { const next = prev.filter(f => f.id !== id); save(LS_FAC, next); return next; });
    removeObjectItem('proveedores', 'facturasPendientes', id);
  }, []);

  // Registra un pago contra una factura: lee la factura FRESCA del ref (robusto si
  // el bot/otra pestaña la tocó), agrega el pago, recalcula estado/saldo y persiste
  // SOLO esa factura. El movimiento de caja (gasto) se crea aparte y su id viene en
  // pago.movimientoId. Devuelve la factura actualizada (o null si no existe).
  const registrarPagoFactura = useCallback((facturaId, pago) => {
    const actual = (facRef.current || []).find(f => f.id === facturaId);
    if (!actual) return null;
    // Defensa: una factura 'registrada' (solo fiscal) o 'anulada' no es deuda → no
    // recibe pagos. Evita que un pago la "salde" o mueva caja contra ella por error.
    const est = estadoFacturaPendiente(actual);
    if (est === 'registrada' || est === 'anulada') return actual;
    const next = aplicarPagoAFactura(actual, pago);
    mark();
    setFacturasPendientes(prev => { const n = prev.map(f => f.id === facturaId ? next : f); save(LS_FAC, n); return n; });
    patchObjectItem('proveedores', 'facturasPendientes', facturaId, { pagos: next.pagos, estado: next.estado, saldoPendiente: next.saldoPendiente });
    return next;
  }, []);

  const getObrasProveedor = useCallback((proveedorId) => {
    const map = {};
    ccEntries
      .filter(e => e.proveedorId === proveedorId && e.obraId)
      .forEach(e => { map[e.obraId] = e.obraNombre || e.obraId; });
    return Object.entries(map).map(([id, nombre]) => ({ id, nombre }));
  }, [ccEntries]);

  const value = useMemo(() => ({
    proveedores, ccEntries, facturasPendientes,
    addProveedor, updateProveedor, removeProveedor,
    addCC, updateCC, removeCC, getObrasProveedor,
    addFacturaPendiente, updateFacturaPendiente, removeFacturaPendiente, registrarPagoFactura,
  }), [
    proveedores, ccEntries, facturasPendientes,
    addProveedor, updateProveedor, removeProveedor,
    addCC, updateCC, removeCC, getObrasProveedor,
    addFacturaPendiente, updateFacturaPendiente, removeFacturaPendiente, registrarPagoFactura,
  ]);

  return (
    <CTX.Provider value={value}>
      {children}
    </CTX.Provider>
  );
}

export const useProveedores = () => useContext(CTX);
