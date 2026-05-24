import { useState, useRef, useMemo, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import PageLayout from '../../components/layout/PageLayout';
import { Box, Btn, Chip, Stat, Label, Bar, Divider } from '../../components/ui';
import { T } from '../../theme';
import { useObras, EMPTY_DETALLE } from '../../store/ObrasContext';
import { usePlantillas } from '../../store/PlantillasContext';
import { useMovimientos } from '../../store/MovimientosContext';
import { useProveedores } from '../../store/ProveedoresContext';
import { useClientes } from '../../store/ClientesContext';
import { useDolar } from '../../store/DolarContext';
import ExportModal from '../modales/ExportModal';
import ContratoMOModal from '../modales/ContratoMOModal';
import { PROVEEDORES } from '../../data/proveedores';
import { useGastosFijos } from '../../store/GastosFijosContext';
import { useCatalog, calcTarea } from '../../store/CatalogContext';
import { useUsuarios } from '../../store/UsuariosContext';
import { supabase } from '../../lib/supabase';
import { loadSharedData, saveSharedData } from '../../lib/dbHelpers';
import { onRemoteChange } from '../../lib/syncBus';

// ── Helpers ───────────────────────────────────────────────────────────────────
const newId = () => `id-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const fmtN = (n) => Math.round(n).toLocaleString('es-AR');
const fmtM = (n, moneda) => moneda === 'USD' ? `U$S ${fmtN(n)}` : `$ ${fmtN(n)}`;
const fmtQ = (n) => { if (!n) return '0'; const r = Math.round(n * 1000) / 1000; return r.toLocaleString('es-AR', { maximumFractionDigits: 3 }); };
const fmtD = (iso) => !iso ? '—' : iso.split('-').reverse().join('/');

const tareaVentaUnit = (t, rubro) => {
  const costoUnit = t.costoMat + (t.costoSub || 0);
  if (t.margenLinea != null) return costoUnit * (1 + t.margenLinea / 100);
  return t.costoMat * (1 + rubro.margenMat / 100) + (t.costoSub || 0) * (1 + rubro.margenMO / 100);
};

const calcRubro = (rubro) => {
  const tareas = (rubro.tareas || []).filter(t => t.tipo !== 'seccion');
  let cMat = 0, cSub = 0, venta = 0;
  for (const t of tareas) {
    cMat += t.costoMat * t.cantidad;
    cSub += (t.costoSub || 0) * t.cantidad;
    venta += tareaVentaUnit(t, rubro) * t.cantidad;
  }
  const costo = cMat + cSub;
  const margen = venta > 0 ? Math.round((venta - costo) / venta * 100) : 0;
  const avance = tareas.length > 0 ? Math.round(tareas.reduce((s, t) => s + t.avance, 0) / tareas.length) : 0;
  return { cMat, cSub, costo, venta, margen, avance };
};

const calcObra = (rubros) => {
  const rr = rubros.map(r => ({ ...r, ...calcRubro(r) }));
  const costo = rr.reduce((s, r) => s + r.costo, 0);
  const venta = rr.reduce((s, r) => s + r.venta, 0);
  const cMat = rr.reduce((s, r) => s + r.cMat, 0);
  const cSub = rr.reduce((s, r) => s + r.cSub, 0);
  const margen = venta > 0 ? Math.round((venta - costo) / venta * 100) : 0;
  return { costo, venta, cMat, cSub, margen, rubros: rr };
};

// ── Helpers contratos MO ─────────────────────────────────────────────────────
const calcTareaContratada = (tareaId, contratos) =>
  contratos
    .filter(c => c.estado !== 'anulado' && Array.isArray(c.tareas))
    .flatMap(c => c.tareas)
    .filter(t => t.tareaId === tareaId)
    .reduce((s, t) => s + (t.cantidadContratada || 0), 0);

// ── UI micro-helpers ──────────────────────────────────────────────────────────
const inputSt = { padding: '5px 8px', border: `1.2px solid ${T.faint2}`, borderRadius: 4, fontFamily: T.font, fontSize: 12, background: T.paper, width: '100%', boxSizing: 'border-box', outline: 'none' };
const labelSt = { fontSize: 10, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 3 };

function FRow({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={labelSt}>{label}</div>
      {children}
    </div>
  );
}
function FInput({ label, value, onChange, type = 'text', placeholder }) {
  return (
    <FRow label={label}>
      <input style={inputSt} type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} step={type === 'number' ? 'any' : undefined} />
    </FRow>
  );
}
function FSelect({ label, value, onChange, options }) {
  return (
    <FRow label={label}>
      <select style={{ ...inputSt, cursor: 'pointer' }} value={value} onChange={e => onChange(e.target.value)}>
        {options.map(o => <option key={o}>{o}</option>)}
      </select>
    </FRow>
  );
}

// ── Componente reutilizable de formulario inline ──────────────────────────────
function FormPanel({ title, children, onSave, onCancel, style, saveLabel = 'Guardar', saveDisabled = false }) {
  return (
    <div style={{ background: T.accentSoft, border: `1.5px solid ${T.accent}`, borderRadius: 6, padding: 14, display: 'flex', flexDirection: 'column', gap: 10, ...style }}>
      {title && <div style={{ fontWeight: 700, fontSize: 13 }}>{title}</div>}
      {children}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
        <Btn sm onClick={onCancel}>Cancelar</Btn>
        <Btn sm accent onClick={onSave} style={{ opacity: saveDisabled ? 0.5 : 1, pointerEvents: saveDisabled ? 'none' : 'auto' }}>{saveLabel}</Btn>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 0: RESUMEN
// ─────────────────────────────────────────────────────────────────────────────
function TabResumen({ obra, detalle, moneda, onChangeTab }) {
  const [incluirPagos, setIncluirPagos] = useState(true);
  const { currentUser } = useUsuarios();
  const verCostos   = currentUser?.permisos?.verCostos   ?? true;
  const verMargenes = currentUser?.permisos?.verMargenes ?? true;
  const { costo, venta, margen, rubros: rr } = calcObra(detalle.rubros);
  const { dolarVenta } = useDolar();
  const { movimientos: allMovs } = useMovimientos();
  const today = new Date();
  const fin = obra.fechaFinEstim ? new Date(obra.fechaFinEstim) : null;
  const diasRest = fin ? Math.ceil((fin - today) / 86400000) : null;

  // Cobrado real: ingresos registrados en Movimientos con esta obra
  const movsObra = useMemo(() => allMovs.filter(m => m.obraId === obra.id), [allMovs, obra.id]);
  const totalCobradoReal = useMemo(() => movsObra.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + m.monto, 0), [movsObra]);
  const totalGastadoReal = useMemo(() => movsObra.filter(m => m.tipo === 'gasto').reduce((s, m) => s + m.monto, 0), [movsObra]);
  const faltaCobrar = Math.max(0, venta - totalCobradoReal);

  const currMesKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`;
  const gastosMes = movsObra.filter(m => m.tipo === 'gasto' && m.fecha.startsWith(currMesKey)).reduce((s, m) => s + m.monto, 0);

  const alertas = [];
  if (margen < 0) alertas.push({ tipo: 'danger', msg: `Margen negativo (${margen}%) — sobrecosto detectado` });
  if (diasRest !== null && diasRest < 30 && obra.avance < 80) alertas.push({ tipo: 'warn', msg: `Quedan ${diasRest} días pero el avance es solo ${obra.avance}%` });
  detalle.adicionales.filter(a => a.estado === 'pendiente').forEach(a => alertas.push({ tipo: 'info', msg: `Adicional pendiente de aprobación: "${a.descripcion}"` }));

  const toUSD = (n) => moneda === 'ARS' && dolarVenta ? `U$S ${fmtN(Math.round(n / dolarVenta))}` : fmtM(n, moneda);

  // Financiación
  const finPlan = detalle.financiacion || {};
  const adicionalCliente = (detalle.adicionales || [])
    .filter(a => a.estado === 'aprobado' && a.aplicaACliente !== false)
    .reduce((s, a) => s + (a.valorVentaTotal ?? a.costoTotal ?? a.monto ?? 0), 0);
  const interesFin = parseFloat(finPlan.interes) || 0;
  const totalCliente = Math.round((venta + adicionalCliente) * (1 + interesFin / 100));
  const cuotasPlan = detalle.cuotas || [];
  const cuotasPagadas = cuotasPlan.filter(c => c.estado === 'pagado').reduce((s, c) => s + (c.monto || 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Botón exportar resumen */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: T.ink2, cursor: 'pointer' }}>
          <input type="checkbox" checked={incluirPagos} onChange={e => setIncluirPagos(e.target.checked)} />
          Incluir plan de pagos
        </label>
        <Btn sm onClick={() => abrirExport(generarHTMLResumen({ obra, detalle, moneda, incluirPagos }), 'Resumen')}>↗ Exportar resumen total</Btn>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {[
          { label: 'Avance general', value: `${obra.avance}%`, color: obra.avance >= 85 ? T.warn : T.ok, show: true },
          { label: 'Margen real', value: `${margen}%`, color: margen < 0 ? T.accent : margen < 20 ? T.warn : T.ok, show: verMargenes },
          { label: 'Días al vencimiento', value: diasRest !== null ? diasRest : '—', color: diasRest !== null && diasRest < 30 ? T.warn : T.ink, show: true },
        ].filter(k => k.show).map((k, i) => (
          <Box key={i} style={{ padding: '12px 14px' }}>
            <div style={{ fontSize: 11, color: T.ink2, marginBottom: 4 }}>{k.label}</div>
            <div style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 22, color: k.color }}>{k.value}</div>
          </Box>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {/* KPI: Total cliente */}
        {verCostos && totalCliente > 0 && (
          <Box style={{ padding: '12px 14px', borderLeft: `3px solid ${T.accent}`, cursor: 'pointer' }}
            onClick={() => onChangeTab?.(10)}>
            <div style={{ fontSize: 11, color: T.ink2, marginBottom: 4 }}>Total cliente</div>
            <div style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 18, color: T.accent }}>{fmtM(totalCliente, moneda)}</div>
            {adicionalCliente > 0 && <div style={{ fontSize: 10, color: T.ink3, marginTop: 2 }}>incl. {fmtM(adicionalCliente, moneda)} adicionales</div>}
            <div style={{ fontSize: 10, color: T.accent, marginTop: 4 }}>Ver plan de cuotas →</div>
          </Box>
        )}
        {/* KPI: Cuotas */}
        {cuotasPlan.length > 0 && (
          <Box style={{ padding: '12px 14px', cursor: 'pointer' }}
            onClick={() => onChangeTab?.(10)}>
            <div style={{ fontSize: 11, color: T.ink2, marginBottom: 4 }}>Cuotas cobradas</div>
            <div style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 18, color: T.ok }}>{fmtM(cuotasPagadas, moneda)}</div>
            <div style={{ fontSize: 10, color: T.ink3, marginTop: 2 }}>{cuotasPlan.filter(c => c.estado === 'pagado').length} / {cuotasPlan.length} cuotas</div>
          </Box>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {/* Avance por rubro */}
        <Box style={{ padding: 14, cursor: 'pointer' }} onClick={() => onChangeTab?.(1)}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Avance por rubro</div>
            <span style={{ fontSize: 11, color: T.accent }}>Ver presupuesto →</span>
          </div>
          {rr.length === 0 && <div style={{ color: T.ink3, fontSize: 12 }}>Sin rubros cargados</div>}
          {rr.map(r => (
            <div key={r.id} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                <span style={{ fontWeight: 600 }}>{r.nombre}</span>
                <span style={{ fontFamily: T.fontMono, color: r.avance === 100 ? T.ok : T.ink2 }}>{r.avance}%</span>
              </div>
              <Bar pct={r.avance} ok={r.avance === 100} warn={r.avance < 50 && r.avance > 0} />
            </div>
          ))}
        </Box>

        {/* Financiero */}
        {verCostos && <Box style={{ padding: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Financiero</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[
              ['Venta total (presu)', toUSD(venta), T.ink, true],
              ['Costo total (presu)', toUSD(costo), T.ink, true],
              ['Margen bruto (presu)', toUSD(venta - costo), margen < 0 ? T.accent : T.ok, verMargenes],
              ['Gastado real', toUSD(totalGastadoReal), totalGastadoReal > costo ? T.accent : T.ink, true],
              ['Cobrado (movimientos)', toUSD(totalCobradoReal), T.ok, true],
              ['Falta cobrar', toUSD(faltaCobrar), faltaCobrar > 0 ? T.warn : T.ok, true],
            ].filter(([,,, show]) => show).map(([l, v, c], i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: `1px solid ${T.faint2}`, fontSize: 12 }}>
                <span style={{ color: T.ink2 }}>{l}</span>
                <span style={{ fontFamily: T.fontMono, fontWeight: 700, color: c }}>{v}</span>
              </div>
            ))}
          </div>
        </Box>}
      </div>

      {/* Alertas */}
      {alertas.length > 0 && (
        <Box style={{ padding: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Alertas</div>
          {alertas.map((a, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '7px 10px', borderRadius: 4, marginBottom: 5, background: a.tipo === 'danger' ? '#fae6e0' : a.tipo === 'warn' ? '#fff7e6' : T.accentSoft, borderLeft: `3px solid ${a.tipo === 'danger' ? T.accent : a.tipo === 'warn' ? T.warn : T.accent}` }}>
              <span>{a.tipo === 'danger' ? '⚠' : a.tipo === 'warn' ? '⏰' : 'ℹ'}</span>
              <span style={{ fontSize: 12 }}>{a.msg}</span>
            </div>
          ))}
        </Box>
      )}

      {/* Últimos movimientos */}
      {detalle.movimientos.length > 0 && (
        <Box style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '8px 14px', background: T.faint, borderBottom: `1.5px solid ${T.faint2}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>Últimos movimientos</span>
            <span style={{ fontSize: 11, color: T.accent, cursor: 'pointer' }}
              onClick={() => onChangeTab?.(5)}>Ver todos →</span>
          </div>
          {[...detalle.movimientos].reverse().slice(0, 5).map(m => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', padding: '8px 14px', borderBottom: `1px solid ${T.faint2}`, fontSize: 12, borderLeft: `3px solid ${m.tipo === 'ingreso' ? T.ok : T.accent}` }}>
              <span style={{ flex: 0.7, fontFamily: T.fontMono, color: T.ink2 }}>{fmtD(m.fecha)}</span>
              <span style={{ flex: 3 }}>{m.descripcion}</span>
              <span style={{ fontFamily: T.fontMono, fontWeight: 700, color: m.tipo === 'ingreso' ? T.ok : T.accent }}>
                {m.tipo === 'ingreso' ? '+' : '-'}{fmtM(m.monto, moneda)}
              </span>
            </div>
          ))}
        </Box>
      )}
    </div>
  );
}

// ── Autocomplete para nombre de tarea ─────────────────────────────────────────
function TaskAutocomplete({ value, onChange, suggestions, onSelect }) {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(-1);
  const wrapRef = useRef(null);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return suggestions.slice(0, 10);
    return suggestions.filter(s => s.nombre.toLowerCase().includes(q)).slice(0, 10);
  }, [value, suggestions]);

  useEffect(() => {
    const handler = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const select = (s) => {
    onSelect(s);
    setOpen(false);
    setFocused(-1);
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        autoFocus
        style={inputSt}
        value={value}
        placeholder="Nombre de la tarea…"
        onChange={e => { onChange(e.target.value); setOpen(true); setFocused(-1); }}
        onFocus={() => setOpen(true)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setFocused(f => Math.min(f + 1, filtered.length - 1)); }
          if (e.key === 'ArrowUp')   { e.preventDefault(); setFocused(f => Math.max(f - 1, 0)); }
          if (e.key === 'Enter' && focused >= 0 && filtered[focused]) select(filtered[focused]);
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && filtered.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: T.paper, border: `1.5px solid ${T.accent}`, borderTop: 'none', borderRadius: '0 0 5px 5px', zIndex: 200, boxShadow: '0 6px 20px rgba(0,0,0,0.15)', maxHeight: 260, overflow: 'auto' }}>
          {filtered.map((s, i) => (
            <div key={i} onMouseDown={() => select(s)}
              style={{ padding: '6px 10px', cursor: 'pointer', background: i === focused ? T.accentSoft : 'transparent', borderBottom: `1px solid ${T.faint2}` }}>
              <div style={{ fontWeight: 700, fontSize: 12 }}>{s.nombre}</div>
              <div style={{ fontSize: 10, color: T.ink2, display: 'flex', gap: 8, marginTop: 1 }}>
                <span style={{ background: T.faint, padding: '1px 5px', borderRadius: 3 }}>{s.unidad}</span>
                {s.costoMat > 0 && <span>mat $ {fmtN(s.costoMat)}</span>}
                {s.costoSub > 0 && <span>sub $ {fmtN(s.costoSub)}</span>}
                <span style={{ marginLeft: 'auto', color: s.fuente === 'Catálogo' ? T.accent : T.ok, fontWeight: 600 }}>{s.fuente}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function buildVisibleTareas(tareas, collapsedSections) {
  let sec1 = null, sec2 = null;
  return tareas.map(t => {
    if (t.tipo === 'seccion') {
      if (t.nivel === 1) { sec1 = t; sec2 = null; return { ...t, _hidden: false }; }
      sec2 = t;
      return { ...t, _hidden: !!(sec1 && collapsedSections.has(sec1.id)) };
    }
    const hidden = (sec1 && collapsedSections.has(sec1.id)) || (sec2 && collapsedSections.has(sec2.id));
    return { ...t, _hidden: hidden };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 1: PRESUPUESTO
// ─────────────────────────────────────────────────────────────────────────────
function TabPresupuesto({ obra, detalle, patch, moneda, frozen, onApprove, onExport }) {
  const { currentUser } = useUsuarios();
  const navigate = useNavigate();
  const { proveedores: provListPresu } = useProveedores();
  const verCostos   = currentUser?.permisos?.verCostos   ?? true;
  const verMargenes = currentUser?.permisos?.verMargenes ?? true;
  const puedeEditar = (currentUser?.permisos?.editarPresu ?? true) && !frozen;
  const puedeCargarAvance = currentUser?.permisos?.cargarAvance ?? true;
  const [selTask, setSelTask] = useState(null);
  const [selRubroId, setSelRubroId] = useState(null);
  const [editTask, setEditTask] = useState(null);
  const [addingTask, setAddingTask] = useState(null);
  const [addingRubro, setAddingRubro] = useState(false);
  const [newTask, setNewTask] = useState({ codigo: '', nombre: '', unidad: 'u', cantidad: 1, costoMat: 0, costoSub: 0 });
  const [newRubro, setNewRubro] = useState({ rubroId: '', margenMat: 20, margenMO: 35, proveedor: '' });
  const [selectedTareas, setSelectedTareas] = useState(new Set());
  const [showPlantillas, setShowPlantillas] = useState(false);
  const [inlineEdit, setInlineEdit] = useState(null);
  const [editSeccionId, setEditSeccionId] = useState(null);
  const [editSeccionNombre, setEditSeccionNombre] = useState('');
  const [collapsedSections, setCollapsedSections] = useState(new Set());
  const toggleSeccion = (id) => setCollapsedSections(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const [colsUser, setColsUser] = useState({ costoUnit: false, costoTotal: true, margenL: false, ventaUnit: false, ventaTotal: true });
  // Force-off cost/margin columns based on permissions
  const cols = {
    costoUnit:  verCostos   ? colsUser.costoUnit  : false,
    costoTotal: verCostos   ? colsUser.costoTotal : false,
    margenL:    verMargenes ? colsUser.margenL    : false,
    ventaUnit:  colsUser.ventaUnit,
    ventaTotal: colsUser.ventaTotal,
  };
  const { plantillas, add: addPlantilla, incrementUso } = usePlantillas();
  const [showSavePlantilla, setShowSavePlantilla] = useState(false);
  const [savePlantillaForm, setSavePlantillaForm] = useState({ nombre: '', tipo: 'Comercial', descripcion: '' });
  const { obras: todasObras, detalles } = useObras();
  const { totalMensual: gfMensual } = useGastosFijos();
  const { catalog } = useCatalog();
  const { dolarVenta } = useDolar();

  // Drag state ─ rubros
  const dragRubroRef = useRef(null);
  const [dragOverRubroId, setDragOverRubroId] = useState(null);
  // Drag state ─ tasks
  const dragTaskRef = useRef(null);
  const [dragOverTaskId, setDragOverTaskId] = useState(null);

  // All task suggestions: catalog APUs + tasks from all obras
  const allSuggestions = useMemo(() => {
    const seen = new Set();
    const list = [];
    // From catalog APUs
    (catalog.tareas || []).forEach(t => {
      if (seen.has(t.nombre)) return;
      seen.add(t.nombre);
      const { mat, mo } = calcTarea(t);
      list.push({ nombre: t.nombre, unidad: t.unidad || 'u', costoMat: Math.round(mat), costoSub: Math.round(mo), codigo: t.codigo || '', fuente: 'Catálogo' });
    });
    // From all obras
    Object.values(detalles).forEach(d => {
      (d.rubros || []).forEach(r => {
        (r.tareas || []).forEach(t => {
          if (seen.has(t.nombre)) return;
          seen.add(t.nombre);
          list.push({ nombre: t.nombre, unidad: t.unidad || 'u', costoMat: t.costoMat || 0, costoSub: t.costoSub || 0, codigo: t.codigo || '', fuente: 'Obra' });
        });
      });
    });
    return list;
  }, [catalog.tareas, detalles]);

  const { costo, venta, cMat, cSub, margen, rubros: rr } = calcObra(detalle.rubros);

  const obrasActivas = todasObras.filter(o => ['activa', 'en-presupuesto'].includes(o.estado));
  const durMeses = (() => {
    const ini = obra.fechaInicio ? new Date(obra.fechaInicio) : null;
    const fin = obra.fechaFinEstim || obra.fechaFin ? new Date(obra.fechaFinEstim || obra.fechaFin) : null;
    if (!ini || !fin) return 6;
    return Math.max(1, Math.ceil((fin - ini) / (1000 * 60 * 60 * 24 * 30)));
  })();
  const gastosFijosObra = obrasActivas.length > 0 ? Math.round(gfMensual * durMeses / obrasActivas.length) : 0;

  const allVisibleTaskIds = useMemo(() => {
    const ids = [];
    for (const r of detalle.rubros) {
      for (const t of buildVisibleTareas(r.tareas, collapsedSections)) {
        if (!t._hidden && t.tipo !== 'seccion') ids.push(t.id);
      }
    }
    return ids;
  }, [detalle.rubros, collapsedSections]);

  const saveInlineCost = () => {
    if (!inlineEdit) return;
    const { taskId, field, value } = inlineEdit;
    const parsed = field === 'margenLinea' ? (value === '' ? null : +value) : (+value || 0);
    patch(d => ({ ...d, rubros: d.rubros.map(r => ({ ...r, tareas: r.tareas.map(t => t.id === taskId ? { ...t, [field]: parsed } : t) })) }));
    if (selTask?.id === taskId) setSelTask(prev => ({ ...prev, [field]: parsed }));
    setInlineEdit(null);
  };

  const patchTaskReceta = (taskId, receta) => {
    const costoMat = receta.materiales.reduce((s, m) => s + (m.costoUnit || 0), 0);
    patch(d => ({ ...d, rubros: d.rubros.map(r => ({ ...r, tareas: r.tareas.map(t => t.id === taskId ? { ...t, receta, costoMat } : t) })) }));
    setSelTask(prev => prev && prev.id === taskId ? { ...prev, receta, costoMat } : prev);
  };

  const guardarComoPlantilla = () => {
    if (!savePlantillaForm.nombre.trim()) return;
    const rubros = (detalle.rubros || []).map(r => ({
      id: newId(), nombre: r.nombre, margenMat: r.margenMat, margenMO: r.margenMO,
      tareas: (r.tareas || []).map(t => t.tipo === 'seccion'
        ? { id: newId(), tipo: 'seccion', nombre: t.nombre, nivel: t.nivel || 1 }
        : { id: newId(), nombre: t.nombre, codigo: t.codigo || '', unidad: t.unidad || 'u',
            cantidad: t.cantidad || 1, costoMat: t.costoMat || 0, costoSub: t.costoSub || 0,
            receta: t.receta ? { materiales: (t.receta.materiales || []).map(m => ({ ...m, id: newId() })) } : { materiales: [] },
            ...(t.margenLinea != null ? { margenLinea: t.margenLinea } : {}) }
      ),
    }));
    addPlantilla({ nombre: savePlantillaForm.nombre.trim(), tipo: savePlantillaForm.tipo, descripcion: savePlantillaForm.descripcion, rubros });
    setShowSavePlantilla(false);
  };

  const importarPlantilla = (plt) => {
    const n = detalle.rubros.length;
    const nuevos = (plt.rubros || []).map((r, idx) => ({
      id: newId(), nombre: r.nombre, proveedor: '', margenMat: r.margenMat || 20, margenMO: r.margenMO || 35,
      orden: n + idx, abierto: true,
      tareas: (r.tareas || []).map(t => t.tipo === 'seccion'
        ? { id: newId(), tipo: 'seccion', nombre: t.nombre, nivel: t.nivel || 1 }
        : { id: newId(), codigo: t.codigo || '', nombre: t.nombre, unidad: t.unidad || 'u', cantidad: t.cantidad || 1, costoMat: t.costoMat || 0, costoSub: t.costoSub || 0, receta: t.receta ? { materiales: (t.receta.materiales || []).map(m => ({ ...m, id: newId() })) } : { materiales: [] }, avance: 0 }),
    }));
    patch(d => ({ ...d, rubros: [...d.rubros, ...nuevos] }));
    incrementUso(plt.id);
    setShowPlantillas(false);
  };

  const addSeccion = (rubroId, nivel) => {
    const nombre = window.prompt(nivel === 2 ? 'Nombre de la sub-sección:' : 'Nombre de la sección:');
    if (!nombre?.trim()) return;
    patch(d => ({ ...d, rubros: d.rubros.map(r => r.id === rubroId ? { ...r, tareas: [...r.tareas, { id: newId(), tipo: 'seccion', nombre: nombre.trim(), nivel }] } : r) }));
  };
  const patchSeccionNombre = (tareaId, nombre) => {
    patch(d => ({ ...d, rubros: d.rubros.map(r => ({ ...r, tareas: r.tareas.map(t => t.id === tareaId ? { ...t, nombre } : t) })) }));
  };

  const toggleRubro = (id) => patch(d => ({ ...d, rubros: d.rubros.map(r => r.id === id ? { ...r, abierto: !r.abierto } : r) }));
  const deleteTarea = (rubroId, tareaId) => patch(d => ({ ...d, rubros: d.rubros.map(r => r.id === rubroId ? { ...r, tareas: r.tareas.filter(t => t.id !== tareaId) } : r) }));
  const deleteRubro = (rubroId) => { if (window.confirm('¿Eliminar rubro y todas sus tareas?')) patch(d => ({ ...d, rubros: d.rubros.filter(r => r.id !== rubroId) })); };

  const saveTask = () => {
    if (!newTask.nombre.trim()) return;
    const t = { id: newId(), ...newTask, cantidad: +newTask.cantidad, costoMat: +newTask.costoMat, costoSub: +newTask.costoSub || 0, receta: { materiales: [] }, avance: 0 };
    patch(d => ({ ...d, rubros: d.rubros.map(r => r.id === addingTask ? { ...r, tareas: [...r.tareas, t] } : r) }));
    setAddingTask(null);
    setNewTask({ codigo: '', nombre: '', unidad: 'u', cantidad: 1, costoMat: 0, costoSub: 0 });
  };

  const saveRubro = () => {
    const catalogRubro = (catalog.rubros || []).find(r => r.id === newRubro.rubroId);
    if (!catalogRubro) return;
    const tareasIniciales = (catalog.tareas || [])
      .filter(t => selectedTareas.has(t.id))
      .map(t => {
        const { mat, sub, mo, gen } = calcTarea(t);
        return { id: newId(), nombre: t.nombre, codigo: t.codigo || '', unidad: t.unidad || 'u', cantidad: 1, costoMat: Math.round(mat + gen), costoSub: Math.round(sub + mo), receta: { materiales: (t.materiales || []).map(m => ({ id: newId(), nombre: m.nombre, cantidad: m.cantidad || 0, unidad: m.unidad || '', precio: m.precio || 0, costoUnit: (m.cantidad || 0) * (m.precio || 0) })) }, avance: 0 };
      });
    patch(d => ({ ...d, rubros: [...d.rubros, { id: newId(), nombre: catalogRubro.nombre, proveedor: newRubro.proveedor, margenMat: +newRubro.margenMat, margenMO: +newRubro.margenMO, orden: d.rubros.length, abierto: true, tareas: tareasIniciales }] }));
    setAddingRubro(false);
    setNewRubro({ rubroId: '', margenMat: 20, margenMO: 35, proveedor: '' });
    setSelectedTareas(new Set());
  };

  const saveEditTask = () => {
    if (!editTask) return;
    patch(d => ({ ...d, rubros: d.rubros.map(r => ({ ...r, tareas: r.tareas.map(t => t.id === editTask.id ? editTask : t) })) }));
    setSelTask(editTask);
    setEditTask(null);
  };

  const updateEditField = (k, v) => setEditTask(et => ({ ...et, [k]: isNaN(v) || v === '' ? v : +v }));
  const selRubro = selRubroId ? rr.find(r => r.id === selRubroId) : null;

  // ── Drag handlers: rubros ────────────────────────────────────────────────
  const onRubroDragStart = (e, rubroId) => {
    dragRubroRef.current = rubroId;
    e.dataTransfer.effectAllowed = 'move';
  };
  const onRubroDragOver = (e, rubroId) => {
    e.preventDefault();
    if (dragRubroRef.current && dragRubroRef.current !== rubroId) setDragOverRubroId(rubroId);
  };
  const onRubroDrop = (e, rubroId) => {
    e.preventDefault();
    const src = dragRubroRef.current;
    if (!src || src === rubroId) { setDragOverRubroId(null); return; }
    patch(d => {
      const rubros = [...d.rubros];
      const fi = rubros.findIndex(r => r.id === src);
      const ti = rubros.findIndex(r => r.id === rubroId);
      if (fi === -1 || ti === -1) return d;
      const [moved] = rubros.splice(fi, 1);
      rubros.splice(ti, 0, moved);
      return { ...d, rubros };
    });
    dragRubroRef.current = null;
    setDragOverRubroId(null);
  };
  const onRubroDragEnd = () => { dragRubroRef.current = null; setDragOverRubroId(null); };

  // ── Drag handlers: tasks ─────────────────────────────────────────────────
  const onTaskDragStart = (e, rubroId, taskId) => {
    dragTaskRef.current = { rubroId, taskId };
    e.dataTransfer.effectAllowed = 'move';
    e.stopPropagation();
  };
  const onTaskDragOver = (e, taskId) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragTaskRef.current && dragTaskRef.current.taskId !== taskId) setDragOverTaskId(taskId);
  };
  const onTaskDrop = (e, toRubroId, toTaskId) => {
    e.preventDefault();
    e.stopPropagation();
    const src = dragTaskRef.current;
    if (!src || src.taskId === toTaskId) { setDragOverTaskId(null); return; }
    patch(d => {
      const rubros = d.rubros.map(r => ({ ...r, tareas: [...r.tareas] }));
      const fromRubro = rubros.find(r => r.id === src.rubroId);
      const toRubro = rubros.find(r => r.id === toRubroId);
      if (!fromRubro || !toRubro) return d;
      const fi = fromRubro.tareas.findIndex(t => t.id === src.taskId);
      if (fi === -1) return d;
      const [moved] = fromRubro.tareas.splice(fi, 1);
      const ti = toRubro.tareas.findIndex(t => t.id === toTaskId);
      toRubro.tareas.splice(ti === -1 ? toRubro.tareas.length : ti, 0, moved);
      return { ...d, rubros };
    });
    dragTaskRef.current = null;
    setDragOverTaskId(null);
  };
  const onTaskDragEnd = () => { dragTaskRef.current = null; setDragOverTaskId(null); };

  const COLS_DEF = [
    { key: 'costoUnit', label: '$ Costo unit' },
    { key: 'costoTotal', label: '$ Costo total' },
    { key: 'margenL', label: 'Margen %' },
    { key: 'ventaUnit', label: '$ Venta unit' },
    { key: 'ventaTotal', label: '$ Venta total' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, overflow: 'hidden', height: 'calc(100vh - 320px)' }}>

      {/* Banner aprobación */}
      {frozen ? (
        <div style={{ background: '#1a9b9c18', border: `1.5px solid #1a9b9c`, borderRadius: 6, padding: '9px 14px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 16 }}>🔒</span>
          <div style={{ flex: 1 }}>
            <span style={{ fontWeight: 700, color: '#1a9b9c', fontSize: 13 }}>Presupuesto aprobado · congelado</span>
            {detalle.fechaAprobacion && <span style={{ fontSize: 11, color: T.ink3, marginLeft: 10 }}>Aprobado el {fmtD(detalle.fechaAprobacion)} · Para cambios usá la pestaña Adicionales</span>}
          </div>
          {onExport && <Btn sm onClick={onExport}>↗ Exportar</Btn>}
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginBottom: 8, flexShrink: 0 }}>
          {onExport && <Btn sm onClick={onExport}>↗ Exportar presupuesto</Btn>}
          {onApprove && <Btn sm fill onClick={onApprove} style={{ background: T.ok, borderColor: T.ok, color: '#fff' }}>✓ Aprobar presupuesto</Btn>}
        </div>
      )}

    <div style={{ display: 'flex', gap: 10, flex: 1, overflow: 'hidden' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Totals strip */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 8, flexShrink: 0, alignItems: 'stretch' }}>
          <div style={{ flex: 1, background: '#f6efd9', borderRadius: 4, border: `1px solid ${T.faint2}`, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr' }}>
              {[
                { label: 'Total venta', val: fmtM(venta, moneda), usd: moneda === 'ARS' && dolarVenta ? Math.round(venta / dolarVenta) : null, color: T.ink, show: true },
                { label: 'Total costo', val: fmtM(costo, moneda), usd: moneda === 'ARS' && dolarVenta ? Math.round(costo / dolarVenta) : null, color: T.ink, show: verCostos },
                { label: 'Margen', val: `${margen}%`, sub: fmtM(venta - costo, moneda), usd: moneda === 'ARS' && dolarVenta ? Math.round((venta - costo) / dolarVenta) : null, color: margen < 0 ? '#dc2626' : margen < 15 ? T.warn : T.ok, show: verMargenes },
              ].filter(s => s.show).map((s, i, arr) => (
                <div key={i} style={{ padding: '8px 14px', textAlign: 'center', borderRight: i < 2 ? `1px solid ${T.faint2}` : 'none' }}>
                  <div style={{ fontSize: 9, color: T.ink3, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>{s.label}</div>
                  <div style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 17, color: s.color }}>{s.val}</div>
                  {s.sub && <div style={{ fontFamily: T.fontMono, fontSize: 11, color: T.ink, marginTop: 2 }}>{s.sub}</div>}
                  {s.usd != null && <div style={{ fontFamily: T.fontMono, fontSize: 10, color: '#1a9b9c', marginTop: 2 }}>U$S {s.usd.toLocaleString('es-AR')}</div>}
                </div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', borderTop: `1px solid ${T.faint2}` }}>
              {[
                { label: 'Materiales', val: fmtM(cMat, moneda) },
                { label: 'Subcontratos', val: fmtM(cSub, moneda) },
                { label: `Gastos fijos (${durMeses}m ÷ ${obrasActivas.length})`, val: gastosFijosObra > 0 ? fmtM(gastosFijosObra, moneda) : '—', warn: gastosFijosObra > 0 },
              ].map((s, i) => (
                <div key={i} style={{ padding: '4px 14px', borderRight: i < 2 ? `1px solid ${T.faint2}` : 'none', display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                  <span style={{ color: T.ink2 }}>{s.label}</span>
                  <span style={{ fontFamily: T.fontMono, color: s.warn ? T.warn : T.ink }}>{s.val}</span>
                </div>
              ))}
            </div>
          </div>
          {puedeEditar && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'center', flexShrink: 0 }}>
              <Btn sm fill onClick={() => setAddingRubro(true)}>+ Rubro</Btn>
              <Btn sm onClick={() => setShowPlantillas(true)}>📋 Desde plantilla</Btn>
              <Btn sm onClick={() => { setSavePlantillaForm({ nombre: obra.nombre || '', tipo: 'Comercial', descripcion: '' }); setShowSavePlantilla(true); }}>💾 Guardar como plantilla</Btn>
            </div>
          )}
        </div>

        {/* Column visibility toggles */}
        <div style={{ display: 'flex', gap: 5, alignItems: 'center', marginBottom: 8, flexShrink: 0, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, color: T.ink3, textTransform: 'uppercase', letterSpacing: 0.5, marginRight: 2 }}>Columnas</span>
          {COLS_DEF.filter(c => {
            if ((c.key === 'costoUnit' || c.key === 'costoTotal') && !verCostos) return false;
            if (c.key === 'margenL' && !verMargenes) return false;
            return true;
          }).map(c => (
            <span key={c.key} onClick={() => setColsUser(s => ({ ...s, [c.key]: !s[c.key] }))}
              style={{ padding: '3px 10px', borderRadius: 10, fontSize: 11, cursor: 'pointer', userSelect: 'none', transition: 'all 0.12s',
                background: cols[c.key] ? T.accent : T.faint2, color: cols[c.key] ? 'white' : T.ink2,
                fontWeight: cols[c.key] ? 700 : 400, border: `1px solid ${cols[c.key] ? T.accent2 : T.faint2}` }}>
              {c.label}
            </span>
          ))}
        </div>

        {/* Rubros */}
        <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {detalle.rubros.length === 0 && !addingRubro && (
            <Box dashed style={{ padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, color: T.ink3 }}>
              <div style={{ fontSize: 13 }}>Sin rubros. Agregá el primero.</div>
              <Btn sm fill onClick={() => setAddingRubro(true)}>+ Agregar rubro</Btn>
            </Box>
          )}

          {rr.map(rubro => (
            <Box key={rubro.id}
              draggable
              onDragStart={e => onRubroDragStart(e, rubro.id)}
              onDragOver={e => onRubroDragOver(e, rubro.id)}
              onDrop={e => onRubroDrop(e, rubro.id)}
              onDragEnd={onRubroDragEnd}
              style={{ padding: 0, flexShrink: 0, borderTop: dragOverRubroId === rubro.id ? `2px solid ${T.accent}` : '2px solid transparent', opacity: dragRubroRef.current === rubro.id ? 0.5 : 1, transition: 'border-top 0.1s' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: T.faint, borderBottom: rubro.abierto ? `1px solid ${T.faint2}` : 'none', cursor: 'pointer' }}
                onClick={() => { toggleRubro(rubro.id); setSelRubroId(rubro.id); setSelTask(null); }}>
                <span style={{ color: T.ink3, cursor: 'grab', userSelect: 'none' }}>⋮⋮</span>
                <span style={{ fontSize: 12 }}>{rubro.abierto ? '▾' : '▸'}</span>
                <div className="k-h" style={{ fontSize: 16 }}>{rubro.nombre}</div>
                <Chip style={{ fontSize: 10 }}>mat {rubro.margenMat}%</Chip>
                <Chip style={{ fontSize: 10 }}>Sub {rubro.margenMO}%</Chip>
                {rubro.proveedor && (() => {
                  const prov = provListPresu.find(p => p.nombre === rubro.proveedor);
                  return prov
                    ? <Chip style={{ fontSize: 10, cursor: 'pointer', color: T.accent, borderColor: T.accent }} onClick={e => { e.stopPropagation(); navigate(`/proveedores/${prov.id}`); }}>{rubro.proveedor} ↗</Chip>
                    : <Chip style={{ fontSize: 10 }}>{rubro.proveedor}</Chip>;
                })()}
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 14, fontFamily: T.fontMono, fontSize: 11 }}>
                  {verCostos   && <span>costo <b>{fmtM(rubro.costo, moneda)}</b></span>}
                  <span>venta <b>{fmtM(rubro.venta, moneda)}</b></span>
                  {verMargenes && <span style={{ color: rubro.margen > 0 ? T.ok : T.accent }}><b>{rubro.margen > 0 ? '+' : ''}{rubro.margen}%</b></span>}
                </span>
                {puedeEditar && <span style={{ color: T.accent, fontSize: 11, cursor: 'pointer' }}
                  onClick={e => { e.stopPropagation(); deleteRubro(rubro.id); }}>🗑</span>}
              </div>

              {rubro.abierto && (
                <>
                  <div className="k-tr k-th" style={{ background: T.paper, borderBottom: `1px dashed ${T.faint2}` }}>
                    <div className="k-cell" style={{ flex: 3 }}>Tarea</div>
                    <div className="k-cell" style={{ flex: 0.8, textAlign: 'right' }}>{puedeCargarAvance ? 'Cant / Av ✏' : 'Cant'}</div>
                    <div className="k-cell" style={{ flex: 0.6 }}>Un</div>
                    {verCostos && <div className="k-cell" style={{ flex: 1, textAlign: 'right', color: '#c0392b' }}>{puedeEditar ? '$ Mat ✏' : '$ Mat'}</div>}
                    {verCostos && <div className="k-cell" style={{ flex: 1, textAlign: 'right', color: '#c0392b' }}>{puedeEditar ? '$ Sub ✏' : '$ Sub'}</div>}
                    {cols.costoUnit  && <div className="k-cell" style={{ flex: 1, textAlign: 'right', color: '#c0392b' }}>$ Costo u</div>}
                    {cols.costoTotal && <div className="k-cell" style={{ flex: 1, textAlign: 'right', color: '#c0392b' }}>$ Costo T</div>}
                    {cols.margenL   && <div className="k-cell" style={{ flex: 0.9, textAlign: 'right', color: T.ok }}>Margen % {puedeEditar ? '✏' : ''}</div>}
                    {cols.ventaUnit  && <div className="k-cell" style={{ flex: 1, textAlign: 'right', color: T.accent }}>$ Venta u</div>}
                    {cols.ventaTotal && <div className="k-cell" style={{ flex: 1.1, textAlign: 'right', color: T.accent }}>$ Venta T</div>}
                    <div className="k-cell" style={{ flex: 0.4 }}></div>
                  </div>

                  {buildVisibleTareas(rubro.tareas, collapsedSections).map(tarea => {
                    if (tarea._hidden) return null;
                    const costoUnit = tarea.costoMat + (tarea.costoSub || 0);
                    const costoTotalRow = costoUnit * tarea.cantidad;
                    const ventaUnitRow = tareaVentaUnit(tarea, rubro);
                    const ventaTotalRow = ventaUnitRow * tarea.cantidad;
                    const isSelected = selTask?.id === tarea.id;
                    const ie = inlineEdit?.taskId === tarea.id ? inlineEdit : null;
                    const inlineCellSt = { fontFamily: T.fontMono, fontSize: 12, color: T.ink2, cursor: 'text', textDecoration: 'underline dotted', textDecorationColor: T.faint2 };
                    const inlineInputSt = { width: '100%', textAlign: 'right', fontFamily: T.fontMono, fontSize: 12, border: `1.5px solid ${T.accent}`, borderRadius: 3, padding: '1px 4px', outline: 'none', background: 'white' };

                    const InlineNum = ({ field, value, flex, fmt, color }) => (
                      <div className="k-cell" style={{ flex, textAlign: 'right', padding: '2px 6px' }}
                        onClick={e => { e.stopPropagation(); setInlineEdit({ taskId: tarea.id, field, value: String(value) }); }}>
                        {ie?.field === field
                          ? <input autoFocus type="number" min="0" step="any" style={inlineInputSt} value={ie.value}
                              onFocus={e => e.target.select()}
                              onChange={e => setInlineEdit(x => ({ ...x, value: e.target.value }))}
                              onBlur={saveInlineCost}
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  saveInlineCost();
                                  if (field === 'cantidad') {
                                    const idx = allVisibleTaskIds.indexOf(tarea.id);
                                    const nextId = allVisibleTaskIds[idx + 1];
                                    if (nextId) {
                                      let nextT = null;
                                      for (const r of detalle.rubros) { nextT = r.tareas.find(t => t.id === nextId); if (nextT) break; }
                                      if (nextT) setInlineEdit({ taskId: nextId, field: 'cantidad', value: String(nextT.cantidad) });
                                    }
                                  }
                                }
                                if (e.key === 'Escape') setInlineEdit(null);
                              }} />
                          : <span style={{ ...inlineCellSt, ...(color ? { color } : {}) }}>{fmt ? fmt(value) : value}</span>}
                      </div>
                    );

                    if (tarea.tipo === 'seccion') {
                      const indent = (tarea.nivel || 1) === 2 ? 36 : 16;
                      const bg = tarea.nivel === 2 ? T.faint : '#e4eaf0';
                      const isCollapsed = collapsedSections.has(tarea.id);
                      return (
                        <div key={tarea.id}
                          draggable
                          onDragStart={e => onTaskDragStart(e, rubro.id, tarea.id)}
                          onDragOver={e => onTaskDragOver(e, tarea.id)}
                          onDrop={e => onTaskDrop(e, rubro.id, tarea.id)}
                          onDragEnd={onTaskDragEnd}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: `5px 12px 5px ${indent}px`, background: bg, borderTop: dragOverTaskId === tarea.id ? `2px solid ${T.accent}` : `1px solid ${T.faint2}` }}>
                          <span style={{ color: T.ink3, cursor: 'grab', fontSize: 10, userSelect: 'none' }}>⋮⋮</span>
                          <span
                            onClick={() => toggleSeccion(tarea.id)}
                            style={{ cursor: 'pointer', fontSize: 11, color: T.ink2, userSelect: 'none', width: 14, flexShrink: 0 }}>
                            {isCollapsed ? '▸' : '▾'}
                          </span>
                          {editSeccionId === tarea.id
                            ? <input autoFocus value={editSeccionNombre}
                                onChange={e => setEditSeccionNombre(e.target.value)}
                                onBlur={() => { patchSeccionNombre(tarea.id, editSeccionNombre); setEditSeccionId(null); }}
                                onKeyDown={e => { if (e.key === 'Enter') { patchSeccionNombre(tarea.id, editSeccionNombre); setEditSeccionId(null); } if (e.key === 'Escape') setEditSeccionId(null); }}
                                style={{ flex: 1, fontSize: 11, fontWeight: 800, background: 'transparent', border: 'none', borderBottom: `1.5px solid ${T.accent}`, outline: 'none', color: T.ink, fontFamily: T.font, textTransform: 'uppercase', letterSpacing: 0.5 }} />
                            : <span
                                onDoubleClick={() => { setEditSeccionId(tarea.id); setEditSeccionNombre(tarea.nombre); }}
                                style={{ flex: 1, fontSize: 11, fontWeight: 800, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, cursor: 'text', userSelect: 'none' }}>
                                {tarea.nombre}
                              </span>
                          }
                          {puedeEditar && <span style={{ color: T.accent, fontSize: 12, cursor: 'pointer', marginLeft: 'auto' }}
                            onClick={() => deleteTarea(rubro.id, tarea.id)}>🗑</span>}
                        </div>
                      );
                    }

                    return (
                      <div key={tarea.id} className="k-tr"
                        draggable
                        onDragStart={e => onTaskDragStart(e, rubro.id, tarea.id)}
                        onDragOver={e => onTaskDragOver(e, tarea.id)}
                        onDrop={e => onTaskDrop(e, rubro.id, tarea.id)}
                        onDragEnd={onTaskDragEnd}
                        style={{ alignItems: 'center', background: isSelected ? T.accentSoft : 'transparent', cursor: 'pointer', borderTop: dragOverTaskId === tarea.id ? `2px solid ${T.accent}` : '2px solid transparent', transition: 'border-top 0.1s' }}
                        onClick={() => { setSelTask(tarea); setSelRubroId(rubro.id); setEditTask(null); }}>
                        <div className="k-cell" style={{ flex: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ color: T.ink3, cursor: 'grab', userSelect: 'none', fontSize: 10 }}>⋮⋮</span>
                          {tarea.nombre}
                        </div>
                        <InlineNum field="cantidad" value={tarea.cantidad} flex={0.8} />
                        <div className="k-cell" style={{ flex: 0.6 }}>{tarea.unidad}</div>
                        <InlineNum field="costoMat" value={tarea.costoMat} flex={1} fmt={v => `$ ${fmtN(v)}`} color="#c0392b" />
                        <InlineNum field="costoSub" value={tarea.costoSub || 0} flex={1} fmt={v => `$ ${fmtN(v)}`} color="#c0392b" />

                        {cols.costoUnit  && <div className="k-cell" style={{ flex: 1, textAlign: 'right', fontFamily: T.fontMono, fontSize: 12, color: '#c0392b' }}>{`$ ${fmtN(costoUnit)}`}</div>}
                        {cols.costoTotal && <div className="k-cell" style={{ flex: 1, textAlign: 'right', fontFamily: T.fontMono, fontSize: 12, fontWeight: 700, color: '#c0392b' }}>{`$ ${fmtN(costoTotalRow)}`}</div>}

                        {cols.margenL && (
                          <div className="k-cell" style={{ flex: 0.9, textAlign: 'right', padding: '2px 6px' }}
                            onClick={e => { e.stopPropagation(); setInlineEdit({ taskId: tarea.id, field: 'margenLinea', value: tarea.margenLinea != null ? String(tarea.margenLinea) : '' }); }}>
                            {ie?.field === 'margenLinea'
                              ? <input autoFocus type="number" min="0" step="any" style={{ ...inlineInputSt, width: 56 }} value={ie.value}
                                  placeholder={`${rubro.margenMat}/${rubro.margenMO}`}
                                  onFocus={e => e.target.select()}
                                  onChange={e => setInlineEdit(x => ({ ...x, value: e.target.value }))}
                                  onBlur={saveInlineCost}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') {
                                      saveInlineCost();
                                      const idx = allVisibleTaskIds.indexOf(tarea.id);
                                      const nextId = allVisibleTaskIds[idx + 1];
                                      if (nextId) {
                                        let nextT = null;
                                        for (const r of detalle.rubros) { nextT = r.tareas.find(t => t.id === nextId); if (nextT) break; }
                                        if (nextT) setInlineEdit({ taskId: nextId, field: 'margenLinea', value: nextT.margenLinea != null ? String(nextT.margenLinea) : '' });
                                      }
                                    }
                                    if (e.key === 'Escape') setInlineEdit(null);
                                  }} />
                              : <span style={{ ...inlineCellSt, color: tarea.margenLinea != null ? T.accent : T.ink3 }}>
                                  {tarea.margenLinea != null ? `${tarea.margenLinea}%` : 'def'}
                                </span>}
                          </div>
                        )}

                        {cols.ventaUnit  && <div className="k-cell" style={{ flex: 1, textAlign: 'right', fontFamily: T.fontMono, fontSize: 12, color: T.accent }}>{`$ ${fmtN(ventaUnitRow)}`}</div>}
                        {cols.ventaTotal && <div className="k-cell" style={{ flex: 1.1, textAlign: 'right', fontFamily: T.fontMono, fontSize: 12, fontWeight: 700, color: T.accent }}>{`$ ${fmtN(ventaTotalRow)}`}</div>}

                        <div className="k-cell" style={{ flex: 0.4, padding: '0 4px' }}>
                          <span style={{ color: T.accent, fontSize: 11, cursor: 'pointer' }} onClick={e => { e.stopPropagation(); deleteTarea(rubro.id, tarea.id); }}>🗑</span>
                        </div>
                      </div>
                    );
                  })}

                  {addingTask === rubro.id ? (
                    <div style={{ padding: '10px 12px', background: T.accentSoft, borderTop: `1px solid ${T.accent}` }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 0.7fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
                        <FRow label="Nombre tarea">
                          <TaskAutocomplete
                            value={newTask.nombre}
                            onChange={v => setNewTask(p => ({ ...p, nombre: v }))}
                            suggestions={allSuggestions}
                            onSelect={s => setNewTask(p => ({ ...p, nombre: s.nombre, unidad: s.unidad, costoMat: s.costoMat, costoSub: s.costoSub, codigo: s.codigo || p.codigo }))}
                          />
                        </FRow>
                        <FInput label="Cantidad" value={newTask.cantidad} onChange={v => setNewTask(p => ({ ...p, cantidad: v }))} type="number" />
                        <FInput label="Unidad" value={newTask.unidad} onChange={v => setNewTask(p => ({ ...p, unidad: v }))} />
                        <FInput label="$ Materiales" value={newTask.costoMat} onChange={v => setNewTask(p => ({ ...p, costoMat: v }))} type="number" />
                        <FInput label="$ Subcontrato" value={newTask.costoSub} onChange={v => setNewTask(p => ({ ...p, costoSub: v }))} type="number" />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8, marginBottom: 8 }}>
                        <FInput label="Código (opcional)" value={newTask.codigo} onChange={v => setNewTask(p => ({ ...p, codigo: v }))} placeholder="ELE-BOC-001" />
                      </div>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <Btn sm onClick={() => setAddingTask(null)}>Cancelar</Btn>
                        <Btn sm accent onClick={saveTask}>+ Agregar</Btn>
                      </div>
                    </div>
                  ) : (
                    <div className="k-tr" style={{ cursor: 'pointer', gap: 0 }}>
                      <div className="k-cell" style={{ flex: 1, color: T.accent, fontSize: 12 }} onClick={() => { setAddingTask(rubro.id); setSelTask(null); }}>+ Agregar tarea</div>
                      {puedeEditar && <>
                        <div className="k-cell" style={{ color: T.ink2, fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }} onClick={() => addSeccion(rubro.id, 1)}>§ Sección</div>
                        <div className="k-cell" style={{ color: T.ink3, fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }} onClick={() => addSeccion(rubro.id, 2)}>§§ Sub-sección</div>
                      </>}
                    </div>
                  )}
                </>
              )}
            </Box>
          ))}

          {addingRubro && (() => {
            const selCatRubro = (catalog.rubros || []).find(r => r.id === newRubro.rubroId);
            const tareasDispo = selCatRubro
              ? (catalog.tareas || []).filter(t => t.rubroNombre === selCatRubro.nombre)
              : [];
            const toggleTarea = (id) => setSelectedTareas(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
            return (
              <FormPanel title="Nuevo rubro" onSave={saveRubro} onCancel={() => { setAddingRubro(false); setNewRubro({ rubroId: '', margenMat: 20, margenMO: 35, proveedor: '' }); setSelectedTareas(new Set()); }}>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1.5fr', gap: 10 }}>
                  <FRow label="Rubro">
                    <select style={{ ...inputSt, cursor: 'pointer' }} value={newRubro.rubroId}
                      onChange={e => { setNewRubro(p => ({ ...p, rubroId: e.target.value })); setSelectedTareas(new Set()); }}>
                      <option value="">— Seleccionar rubro —</option>
                      {(catalog.rubros || []).map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                    </select>
                  </FRow>
                  <FInput label="% margen mat" value={newRubro.margenMat} onChange={v => setNewRubro(p => ({ ...p, margenMat: v }))} type="number" />
                  <FInput label="% margen Sub" value={newRubro.margenMO} onChange={v => setNewRubro(p => ({ ...p, margenMO: v }))} type="number" />
                  <FInput label="Proveedor" value={newRubro.proveedor} onChange={v => setNewRubro(p => ({ ...p, proveedor: v }))} placeholder="Nombre proveedor" />
                </div>
                {newRubro.rubroId && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        Tareas disponibles {selectedTareas.size > 0 && <span style={{ color: T.accent }}>· {selectedTareas.size} seleccionadas</span>}
                      </div>
                      {tareasDispo.length > 0 && (
                        <span style={{ fontSize: 10, color: T.accent, cursor: 'pointer', fontWeight: 700 }}
                          onClick={() => setSelectedTareas(selectedTareas.size === tareasDispo.length ? new Set() : new Set(tareasDispo.map(t => t.id)))}>
                          {selectedTareas.size === tareasDispo.length ? 'Deseleccionar todo' : 'Seleccionar todo'}
                        </span>
                      )}
                    </div>
                    {tareasDispo.length === 0
                      ? <div style={{ fontSize: 12, color: T.ink3, padding: '8px 0' }}>No hay tareas cargadas en este rubro del catálogo.</div>
                      : <div style={{ maxHeight: 220, overflowY: 'auto', border: `1px solid ${T.faint2}`, borderRadius: 4, background: T.paper }}>
                          {tareasDispo.map(t => {
                            const checked = selectedTareas.has(t.id);
                            const { mat, sub, mo, gen } = calcTarea(t);
                            return (
                              <div key={t.id} onClick={() => toggleTarea(t.id)}
                                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', cursor: 'pointer', background: checked ? T.accentSoft : 'transparent', borderBottom: `1px solid ${T.faint}` }}>
                                <input type="checkbox" readOnly checked={checked} style={{ cursor: 'pointer', flexShrink: 0 }} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 12, fontWeight: checked ? 700 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.nombre}</div>
                                  <div style={{ fontSize: 10, color: T.ink3 }}>{t.unidad} · mat ${fmtN(Math.round(mat + gen))} · sub ${fmtN(Math.round(sub + mo))}</div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                    }
                  </div>
                )}
              </FormPanel>
            );
          })()}
        </div>
      </div>

      {/* Modal: Desde plantilla */}
      {showPlantillas && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setShowPlantillas(false)}>
          <div style={{ background: T.paper, borderRadius: 8, padding: 22, width: 580, maxHeight: '75vh', overflow: 'auto', boxShadow: '0 6px 32px rgba(0,0,0,0.22)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 6 }}>Importar desde plantilla</div>
            <div style={{ fontSize: 12, color: T.ink2, marginBottom: 14 }}>Los rubros y tareas se agregarán al presupuesto actual.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {plantillas.length === 0 && <div style={{ color: T.ink3, fontSize: 12, padding: 16, textAlign: 'center' }}>Sin plantillas disponibles</div>}
              {plantillas.map(p => {
                const nRubros = (p.rubros || []).length;
                const nTareas = (p.rubros || []).reduce((s, r) => s + (r.tareas || []).length, 0);
                return (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', background: T.faint, borderRadius: 4, border: `1px solid ${T.faint2}`, gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{p.nombre}</div>
                      <div style={{ fontSize: 11, color: T.ink2 }}>{p.descripcion || p.tipo}</div>
                    </div>
                    <Chip style={{ fontSize: 10 }}>{nRubros} rubros</Chip>
                    <Chip style={{ fontSize: 10 }}>{nTareas} tareas</Chip>
                    <Btn sm fill onClick={() => importarPlantilla(p)}>Importar →</Btn>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 14, textAlign: 'right' }}><Btn sm onClick={() => setShowPlantillas(false)}>Cerrar</Btn></div>
          </div>
        </div>
      )}

      {/* Modal: Guardar como plantilla */}
      {showSavePlantilla && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setShowSavePlantilla(false)}>
          <div style={{ background: T.paper, borderRadius: 8, padding: 24, width: 460, boxShadow: '0 6px 32px rgba(0,0,0,0.22)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>Guardar como plantilla</div>
            <div style={{ fontSize: 12, color: T.ink2, marginBottom: 16 }}>
              Se guardará una copia del presupuesto actual con {detalle.rubros.length} rubros y {detalle.rubros.reduce((s, r) => s + (r.tareas || []).filter(t => t.tipo !== 'seccion').length, 0)} tareas (incluyendo secciones y sub-secciones).
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <FRow label="Nombre de la plantilla">
                <input autoFocus style={inputSt} value={savePlantillaForm.nombre}
                  onChange={e => setSavePlantillaForm(p => ({ ...p, nombre: e.target.value }))}
                  placeholder="Ej: Panadería 130m²" />
              </FRow>
              <FRow label="Tipo">
                <select style={{ ...inputSt, cursor: 'pointer' }} value={savePlantillaForm.tipo}
                  onChange={e => setSavePlantillaForm(p => ({ ...p, tipo: e.target.value }))}>
                  {['Comercial', 'Vivienda', 'Industrial', 'Refacción'].map(t => <option key={t}>{t}</option>)}
                </select>
              </FRow>
              <FRow label="Descripción (opcional)">
                <input style={inputSt} value={savePlantillaForm.descripcion}
                  onChange={e => setSavePlantillaForm(p => ({ ...p, descripcion: e.target.value }))}
                  placeholder="Breve descripción del modelo" />
              </FRow>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
              <Btn sm onClick={() => setShowSavePlantilla(false)}>Cancelar</Btn>
              <Btn sm fill style={{ opacity: savePlantillaForm.nombre.trim() ? 1 : 0.5 }} onClick={guardarComoPlantilla}>Guardar plantilla</Btn>
            </div>
          </div>
        </div>
      )}

      {/* APU panel */}
      <Box style={{ width: 280, padding: 12, flexShrink: 0, overflow: 'auto' }}>
        {selTask && !editTask ? (
          <>
            <Label>Tarea seleccionada</Label>
            <div className="k-h" style={{ fontSize: 16, marginTop: 3 }}>{selTask.nombre}</div>
            {selTask.codigo && <div style={{ fontSize: 10, color: T.ink3, marginBottom: 4 }}>{selTask.codigo}</div>}
            <div style={{ fontSize: 11, color: T.ink2, marginBottom: 6 }}>{selTask.cantidad} {selTask.unidad}</div>
            <Divider style={{ margin: '6px 0' }} />

            {/* Receta */}
            <div style={{ fontSize: 10, fontWeight: 700, color: T.ink2, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>Receta / componentes</div>

            {/* Subcontrato */}
            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 9, color: T.ink3, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 2 }}>Subcontrato $/un</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: (selTask.costoSub || 0) > 0 ? '#fdf0ed' : T.faint, borderRadius: 3, padding: '4px 8px' }}>
                <span style={{ fontSize: 11, color: T.ink2 }}>Precio por unidad</span>
                <span className="k-mono" style={{ fontWeight: 700, fontSize: 12, color: '#c0392b' }}>$ {fmtN(selTask.costoSub || 0)}</span>
              </div>
            </div>

            {/* Materiales */}
            <div style={{ marginBottom: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <div style={{ fontSize: 9, color: T.ink3, letterSpacing: 1, textTransform: 'uppercase' }}>Materiales $/un</div>
                <span style={{ fontSize: 10, color: T.accent, cursor: 'pointer', fontWeight: 700 }}
                  onClick={() => {
                    const receta = selTask.receta || { materiales: [] };
                    patchTaskReceta(selTask.id, { ...receta, materiales: [...receta.materiales, { id: newId(), nombre: 'Nuevo material', categoria: 'General', costoUnit: 0 }] });
                  }}>+ agregar</span>
              </div>
              {(selTask.receta?.materiales || []).length === 0 ? (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: selTask.costoMat > 0 ? '#fdf0ed' : T.faint, borderRadius: 3, padding: '4px 8px' }}>
                  <span style={{ fontSize: 11, color: T.ink2 }}>Total materiales</span>
                  <span className="k-mono" style={{ fontWeight: 700, fontSize: 12, color: '#c0392b' }}>$ {fmtN(selTask.costoMat)}</span>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {(selTask.receta.materiales).map((m, mi) => (
                    <div key={m.id} style={{ background: '#fdf0ed', borderRadius: 3, padding: '4px 6px' }}>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 3 }}>
                        <input value={m.nombre} style={{ flex: 1, fontSize: 10, padding: '1px 4px', border: `1px solid ${T.faint2}`, borderRadius: 2, fontFamily: T.font }}
                          onChange={e => {
                            const mats = selTask.receta.materiales.map((x, xi) => xi === mi ? { ...x, nombre: e.target.value } : x);
                            patchTaskReceta(selTask.id, { ...selTask.receta, materiales: mats });
                          }} />
                        <span style={{ fontSize: 10, color: T.accent, cursor: 'pointer' }}
                          onClick={() => {
                            const mats = selTask.receta.materiales.filter((_, xi) => xi !== mi);
                            patchTaskReceta(selTask.id, { ...selTask.receta, materiales: mats });
                          }}>✕</span>
                      </div>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <select value={m.categoria} style={{ flex: 1, fontSize: 9, padding: '1px 3px', border: `1px solid ${T.faint2}`, borderRadius: 2, fontFamily: T.font, color: T.ink2 }}
                          onChange={e => {
                            const mats = selTask.receta.materiales.map((x, xi) => xi === mi ? { ...x, categoria: e.target.value } : x);
                            patchTaskReceta(selTask.id, { ...selTask.receta, materiales: mats });
                          }}>
                          {['General', 'Logística', 'Estructura', 'Terminaciones', 'Herramientas', 'Otro'].map(c => <option key={c}>{c}</option>)}
                        </select>
                        <span style={{ fontSize: 9, color: T.ink3 }}>$</span>
                        <input type="number" min="0" step="any" value={m.costoUnit} style={{ width: 60, fontSize: 10, padding: '1px 4px', border: `1px solid ${T.faint2}`, borderRadius: 2, fontFamily: T.fontMono, textAlign: 'right' }}
                          onChange={e => {
                            const mats = selTask.receta.materiales.map((x, xi) => xi === mi ? { ...x, costoUnit: +e.target.value || 0 } : x);
                            patchTaskReceta(selTask.id, { ...selTask.receta, materiales: mats });
                          }} />
                      </div>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 6px', background: T.faint, borderRadius: 3, fontSize: 11, fontWeight: 700 }}>
                    <span style={{ color: T.ink2 }}>Total mat</span>
                    <span className="k-mono" style={{ color: '#c0392b' }}>$ {fmtN(selTask.costoMat)}</span>
                  </div>
                </div>
              )}
            </div>

            <Divider style={{ margin: '6px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
              <span style={{ color: '#c0392b', fontWeight: 600 }}>Costo total</span>
              <b className="k-mono" style={{ color: '#c0392b' }}>$ {fmtN((selTask.costoMat + (selTask.costoSub || 0)) * selTask.cantidad)}</b>
            </div>
            {selRubro && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span style={{ color: T.accent, fontWeight: 600 }}>Venta total</span>
                <b className="k-mono" style={{ color: T.accent }}>$ {fmtN(tareaVentaUnit(selTask, selRubro) * selTask.cantidad)}</b>
              </div>
            )}
            <div style={{ marginTop: 8 }}>
              <Label>% Avance</Label>
              <div style={{ marginTop: 4 }}>
                <Bar pct={selTask.avance} ok={selTask.avance === 100} />
                <div style={{ fontSize: 11, color: T.ink2, textAlign: 'right', marginTop: 2 }}>{selTask.avance}%</div>
              </div>
            </div>
            {selRubro && (
              <div style={{ marginTop: 6, fontSize: 10, color: T.ink2 }}>
                Rubro: <b>{selRubro.nombre}</b> · mat +{selRubro.margenMat}% · sub +{selRubro.margenMO}%
                {selTask.margenLinea != null && <span style={{ color: T.accent }}> · override {selTask.margenLinea}%</span>}
              </div>
            )}
            <Btn sm fill style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} onClick={() => setEditTask({ ...selTask })}>Editar tarea</Btn>
          </>
        ) : editTask ? (
          <>
            <Label>Editar tarea</Label>
            <div className="k-h" style={{ fontSize: 16, marginTop: 3, marginBottom: 10 }}>{editTask.nombre}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <FInput label="Nombre" value={editTask.nombre} onChange={v => updateEditField('nombre', v)} />
              <FInput label="Código" value={editTask.codigo} onChange={v => updateEditField('codigo', v)} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <FInput label="Cantidad" value={editTask.cantidad} onChange={v => updateEditField('cantidad', v)} type="number" />
                <FInput label="Unidad" value={editTask.unidad} onChange={v => updateEditField('unidad', v)} />
              </div>
              <FInput label="$ Materiales unit" value={editTask.costoMat} onChange={v => updateEditField('costoMat', v)} type="number" />
              <FInput label="$ Subcontrato unit" value={editTask.costoSub || 0} onChange={v => updateEditField('costoSub', v)} type="number" />
              <div>
                <div style={labelSt}>Avance %</div>
                <input type="range" min={0} max={100} step={5} value={editTask.avance}
                  onChange={e => updateEditField('avance', +e.target.value)}
                  style={{ width: '100%', accentColor: T.accent }} />
                <div style={{ textAlign: 'right', fontSize: 11, color: T.ink2 }}>{editTask.avance}%</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <Btn sm style={{ flex: 1 }} onClick={() => setEditTask(null)}>Cancelar</Btn>
              <Btn sm accent style={{ flex: 1 }} onClick={saveEditTask}>Guardar</Btn>
            </div>
          </>
        ) : (
          <div style={{ color: T.ink3, fontSize: 12, marginTop: 20, textAlign: 'center' }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>←</div>
            Hacé click en una tarea para ver su detalle y editarla
          </div>
        )}
      </Box>
    </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 2: MATERIALES
// ─────────────────────────────────────────────────────────────────────────────
function TabMateriales({ detalle, obra }) {
  const [selRubroId, setSelRubroId] = useState(null);
  const { catalog } = useCatalog();

  // Aggregate materials per rubro, grouped by nombre
  const rubroMats = useMemo(() => {
    const catalogByNombre = new Map((catalog.tareas || []).map(ct => [ct.nombre, ct]));
    return detalle.rubros.map(rubro => {
      const matMap = new Map();
      for (const t of (rubro.tareas || []).filter(t => t.tipo !== 'seccion')) {
        const recipeMats = (t.receta?.materiales || []).length > 0
          ? t.receta.materiales
          : (catalogByNombre.get(t.nombre)?.materiales || []);
        for (const m of recipeMats) {
          if (!m.nombre) continue;
          const key = m.nombre;
          // Physical quantity per APU unit: validate stored cantidad against costoUnit/precio
          const stored = m.cantidad || 0;
          const precio = m.precio || 0;
          const costoUnit = m.costoUnit || 0;
          let cantUnit = stored;
          if (stored > 0 && precio > 0 && costoUnit > 0 && Math.abs(stored * precio - costoUnit) > costoUnit * 0.01 + 0.01) {
            cantUnit = costoUnit / precio; // stored cantidad is inconsistent → derive from cost
          } else if (stored === 0 && precio > 0 && costoUnit > 0) {
            cantUnit = costoUnit / precio; // only costoUnit available → derive
          }
          const qty = cantUnit * t.cantidad;
          if (matMap.has(key)) {
            matMap.get(key).cantidad += qty;
          } else {
            matMap.set(key, { nombre: m.nombre, unidad: m.unidad || '', categoria: m.categoria || 'General', cantidad: qty });
          }
        }
      }
      return { rubro, materiales: [...matMap.values()].sort((a, b) => a.nombre.localeCompare(b.nombre)) };
    }).filter(r => r.materiales.length > 0);
  }, [detalle.rubros, catalog.tareas]);

  // Global aggregate across all rubros
  const globalMats = useMemo(() => {
    const matMap = new Map();
    for (const { rubro, materiales } of rubroMats) {
      for (const m of materiales) {
        if (matMap.has(m.nombre)) {
          matMap.get(m.nombre).cantidad += m.cantidad;
        } else {
          matMap.set(m.nombre, { ...m });
        }
      }
    }
    return [...matMap.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [rubroMats]);

  const visibleMats = selRubroId
    ? (rubroMats.find(r => r.rubro.id === selRubroId)?.materiales || [])
    : globalMats;

  const exportarLista = () => {
    const titulo = selRubroId
      ? rubroMats.find(r => r.rubro.id === selRubroId)?.rubro.nombre || 'Rubro'
      : 'Todos los gremios';
    const fecha = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });
    const rows = visibleMats.map((m, i) => `
      <tr>
        <td>${i + 1}</td>
        <td><b>${m.nombre}</b></td>
        <td>${m.categoria}</td>
        <td>${m.unidad}</td>
        <td style="text-align:right;font-family:monospace">${fmtQ(m.cantidad)}</td>
        <td style="width:120px"></td>
      </tr>`).join('');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Lista de Materiales — ${obra?.nombre || ''}</title>
<style>
  body{font-family:Arial,sans-serif;font-size:12px;padding:16mm 20mm;color:#1a1a1a}
  h2{margin:0 0 2px;font-size:17px;letter-spacing:0.5px}
  .sub{font-size:11px;color:#666;margin-bottom:18px}
  table{width:100%;border-collapse:collapse}
  th{background:#1f2024;color:#fff;padding:7px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.5px}
  th:nth-child(5),th:nth-child(6){text-align:right}
  td{padding:6px 10px;border-bottom:1px solid #e8e8e8;vertical-align:top}
  tr:nth-child(even) td{background:#f7f7f7}
  .note{font-size:10px;color:#888;margin-top:14px}
  @media print{body{padding:8mm 12mm}.note{display:none}}
</style></head><body>
<h2>LISTA DE MATERIALES · ${(obra?.nombre || '').toUpperCase()}</h2>
<div class="sub">${titulo} · Para cotización · ${fecha}</div>
<table>
  <thead><tr>
    <th style="width:32px">#</th>
    <th>Material / Descripción</th>
    <th>Categoría</th>
    <th>Unidad</th>
    <th style="text-align:right;width:90px">Cantidad</th>
    <th style="text-align:right;width:120px">Precio unitario</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="note">* Lista generada automáticamente desde Kamak · Precios a confirmar por proveedor</div>
<script>setTimeout(()=>window.print(),400)</script>
</body></html>`;
    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
  };

  return (
    <div style={{ display: 'flex', gap: 12, height: 'calc(100vh - 240px)' }}>

      {/* Sidebar: rubros */}
      <div style={{ width: 200, flexShrink: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div onClick={() => setSelRubroId(null)}
          style={{ padding: '8px 10px', borderRadius: 4, cursor: 'pointer', border: `1px solid ${!selRubroId ? T.accent : T.faint2}`, background: !selRubroId ? T.accentSoft : T.paper }}>
          <div style={{ fontSize: 12, fontWeight: !selRubroId ? 700 : 400 }}>Todos los gremios</div>
          <div style={{ fontFamily: T.fontMono, fontSize: 11, color: T.ink3, marginTop: 2 }}>{globalMats.length} materiales</div>
        </div>
        {rubroMats.map(({ rubro, materiales }) => (
          <div key={rubro.id} onClick={() => setSelRubroId(rubro.id)}
            style={{ padding: '8px 10px', borderRadius: 4, cursor: 'pointer', border: `1px solid ${selRubroId === rubro.id ? T.accent : T.faint2}`, background: selRubroId === rubro.id ? T.accentSoft : T.paper }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{rubro.nombre}</div>
            <div style={{ fontFamily: T.fontMono, fontSize: 11, color: T.ink3, marginTop: 2 }}>{materiales.length} materiales</div>
          </div>
        ))}
      </div>

      {/* Main table */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexShrink: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>
            {visibleMats.length} {visibleMats.length === 1 ? 'material' : 'materiales'}
          </div>
          <Btn sm onClick={exportarLista} disabled={visibleMats.length === 0}>
            📋 Exportar para cotización
          </Btn>
        </div>

        <Box style={{ flex: 1, padding: 0, overflow: 'auto' }}>
          {visibleMats.length === 0 && (
            <div style={{ padding: 48, textAlign: 'center', color: T.ink3 }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>🧱</div>
              <div style={{ fontSize: 12 }}>Sin materiales registrados. Agregá recetas APU a las tareas desde la pestaña Presupuesto.</div>
            </div>
          )}
          {visibleMats.length > 0 && (
            <>
              <div className="k-tr" style={{ background: T.faint, fontWeight: 700, fontSize: 10, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                <div className="k-cell" style={{ flex: 3 }}>Material</div>
                <div className="k-cell" style={{ flex: 0.9 }}>Categoría</div>
                <div className="k-cell" style={{ flex: 0.6, textAlign: 'right' }}>Unidad</div>
                <div className="k-cell" style={{ flex: 0.9, textAlign: 'right' }}>Cantidad total</div>
              </div>
              {visibleMats.map((m, i) => (
                <div key={m.nombre} className="k-tr" style={{ alignItems: 'center' }}>
                  <div className="k-cell" style={{ flex: 3, fontWeight: 600, fontSize: 12 }}>{m.nombre}</div>
                  <div className="k-cell" style={{ flex: 0.9 }}>
                    <Chip style={{ fontSize: 9 }}>{m.categoria}</Chip>
                  </div>
                  <div className="k-cell" style={{ flex: 0.6, fontFamily: T.fontMono, textAlign: 'right', fontSize: 12, color: T.ink2 }}>{m.unidad}</div>
                  <div className="k-cell" style={{ flex: 0.9, fontFamily: T.fontMono, textAlign: 'right', fontWeight: 700, fontSize: 13 }}>{fmtQ(m.cantidad)}</div>
                </div>
              ))}
            </>
          )}
        </Box>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 3: ADICIONALES
// ─────────────────────────────────────────────────────────────────────────────
const fmtU = (n) => n != null && n !== '' ? fmtN(n) : '—';

// ── Export HTML helpers (adicionales + resumen) ───────────────────────────────
const fmtNE  = (n) => Math.round(n ?? 0).toLocaleString('es-AR');
const fmtME  = (n, m) => m === 'USD' ? `U$S ${fmtNE(n)}` : `$ ${fmtNE(n)}`;
const fmtDE  = (iso) => !iso ? '—' : iso.split('-').reverse().join('/');
const fechaE = () => new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });

const BASE_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800;900&family=JetBrains+Mono:wght@400;700&display=swap');
@page{size:A4;margin:18mm 16mm}
*{margin:0;padding:0;box-sizing:border-box;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
body{font-family:'Montserrat',sans-serif;font-size:11px;color:#1f2024;background:#fff}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:10px;border-bottom:3px solid #1a9b9c;margin-bottom:18px}
.logo{font-weight:900;font-size:20px;letter-spacing:2px;color:#1f2024}
.hdr-r{text-align:right;font-family:'JetBrains Mono',monospace;font-size:8px;color:#9a9892;line-height:1.7}
.title{font-weight:900;font-size:16px;letter-spacing:1px;color:#1a9b9c;margin-bottom:2px}
.obra-info{font-size:10px;color:#5a5a58;margin-bottom:16px}
table{width:100%;border-collapse:collapse;font-size:10px;margin-bottom:14px}
th{background:#1f2024;color:#fff;padding:5px 8px;text-align:left;font-size:8.5px;letter-spacing:.8px;font-family:'JetBrains Mono',monospace;font-weight:700}
th.r{text-align:right}
td{padding:5px 8px;border-bottom:1px solid #e8e4d8}
td.r{text-align:right;font-family:'JetBrains Mono',monospace}
td.b{font-weight:700}
tr.alt td{background:#f9f7f2}
tr.rubro td{background:#1a9b9c18;font-weight:800;font-size:10.5px;color:#1a9b9c}
tr.subtot td{background:#d6efef;font-weight:800}
tr.total td{background:#1f2024;color:#fff;font-weight:900;font-family:'JetBrains Mono',monospace;font-size:12px}
.pill{display:inline-block;padding:1px 7px;border-radius:8px;font-size:8px;font-weight:700;font-family:'JetBrains Mono',monospace}
.ok{background:#d1fae5;color:#065f46}
.warn{background:#fef3c7;color:#92400e}
.accent{background:#fee2e2;color:#991b1b}
.ftr{margin-top:20px;padding-top:8px;border-top:1px solid #e8e4d8;display:flex;justify-content:space-between;font-size:8px;color:#9a9892;font-family:'JetBrains Mono',monospace}
@media screen{body{max-width:794px;margin:0 auto;padding:16px}}`;

function generarHTMLAdicionales({ obra, detalle, moneda }) {
  const adic = detalle.adicionales || [];
  const monedaStr = moneda || 'ARS';
  const aprobados = adic.filter(a => a.estado === 'aprobado');
  const totalCosto = aprobados.reduce((s, a) => s + (a.costoTotal ?? a.monto ?? 0), 0);
  const totalVenta = aprobados.reduce((s, a) => s + (a.valorVentaTotal ?? a.monto ?? 0), 0);

  const rows = adic.map((a, i) => {
    const estadoPill = a.estado === 'aprobado'
      ? `<span class="pill ok">aprobado</span>`
      : a.estado === 'rechazado'
        ? `<span class="pill accent">rechazado</span>`
        : `<span class="pill warn">pendiente</span>`;
    return `<tr${i % 2 === 1 ? ' class="alt"' : ''}>
      <td>${i + 1}</td>
      <td class="b">${a.descripcion || '—'}</td>
      <td>${a.tarea || '—'}</td>
      <td class="r">${a.cantidad != null ? fmtNE(a.cantidad) : '—'}</td>
      <td class="r">${a.unidad || '—'}</td>
      <td class="r">${a.costoTotal != null ? fmtME(a.costoTotal, monedaStr) : '—'}</td>
      <td class="r b" style="color:#1a9b9c">${a.valorVentaTotal != null ? fmtME(a.valorVentaTotal, monedaStr) : '—'}</td>
      <td>${estadoPill}</td>
      <td class="r">${fmtDE(a.fecha)}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Adicionales — ${obra?.nombre || ''}</title><style>${BASE_CSS}</style></head><body>
<div class="hdr">
  <div><div class="logo">KAMAK</div><div style="font-size:9px;color:#9a9892;font-family:'JetBrains Mono',monospace;margin-top:2px">KAMAKDESARROLLOS@GMAIL.COM</div></div>
  <div class="hdr-r">ADICIONALES DE OBRA<br>${fechaE()}</div>
</div>
<div class="title">ADICIONALES</div>
<div class="obra-info">${(obra?.nombre || '').toUpperCase()}${obra?.cliente ? ' · ' + obra.cliente : ''}${obra?.tipo ? ' · ' + obra.tipo : ''} · ${adic.length} adicionales · ${aprobados.length} aprobados</div>
<table>
  <thead><tr>
    <th>#</th><th>Descripción</th><th>Tarea</th><th class="r">Cant</th><th class="r">Un</th>
    <th class="r">Costo total</th><th class="r">Venta total</th><th>Estado</th><th class="r">Fecha</th>
  </tr></thead>
  <tbody>${rows}</tbody>
  ${aprobados.length > 0 ? `<tfoot>
    <tr class="subtot"><td colspan="5"></td><td class="r">${fmtME(totalCosto, monedaStr)}</td><td class="r" style="color:#1a9b9c">${fmtME(totalVenta, monedaStr)}</td><td colspan="2"></td></tr>
  </tfoot>` : ''}
</table>
<div class="ftr"><span>KAMAK DESARROLLOS</span><span>NO INCLUYE IVA</span><span>${fechaE()}</span></div>
</body></html>`;
}

function generarHTMLResumen({ obra, detalle, moneda, incluirPagos }) {
  const monedaStr = moneda || 'ARS';
  const rubros = detalle.rubros || [];
  const adic = (detalle.adicionales || []).filter(a => a.estado === 'aprobado' && a.aplicaACliente !== false);
  const cuotas = detalle.cuotas || [];
  const fin = detalle.financiacion || {};

  let ventaBase = 0;
  const rubroRows = rubros.map((rubro, ri) => {
    let rubroVenta = 0;
    const tareaRows = rubro.tareas.filter(t => t.tipo !== 'seccion').map((t, ti) => {
      const cu = t.costoMat + (t.costoSub || 0);
      const vu = t.margenLinea != null ? cu * (1 + t.margenLinea / 100) : t.costoMat * (1 + (rubro.margenMat || 0) / 100) + (t.costoSub || 0) * (1 + (rubro.margenMO || 0) / 100);
      const vt = Math.round(vu * t.cantidad);
      rubroVenta += vt;
      return `<tr${ti % 2 === 1 ? ' class="alt"' : ''}><td style="padding-left:20px">${t.nombre}</td><td class="r">${fmtNE(t.cantidad)}</td><td class="r">${t.unidad}</td><td class="r">${fmtME(vt, monedaStr)}</td></tr>`;
    }).join('');
    ventaBase += rubroVenta;
    return `<tr class="rubro"><td colspan="3">RUBRO ${String(ri+1).padStart(2,'0')} · ${rubro.nombre.toUpperCase()}</td><td class="r">${fmtME(rubroVenta, monedaStr)}</td></tr>${tareaRows}`;
  }).join('');

  const adicRows = adic.map((a, i) => `<tr${i % 2 === 1 ? ' class="alt"' : ''}><td style="padding-left:20px">${a.descripcion}</td><td class="r">${a.cantidad != null ? fmtNE(a.cantidad) : ''}</td><td class="r">${a.unidad || ''}</td><td class="r" style="color:#1a9b9c">${fmtME(a.valorVentaTotal ?? a.monto ?? 0, monedaStr)}</td></tr>`).join('');
  const totalAdic = adic.reduce((s, a) => s + (a.valorVentaTotal ?? a.monto ?? 0), 0);
  const interes = parseFloat(fin.interes) || 0;
  const totalCliente = Math.round((ventaBase + totalAdic) * (1 + interes / 100));

  const cuotaRows = incluirPagos && cuotas.length > 0 ? cuotas.map((c, i) => `<tr${i % 2 === 1 ? ' class="alt"' : ''}><td>${c.n || i+1}</td><td>${c.descripcion}</td><td class="r">${fmtDE(c.fecha)}</td><td class="r">${fmtME(c.monto, monedaStr)}</td><td><span class="pill ${c.estado === 'pagado' ? 'ok' : 'warn'}">${c.estado === 'pagado' ? 'pagado' : 'pendiente'}</span></td></tr>`).join('') : '';
  const pagado = cuotas.filter(c => c.estado === 'pagado').reduce((s, c) => s + c.monto, 0);
  const saldo = totalCliente - pagado;

  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Resumen — ${obra?.nombre || ''}</title><style>${BASE_CSS}</style></head><body>
<div class="hdr">
  <div><div class="logo">KAMAK</div><div style="font-size:9px;color:#9a9892;font-family:'JetBrains Mono',monospace;margin-top:2px">KAMAKDESARROLLOS@GMAIL.COM</div></div>
  <div class="hdr-r">RESUMEN DE OBRA<br>${fechaE()}</div>
</div>
<div class="title">RESUMEN TOTAL DE OBRA</div>
<div class="obra-info">${(obra?.nombre || '').toUpperCase()}${obra?.cliente ? ' · CLIENTE: ' + obra.cliente : ''}${obra?.tipo ? ' · ' + obra.tipo : ''}</div>

<table>
  <thead><tr><th>Tarea / Descripción</th><th class="r">Cant</th><th class="r">Un</th><th class="r">Subtotal</th></tr></thead>
  <tbody>
    ${rubros.length > 0 ? `<tr class="rubro"><td colspan="4">▸ PRESUPUESTO BASE</td></tr>${rubroRows}
    <tr class="subtot"><td colspan="3">SUBTOTAL PRESUPUESTO BASE</td><td class="r">${fmtME(ventaBase, monedaStr)}</td></tr>` : ''}
    ${adic.length > 0 ? `<tr class="rubro"><td colspan="4">▸ ADICIONALES APROBADOS</td></tr>${adicRows}
    <tr class="subtot"><td colspan="3">SUBTOTAL ADICIONALES</td><td class="r" style="color:#1a9b9c">${fmtME(totalAdic, monedaStr)}</td></tr>` : ''}
    ${interes > 0 ? `<tr><td colspan="3" style="font-style:italic;color:#9a9892">Interés financiero (${interes}%)</td><td class="r">${fmtME(Math.round((ventaBase + totalAdic) * interes / 100), monedaStr)}</td></tr>` : ''}
    <tr class="total"><td colspan="3">TOTAL CLIENTE</td><td class="r" style="font-size:14px">${fmtME(totalCliente, monedaStr)}</td></tr>
  </tbody>
</table>

${incluirPagos && cuotas.length > 0 ? `
<div class="title" style="font-size:13px;margin-top:10px;margin-bottom:10px">PLAN DE PAGOS</div>
<table>
  <thead><tr><th>#</th><th>Cuota</th><th class="r">Fecha</th><th class="r">Monto</th><th>Estado</th></tr></thead>
  <tbody>${cuotaRows}</tbody>
  <tfoot>
    <tr class="subtot"><td colspan="3">Pagado</td><td class="r">${fmtME(pagado, monedaStr)}</td><td></td></tr>
    <tr class="total"><td colspan="3">Saldo pendiente</td><td class="r">${fmtME(Math.max(0, saldo), monedaStr)}</td><td></td></tr>
  </tfoot>
</table>` : ''}

${fin.notaPortal ? `<div style="margin-top:12px;padding:8px 12px;background:#f9f7f2;border-left:3px solid #1a9b9c;font-size:10px;color:#5a5a58">📋 ${fin.notaPortal}</div>` : ''}
<div class="ftr"><span>KAMAK DESARROLLOS</span><span>NO INCLUYE IVA</span><span>${fechaE()}</span></div>
</body></html>`;
}

function abrirExport(html, titulo) {
  const w = window.open('', '_blank', 'width=794,height=1000,scrollbars=yes');
  w.document.open(); w.document.write(html); w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 800);
}

// ─────────────────────────────────────────────────────────────────────────────
function TabAdicionales({ detalle, patch, moneda, obra }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const defaultForm = {
    descripcion: '', tarea: '', cantidad: '', unidad: '',
    costoUnit: '', costoTotal: '',
    valorVentaUnit: '', valorVentaTotal: '',
    montoProveedor: '',
    cantidadProveedor: '', costoUnitProveedor: '',
    aplicaACliente: true, aplicaAProveedor: false,
    fecha: new Date().toISOString().split('T')[0], estado: 'pendiente',
  };
  const [form, setForm] = useState(defaultForm);

  const autoCalc = (f, field, val) => {
    const updated = { ...f, [field]: val };
    const cant = parseFloat(updated.cantidad) || 0;
    if (cant > 0) {
      if ((field === 'costoUnit' || field === 'cantidad') && updated.costoUnit && !updated.costoTotal)
        updated.costoTotal = String(Math.round(cant * (parseFloat(updated.costoUnit) || 0)));
      if ((field === 'valorVentaUnit' || field === 'cantidad') && updated.valorVentaUnit && !updated.valorVentaTotal)
        updated.valorVentaTotal = String(Math.round(cant * (parseFloat(updated.valorVentaUnit) || 0)));
    }
    return updated;
  };
  const set = (field) => (val) => setForm(p => autoCalc(p, field, val));

  const save = () => {
    if (!form.descripcion.trim()) return;
    const costoTot  = parseFloat(form.costoTotal)  || (parseFloat(form.cantidad || 0) * parseFloat(form.costoUnit || 0)) || null;
    const ventaTot  = parseFloat(form.valorVentaTotal) || (parseFloat(form.cantidad || 0) * parseFloat(form.valorVentaUnit || 0)) || null;
    const entry = {
      id:              editingId || newId(),
      descripcion:     form.descripcion,
      tarea:           form.tarea || '',
      cantidad:        parseFloat(form.cantidad) || null,
      unidad:          form.unidad || '',
      costoUnit:       parseFloat(form.costoUnit) || null,
      costoTotal:      costoTot,
      valorVentaUnit:  parseFloat(form.valorVentaUnit) || null,
      valorVentaTotal: ventaTot,
      montoProveedor:    form.montoProveedor !== '' ? parseFloat(form.montoProveedor) : null,
      cantidadProveedor: parseFloat(form.cantidadProveedor) || null,
      costoUnitProveedor: parseFloat(form.costoUnitProveedor) || null,
      aplicaACliente:    form.aplicaACliente !== false,
      aplicaAProveedor:  !!form.aplicaAProveedor,
      monto:             ventaTot ?? costoTot ?? 0,
      fecha:             form.fecha,
      estado:            form.estado || 'pendiente',
    };
    if (editingId) {
      patch(d => ({ ...d, adicionales: d.adicionales.map(a => a.id === editingId ? entry : a) }));
    } else {
      patch(d => ({ ...d, adicionales: [...d.adicionales, entry] }));
    }
    setAdding(false);
    setEditingId(null);
    setForm(defaultForm);
  };

  const startEdit = (a) => {
    setForm({
      descripcion: a.descripcion || '', tarea: a.tarea || '',
      cantidad: a.cantidad ?? '', unidad: a.unidad || '',
      costoUnit: a.costoUnit ?? '', costoTotal: a.costoTotal ?? '',
      valorVentaUnit: a.valorVentaUnit ?? '', valorVentaTotal: a.valorVentaTotal ?? '',
      montoProveedor: a.montoProveedor ?? '',
      cantidadProveedor: a.cantidadProveedor ?? '', costoUnitProveedor: a.costoUnitProveedor ?? '',
      aplicaACliente: a.aplicaACliente !== false, aplicaAProveedor: !!a.aplicaAProveedor,
      fecha: a.fecha || new Date().toISOString().split('T')[0], estado: a.estado || 'pendiente',
    });
    setEditingId(a.id);
    setAdding(true);
  };

  const setEstado = (id, estado) => patch(d => ({ ...d, adicionales: d.adicionales.map(a => a.id === id ? { ...a, estado } : a) }));
  const del = (id) => patch(d => ({ ...d, adicionales: d.adicionales.filter(a => a.id !== id) }));

  const aplicarAContrato = (a) => {
    const tareaKey = (a.tarea || '').toLowerCase();
    patch(d => {
      const contratos = d.contratos || [];
      const cIdx = contratos.findIndex(c =>
        (c.tareas || []).some(t => t.nombre?.toLowerCase().includes(tareaKey) || tareaKey.includes(t.nombre?.toLowerCase() || ''))
      );
      if (cIdx < 0) { alert('No se encontró un contrato MO con la tarea "' + a.tarea + '".\nCreá primero el contrato MO para ese rubro.'); return d; }
      const cantProv = a.cantidadProveedor || a.cantidad || 1;
      const precioProv = a.costoUnitProveedor || a.costoUnit || 0;
      const extraTarea = { tareaId: newId(), nombre: `Adicional: ${a.descripcion}`, unidad: a.unidad || '', cantidadTotal: cantProv, cantidadContratada: cantProv, precioUnit: precioProv };
      const montoExtra = cantProv * precioProv;
      const updatedContratos = contratos.map((c, i) => i !== cIdx ? c : { ...c, tareas: [...(c.tareas || []), extraTarea], monto: (c.monto || 0) + montoExtra });
      const updatedAdicionales = d.adicionales.map(x => x.id === a.id ? { ...x, aplicadoAContrato: true } : x);
      return { ...d, contratos: updatedContratos, adicionales: updatedAdicionales };
    });
  };

  const aprobados   = detalle.adicionales.filter(a => a.estado === 'aprobado');
  const totalCosto  = aprobados.reduce((s, a) => s + (a.costoTotal ?? a.monto ?? 0), 0);
  const totalVenta  = aprobados.reduce((s, a) => s + (a.valorVentaTotal ?? a.monto ?? 0), 0);
  const totalProv   = aprobados.filter(a => a.montoProveedor != null).reduce((s, a) => s + (a.montoProveedor || 0), 0);

  const colH = { fontSize: 10, fontWeight: 700, color: T.ink3, padding: '5px 8px', textAlign: 'right', borderBottom: `1px solid ${T.faint2}`, whiteSpace: 'nowrap', background: T.faint };
  const colD = { fontSize: 11, padding: '9px 8px', textAlign: 'right', fontFamily: T.fontMono };

  // Grupos de encabezado
  const thSpan = (label, cols, align = 'center', accent = false) => (
    <th colSpan={cols} style={{ fontSize: 9, fontWeight: 700, color: accent ? T.accent : T.ink3, padding: '4px 8px', textAlign: align, borderBottom: `1px solid ${T.faint2}`, background: T.faint, letterSpacing: 0.8, textTransform: 'uppercase' }}>
      {label}
    </th>
  );

  return (
    <div style={{ maxWidth: 1020 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 12, color: T.ink2, display: 'flex', gap: 16 }}>
          <span>{detalle.adicionales.length} adicionales</span>
          {totalCosto > 0 && <span>Costo aprobado: <b>{fmtM(totalCosto, moneda)}</b></span>}
          {totalVenta > 0 && <span style={{ color: T.ok }}>Venta aprobada: <b>{fmtM(totalVenta, moneda)}</b></span>}
          {totalProv  > 0 && <span style={{ color: T.ink3 }}>Prov: <b>{fmtM(totalProv, moneda)}</b></span>}
        </div>
        <Btn sm onClick={() => abrirExport(generarHTMLAdicionales({ obra, detalle, moneda }), 'Adicionales')}>↗ Exportar</Btn>
        <Btn sm fill onClick={() => { setAdding(true); setEditingId(null); setForm(defaultForm); }}>+ Adicional</Btn>
      </div>

      {adding && (
        <FormPanel title={editingId ? 'Editar adicional' : 'Nuevo adicional'} onSave={save} onCancel={() => { setAdding(false); setEditingId(null); setForm(defaultForm); }} style={{ marginBottom: 14 }}>
          <FInput label="Descripción" value={form.descripcion} onChange={v => setForm(p => ({ ...p, descripcion: v }))} placeholder="Ej: Ampliación tablero secundario" />
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 10 }}>
            <FInput label="Tarea" value={form.tarea} onChange={v => setForm(p => ({ ...p, tarea: v }))} placeholder="Ej: Pintura interior látex" />
            <FInput label="Cantidad" value={form.cantidad} onChange={set('cantidad')} type="number" />
            <FInput label="Unidad" value={form.unidad} onChange={v => setForm(p => ({ ...p, unidad: v }))} placeholder="m², u..." />
            <FInput label="Fecha" value={form.fecha} onChange={v => setForm(p => ({ ...p, fecha: v }))} type="date" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10, marginTop: 4 }}>
            <FInput label="Costo / unidad" value={form.costoUnit} onChange={set('costoUnit')} type="number" />
            <FInput label="Costo total" value={form.costoTotal} onChange={set('costoTotal')} type="number" />
            <FInput label="Venta / unidad (cliente)" value={form.valorVentaUnit} onChange={set('valorVentaUnit')} type="number" />
            <FInput label="Venta total (cliente)" value={form.valorVentaTotal} onChange={set('valorVentaTotal')} type="number" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto auto', gap: 10, marginTop: 8, alignItems: 'end' }}>
            <FInput label="Cant. proveedor MO" value={form.cantidadProveedor} onChange={v => setForm(p => ({ ...p, cantidadProveedor: v }))} type="number" placeholder="Si difiere de cant. cliente" />
            <FInput label="Costo/u proveedor MO" value={form.costoUnitProveedor} onChange={v => setForm(p => ({ ...p, costoUnitProveedor: v }))} type="number" />
            <FInput label="Monto prov. total" value={form.montoProveedor} onChange={v => setForm(p => ({ ...p, montoProveedor: v }))} type="number" placeholder="Opcional" />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: T.ink2, cursor: 'pointer', paddingBottom: 6 }}>
              <input type="checkbox" checked={!!form.aplicaAProveedor} onChange={e => setForm(p => ({ ...p, aplicaAProveedor: e.target.checked }))} />
              Aplica a proveedor MO
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: T.ink2, cursor: 'pointer', paddingBottom: 6 }}>
              <input type="checkbox" checked={form.aplicaACliente !== false} onChange={e => setForm(p => ({ ...p, aplicaACliente: e.target.checked }))} />
              Aplica a cliente
            </label>
          </div>
        </FormPanel>
      )}

      {detalle.adicionales.length === 0 ? (
        <div style={{ color: T.ink3, padding: 24, textAlign: 'center' }}>Sin adicionales registrados</div>
      ) : (
        <Box style={{ padding: 0, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: 820 }}>
            <thead>
              <tr>
                {thSpan('', 1, 'left')}
                {thSpan('Cantidad', 2, 'center')}
                {thSpan('Costo', 2, 'center')}
                {thSpan('Venta (cliente)', 2, 'center', true)}
                {thSpan('Proveedor', 1, 'center')}
                {thSpan('', 2, 'center')}
              </tr>
              <tr>
                <th style={{ ...colH, textAlign: 'left', minWidth: 180 }}>Descripción / Tarea</th>
                <th style={colH}>Cant.</th>
                <th style={colH}>Unidad</th>
                <th style={colH}>$/u</th>
                <th style={colH}>Total costo</th>
                <th style={{ ...colH, color: T.accent }}>$/u</th>
                <th style={{ ...colH, color: T.accent }}>Total venta</th>
                <th style={colH}>Monto prov.</th>
                <th style={{ ...colH, textAlign: 'center' }}>Estado</th>
                <th style={colH}></th>
              </tr>
            </thead>
            <tbody>
              {detalle.adicionales.map((a, i) => (
                <tr key={a.id} style={{ borderBottom: i < detalle.adicionales.length - 1 ? `1px solid ${T.faint2}` : 'none' }}>
                  <td style={{ ...colD, textAlign: 'left', maxWidth: 200 }}>
                    <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.descripcion}</div>
                    {a.tarea && a.tarea !== a.descripcion && <div style={{ fontSize: 10, color: T.ink3 }}>{a.tarea}</div>}
                    <div style={{ fontSize: 10, color: T.ink3 }}>{fmtD(a.fecha)}</div>
                  </td>
                  <td style={colD}>{a.cantidad != null ? fmtU(a.cantidad) : '—'}</td>
                  <td style={colD}>{a.unidad || '—'}</td>
                  <td style={colD}>{a.costoUnit != null ? fmtM(a.costoUnit, moneda) : '—'}</td>
                  <td style={{ ...colD, fontWeight: 600 }}>{a.costoTotal != null ? fmtM(a.costoTotal, moneda) : (a.monto ? fmtM(a.monto, moneda) : '—')}</td>
                  <td style={{ ...colD, color: T.accent }}>{a.valorVentaUnit != null ? fmtM(a.valorVentaUnit, moneda) : '—'}</td>
                  <td style={{ ...colD, fontWeight: 700, color: T.accent }}>{a.valorVentaTotal != null ? fmtM(a.valorVentaTotal, moneda) : '—'}</td>
                  <td style={{ ...colD, color: T.ink2 }}>
                    {a.montoProveedor != null ? fmtM(a.montoProveedor, moneda) : '—'}
                    {a.cantidadProveedor != null && a.cantidadProveedor !== a.cantidad && (
                      <div style={{ fontSize: 9, color: T.ink3 }}>{fmtQ(a.cantidadProveedor)} {a.unidad}</div>
                    )}
                  </td>
                  <td style={{ ...colD, textAlign: 'center' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                      <Chip ok={a.estado === 'aprobado'} warn={a.estado === 'pendiente'} accent={a.estado === 'rechazado'} style={{ fontSize: 10 }}>{a.estado}</Chip>
                      <div style={{ display: 'flex', gap: 3 }}>
                        {a.aplicaACliente !== false && <span title="Aplica a cliente" style={{ fontSize: 9, color: T.accent, background: T.faint, padding: '1px 4px', borderRadius: 3 }}>💰 cliente</span>}
                        {a.aplicaAProveedor && <span title="Aplica a proveedor MO" style={{ fontSize: 9, color: T.ink2, background: T.faint, padding: '1px 4px', borderRadius: 3 }}>{a.aplicadoAContrato ? '✓ contrato' : '🔧 prov'}</span>}
                      </div>
                    </div>
                  </td>
                  <td style={{ ...colD, textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      {a.estado === 'pendiente' && <>
                        <Btn sm onClick={() => setEstado(a.id, 'aprobado')}>✓</Btn>
                        <Btn sm style={{ color: T.accent, borderColor: T.accent }} onClick={() => setEstado(a.id, 'rechazado')}>✕</Btn>
                      </>}
                      {a.estado === 'aprobado' && a.aplicaAProveedor && !a.aplicadoAContrato && (
                        <Btn sm onClick={() => aplicarAContrato(a)} style={{ fontSize: 9 }}>→ MO</Btn>
                      )}
                      <Btn sm onClick={() => startEdit(a)}>✎</Btn>
                      <span style={{ color: T.accent, cursor: 'pointer', fontSize: 11, padding: '2px 4px' }} onClick={() => del(a.id)}>🗑</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Box>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 10: FINANCIACIÓN
// ─────────────────────────────────────────────────────────────────────────────
function TabFinanciacion({ obra, detalle, patch, moneda }) {
  const fin = detalle.financiacion || {};
  const [editingFin, setEditingFin] = useState(false);
  const [finForm, setFinForm] = useState({ interes: String(fin.interes || 0), notaPortal: fin.notaPortal || '' });
  const [addingCuota, setAddingCuota] = useState(false);
  const [cuotaForm, setCuotaForm] = useState({ descripcion: '', monto: '', fecha: '', n: '' });
  const [editCuotaId, setEditCuotaId] = useState(null);

  const { venta: ventaBase } = calcObra(detalle.rubros);
  const adicionalCliente = (detalle.adicionales || [])
    .filter(a => a.estado === 'aprobado')
    .reduce((s, a) => s + (a.valorVentaTotal ?? a.costoTotal ?? a.monto ?? 0), 0);
  const interes = parseFloat(fin.interes) || 0;
  const baseTotal = ventaBase + adicionalCliente;
  const totalConInteres = Math.round(baseTotal * (1 + interes / 100));

  const cuotas = detalle.cuotas || [];
  const totalCuotas = cuotas.reduce((s, c) => s + (c.monto || 0), 0);
  const cuotasPagadas = cuotas.filter(c => c.estado === 'pagado').reduce((s, c) => s + (c.monto || 0), 0);
  const saldoCuotas = totalCuotas - cuotasPagadas;
  const diferencia = totalConInteres - totalCuotas;

  const saveFin = () => {
    patch(d => ({ ...d, financiacion: { ...(d.financiacion || {}), interes: parseFloat(finForm.interes) || 0, notaPortal: finForm.notaPortal } }));
    setEditingFin(false);
  };

  const saveCuota = () => {
    const n = parseInt(cuotaForm.n) || cuotas.length + 1;
    const entry = { id: editCuotaId || newId(), n, descripcion: cuotaForm.descripcion || `Cuota ${n}`, monto: parseFloat(cuotaForm.monto) || 0, fecha: cuotaForm.fecha || '', estado: 'pendiente' };
    if (editCuotaId) {
      patch(d => ({ ...d, cuotas: d.cuotas.map(c => c.id === editCuotaId ? { ...c, ...entry } : c) }));
    } else {
      patch(d => ({ ...d, cuotas: [...(d.cuotas || []), entry] }));
    }
    setAddingCuota(false); setEditCuotaId(null); setCuotaForm({ descripcion: '', monto: '', fecha: '', n: '' });
  };

  const startEditCuota = (c) => {
    setCuotaForm({ descripcion: c.descripcion || '', monto: String(c.monto || ''), fecha: c.fecha || '', n: String(c.n || '') });
    setEditCuotaId(c.id); setAddingCuota(true);
  };

  const togglePago = (id) => patch(d => ({ ...d, cuotas: d.cuotas.map(c => c.id === id ? { ...c, estado: c.estado === 'pagado' ? 'pendiente' : 'pagado' } : c) }));
  const delCuota = (id) => patch(d => ({ ...d, cuotas: d.cuotas.filter(c => c.id !== id) }));

  const distribuirEnCuotas = (n) => {
    if (!n || !totalConInteres) return;
    const montoCuota = Math.round(totalConInteres / n);
    const nuevas = Array.from({ length: n }, (_, i) => ({
      id: newId(), n: i + 1,
      descripcion: `Cuota ${i + 1} de ${n}`,
      monto: i === n - 1 ? totalConInteres - montoCuota * (n - 1) : montoCuota,
      fecha: '', estado: 'pendiente',
    }));
    patch(d => ({ ...d, cuotas: [...(d.cuotas || []), ...nuevas] }));
  };

  const statSt = { display: 'flex', flexDirection: 'column', gap: 3 };
  const kSt = { fontSize: 10, color: T.ink3, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6 };
  const vSt = { fontSize: 16, fontWeight: 800, fontFamily: T.fontMono, color: T.ink };

  return (
    <div style={{ maxWidth: 860, display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Resumen financiero */}
      <Box style={{ padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: T.ink }}>Resumen financiero</div>
          <Btn sm onClick={() => { setFinForm({ interes: String(fin.interes || 0), notaPortal: fin.notaPortal || '' }); setEditingFin(true); }}>✎ Editar</Btn>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 16, marginBottom: 16 }}>
          <div style={statSt}><div style={kSt}>Presupuesto venta</div><div style={vSt}>{fmtM(ventaBase, moneda)}</div></div>
          <div style={statSt}><div style={kSt}>Adicionales (cliente)</div><div style={{ ...vSt, color: adicionalCliente > 0 ? T.accent : T.ink }}>{fmtM(adicionalCliente, moneda)}</div></div>
          <div style={statSt}><div style={kSt}>Interés aplicado</div><div style={{ ...vSt, color: interes > 0 ? T.warn : T.ink3 }}>{interes > 0 ? `${interes}%` : '—'}</div></div>
          <div style={{ ...statSt, borderLeft: `3px solid ${T.accent}`, paddingLeft: 12 }}>
            <div style={kSt}>Total cliente</div>
            <div style={{ ...vSt, color: T.accent, fontSize: 20 }}>{fmtM(totalConInteres, moneda)}</div>
          </div>
        </div>

        {editingFin && (
          <FormPanel title="Configurar financiación" onSave={saveFin} onCancel={() => setEditingFin(false)} style={{ marginTop: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
              <FInput label="Interés (%)" value={finForm.interes} onChange={v => setFinForm(p => ({ ...p, interes: v }))} type="number" placeholder="0" />
              <FInput label="Nota para portal del cliente" value={finForm.notaPortal} onChange={v => setFinForm(p => ({ ...p, notaPortal: v }))} placeholder="Ej: Plan de pagos acordado el 01/01/2025" />
            </div>
          </FormPanel>
        )}

        {fin.notaPortal && (
          <div style={{ marginTop: 12, padding: '8px 12px', background: T.faint, borderRadius: 5, fontSize: 12, color: T.ink2, borderLeft: `3px solid ${T.accent}` }}>
            📋 Nota portal: {fin.notaPortal}
          </div>
        )}
      </Box>

      {/* Plan de cuotas */}
      <Box style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 18px', background: T.faint, borderBottom: `1px solid ${T.faint2}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: T.ink }}>Plan de cuotas</div>
            {cuotas.length > 0 && (
              <div style={{ fontSize: 11, color: T.ink3, marginTop: 2, fontFamily: T.fontMono }}>
                {fmtM(cuotasPagadas, moneda)} cobrado · {fmtM(saldoCuotas, moneda)} saldo
                {Math.abs(diferencia) > 10 && (
                  <span style={{ color: diferencia > 0 ? T.warn : T.ok, marginLeft: 10 }}>
                    {diferencia > 0 ? `⚠ faltan $ ${fmtN(diferencia)} en cuotas` : `✓ $ ${fmtN(Math.abs(diferencia))} extra en cuotas`}
                  </span>
                )}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {cuotas.length === 0 && totalConInteres > 0 && (
              <>
                {[2, 3, 4, 6, 12].map(n => (
                  <Btn key={n} sm onClick={() => distribuirEnCuotas(n)}>{n}×</Btn>
                ))}
              </>
            )}
            <Btn sm fill onClick={() => { setAddingCuota(true); setEditCuotaId(null); setCuotaForm({ descripcion: '', monto: '', fecha: '', n: String(cuotas.length + 1) }); }}>+ Cuota</Btn>
          </div>
        </div>

        {addingCuota && (
          <div style={{ padding: '12px 18px', borderBottom: `1px solid ${T.faint2}` }}>
            <FormPanel title={editCuotaId ? 'Editar cuota' : 'Nueva cuota'} onSave={saveCuota} onCancel={() => { setAddingCuota(false); setEditCuotaId(null); }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 1fr', gap: 10 }}>
                <FInput label="N°" value={cuotaForm.n} onChange={v => setCuotaForm(p => ({ ...p, n: v }))} type="number" />
                <FInput label="Descripción" value={cuotaForm.descripcion} onChange={v => setCuotaForm(p => ({ ...p, descripcion: v }))} placeholder="Ej: Anticipo / Cuota 1 de 6..." />
                <FInput label="Monto" value={cuotaForm.monto} onChange={v => setCuotaForm(p => ({ ...p, monto: v }))} type="number" />
                <FInput label="Fecha de pago" value={cuotaForm.fecha} onChange={v => setCuotaForm(p => ({ ...p, fecha: v }))} type="date" />
              </div>
            </FormPanel>
          </div>
        )}

        {cuotas.length === 0 && !addingCuota ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: T.ink3, fontSize: 13 }}>
            Sin cuotas. Usá los botones "2×", "3×"… para distribuir automáticamente, o agregá una por una.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: T.faint }}>
                <th style={{ ...colH2, textAlign: 'center', width: 40 }}>#</th>
                <th style={{ ...colH2, textAlign: 'left' }}>Descripción</th>
                <th style={colH2}>Monto</th>
                <th style={colH2}>Fecha</th>
                <th style={{ ...colH2, textAlign: 'center' }}>Estado</th>
                <th style={colH2}></th>
              </tr>
            </thead>
            <tbody>
              {cuotas.map((c, i) => (
                <tr key={c.id} style={{ borderBottom: i < cuotas.length - 1 ? `1px solid ${T.faint2}` : 'none' }}>
                  <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: T.ink2 }}>{c.n}</td>
                  <td style={{ padding: '10px 12px', fontSize: 12, color: T.ink }}>{c.descripcion}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: T.fontMono, fontSize: 13, fontWeight: 700, color: c.estado === 'pagado' ? T.ok : T.ink }}>{fmtM(c.monto, moneda)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, color: T.ink3 }}>{fmtD(c.fecha)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                    <Chip ok={c.estado === 'pagado'} warn={c.estado === 'pendiente'} accent={c.estado === 'proximo'} style={{ fontSize: 10, cursor: 'pointer' }} onClick={() => togglePago(c.id)}>
                      {c.estado === 'pagado' ? '✓ pagado' : c.estado === 'proximo' ? 'próximo' : 'pendiente'}
                    </Chip>
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      <Btn sm onClick={() => startEditCuota(c)}>✎</Btn>
                      <span style={{ color: T.accent, cursor: 'pointer', padding: '2px 4px', fontSize: 11 }} onClick={() => delCuota(c.id)}>🗑</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            {cuotas.length > 1 && (
              <tfoot>
                <tr style={{ background: T.faint }}>
                  <td colSpan={2} style={{ padding: '8px 12px', fontSize: 11, fontWeight: 700, color: T.ink3 }}>TOTAL</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: T.fontMono, fontSize: 13, fontWeight: 800, color: T.ink }}>{fmtM(totalCuotas, moneda)}</td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </Box>
    </div>
  );
}
const colH2 = { fontSize: 10, fontWeight: 700, color: T.ink3, padding: '6px 12px', textAlign: 'right', borderBottom: `1px solid ${T.faint2}` };

// ─────────────────────────────────────────────────────────────────────────────
// TAB 3: MOVIMIENTOS (connected to MovimientosContext)
// ─────────────────────────────────────────────────────────────────────────────
const inputStMov = { padding: '6px 10px', border: `1.2px solid ${T.faint2}`, borderRadius: 4, fontFamily: T.font, fontSize: 12, background: T.paper, boxSizing: 'border-box', outline: 'none' };
const fmtFechaShort = (iso) => { if (!iso) return ''; const [, m, d] = iso.split('-'); return `${d}/${m}`; };
const todayStrOp = () => new Date().toISOString().split('T')[0];

function ObraMovRow({ m, cajas, onRemove }) {
  const [hover, setHover] = useState(false);
  const navigate = useNavigate();
  const { proveedores: provsList } = useProveedores();
  const caja = cajas.find(c => c.id === m.cajaId);
  const isIngreso = m.tipo === 'ingreso';
  const cajaIsUSD = caja?.moneda === 'USD';
  const simbolo = cajaIsUSD ? 'USD' : '$';

  return (
    <div
      style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', borderBottom: `1px solid ${T.faint2}`, fontSize: 12, background: hover ? T.faint : 'transparent', transition: 'background .1s', gap: 8 }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}>
      <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.ink3, width: 32, flexShrink: 0 }}>{fmtFechaShort(m.fecha)}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.descripcion}</div>
        <div style={{ fontSize: 10, color: T.ink3, display: 'flex', gap: 5, marginTop: 1 }}>
          {caja && <span>{caja.nombre}</span>}
          {m.proveedor && (() => {
            const prov = m.proveedorId ? provsList.find(p => p.id === m.proveedorId) : provsList.find(p => p.nombre === m.proveedor);
            return prov
              ? <span style={{ color: T.accent, cursor: 'pointer', textDecoration: 'underline' }} onClick={e => { e.stopPropagation(); navigate(`/proveedores/${prov.id}`); }}>· {m.proveedor}</span>
              : <span>· {m.proveedor}</span>;
          })()}
          {m.medioPago && m.medioPago !== 'Transferencia' && <span>· {m.medioPago}</span>}
        </div>
      </div>
      <span style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 13, color: isIngreso ? T.ok : T.warn, flexShrink: 0 }}>
        {isIngreso ? '+' : '−'}{simbolo} {fmtN(m.monto)}
      </span>
      <span style={{ width: 16, flexShrink: 0 }}>
        {hover && (
          <span style={{ color: T.ink3, cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
            onClick={() => { if (confirm('¿Eliminar este movimiento?')) onRemove(m.id); }}>×</span>
        )}
      </span>
    </div>
  );
}

function ObraQuickAddForm({ tipo, cajas, proveedores, clientes, dolarVenta, obraId, obraNombre, obraMoneda, onSave, onCancel }) {
  const isGasto = tipo === 'gasto';
  const color = isGasto ? T.warn : T.ok;
  const navigate = useNavigate();

  const [desc,          setDesc]          = useState('');
  const [monto,         setMonto]         = useState('');
  const [fecha,         setFecha]         = useState(todayStrOp);
  const [medio,         setMedio]         = useState('Transferencia');
  const [contraparteId, setContraparteId] = useState('');
  const [monedaIngreso, setMonedaIngreso] = useState(() => obraMoneda === 'USD' ? 'USD' : 'ARS');
  const [monedaGasto,   setMonedaGasto]   = useState('ARS');
  const [montoDolar,    setMontoDolar]    = useState('');
  const [tipoCambio,    setTipoCambio]    = useState(() => String(Math.round(dolarVenta || 1070)));

  const monedaActual = isGasto ? monedaGasto : (monedaIngreso === 'USD' ? 'USD' : 'ARS');
  const cajasMoneda  = cajas.filter(c => c.activa && c.moneda === monedaActual);
  const cajaIsUSD    = monedaActual === 'USD';
  const [cajaId, setCajaId] = useState(() => cajas.filter(c => c.activa && c.moneda === 'ARS')[0]?.id || '');

  useEffect(() => {
    const firstMatch = cajas.filter(c => c.activa && c.moneda === monedaActual)[0];
    if (firstMatch) setCajaId(firstMatch.id);
  }, [monedaActual]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsedMonto = parseFloat(monto.replace(/[^0-9.]/g, '')) || 0;
  const parsedDolar = parseFloat(montoDolar.replace(/[^0-9.]/g, '')) || 0;
  const parsedTC    = parseFloat(tipoCambio.replace(/[^0-9.]/g, '')) || dolarVenta || 1070;

  const montoFinal = (!isGasto && monedaIngreso === 'USD_ARS')
    ? Math.round(parsedDolar * parsedTC)
    : Math.round(parsedMonto);

  const canSave = montoFinal > 0 && desc.trim().length > 0;

  const save = () => {
    if (!canSave) return;
    const effectiveCajaId = cajasMoneda.find(c => c.id === cajaId) ? cajaId : cajasMoneda[0]?.id || cajaId;
    let contraparteName = '';
    const extra = {};
    if (isGasto) {
      const prov = proveedores.find(p => p.id === contraparteId);
      contraparteName = prov?.nombre || '';
      extra.proveedorId = contraparteId || null;
    } else {
      const cli = clientes.find(c => c.id === contraparteId);
      contraparteName = cli?.nombre || '';
      extra.clienteId = contraparteId || null;
      if (monedaIngreso === 'USD_ARS') {
        extra.tipoCambio = parsedTC;
        extra.montoDolar = parsedDolar;
      }
    }
    onSave({
      tipo,
      descripcion: desc.trim(),
      monto: montoFinal,
      fecha,
      obraId,
      obraNombre,
      cajaId: effectiveCajaId,
      cajaDestinoId: null,
      proveedor: contraparteName,
      categoria: isGasto ? 'general' : 'cobro-cliente',
      medioPago: medio,
      referencia: '',
      fondoReparo: false,
      ...extra,
    });
    setDesc(''); setMonto(''); setMontoDolar(''); setContraparteId('');
  };

  const onKey = (e) => {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') onCancel();
  };

  return (
    <div style={{ padding: '12px 14px', background: isGasto ? 'rgba(212,146,58,.07)' : 'rgba(61,122,74,.07)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input autoFocus style={{ ...inputStMov, flex: 1 }}
          value={desc} onChange={e => setDesc(e.target.value)} onKeyDown={onKey}
          placeholder={isGasto ? 'Descripción del gasto…' : 'Descripción del ingreso…'} />
        {!isGasto && monedaIngreso === 'USD_ARS' ? (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
            <input style={{ ...inputStMov, width: 90, fontFamily: T.fontMono, fontWeight: 700 }}
              type="number" min="0" placeholder="USD"
              value={montoDolar} onChange={e => setMontoDolar(e.target.value)} onKeyDown={onKey} />
            <span style={{ fontSize: 11, color: T.ink3 }}>× TC</span>
            <input style={{ ...inputStMov, width: 85, fontFamily: T.fontMono }}
              type="number" min="0" placeholder="TC"
              value={tipoCambio} onChange={e => setTipoCambio(e.target.value)} onKeyDown={onKey} />
            <span style={{ fontSize: 11, color: T.ink3 }}>=</span>
            <div style={{ ...inputStMov, width: 105, fontFamily: T.fontMono, fontWeight: 700, color: T.ok, background: T.faint, display: 'flex', alignItems: 'center', cursor: 'default' }}>
              $ {montoFinal > 0 ? fmtN(montoFinal) : '0'}
            </div>
          </div>
        ) : (
          <input style={{ ...inputStMov, width: 130, fontFamily: T.fontMono, fontWeight: 700 }}
            type="number" min="0" placeholder={cajaIsUSD ? 'USD' : '$ Monto'}
            value={monto} onChange={e => setMonto(e.target.value)} onKeyDown={onKey} />
        )}
        <input type="date" style={{ ...inputStMov, width: 140 }}
          value={fecha} onChange={e => setFecha(e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1.4, gap: 2 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>{isGasto ? 'Proveedor' : 'Cliente'}</span>
            {isGasto && contraparteId && (
              <span style={{ fontSize: 10, color: T.accent, cursor: 'pointer', textDecoration: 'underline' }}
                onClick={() => navigate(`/proveedores/${contraparteId}`)}>Ver CC →</span>
            )}
          </div>
          <select style={{ ...inputStMov, cursor: 'pointer', width: '100%' }}
            value={contraparteId} onChange={e => setContraparteId(e.target.value)}>
            <option value="">{isGasto ? '— Sin proveedor' : '— Sin cliente'}</option>
            {isGasto
              ? proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}{p.tipo ? ` · ${p.tipo}` : ''}</option>)
              : clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}{c.empresa ? ` · ${c.empresa}` : ''}</option>)
            }
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Moneda</span>
          {isGasto ? (
            <select style={{ ...inputStMov, width: 110, cursor: 'pointer' }}
              value={monedaGasto} onChange={e => setMonedaGasto(e.target.value)}>
              <option value="ARS">Pesos (ARS)</option>
              <option value="USD">Dólares (USD)</option>
            </select>
          ) : (
            <select style={{ ...inputStMov, width: 110, cursor: 'pointer' }}
              value={monedaIngreso} onChange={e => setMonedaIngreso(e.target.value)}>
              {obraMoneda !== 'USD' && <option value="ARS">Pesos (ARS)</option>}
              <option value="USD">Dólares (USD)</option>
              <option value="USD_ARS">USD → Pesos</option>
            </select>
          )}
        </div>
        <select style={{ ...inputStMov, flex: 1, cursor: 'pointer' }}
          value={cajasMoneda.find(c => c.id === cajaId) ? cajaId : cajasMoneda[0]?.id || ''}
          onChange={e => setCajaId(e.target.value)}>
          {cajasMoneda.length === 0
            ? <option value="">Sin cajas {monedaActual}</option>
            : cajasMoneda.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)
          }
        </select>
        <select style={{ ...inputStMov, width: 120, cursor: 'pointer' }} value={medio} onChange={e => setMedio(e.target.value)}>
          {['Transferencia','Efectivo','Cheque','E-cheq','Débito','Tarjeta'].map(v => <option key={v}>{v}</option>)}
        </select>
        <Btn sm onClick={onCancel}>✕</Btn>
        <button onClick={save}
          style={{ padding: '6px 16px', borderRadius: 4, border: 'none', fontFamily: T.font, fontWeight: 700, fontSize: 12, cursor: canSave ? 'pointer' : 'not-allowed', background: canSave ? color : T.faint2, color: canSave ? '#fff' : T.ink3, transition: 'background .15s', flexShrink: 0 }}>
          ↵ Guardar
        </button>
      </div>
      <div style={{ fontSize: 10, color: T.ink3 }}>Enter guarda · Esc cierra</div>
    </div>
  );
}

function ObraPanel({ tipo, movs, cajas, proveedores, clientes, dolarVenta, obraId, obraNombre, obraMoneda, addMovimiento, removeMovimiento }) {
  const [open, setOpen] = useState(false);
  const isIngreso = tipo === 'ingreso';
  const color = isIngreso ? T.ok : T.warn;
  const label = isIngreso ? 'Ingresos' : 'Gastos';
  const arrow = isIngreso ? '↑' : '↓';
  const total = movs.reduce((s, m) => s + m.monto, 0);

  return (
    <Box style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '9px 14px', background: isIngreso ? 'rgba(61,122,74,.1)' : 'rgba(212,146,58,.1)', borderBottom: `2px solid ${color}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontWeight: 800, color, fontSize: 14 }}>{arrow} {label}</span>
          <span style={{ fontSize: 11, color: T.ink3 }}>{movs.length} registros</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: T.fontMono, fontWeight: 800, color, fontSize: 15 }}>$ {fmtN(total)}</span>
          <button onClick={() => setOpen(o => !o)}
            style={{ padding: '4px 12px', borderRadius: 4, border: `1.5px solid ${color}`, background: open ? color : 'transparent', color: open ? '#fff' : color, fontFamily: T.font, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
            {open ? '✕ Cerrar' : `+ ${isIngreso ? 'Ingreso' : 'Gasto'}`}
          </button>
        </div>
      </div>
      {open && (
        <ObraQuickAddForm
          tipo={tipo}
          cajas={cajas}
          proveedores={proveedores}
          clientes={clientes}
          dolarVenta={dolarVenta}
          obraId={obraId}
          obraNombre={obraNombre}
          obraMoneda={obraMoneda}
          onSave={(data) => addMovimiento(data)}
          onCancel={() => setOpen(false)}
        />
      )}
      <div style={{ overflow: 'auto', maxHeight: 460 }}>
        {movs.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: T.ink3, fontSize: 12 }}>
            Sin {label.toLowerCase()} registrados
            <div style={{ marginTop: 8 }}>
              <button onClick={() => setOpen(true)}
                style={{ padding: '5px 14px', borderRadius: 4, border: `1px solid ${color}`, background: 'transparent', color, fontFamily: T.font, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                + Registrar {isIngreso ? 'ingreso' : 'gasto'}
              </button>
            </div>
          </div>
        )}
        {movs.map(m => <ObraMovRow key={m.id} m={m} cajas={cajas} onRemove={removeMovimiento} />)}
      </div>
    </Box>
  );
}

function TabMovimientos({ obra, moneda }) {
  const { movimientos, cajas, addMovimiento, removeMovimiento } = useMovimientos();
  const { proveedores } = useProveedores();
  const { clientes }    = useClientes();
  const { dolarVenta }  = useDolar();
  const navigate        = useNavigate();

  const movsObra = useMemo(() =>
    movimientos.filter(m => m.obraId === obra.id).sort((a, b) => b.fecha.localeCompare(a.fecha)),
    [movimientos, obra.id]);
  const ingresos = useMemo(() => movsObra.filter(m => m.tipo === 'ingreso'), [movsObra]);
  const gastos   = useMemo(() => movsObra.filter(m => m.tipo === 'gasto'),   [movsObra]);

  const totalIngresos = ingresos.reduce((s, m) => s + m.monto, 0);
  const totalGastos   = gastos.reduce((s, m) => s + m.monto, 0);
  const neto          = totalIngresos - totalGastos;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: T.accent, cursor: 'pointer', textDecoration: 'underline' }}
          onClick={() => navigate(`/movimientos?obra=${obra.id}`)}>
          Ver todos en Movimientos →
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 14 }}>
        <Box style={{ padding: '10px 16px' }}>
          <div style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Ingresos</div>
          <div style={{ fontSize: 20, fontWeight: 800, fontFamily: T.fontMono, color: T.ok, marginTop: 2 }}>$ {fmtN(totalIngresos)}</div>
        </Box>
        <Box style={{ padding: '10px 16px' }}>
          <div style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Gastos</div>
          <div style={{ fontSize: 20, fontWeight: 800, fontFamily: T.fontMono, color: T.warn, marginTop: 2 }}>$ {fmtN(totalGastos)}</div>
        </Box>
        <Box style={{ padding: '10px 16px' }}>
          <div style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Neto</div>
          <div style={{ fontSize: 20, fontWeight: 800, fontFamily: T.fontMono, color: neto >= 0 ? T.ok : T.warn, marginTop: 2 }}>$ {fmtN(neto)}</div>
        </Box>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <ObraPanel
          tipo="ingreso"
          movs={ingresos}
          cajas={cajas}
          proveedores={proveedores}
          clientes={clientes}
          dolarVenta={dolarVenta}
          obraId={obra.id}
          obraNombre={obra.nombre}
          obraMoneda={obra.moneda}
          addMovimiento={addMovimiento}
          removeMovimiento={removeMovimiento}
        />
        <ObraPanel
          tipo="gasto"
          movs={gastos}
          cajas={cajas}
          proveedores={proveedores}
          clientes={clientes}
          dolarVenta={dolarVenta}
          obraId={obra.id}
          obraNombre={obra.nombre}
          obraMoneda={obra.moneda}
          addMovimiento={addMovimiento}
          removeMovimiento={removeMovimiento}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 4: CUENTA CLIENTE
// ─────────────────────────────────────────────────────────────────────────────
function TabCuentaCliente({ detalle, patch, moneda, obra }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ descripcion: '', fecha: '', monto: '' });
  const navigate = useNavigate();

  const total = detalle.cuotas.reduce((s, c) => s + c.monto, 0);
  const cobrado = detalle.cuotas.filter(c => c.estado === 'pagado').reduce((s, c) => s + c.monto, 0);

  const save = () => {
    if (!form.descripcion.trim() || !form.monto) return;
    const n = detalle.cuotas.length + 1;
    patch(d => ({ ...d, cuotas: [...d.cuotas, { id: newId(), n, ...form, monto: +form.monto, estado: 'pendiente' }] }));
    setAdding(false);
    setForm({ descripcion: '', fecha: '', monto: '' });
  };

  const marcarPagado = (id) => patch(d => ({ ...d, cuotas: d.cuotas.map(c => c.id === id ? { ...c, estado: 'pagado' } : c) }));
  const del = (id) => patch(d => ({ ...d, cuotas: d.cuotas.filter(c => c.id !== id) }));

  return (
    <div style={{ maxWidth: 700 }}>
      {obra?.cliente && (
        <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <span style={{ color: T.ink2 }}>Cliente:</span>
          <span style={{ color: T.accent, cursor: 'pointer', fontWeight: 700, textDecoration: 'underline' }}
            onClick={() => navigate(`/clientes?q=${encodeURIComponent(obra.cliente)}`)}>
            {obra.cliente}
          </span>
        </div>
      )}
      <div style={{ display: 'flex', gap: 14, padding: '10px 14px', background: '#f6efd9', borderRadius: 4, marginBottom: 14 }}>
        <Stat label="Total contratado" value={fmtM(total, moneda)} />
        <Stat label="Cobrado" value={fmtM(cobrado, moneda)} />
        <Stat label="Pendiente" value={fmtM(total - cobrado, moneda)} accent={total - cobrado > 0} />
        <Stat label="Cuotas" value={`${detalle.cuotas.filter(c => c.estado === 'pagado').length} / ${detalle.cuotas.length}`} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <Btn sm fill onClick={() => setAdding(true)}>+ Cuota</Btn>
      </div>

      {adding && (
        <FormPanel title="Nueva cuota" onSave={save} onCancel={() => setAdding(false)} style={{ marginBottom: 12 }}>
          <FInput label="Descripción" value={form.descripcion} onChange={v => setForm(p => ({ ...p, descripcion: v }))} placeholder="Ej: Al 70% de avance" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <FInput label="Monto" value={form.monto} onChange={v => setForm(p => ({ ...p, monto: v }))} type="number" />
            <FInput label="Fecha estimada" value={form.fecha} onChange={v => setForm(p => ({ ...p, fecha: v }))} type="date" />
          </div>
        </FormPanel>
      )}

      <Box style={{ padding: 0, overflow: 'hidden' }}>
        {detalle.cuotas.length === 0 ? <div style={{ padding: 20, color: T.ink3, fontSize: 12, textAlign: 'center' }}>Sin cuotas</div> : detalle.cuotas.map((c, i) => (
          <div key={c.id} style={{ display: 'flex', alignItems: 'center', padding: '12px 14px', borderBottom: i < detalle.cuotas.length - 1 ? `1px solid ${T.faint2}` : 'none', gap: 12 }}>
            <div style={{ width: 28, height: 28, borderRadius: 14, background: c.estado === 'pagado' ? T.ok : c.estado === 'proximo' ? T.accent : T.faint2, display: 'flex', alignItems: 'center', justifyContent: 'center', color: c.estado !== 'pendiente' ? 'white' : T.ink3, fontWeight: 800, fontSize: 12, flexShrink: 0 }}>{c.n}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{c.descripcion}</div>
              {c.fecha && <div style={{ fontSize: 11, color: T.ink2 }}>{fmtD(c.fecha)}</div>}
            </div>
            <div style={{ fontFamily: T.fontMono, fontWeight: 700, fontSize: 14 }}>{fmtM(c.monto, moneda)}</div>
            <Chip ok={c.estado === 'pagado'} accent={c.estado === 'proximo'} style={{ fontSize: 10 }}>{c.estado}</Chip>
            {(c.estado === 'pendiente' || c.estado === 'proximo') && (
              <Btn sm onClick={() => marcarPagado(c.id)}>✓ Marcar pagado</Btn>
            )}
            <span style={{ color: T.accent, cursor: 'pointer', fontSize: 12 }} onClick={() => del(c.id)}>🗑</span>
          </div>
        ))}
      </Box>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 5: CONTRATOS MO
// ─────────────────────────────────────────────────────────────────────────────
const FORM_INIT = { rubroId: '', gremio: '', proveedor: '', cuit: '', fechaInicio: '', fechaFin: '', fondoReparo: 5, formaPago: 'Por avance certificado mensualmente', tareasSel: {} };

function TabContratosMO({ detalle, patch, moneda, obra }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(FORM_INIT);
  const [formError, setFormError] = useState('');
  const [printContrato, setPrintContrato] = useState(null);
  const { proveedores: proveedoresDyn } = useProveedores();
  const navigate = useNavigate();

  const rubros = detalle.rubros || [];
  const contratos = detalle.contratos || [];

  const rubroSel = rubros.find(r => r.id === form.rubroId) || null;

  const tareasDisponibles = rubroSel
    ? (rubroSel.tareas || []).filter(t => t.tipo !== 'seccion' && calcTareaContratada(t.id, contratos) < (t.cantidad || 0))
    : [];

  const onRubroChange = (rubroId) => {
    const r = rubros.find(x => x.id === rubroId);
    setForm(p => ({ ...p, rubroId, gremio: r?.nombre || '', tareasSel: {} }));
    setFormError('');
  };

  const onTareaToggle = (t) => {
    setForm(p => {
      if (p.tareasSel[t.id]) {
        const next = { ...p.tareasSel };
        delete next[t.id];
        return { ...p, tareasSel: next };
      }
      const disponible = t.cantidad - calcTareaContratada(t.id, contratos);
      return { ...p, tareasSel: { ...p.tareasSel, [t.id]: { cantidad: disponible, precioUnit: Math.round(t.costoSub || t.costoMO) || 0 } } };
    });
  };

  const totalContrato = Object.values(form.tareasSel).reduce((s, v) => s + (v.cantidad || 0) * (v.precioUnit || 0), 0);

  const save = () => {
    if (!form.rubroId) { setFormError('Seleccioná un rubro'); return; }
    if (!form.proveedor.trim()) { setFormError('Ingresá el nombre del contratista'); return; }
    if (!rubroSel) { setFormError('El rubro seleccionado ya no existe'); return; }
    setFormError('');
    const tareas = Object.entries(form.tareasSel)
      .filter(([, v]) => (v.cantidad || 0) > 0)
      .map(([tareaId, v]) => {
        const t = (rubroSel.tareas || []).find(x => x.id === tareaId);
        if (!t) return null;
        return { tareaId, rubroId: form.rubroId, nombre: t.nombre, unidad: t.unidad, cantidadTotal: t.cantidad, cantidadContratada: +v.cantidad, precioUnit: +v.precioUnit };
      })
      .filter(Boolean);
    patch(d => ({ ...d, contratos: [...(d.contratos || []), { id: newId(), gremio: form.gremio, rubroId: form.rubroId, proveedor: form.proveedor, cuit: form.cuit, fechaInicio: form.fechaInicio, fechaFin: form.fechaFin, fondoReparo: +form.fondoReparo, formaPago: form.formaPago, estado: 'activo', tareas, monto: totalContrato }] }));
    setAdding(false);
    setForm(FORM_INIT);
  };

  const toggleEstado = (id) => patch(d => ({ ...d, contratos: d.contratos.map(c => c.id === id ? { ...c, estado: c.estado === 'activo' ? 'cerrado' : 'activo' } : c) }));
  const del = (id) => patch(d => ({ ...d, contratos: d.contratos.filter(c => c.id !== id) }));

  return (
    <div style={{ maxWidth: 800 }}>
      {printContrato && <ContratoMOModal contrato={printContrato} obra={obra} onClose={() => setPrintContrato(null)} />}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <Btn sm fill onClick={() => setAdding(true)}>+ Contrato MO</Btn>
      </div>

      {adding && (
        <FormPanel title="Nuevo contrato MO" onSave={save} onCancel={() => { setAdding(false); setForm(FORM_INIT); setFormError(''); }} style={{ marginBottom: 14 }}>
          {formError && <div style={{ color: '#dc2626', fontSize: 12, fontWeight: 600, padding: '4px 0' }}>{formError}</div>}
          {/* Fila 1: gremio + proveedor + cuit */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <FRow label="Gremio / rubro">
              <select style={{ ...inputSt, cursor: 'pointer' }} value={form.rubroId} onChange={e => onRubroChange(e.target.value)}>
                <option value="">— Seleccionar rubro —</option>
                {rubros.map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}
              </select>
            </FRow>
            <FRow label="Proveedor / contratista">
              <input
                list="contrato-prov-list"
                style={inputSt}
                placeholder="Nombre del contratista"
                value={form.proveedor}
                onChange={e => {
                  const prov = proveedoresDyn.find(p => p.nombre === e.target.value);
                  setForm(p => ({ ...p, proveedor: e.target.value, cuit: prov?.cuit || p.cuit }));
                }}
              />
              <datalist id="contrato-prov-list">
                {proveedoresDyn.map(p => <option key={p.id} value={p.nombre} />)}
              </datalist>
            </FRow>
            <FInput label="CUIT contratista" value={form.cuit} onChange={v => setForm(p => ({ ...p, cuit: v }))} placeholder="20-XXXXXXXX-X" />
          </div>

          {/* Fila 2: fechas + fondo */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 0.6fr 1fr', gap: 10 }}>
            <FInput label="Fecha inicio" value={form.fechaInicio} onChange={v => setForm(p => ({ ...p, fechaInicio: v }))} type="date" />
            <FInput label="Fecha fin" value={form.fechaFin} onChange={v => setForm(p => ({ ...p, fechaFin: v }))} type="date" />
            <FInput label="Fondo reparo %" value={form.fondoReparo} onChange={v => setForm(p => ({ ...p, fondoReparo: v }))} type="number" />
            <FInput label="Forma de pago" value={form.formaPago} onChange={v => setForm(p => ({ ...p, formaPago: v }))} />
          </div>

          {/* Selección de tareas */}
          {rubroSel && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Tareas disponibles — {rubroSel.nombre}
                </div>
                {tareasDisponibles.length > 0 && (
                  <span style={{ fontSize: 10, color: T.accent, cursor: 'pointer', fontWeight: 700 }}
                    onClick={() => {
                      const allSel = tareasDisponibles.every(t => form.tareasSel[t.id]);
                      if (allSel) {
                        setForm(p => ({ ...p, tareasSel: {} }));
                      } else {
                        const next = { ...form.tareasSel };
                        tareasDisponibles.forEach(t => {
                          if (!next[t.id]) {
                            const disponible = t.cantidad - calcTareaContratada(t.id, contratos);
                            next[t.id] = { cantidad: disponible, precioUnit: Math.round(t.costoSub || t.costoMO) || 0 };
                          }
                        });
                        setForm(p => ({ ...p, tareasSel: next }));
                      }
                    }}>
                    {tareasDisponibles.every(t => form.tareasSel[t.id]) ? 'Deseleccionar todo' : 'Seleccionar todo'}
                  </span>
                )}
              </div>
              {tareasDisponibles.length === 0 ? (
                <div style={{ fontSize: 12, color: T.ink3, padding: '8px 0' }}>Todas las tareas de este rubro ya están completamente contratadas.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {tareasDisponibles.map(t => {
                    const contratado = calcTareaContratada(t.id, contratos);
                    const disponible = t.cantidad - contratado;
                    const sel = form.tareasSel[t.id];
                    return (
                      <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', background: sel ? T.accentSoft : T.faint, borderRadius: 4, border: `1px solid ${sel ? T.accent : T.faint2}` }}>
                        <input type="checkbox" checked={!!sel} onChange={() => onTareaToggle(t)} style={{ accentColor: T.accent, cursor: 'pointer', flexShrink: 0 }} />
                        <span style={{ flex: 3, fontSize: 12 }}>{t.nombre}</span>
                        <span style={{ fontSize: 10, color: T.ink3, fontFamily: T.fontMono, whiteSpace: 'nowrap' }}>{t.unidad} · disp: {disponible}/{t.cantidad}</span>
                        {sel && (<>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            <span style={{ fontSize: 9, color: T.ink3 }}>Cant.</span>
                            <input type="number" value={sel.cantidad} min="0" max={disponible}
                              onChange={e => setForm(p => ({ ...p, tareasSel: { ...p.tareasSel, [t.id]: { ...sel, cantidad: +e.target.value } } }))}
                              style={{ width: 64, padding: '2px 6px', border: `1px solid ${T.accent}`, borderRadius: 3, fontFamily: T.fontMono, fontSize: 12, textAlign: 'right' }} />
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            <span style={{ fontSize: 9, color: T.ink3 }}>$ Unit MO</span>
                            <input type="number" value={sel.precioUnit} min="0"
                              onChange={e => setForm(p => ({ ...p, tareasSel: { ...p.tareasSel, [t.id]: { ...sel, precioUnit: +e.target.value } } }))}
                              style={{ width: 96, padding: '2px 6px', border: `1px solid ${T.accent}`, borderRadius: 3, fontFamily: T.fontMono, fontSize: 12, textAlign: 'right' }} />
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 700, fontFamily: T.fontMono, color: T.accent, whiteSpace: 'nowrap' }}>
                            $ {Math.round((sel.cantidad || 0) * (sel.precioUnit || 0)).toLocaleString('es-AR')}
                          </span>
                        </>)}
                      </div>
                    );
                  })}
                </div>
              )}
              {totalContrato > 0 && (
                <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end', fontSize: 14, fontWeight: 800, fontFamily: T.fontMono, color: T.accent }}>
                  Total contrato: $ {Math.round(totalContrato).toLocaleString('es-AR')}
                </div>
              )}
            </div>
          )}
        </FormPanel>
      )}

      {contratos.length === 0 ? (
        <div style={{ color: T.ink3, padding: 24, textAlign: 'center' }}>Sin contratos</div>
      ) : contratos.map((c) => {
        const monto = c.monto || 0;
        const avPct = c.avancePct ?? 0;
        const cert = Math.round(monto * avPct / 100);
        const reparo = Math.round(cert * (c.fondoReparo || 0) / 100);
        const aLiquidar = cert - reparo;
        const tareas = Array.isArray(c.tareas) ? c.tareas : [];
        return (
          <Box key={c.id} style={{ padding: '12px 14px', marginBottom: 8, opacity: c.estado === 'cerrado' ? 0.7 : 1 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{c.gremio}</div>
                <div style={{ fontSize: 12, color: T.ink2 }}>
                  {(() => {
                    const prov = proveedoresDyn.find(p => p.nombre === c.proveedor || (c.cuit && p.cuit && p.cuit.replace(/[-\s]/g,'') === c.cuit.replace(/[-\s]/g,'')));
                    return prov
                      ? <span style={{ color: T.accent, cursor: 'pointer', textDecoration: 'underline' }} onClick={() => navigate(`/proveedores/${prov.id}`)}>{c.proveedor}</span>
                      : c.proveedor;
                  })()}{c.cuit ? ` · CUIT ${c.cuit}` : ''}
                </div>
              </div>
              <div style={{ fontFamily: T.fontMono, fontWeight: 700, fontSize: 16 }}>{fmtM(monto, moneda)}</div>
              <Chip ok={c.estado === 'activo'} style={{ fontSize: 10 }}>{c.estado}</Chip>
              <div style={{ display: 'flex', gap: 6 }}>
                <Btn sm onClick={() => setPrintContrato(c)}>Imprimir</Btn>
                <Btn sm onClick={() => toggleEstado(c.id)}>{c.estado === 'activo' ? '✓ Cerrar' : '↩ Reabrir'}</Btn>
                <span style={{ color: T.accent, cursor: 'pointer' }} onClick={() => del(c.id)}>🗑</span>
              </div>
            </div>

            {tareas.length > 0 && (
              <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {tareas.map((t, i) => (
                  <span key={i} style={{ fontSize: 10, background: T.faint, borderRadius: 3, padding: '2px 7px', color: T.ink2 }}>{t.nombre} ({t.cantidadContratada} {t.unidad})</span>
                ))}
              </div>
            )}

            <div style={{ marginTop: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                <span style={{ color: T.ink2 }}>Avance certificado</span>
                <span style={{ fontFamily: T.fontMono, fontWeight: 700, color: avPct >= 100 ? T.ok : T.accent }}>{avPct}%</span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: T.faint2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${avPct}%`, background: avPct >= 100 ? T.ok : T.accent, borderRadius: 3, transition: 'width 0.3s' }} />
              </div>
            </div>

            {avPct > 0 && (
              <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {[
                  { label: 'Certificado', value: fmtM(cert, moneda), color: T.ink },
                  { label: `Fondo reparo (${c.fondoReparo}%)`, value: `− ${fmtM(reparo, moneda)}`, color: T.warn },
                  { label: 'A liquidar', value: fmtM(aLiquidar, moneda), color: T.ok },
                ].map(k => (
                  <div key={k.label} style={{ background: T.faint, borderRadius: 4, padding: '6px 10px' }}>
                    <div style={{ fontSize: 10, color: T.ink2, marginBottom: 2 }}>{k.label}</div>
                    <div style={{ fontFamily: T.fontMono, fontWeight: 700, fontSize: 13, color: k.color }}>{k.value}</div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: 8, fontSize: 11, color: T.ink2, display: 'flex', gap: 16 }}>
              <span>Inicio: {fmtD(c.fechaInicio)}</span>
              <span>Fin: {fmtD(c.fechaFin)}</span>
              <span>Fondo reparo: {c.fondoReparo}%</span>
              {c.formaPago && <span>Pago: {c.formaPago}</span>}
            </div>
          </Box>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 6: DOCUMENTOS
// ─────────────────────────────────────────────────────────────────────────────
function TabDocumentos({ detalle, patch, obraId }) {
  const [adding,      setAdding]      = useState(false);
  const [form,        setForm]        = useState({ nombre: '', tipo: 'Contrato', fecha: new Date().toISOString().split('T')[0] });
  const [pendingFile, setPendingFile] = useState(null);
  const [uploading,   setUploading]   = useState(false);
  const [uploadErr,   setUploadErr]   = useState('');
  const fileRef = useRef(null);
  const TIPOS_DOC = ['Contrato', 'Presupuesto', 'Planos', 'Certificado', 'Factura', 'Permiso', 'Otro'];

  const handleFile = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setPendingFile(f);
    if (!form.nombre.trim()) setForm(p => ({ ...p, nombre: f.name.replace(/\.[^.]+$/, '') }));
  };

  const save = async () => {
    if (!form.nombre.trim()) return;
    let url = null;
    if (pendingFile) {
      setUploading(true);
      setUploadErr('');
      const ext  = pendingFile.name.split('.').pop();
      const path = `obras/${obraId}/docs/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from('kamak-fotos').upload(path, pendingFile, { upsert: true });
      if (error) { setUploadErr('Error al subir el archivo: ' + error.message); setUploading(false); return; }
      url = supabase.storage.from('kamak-fotos').getPublicUrl(path).data.publicUrl;
      setUploading(false);
    }
    patch(d => ({ ...d, documentos: [...d.documentos, { id: newId(), ...form, url }] }));
    setAdding(false);
    setForm({ nombre: '', tipo: 'Contrato', fecha: new Date().toISOString().split('T')[0] });
    setPendingFile(null);
  };

  const del = (id) => patch(d => ({ ...d, documentos: d.documentos.filter(dc => dc.id !== id) }));

  return (
    <div style={{ maxWidth: 700 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <Btn sm fill onClick={() => setAdding(true)}>+ Documento</Btn>
      </div>

      {adding && (
        <FormPanel title="Agregar documento" onSave={save} onCancel={() => { setAdding(false); setPendingFile(null); setUploadErr(''); }}
          style={{ marginBottom: 14 }} saveLabel={uploading ? 'Subiendo...' : 'Guardar'} saveDisabled={uploading}>
          <FInput label="Nombre del documento" value={form.nombre} onChange={v => setForm(p => ({ ...p, nombre: v }))} placeholder="Ej: Contrato de obra firmado" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <FSelect label="Tipo" value={form.tipo} onChange={v => setForm(p => ({ ...p, tipo: v }))} options={TIPOS_DOC} />
            <FInput label="Fecha" value={form.fecha} onChange={v => setForm(p => ({ ...p, fecha: v }))} type="date" />
          </div>
          <div style={{ background: T.faint, borderRadius: 4, padding: '10px 12px', border: `1.5px dashed ${T.faint2}`, cursor: 'pointer' }}
            onClick={() => fileRef.current?.click()}>
            <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg" style={{ display: 'none' }} onChange={handleFile} />
            {pendingFile ? (
              <div style={{ fontSize: 12, color: T.ink, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 18 }}>📎</span>
                <span style={{ fontWeight: 600 }}>{pendingFile.name}</span>
                <span style={{ color: T.ink3 }}>({(pendingFile.size / 1024).toFixed(0)} KB)</span>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: T.ink2, textAlign: 'center' }}>📎 Clic para seleccionar archivo (PDF, Word, Excel, imágenes)</div>
            )}
          </div>
          {uploadErr && <div style={{ fontSize: 11, color: '#dc2626' }}>{uploadErr}</div>}
        </FormPanel>
      )}

      {detalle.documentos.length === 0 ? (
        <div style={{ color: T.ink3, padding: 24, textAlign: 'center' }}>Sin documentos</div>
      ) : (
        <Box style={{ padding: 0, overflow: 'hidden' }}>
          {detalle.documentos.map((dc, i) => (
            <div key={dc.id} style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: i < detalle.documentos.length - 1 ? `1px solid ${T.faint2}` : 'none', gap: 12 }}>
              <span style={{ fontSize: 22 }}>📄</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{dc.nombre}</div>
                <div style={{ fontSize: 11, color: T.ink2 }}>{dc.tipo} · {fmtD(dc.fecha)}</div>
              </div>
              <Chip style={{ fontSize: 10 }}>{dc.tipo}</Chip>
              {dc.url
                ? <a href={dc.url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}><Btn sm>↓ Abrir</Btn></a>
                : <Btn sm style={{ opacity: 0.4, pointerEvents: 'none' }}>Sin archivo</Btn>
              }
              <span style={{ color: T.accent, cursor: 'pointer', fontSize: 12 }} onClick={() => del(dc.id)}>🗑</span>
            </div>
          ))}
        </Box>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 7: FOTOS
// ─────────────────────────────────────────────────────────────────────────────
function TabFotos({ detalle, patch, obraId }) {
  const [adding,      setAdding]      = useState(false);
  const [form,        setForm]        = useState({ label: '', fecha: new Date().toISOString().split('T')[0], rubro: '' });
  const [editingFoto, setEditingFoto] = useState(null);   // foto being edited
  const [editForm,    setEditForm]    = useState({});
  const [pendingFile, setPendingFile] = useState(null);
  const [previewUrl,  setPreviewUrl]  = useState(null);
  const [uploading,   setUploading]   = useState(false);
  const [uploadErr,   setUploadErr]   = useState('');
  const fileRef      = useRef(null);

  // ── Modo subida múltiple ──────────────────────────────────────────────────
  const [multiMode,   setMultiMode]   = useState(false);
  const [multiFiles,  setMultiFiles]  = useState([]); // { file, previewUrl, label, status }
  const [multiFecha,  setMultiFecha]  = useState(new Date().toISOString().split('T')[0]);
  const [multiRubro,  setMultiRubro]  = useState('');
  const [multiProgress, setMultiProgress] = useState(null); // null | { done, total }
  const multiRef = useRef(null);

  const handleMultiSelect = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const items = files.map(f => ({
      file: f,
      previewUrl: f.type.startsWith('image/') ? URL.createObjectURL(f) : null,
      label: f.name.replace(/\.[^.]+$/, ''),
      status: 'pending',
    }));
    setMultiFiles(items);
    e.target.value = '';
  };

  const cancelMulti = () => {
    multiFiles.forEach(m => m.previewUrl && URL.revokeObjectURL(m.previewUrl));
    setMultiFiles([]);
    setMultiMode(false);
    setMultiProgress(null);
  };

  const uploadAll = async () => {
    if (!multiFiles.length) return;
    setMultiProgress({ done: 0, total: multiFiles.length });
    const nuevasFotos = [];
    for (let i = 0; i < multiFiles.length; i++) {
      const m = multiFiles[i];
      setMultiFiles(prev => prev.map((x, idx) => idx === i ? { ...x, status: 'uploading' } : x));
      let url = null;
      try {
        const ext  = m.file.name.split('.').pop() || 'jpg';
        const path = `obras/${obraId}/fotos/${Date.now()}-${i}.${ext}`;
        const { error } = await supabase.storage.from('kamak-fotos').upload(path, m.file, { upsert: true });
        if (!error) url = supabase.storage.from('kamak-fotos').getPublicUrl(path).data.publicUrl;
        setMultiFiles(prev => prev.map((x, idx) => idx === i ? { ...x, status: error ? 'error' : 'done' } : x));
      } catch {
        setMultiFiles(prev => prev.map((x, idx) => idx === i ? { ...x, status: 'error' } : x));
      }
      nuevasFotos.push({ id: newId(), label: m.label, fecha: multiFecha, rubro: multiRubro, url });
      setMultiProgress({ done: i + 1, total: multiFiles.length });
    }
    patch(d => ({ ...d, fotos: [...d.fotos, ...nuevasFotos] }));
    cancelMulti();
  };

  const handleFile = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setPendingFile(f);
    setPreviewUrl(URL.createObjectURL(f));
  };

  const cancelAdding = () => {
    setAdding(false);
    setPendingFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setUploadErr('');
    setForm({ label: '', fecha: new Date().toISOString().split('T')[0], rubro: '' });
  };

  const save = async () => {
    if (!form.label.trim()) return;
    let url = null;
    if (pendingFile) {
      setUploading(true);
      setUploadErr('');
      const ext  = pendingFile.name.split('.').pop() || 'jpg';
      const path = `obras/${obraId}/fotos/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from('kamak-fotos').upload(path, pendingFile, { upsert: true });
      if (error) { setUploadErr('Error al subir: ' + error.message); setUploading(false); return; }
      url = supabase.storage.from('kamak-fotos').getPublicUrl(path).data.publicUrl;
      setUploading(false);
    }
    patch(d => ({ ...d, fotos: [...d.fotos, { id: newId(), ...form, url }] }));
    cancelAdding();
  };

  const del = (id) => patch(d => ({ ...d, fotos: d.fotos.filter(f => f.id !== id) }));

  const startEditFoto = (f) => {
    // Buscar el avance actual de la tarea asociada a esta foto
    let avanceActual = null;
    for (const r of detalle.rubros) {
      for (const t of (r.tareas || [])) {
        if (t.nombre === f.rubro || t.id === f.tareaId) { avanceActual = t.avance ?? 0; break; }
      }
      if (avanceActual !== null) break;
    }
    setEditingFoto(f);
    setEditForm({ label: f.label || '', fecha: f.fecha || '', rubro: f.rubro || '', avance: avanceActual !== null ? avanceActual : '' });
  };

  const saveEditFoto = () => {
    const nuevoAvance = editForm.avance !== '' ? Math.min(100, Math.max(0, parseInt(editForm.avance) || 0)) : null;
    patch(d => ({
      ...d,
      fotos: d.fotos.map(f => f.id === editingFoto.id
        ? { ...f, label: editForm.label, fecha: editForm.fecha, rubro: editForm.rubro }
        : f
      ),
      // Si cambió el avance, actualizar la tarea que tenga el mismo nombre de rubro
      rubros: nuevoAvance !== null ? d.rubros.map(r => ({
        ...r,
        tareas: (r.tareas || []).map(t =>
          (t.nombre === editingFoto.rubro || t.id === editingFoto.tareaId)
            ? { ...t, avance: nuevoAvance }
            : t
        ),
      })) : d.rubros,
    }));
    setEditingFoto(null);
  };

  const statusColor = { pending: T.ink3, uploading: T.accent, done: T.ok, error: '#dc2626' };
  const statusIcon  = { pending: '⏳', uploading: '⬆', done: '✓', error: '✕' };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: T.ink2 }}>{detalle.fotos.length} fotos</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn sm onClick={() => { setMultiMode(true); setAdding(false); }}>📁 Subir carpeta</Btn>
          <Btn sm fill onClick={() => { setAdding(true); setMultiMode(false); }}>📷 Agregar foto</Btn>
        </div>
      </div>

      {/* ── Subida múltiple ── */}
      {multiMode && (
        <div style={{ background: T.accentSoft, border: `1.5px solid ${T.accent}`, borderRadius: 6, padding: 14, marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Subir varias fotos</div>

          {multiFiles.length === 0 ? (
            <div style={{ border: `1.5px dashed ${T.faint2}`, borderRadius: 6, padding: 24, textAlign: 'center', cursor: 'pointer', background: T.faint }}
              onClick={() => multiRef.current?.click()}>
              <input ref={multiRef} type="file" accept="image/*,.pdf" multiple style={{ display: 'none' }} onChange={handleMultiSelect} />
              <div style={{ fontSize: 28, marginBottom: 6 }}>📁</div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Seleccionar fotos</div>
              <div style={{ fontSize: 11, color: T.ink2, marginTop: 4 }}>Podés seleccionar múltiples archivos a la vez</div>
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                <FRow label="Fecha">
                  <input style={inputSt} type="date" value={multiFecha} onChange={e => setMultiFecha(e.target.value)} />
                </FRow>
                <FRow label="Rubro (común)">
                  <input style={inputSt} value={multiRubro} onChange={e => setMultiRubro(e.target.value)} placeholder="Ej: Albañilería" />
                </FRow>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginBottom: 12, maxHeight: 360, overflowY: 'auto' }}>
                {multiFiles.map((m, i) => (
                  <div key={i} style={{ position: 'relative', borderRadius: 6, overflow: 'hidden', border: `1.5px solid ${m.status === 'error' ? '#dc2626' : T.faint2}`, background: T.faint2 }}>
                    {m.previewUrl ? (
                      <img src={m.previewUrl} alt="" style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', display: 'block' }} />
                    ) : (
                      <div style={{ aspectRatio: '4/3', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>📄</div>
                    )}
                    <div style={{ padding: '4px 6px', background: T.paper }}>
                      <input
                        style={{ ...inputSt, fontSize: 10, padding: '2px 4px' }}
                        value={m.label}
                        onChange={e => setMultiFiles(prev => prev.map((x, idx) => idx === i ? { ...x, label: e.target.value } : x))}
                        placeholder="Descripción"
                      />
                    </div>
                    <div style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.6)', color: statusColor[m.status] || 'white', borderRadius: 3, fontSize: 11, padding: '1px 5px', fontWeight: 700 }}>
                      {statusIcon[m.status]}
                    </div>
                  </div>
                ))}
              </div>

              {multiProgress && (
                <div style={{ fontSize: 12, color: T.ink2, marginBottom: 8 }}>
                  Subiendo {multiProgress.done} / {multiProgress.total}…
                  <div style={{ height: 4, background: T.faint2, borderRadius: 2, marginTop: 4 }}>
                    <div style={{ height: '100%', background: T.accent, borderRadius: 2, width: `${(multiProgress.done / multiProgress.total) * 100}%`, transition: 'width 0.2s' }} />
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <Btn sm onClick={cancelMulti} disabled={!!multiProgress}>Cancelar</Btn>
                <Btn sm fill onClick={uploadAll} disabled={!!multiProgress}>
                  {multiProgress ? 'Subiendo…' : `⬆ Subir ${multiFiles.length} foto${multiFiles.length !== 1 ? 's' : ''}`}
                </Btn>
              </div>
            </>
          )}

          {!multiFiles.length && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <Btn sm onClick={cancelMulti}>Cancelar</Btn>
            </div>
          )}
        </div>
      )}

      {/* ── Agregar foto individual ── */}
      {adding && (
        <FormPanel title="Agregar foto" onSave={save} onCancel={cancelAdding}
          style={{ marginBottom: 14, maxWidth: 500 }} saveLabel={uploading ? 'Subiendo...' : 'Guardar'} saveDisabled={uploading}>
          <FInput label="Descripción" value={form.label} onChange={v => setForm(p => ({ ...p, label: v }))} placeholder="Ej: Tablero instalado" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <FInput label="Fecha" value={form.fecha} onChange={v => setForm(p => ({ ...p, fecha: v }))} type="date" />
            <FInput label="Rubro" value={form.rubro} onChange={v => setForm(p => ({ ...p, rubro: v }))} placeholder="Ej: Electricidad" />
          </div>
          <div style={{ border: `1.5px dashed ${T.faint2}`, borderRadius: 6, overflow: 'hidden', cursor: 'pointer', background: T.faint }}
            onClick={() => fileRef.current?.click()}>
            <input ref={fileRef} type="file" accept="image/*,.pdf" style={{ display: 'none' }} onChange={handleFile} />
            {previewUrl ? (
              <img src={previewUrl} alt="" style={{ width: '100%', maxHeight: 200, objectFit: 'cover', display: 'block' }} />
            ) : (
              <div style={{ padding: 20, fontSize: 12, color: T.ink2, textAlign: 'center' }}>
                📷 Clic para seleccionar imagen o PDF
              </div>
            )}
          </div>
          {uploadErr && <div style={{ fontSize: 11, color: '#dc2626' }}>{uploadErr}</div>}
        </FormPanel>
      )}

      {/* Modal de edición de foto */}
      {editingFoto && (
        <FormPanel
          title="Editar foto / avance"
          onSave={saveEditFoto}
          onCancel={() => setEditingFoto(null)}
          style={{ marginBottom: 14, maxWidth: 500 }}
        >
          <FInput label="Descripción" value={editForm.label} onChange={v => setEditForm(p => ({ ...p, label: v }))} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <FInput label="Fecha" value={editForm.fecha} onChange={v => setEditForm(p => ({ ...p, fecha: v }))} type="date" />
            <FInput label="Tarea / Rubro" value={editForm.rubro} onChange={v => setEditForm(p => ({ ...p, rubro: v }))} />
          </div>
          {editForm.avance !== '' && (
            <div>
              <div style={{ fontSize: 11, color: T.ink2, marginBottom: 4 }}>
                Avance de tarea <b style={{ color: T.ink }}>{editForm.rubro}</b>
                <span style={{ color: T.ink3 }}> — Corregir si la cantidad era incorrecta</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="range" min={0} max={100} step={1}
                  value={editForm.avance}
                  onChange={e => setEditForm(p => ({ ...p, avance: +e.target.value }))}
                  style={{ flex: 1, accentColor: T.accent }}
                />
                <input
                  type="number" min={0} max={100}
                  value={editForm.avance}
                  onChange={e => setEditForm(p => ({ ...p, avance: +e.target.value }))}
                  style={{ width: 58, padding: '4px 6px', border: `1px solid ${T.faint2}`, borderRadius: 4, fontSize: 12, textAlign: 'center', fontFamily: T.fontMono }}
                />
                <span style={{ fontSize: 12, color: T.ink2 }}>%</span>
              </div>
              <Bar pct={editForm.avance} ok={editForm.avance === 100} style={{ marginTop: 4 }} />
            </div>
          )}
        </FormPanel>
      )}

      {detalle.fotos.length === 0 ? (
        <div style={{ color: T.ink3, padding: 40, textAlign: 'center' }}>Sin fotos. Agregá la primera.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
          {detalle.fotos.map(f => (
            <div key={f.id} style={{ position: 'relative' }}>
              <a href={f.url || undefined} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', display: 'block' }}>
                <div style={{ borderRadius: 6, aspectRatio: '4/3', overflow: 'hidden', border: `1.5px solid ${T.faint2}`, background: T.faint2, position: 'relative' }}>
                  {f.url ? (
                    <img src={f.url} alt={f.label} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>📷</div>
                  )}
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.55)', color: 'white', padding: '4px 8px' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.label}</div>
                    <div style={{ fontSize: 9, opacity: 0.8 }}>{fmtD(f.fecha)}{f.rubro ? ` · ${f.rubro}` : ''}</div>
                  </div>
                </div>
              </a>
              {/* Botones editar / eliminar */}
              <div style={{ position: 'absolute', top: 5, right: 5, display: 'flex', gap: 4 }}>
                <span
                  title="Editar"
                  style={{ background: 'rgba(0,0,0,0.6)', color: 'white', borderRadius: 3, fontSize: 10, padding: '2px 6px', cursor: 'pointer' }}
                  onClick={() => startEditFoto(f)}>✎</span>
                <span
                  title="Eliminar"
                  style={{ background: 'rgba(0,0,0,0.6)', color: 'white', borderRadius: 3, fontSize: 10, padding: '2px 6px', cursor: 'pointer' }}
                  onClick={() => del(f.id)}>✕</span>
              </div>
            </div>
          ))}
          <div style={{ background: T.faint, borderRadius: 6, aspectRatio: '4/3', display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.ink3, cursor: 'pointer', border: `1.5px dashed ${T.faint2}` }}
            onClick={() => setAdding(true)}>
            <div style={{ textAlign: 'center' }}><div style={{ fontSize: 24 }}>+</div><div style={{ fontSize: 11 }}>Foto</div></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTE PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────
const TABS_DEF = ['Resumen', 'Presupuesto', 'Materiales', 'Adicionales', 'Gantt', 'Movimientos', 'Cuenta cliente', 'Contratos MO', 'Documentos', 'Fotos', 'Financiación', 'Portal cliente'];

export default function ObraPresupuesto() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { obras, getDetalle, patchDetalle, updateObra } = useObras();
  const { currentUser } = useUsuarios();
  const tabsOcultos = currentUser?.tabsOcultos ?? [];
  const [activeTab, setActiveTab] = useState(() => {
    const t = parseInt(searchParams.get('tab'), 10);
    return isNaN(t) ? 0 : t;
  });
  const [showExport, setShowExport] = useState(false);
  const [showContrato, setShowContrato] = useState(false);
  const [showPortalAccess, setShowPortalAccess] = useState(false);
  const [portalPhone, setPortalPhone] = useState('');
  const [portalSending, setPortalSending] = useState(false);
  const [portalMsg, setPortalMsg] = useState('');
  const [portalWamid, setPortalWamid] = useState('');
  const [portalWaStatus, setPortalWaStatus] = useState('');

  const obra = obras.find(o => o.id === id) ?? { id, nombre: id, cliente: '', moneda: 'ARS', presupuesto: 0, avance: 0 };
  const detalle = getDetalle(id);
  const patch = (fn) => patchDetalle(id, fn);
  const moneda = obra.moneda;

  const { costo, venta, margen } = calcObra(detalle.rubros);
  const gastado = detalle.movimientos.filter(m => m.tipo === 'gasto').reduce((s, m) => s + m.monto, 0);

  const tabLabels = TABS_DEF.map((t, i) => {
    if (i === 3) return `Adicionales${detalle.adicionales.length > 0 ? ' · ' + detalle.adicionales.length : ''}`;
    if (i === 5) return `Movimientos${detalle.movimientos.length > 0 ? ' · ' + detalle.movimientos.length : ''}`;
    if (i === 7) return `Contratos MO${detalle.contratos.length > 0 ? ' · ' + detalle.contratos.length : ''}`;
    if (i === 8) return `Docs${detalle.documentos.length > 0 ? ' · ' + detalle.documentos.length : ''}`;
    if (i === 9) return `Fotos${detalle.fotos.length > 0 ? ' · ' + detalle.fotos.length : ''}`;
    if (i === 10) { const cuotas = detalle.cuotas || []; return `Financiación${cuotas.length > 0 ? ' · ' + cuotas.length + ' cuotas' : ''}`; }
    return t;
  });

  // Filter to visible tab indices; if current tab is hidden, fall back to first visible
  const visibleTabIndices = TABS_DEF.reduce((acc, t, i) => { if (!tabsOcultos.includes(t)) acc.push(i); return acc; }, []);
  const displayTab = visibleTabIndices.includes(activeTab) ? activeTab : (visibleTabIndices[0] ?? 0);

  const handleTab = (i) => {
    if (TABS_DEF[i] === 'Gantt') { navigate(`/obras/${id}/gantt`); return; }
    if (TABS_DEF[i] === 'Portal cliente') { window.open(`/portal/cliente/${id}`, '_blank'); return; }
    setActiveTab(i);
  };

  const estadoColor = { activa: T.ok, 'en-presupuesto': T.ink2, pausada: T.warn, finalizada: T.accent, archivada: T.ink3 };

  const handleApprove = () => {
    if (!confirm('¿Aprobar y congelar el presupuesto?\n\nUna vez aprobado no podrás modificar rubros ni tareas.\nLos cambios futuros van en la pestaña Adicionales.')) return;
    patch(d => ({ ...d, presupuestoAprobado: true, fechaAprobacion: new Date().toISOString().split('T')[0] }));
    if (obra.estado === 'en-presupuesto') updateObra(obra.id, { estado: 'activa' });
    handleTab(10);
  };

  const sendPortalAccess = async () => {
    const rawPhone = portalPhone.replace(/\D/g, '');
    if (rawPhone.length < 10) {
      setPortalMsg('❌ Número inválido. Ingresá al menos 10 dígitos (ej: 5492262530655).');
      return;
    }
    setPortalSending(true); setPortalMsg(''); setPortalWamid(''); setPortalWaStatus('');
    try {
      const token = `pt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
      // Argentine mobile: needs '549' prefix (not just '54')
      let waPhone = rawPhone;
      if (!waPhone.startsWith('549')) {
        waPhone = waPhone.startsWith('54') ? '549' + waPhone.slice(2) : '549' + waPhone;
      }
      const tokens = (await loadSharedData('portal_tokens')) || {};
      tokens[token] = { obraId: id, obraNombre: obra.nombre, cliente: obra.cliente, phone: rawPhone, expires, createdAt: new Date().toISOString() };
      await saveSharedData('portal_tokens', tokens);
      const baseUrl = window.location.origin;
      const link = `${baseUrl}/portal/acceso/${token}`;
      const text = `Hola! Te compartimos el acceso a tu portal de obra *${obra.nombre}*.\n\nPodés ver el avance, las cuotas y los documentos en este enlace:\n${link}\n\n_Kamak Desarrollos_`;
      const res = await fetch(`https://graph.facebook.com/v18.0/${import.meta.env.VITE_WA_PHONE_ID}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${import.meta.env.VITE_WA_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: waPhone, type: 'text', text: { body: text } }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        const errMsg = data.error?.message || data.error?.error_data?.details || `Error ${res.status}`;
        setPortalMsg(`❌ No se pudo enviar al +${waPhone}: ${errMsg}`);
        setPortalSending(false);
        return;
      }
      const wamid = data.messages?.[0]?.id;
      if (wamid) {
        tokens[token].wamid = wamid;
        await saveSharedData('portal_tokens', tokens);
        setPortalWamid(wamid);
      }
      setPortalMsg(`✓ Enviado a +${waPhone}.\nLink: ${link}`);
    } catch (e) {
      setPortalMsg(`❌ Error de red: ${e.message}`);
    }
    setPortalSending(false);
  };

  useEffect(() => {
    if (!portalWamid) return;
    return onRemoteChange('portal_tokens', async () => {
      const tokens = await loadSharedData('portal_tokens');
      const entry = tokens && Object.values(tokens).find(t => t.wamid === portalWamid);
      if (entry?.waStatus) {
        const label = { read: '✓✓ Leído por el cliente', delivered: '✓✓ Entregado', sent: '✓ Enviado' }[entry.waStatus] || entry.waStatus;
        setPortalWaStatus(label);
      }
    });
  }, [portalWamid]);

  return (
    <PageLayout breadcrumb={['Obras', obra.nombre, tabLabels[displayTab]]} active="Obras">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className="k-h" style={{ fontSize: 26 }}>{obra.nombre}</div>
            {obra.estado && <Chip ok={obra.estado === 'activa'} warn={obra.estado === 'pausada'} style={{ fontSize: 10 }}>{obra.estado}</Chip>}
          </div>
          <div style={{ fontSize: 12, color: T.ink2, marginTop: 2 }}>
            {obra.cliente && <span style={{ color: T.accent, cursor: 'pointer', textDecoration: 'underline' }} onClick={() => navigate(`/clientes?q=${encodeURIComponent(obra.cliente)}`)}>{obra.cliente}</span>}{obra.cliente && <span> · </span>}
            <span>{obra.tipo || 'Obra'} · {moneda}</span>
            {obra.fechaFinEstim && <span> · entrega est. {fmtD(obra.fechaFinEstim)}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Btn sm onClick={() => navigate('/obras')}>← Obras</Btn>
          <Btn sm onClick={() => { setShowPortalAccess(true); setPortalMsg(''); setPortalPhone(obra.clienteWhatsapp || ''); }}>🔗 Acceso cliente</Btn>
          <Btn sm fill onClick={() => setShowContrato(true)}>Contrato MO</Btn>
        </div>
      </div>

      {/* Tabs */}
      <div className="k-tabs" style={{ marginBottom: 10, overflowX: 'auto' }}>
        {tabLabels.map((tab, i) => {
          if (!visibleTabIndices.includes(i)) return null;
          return (
            <span key={i} className={`k-tab${displayTab === i && TABS_DEF[i] !== 'Gantt' && TABS_DEF[i] !== 'Portal cliente' ? ' k-tab-on' : ''}`}
              style={{ whiteSpace: 'nowrap' }} onClick={() => handleTab(i)}>{tab}</span>
          );
        })}
      </div>

      {/* Content */}
      {displayTab === 0 && <TabResumen obra={obra} detalle={detalle} moneda={moneda} onChangeTab={handleTab} />}
      {displayTab === 1 && <TabPresupuesto obra={obra} detalle={detalle} patch={patch} moneda={moneda} frozen={!!detalle.presupuestoAprobado} onApprove={handleApprove} onExport={() => setShowExport(true)} />}
      {displayTab === 2 && <TabMateriales detalle={detalle} obra={obra} />}
      {displayTab === 3 && <TabAdicionales detalle={detalle} patch={patch} moneda={moneda} obra={obra} />}
      {displayTab === 5 && <TabMovimientos obra={obra} moneda={moneda} />}
      {displayTab === 6 && <TabCuentaCliente detalle={detalle} patch={patch} moneda={moneda} obra={obra} />}
      {displayTab === 7 && <TabContratosMO detalle={detalle} patch={patch} moneda={moneda} obra={obra} />}
      {displayTab === 8 && <TabDocumentos detalle={detalle} patch={patch} obraId={id} />}
      {displayTab === 9 && <TabFotos detalle={detalle} patch={patch} obraId={id} />}
      {displayTab === 10 && <TabFinanciacion obra={obra} detalle={detalle} patch={patch} moneda={moneda} />}

      {showExport && <ExportModal onClose={() => setShowExport(false)} obra={obra} detalle={detalle} />}
      {showContrato && <ContratoMOModal onClose={() => setShowContrato(false)} />}

      {showPortalAccess && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: T.paper, border: `1px solid ${T.faint2}`, borderRadius: 10, padding: 28, width: 420, boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: T.ink, marginBottom: 6 }}>🔗 Acceso al portal cliente</div>
            <div style={{ fontSize: 12, color: T.ink3, marginBottom: 18 }}>Se genera un link único para <b>{obra.cliente || obra.nombre}</b>. Solo podrán ver el portal de esta obra.</div>
            <FRow label="WhatsApp del cliente (sin +, con código país)">
              <input
                style={{ ...inputSt, fontSize: 14 }}
                placeholder="Ej: 5491112345678"
                value={portalPhone}
                onChange={e => setPortalPhone(e.target.value)}
              />
            </FRow>
            {portalMsg && (
              <div style={{ marginTop: 12, padding: '10px 14px', background: portalMsg.startsWith('✓') ? '#d1fae5' : '#fee2e2', borderRadius: 6, fontSize: 12, color: T.ink, whiteSpace: 'pre-line' }}>
                {portalMsg}
              </div>
            )}
            {portalMsg.startsWith('✓') && (
              <div style={{ marginTop: 4, padding: '7px 14px', background: portalWaStatus ? '#d1fae5' : '#f0f9ff', borderRadius: 6, fontSize: 12, color: T.ink2 }}>
                Estado de entrega: <b style={{ color: T.ink }}>{portalWaStatus || 'aguardando confirmación…'}</b>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <Btn sm onClick={() => { setShowPortalAccess(false); setPortalMsg(''); setPortalWamid(''); setPortalWaStatus(''); }}>Cancelar</Btn>
              <Btn sm fill onClick={sendPortalAccess} disabled={portalSending}>
                {portalSending ? 'Enviando…' : '📲 Generar y enviar acceso'}
              </Btn>
            </div>
          </div>
        </div>
      )}
    </PageLayout>
  );
}
