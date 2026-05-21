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

// ── Helpers ───────────────────────────────────────────────────────────────────
const newId = () => `id-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const fmtN = (n) => Math.round(n).toLocaleString('es-AR');
const fmtM = (n, moneda) => moneda === 'USD' ? `U$S ${fmtN(n)}` : `$ ${fmtN(n)}`;
const fmtD = (iso) => !iso ? '—' : iso.split('-').reverse().join('/');

const tareaVentaUnit = (t, rubro) => {
  const costoUnit = t.costoMat + (t.costoSub || 0);
  if (t.margenLinea != null) return costoUnit * (1 + t.margenLinea / 100);
  return t.costoMat * (1 + rubro.margenMat / 100) + (t.costoSub || 0) * (1 + rubro.margenMO / 100);
};

const calcRubro = (rubro) => {
  let cMat = 0, cSub = 0, venta = 0;
  for (const t of rubro.tareas) {
    cMat += t.costoMat * t.cantidad;
    cSub += (t.costoSub || 0) * t.cantidad;
    venta += tareaVentaUnit(t, rubro) * t.cantidad;
  }
  const costo = cMat + cSub;
  const margen = venta > 0 ? Math.round((venta - costo) / venta * 100) : 0;
  const avance = rubro.tareas.length > 0 ? Math.round(rubro.tareas.reduce((s, t) => s + t.avance, 0) / rubro.tareas.length) : 0;
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
      <input style={inputSt} type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
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
function FormPanel({ title, children, onSave, onCancel, style }) {
  return (
    <div style={{ background: T.accentSoft, border: `1.5px solid ${T.accent}`, borderRadius: 6, padding: 14, display: 'flex', flexDirection: 'column', gap: 10, ...style }}>
      {title && <div style={{ fontWeight: 700, fontSize: 13 }}>{title}</div>}
      {children}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
        <Btn sm onClick={onCancel}>Cancelar</Btn>
        <Btn sm accent onClick={onSave}>Guardar</Btn>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 0: RESUMEN
// ─────────────────────────────────────────────────────────────────────────────
function TabResumen({ obra, detalle, moneda }) {
  const { currentUser } = useUsuarios();
  const verCostos   = currentUser?.permisos?.verCostos   ?? true;
  const verMargenes = currentUser?.permisos?.verMargenes ?? true;
  const { costo, venta, margen, rubros: rr } = calcObra(detalle.rubros);
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {/* Avance por rubro */}
        <Box style={{ padding: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Avance por rubro</div>
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
              ['Venta total (presu)', fmtM(venta, moneda), T.ink, true],
              ['Costo total (presu)', fmtM(costo, moneda), T.ink, true],
              ['Margen bruto (presu)', fmtM(venta - costo, moneda), margen < 0 ? T.accent : T.ok, verMargenes],
              ['Gastado real', fmtM(totalGastadoReal, moneda), totalGastadoReal > costo ? T.accent : T.ink, true],
              ['Cobrado (movimientos)', fmtM(totalCobradoReal, moneda), T.ok, true],
              ['Falta cobrar', fmtM(faltaCobrar, moneda), faltaCobrar > 0 ? T.warn : T.ok, true],
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
          <div style={{ padding: '8px 14px', background: T.faint, borderBottom: `1.5px solid ${T.faint2}`, fontWeight: 700, fontSize: 13 }}>Últimos movimientos</div>
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

// ─────────────────────────────────────────────────────────────────────────────
// TAB 1: PRESUPUESTO
// ─────────────────────────────────────────────────────────────────────────────
function TabPresupuesto({ obra, detalle, patch, moneda }) {
  const { currentUser } = useUsuarios();
  const verCostos   = currentUser?.permisos?.verCostos   ?? true;
  const verMargenes = currentUser?.permisos?.verMargenes ?? true;
  const puedeEditar = currentUser?.permisos?.editarPresu ?? true;
  const puedeCargarAvance = currentUser?.permisos?.cargarAvance ?? true;
  const [selTask, setSelTask] = useState(null);
  const [selRubroId, setSelRubroId] = useState(null);
  const [editTask, setEditTask] = useState(null);
  const [addingTask, setAddingTask] = useState(null);
  const [addingRubro, setAddingRubro] = useState(false);
  const [newTask, setNewTask] = useState({ codigo: '', nombre: '', unidad: 'u', cantidad: 1, costoMat: 0, costoSub: 0 });
  const [newRubro, setNewRubro] = useState({ nombre: '', margenMat: 20, margenMO: 35, proveedor: '' });
  const [showPlantillas, setShowPlantillas] = useState(false);
  const [inlineEdit, setInlineEdit] = useState(null);
  const [colsUser, setColsUser] = useState({ costoUnit: false, costoTotal: true, margenL: false, ventaUnit: false, ventaTotal: true });
  // Force-off cost/margin columns based on permissions
  const cols = {
    costoUnit:  verCostos   ? colsUser.costoUnit  : false,
    costoTotal: verCostos   ? colsUser.costoTotal : false,
    margenL:    verMargenes ? colsUser.margenL    : false,
    ventaUnit:  colsUser.ventaUnit,
    ventaTotal: colsUser.ventaTotal,
  };
  const { plantillas, incrementUso } = usePlantillas();
  const { obras: todasObras, detalles } = useObras();
  const { totalMensual: gfMensual } = useGastosFijos();
  const { catalog } = useCatalog();

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

  const importarPlantilla = (plt) => {
    const n = detalle.rubros.length;
    const nuevos = (plt.rubros || []).map((r, idx) => ({
      id: newId(), nombre: r.nombre, proveedor: '', margenMat: r.margenMat || 20, margenMO: r.margenMO || 35,
      orden: n + idx, abierto: true,
      tareas: (r.tareas || []).map(t => ({ id: newId(), codigo: t.codigo || '', nombre: t.nombre, unidad: t.unidad || 'u', cantidad: t.cantidad || 1, costoMat: t.costoMat || 0, costoSub: t.costoSub || 0, receta: t.receta ? { materiales: (t.receta.materiales || []).map(m => ({ ...m, id: newId() })) } : { materiales: [] }, avance: 0 })),
    }));
    patch(d => ({ ...d, rubros: [...d.rubros, ...nuevos] }));
    incrementUso(plt.id);
    setShowPlantillas(false);
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
    if (!newRubro.nombre.trim()) return;
    patch(d => ({ ...d, rubros: [...d.rubros, { id: newId(), nombre: newRubro.nombre.toUpperCase(), proveedor: newRubro.proveedor, margenMat: +newRubro.margenMat, margenMO: +newRubro.margenMO, orden: d.rubros.length, abierto: true, tareas: [] }] }));
    setAddingRubro(false);
    setNewRubro({ nombre: '', margenMat: 20, margenMO: 35, proveedor: '' });
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
    <div style={{ display: 'flex', gap: 10, overflow: 'hidden', height: 'calc(100vh - 320px)' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Totals strip */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 8, flexShrink: 0, alignItems: 'stretch' }}>
          <div style={{ flex: 1, background: '#f6efd9', borderRadius: 4, border: `1px solid ${T.faint2}`, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr' }}>
              {[
                { label: 'Total venta', val: fmtM(venta, moneda), color: T.ink, show: true },
                { label: 'Total costo', val: fmtM(costo, moneda), color: T.ink, show: verCostos },
                { label: 'Margen', val: `${margen}%`, color: margen < 0 ? '#dc2626' : margen < 15 ? T.warn : T.ok, show: verMargenes },
              ].filter(s => s.show).map((s, i, arr) => (
                <div key={i} style={{ padding: '8px 14px', textAlign: 'center', borderRight: i < 2 ? `1px solid ${T.faint2}` : 'none' }}>
                  <div style={{ fontSize: 9, color: T.ink3, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>{s.label}</div>
                  <div style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 17, color: s.color }}>{s.val}</div>
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
                {rubro.proveedor && <Chip style={{ fontSize: 10 }}>{rubro.proveedor}</Chip>}
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

                  {rubro.tareas.map(tarea => {
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
                          ? <input autoFocus type="number" min="0" step="1" style={inlineInputSt} value={ie.value}
                              onChange={e => setInlineEdit(x => ({ ...x, value: e.target.value }))}
                              onBlur={saveInlineCost}
                              onKeyDown={e => { if (e.key === 'Enter') saveInlineCost(); if (e.key === 'Escape') setInlineEdit(null); }} />
                          : <span style={{ ...inlineCellSt, ...(color ? { color } : {}) }}>{fmt ? fmt(value) : value}</span>}
                      </div>
                    );

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
                              ? <input autoFocus type="number" min="0" step="0.5" style={{ ...inlineInputSt, width: 56 }} value={ie.value}
                                  placeholder={`${rubro.margenMat}/${rubro.margenMO}`}
                                  onChange={e => setInlineEdit(x => ({ ...x, value: e.target.value }))}
                                  onBlur={saveInlineCost}
                                  onKeyDown={e => { if (e.key === 'Enter') saveInlineCost(); if (e.key === 'Escape') setInlineEdit(null); }} />
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
                    <div className="k-tr" style={{ cursor: 'pointer' }} onClick={() => { setAddingTask(rubro.id); setSelTask(null); }}>
                      <div className="k-cell" style={{ flex: 1, color: T.accent, fontSize: 12 }}>+ Agregar tarea</div>
                    </div>
                  )}
                </>
              )}
            </Box>
          ))}

          {addingRubro && (
            <FormPanel title="Nuevo rubro" onSave={saveRubro} onCancel={() => setAddingRubro(false)}>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1.5fr', gap: 10 }}>
                <FInput label="Nombre" value={newRubro.nombre} onChange={v => setNewRubro(p => ({ ...p, nombre: v }))} placeholder="Ej: ELECTRICIDAD" />
                <FInput label="% margen mat" value={newRubro.margenMat} onChange={v => setNewRubro(p => ({ ...p, margenMat: v }))} type="number" />
                <FInput label="% margen Sub" value={newRubro.margenMO} onChange={v => setNewRubro(p => ({ ...p, margenMO: v }))} type="number" />
                <FInput label="Proveedor" value={newRubro.proveedor} onChange={v => setNewRubro(p => ({ ...p, proveedor: v }))} placeholder="Nombre proveedor" />
              </div>
            </FormPanel>
          )}
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
                        <input type="number" min="0" value={m.costoUnit} style={{ width: 60, fontSize: 10, padding: '1px 4px', border: `1px solid ${T.faint2}`, borderRadius: 2, fontFamily: T.fontMono, textAlign: 'right' }}
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
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 2: MATERIALES
// ─────────────────────────────────────────────────────────────────────────────
function TabMateriales({ detalle }) {
  const [selRubroId, setSelRubroId] = useState(null);

  const rubroMats = useMemo(() => {
    return detalle.rubros.map(rubro => {
      const lineas = [];
      for (const t of rubro.tareas) {
        const mats = t.receta?.materiales || [];
        if (mats.length > 0) {
          mats.forEach(m => lineas.push({
            key: `${t.id}-${m.id}`,
            tarea: t.nombre,
            tareaQty: t.cantidad,
            tareaUnidad: t.unidad,
            nombre: m.nombre,
            categoria: m.categoria || 'General',
            costoUnitTarea: m.costoUnit || 0,
            total: (m.costoUnit || 0) * t.cantidad,
          }));
        } else if (t.costoMat > 0) {
          lineas.push({
            key: t.id,
            tarea: t.nombre,
            tareaQty: t.cantidad,
            tareaUnidad: t.unidad,
            nombre: 'Materiales (según presupuesto)',
            categoria: 'General',
            costoUnitTarea: t.costoMat,
            total: t.costoMat * t.cantidad,
          });
        }
      }
      return { rubro, lineas, total: lineas.reduce((s, l) => s + l.total, 0) };
    });
  }, [detalle.rubros]);

  const totalGeneral = rubroMats.reduce((s, r) => s + r.total, 0);
  const rubrosConMats = rubroMats.filter(r => r.lineas.length > 0);
  const visible = selRubroId ? rubroMats.filter(r => r.rubro.id === selRubroId) : rubrosConMats;

  return (
    <div style={{ display: 'flex', gap: 12, height: 'calc(100vh - 240px)' }}>

      {/* Sidebar: gremios */}
      <div style={{ width: 200, flexShrink: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div onClick={() => setSelRubroId(null)}
          style={{ padding: '8px 10px', borderRadius: 4, cursor: 'pointer', border: `1px solid ${!selRubroId ? T.accent : T.faint2}`, background: !selRubroId ? T.accentSoft : T.paper }}>
          <div style={{ fontSize: 12, fontWeight: !selRubroId ? 700 : 400 }}>Todos los gremios</div>
          <div style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 13, color: T.accent, marginTop: 2 }}>$ {fmtN(totalGeneral)}</div>
        </div>
        {rubrosConMats.map(({ rubro, total }) => (
          <div key={rubro.id} onClick={() => setSelRubroId(rubro.id)}
            style={{ padding: '8px 10px', borderRadius: 4, cursor: 'pointer', border: `1px solid ${selRubroId === rubro.id ? T.accent : T.faint2}`, background: selRubroId === rubro.id ? T.accentSoft : T.paper }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{rubro.nombre}</div>
            <div style={{ fontFamily: T.fontMono, color: T.accent, fontSize: 11, marginTop: 2 }}>$ {fmtN(total)}</div>
          </div>
        ))}
      </div>

      {/* Main: material table */}
      <Box style={{ flex: 1, padding: 0, overflow: 'auto' }}>
        {visible.length === 0 && (
          <div style={{ padding: 48, textAlign: 'center', color: T.ink3 }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>🧱</div>
            <div style={{ fontSize: 12 }}>Sin materiales registrados. Agregá recetas a las tareas desde la pestaña Presupuesto.</div>
          </div>
        )}
        {visible.map(({ rubro, lineas, total }) => (
          <div key={rubro.id}>
            {/* Rubro header */}
            <div style={{ padding: '10px 16px', background: T.dark, color: T.paper, display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' }}>{rubro.nombre}</div>
              <div style={{ fontFamily: T.fontMono, fontSize: 13, color: T.accent }}>$ {fmtN(total)}</div>
            </div>
            {/* Column headers */}
            <div className="k-tr" style={{ background: T.faint, fontWeight: 700, fontSize: 10, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.4 }}>
              <div className="k-cell" style={{ flex: 2.5 }}>Material</div>
              <div className="k-cell" style={{ flex: 0.8 }}>Categoría</div>
              <div className="k-cell" style={{ flex: 2 }}>Tarea</div>
              <div className="k-cell" style={{ flex: 0.7, textAlign: 'right' }}>Cant</div>
              <div className="k-cell" style={{ flex: 1, textAlign: 'right' }}>$ / u. tarea</div>
              <div className="k-cell" style={{ flex: 1, textAlign: 'right' }}>Total $</div>
            </div>
            {/* Rows */}
            {lineas.map(l => (
              <div key={l.key} className="k-tr" style={{ alignItems: 'center' }}>
                <div className="k-cell" style={{ flex: 2.5, fontWeight: 600, fontSize: 12 }}>{l.nombre}</div>
                <div className="k-cell" style={{ flex: 0.8 }}>
                  <Chip style={{ fontSize: 9 }}>{l.categoria}</Chip>
                </div>
                <div className="k-cell" style={{ flex: 2, fontSize: 11, color: T.ink2 }}>{l.tarea}</div>
                <div className="k-cell" style={{ flex: 0.7, fontFamily: T.fontMono, textAlign: 'right', fontSize: 11, color: T.ink2 }}>{l.tareaQty} {l.tareaUnidad}</div>
                <div className="k-cell" style={{ flex: 1, fontFamily: T.fontMono, textAlign: 'right', fontSize: 11, color: T.ink2 }}>$ {fmtN(l.costoUnitTarea)}</div>
                <div className="k-cell" style={{ flex: 1, fontFamily: T.fontMono, textAlign: 'right', fontWeight: 700, fontSize: 12 }}>$ {fmtN(l.total)}</div>
              </div>
            ))}
          </div>
        ))}
      </Box>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 3: ADICIONALES
// ─────────────────────────────────────────────────────────────────────────────
function TabAdicionales({ detalle, patch, moneda }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ descripcion: '', fecha: new Date().toISOString().split('T')[0], monto: '' });

  const save = () => {
    if (!form.descripcion.trim() || !form.monto) return;
    patch(d => ({ ...d, adicionales: [...d.adicionales, { id: newId(), ...form, monto: +form.monto, estado: 'pendiente' }] }));
    setAdding(false);
    setForm({ descripcion: '', fecha: new Date().toISOString().split('T')[0], monto: '' });
  };

  const setState = (id, estado) => patch(d => ({ ...d, adicionales: d.adicionales.map(a => a.id === id ? { ...a, estado } : a) }));
  const del = (id) => patch(d => ({ ...d, adicionales: d.adicionales.filter(a => a.id !== id) }));

  const total = detalle.adicionales.filter(a => a.estado === 'aprobado').reduce((s, a) => s + a.monto, 0);

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 13, color: T.ink2 }}>
            {detalle.adicionales.length} adicionales · aprobados: <b>{fmtM(total, moneda)}</b>
          </div>
        </div>
        <Btn sm fill onClick={() => setAdding(true)}>+ Adicional</Btn>
      </div>

      {adding && (
        <FormPanel title="Nuevo adicional" onSave={save} onCancel={() => setAdding(false)} style={{ marginBottom: 14 }}>
          <FInput label="Descripción" value={form.descripcion} onChange={v => setForm(p => ({ ...p, descripcion: v }))} placeholder="Ej: Ampliación tablero secundario" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <FInput label="Monto" value={form.monto} onChange={v => setForm(p => ({ ...p, monto: v }))} type="number" />
            <FInput label="Fecha" value={form.fecha} onChange={v => setForm(p => ({ ...p, fecha: v }))} type="date" />
          </div>
        </FormPanel>
      )}

      {detalle.adicionales.length === 0 ? (
        <div style={{ color: T.ink3, padding: 24, textAlign: 'center' }}>Sin adicionales registrados</div>
      ) : (
        <Box style={{ padding: 0, overflow: 'hidden' }}>
          {detalle.adicionales.map((a, i) => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', padding: '12px 14px', borderBottom: i < detalle.adicionales.length - 1 ? `1px solid ${T.faint2}` : 'none', gap: 12 }}>
              <div style={{ flex: 3 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{a.descripcion}</div>
                <div style={{ fontSize: 11, color: T.ink2 }}>{fmtD(a.fecha)}</div>
              </div>
              <div style={{ fontFamily: T.fontMono, fontWeight: 700, fontSize: 14 }}>{fmtM(a.monto, moneda)}</div>
              <Chip ok={a.estado === 'aprobado'} warn={a.estado === 'pendiente'} accent={a.estado === 'rechazado'} style={{ fontSize: 10 }}>{a.estado}</Chip>
              {a.estado === 'pendiente' && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <Btn sm onClick={() => setState(a.id, 'aprobado')}>✓ Aprobar</Btn>
                  <Btn sm style={{ color: T.accent, borderColor: T.accent }} onClick={() => setState(a.id, 'rechazado')}>✕</Btn>
                </div>
              )}
              <span style={{ color: T.accent, cursor: 'pointer', fontSize: 12 }} onClick={() => del(a.id)}>🗑</span>
            </div>
          ))}
        </Box>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 3: MOVIMIENTOS (connected to MovimientosContext)
// ─────────────────────────────────────────────────────────────────────────────
const inputStMov = { padding: '6px 10px', border: `1.2px solid ${T.faint2}`, borderRadius: 4, fontFamily: T.font, fontSize: 12, background: T.paper, boxSizing: 'border-box', outline: 'none' };
const fmtFechaShort = (iso) => { if (!iso) return ''; const [, m, d] = iso.split('-'); return `${d}/${m}`; };
const todayStrOp = () => new Date().toISOString().split('T')[0];

function ObraMovRow({ m, cajas, onRemove }) {
  const [hover, setHover] = useState(false);
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
          {m.proveedor && <span>· {m.proveedor}</span>}
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
          <span style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>{isGasto ? 'Proveedor' : 'Cliente'}</span>
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
function TabCuentaCliente({ detalle, patch, moneda }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ descripcion: '', fecha: '', monto: '' });

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
  const [printContrato, setPrintContrato] = useState(null);

  const rubros = detalle.rubros || [];
  const contratos = detalle.contratos || [];

  const rubroSel = rubros.find(r => r.id === form.rubroId) || null;

  const tareasDisponibles = rubroSel
    ? rubroSel.tareas.filter(t => calcTareaContratada(t.id, contratos) < t.cantidad)
    : [];

  const onRubroChange = (rubroId) => {
    const r = rubros.find(x => x.id === rubroId);
    setForm(p => ({ ...p, rubroId, gremio: r?.nombre || '', tareasSel: {} }));
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
    if (!form.rubroId || !form.proveedor.trim()) return;
    const tareas = Object.entries(form.tareasSel)
      .filter(([, v]) => (v.cantidad || 0) > 0)
      .map(([tareaId, v]) => {
        const t = rubroSel.tareas.find(x => x.id === tareaId);
        return { tareaId, rubroId: form.rubroId, nombre: t.nombre, unidad: t.unidad, cantidadTotal: t.cantidad, cantidadContratada: +v.cantidad, precioUnit: +v.precioUnit };
      });
    patch(d => ({ ...d, contratos: [...d.contratos, { id: newId(), gremio: form.gremio, rubroId: form.rubroId, proveedor: form.proveedor, cuit: form.cuit, fechaInicio: form.fechaInicio, fechaFin: form.fechaFin, fondoReparo: +form.fondoReparo, formaPago: form.formaPago, estado: 'activo', tareas, monto: totalContrato }] }));
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
        <FormPanel title="Nuevo contrato MO" onSave={save} onCancel={() => { setAdding(false); setForm(FORM_INIT); }} style={{ marginBottom: 14 }}>
          {/* Fila 1: gremio + proveedor + cuit */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <FRow label="Gremio / rubro">
              <select style={{ ...inputSt, cursor: 'pointer' }} value={form.rubroId} onChange={e => onRubroChange(e.target.value)}>
                <option value="">— Seleccionar rubro —</option>
                {rubros.map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}
              </select>
            </FRow>
            <FRow label="Proveedor / contratista">
              <select style={{ ...inputSt, cursor: 'pointer' }} value={form.proveedor}
                onChange={e => {
                  const prov = PROVEEDORES.find(p => p.nombre === e.target.value);
                  setForm(p => ({ ...p, proveedor: e.target.value, cuit: prov ? prov.cuit : p.cuit }));
                }}>
                <option value="">— Seleccionar proveedor —</option>
                {PROVEEDORES.map(p => <option key={p.id} value={p.nombre}>{p.nombre}</option>)}
              </select>
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
              <div style={{ fontSize: 11, fontWeight: 700, color: T.ink2, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Tareas disponibles — {rubroSel.nombre}
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
                <div style={{ fontSize: 12, color: T.ink2 }}>{c.proveedor}{c.cuit ? ` · CUIT ${c.cuit}` : ''}</div>
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
function TabDocumentos({ detalle, patch }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ nombre: '', tipo: 'Contrato', fecha: new Date().toISOString().split('T')[0] });
  const TIPOS_DOC = ['Contrato', 'Presupuesto', 'Planos', 'Certificado', 'Factura', 'Permiso', 'Otro'];

  const save = () => {
    if (!form.nombre.trim()) return;
    patch(d => ({ ...d, documentos: [...d.documentos, { id: newId(), ...form }] }));
    setAdding(false);
    setForm({ nombre: '', tipo: 'Contrato', fecha: new Date().toISOString().split('T')[0] });
  };

  const del = (id) => patch(d => ({ ...d, documentos: d.documentos.filter(dc => dc.id !== id) }));

  return (
    <div style={{ maxWidth: 700 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <Btn sm fill onClick={() => setAdding(true)}>+ Documento</Btn>
      </div>

      {adding && (
        <FormPanel title="Agregar documento" onSave={save} onCancel={() => setAdding(false)} style={{ marginBottom: 14 }}>
          <FInput label="Nombre del documento" value={form.nombre} onChange={v => setForm(p => ({ ...p, nombre: v }))} placeholder="Ej: Contrato de obra firmado" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <FSelect label="Tipo" value={form.tipo} onChange={v => setForm(p => ({ ...p, tipo: v }))} options={TIPOS_DOC} />
            <FInput label="Fecha" value={form.fecha} onChange={v => setForm(p => ({ ...p, fecha: v }))} type="date" />
          </div>
          <div style={{ background: T.faint, borderRadius: 4, padding: '10px 12px', fontSize: 12, color: T.ink2, textAlign: 'center', cursor: 'pointer', border: `1.5px dashed ${T.faint2}` }}>
            📎 Arrastrar archivo o hacer click para adjuntar (próximamente)
          </div>
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
              <Btn sm>↓ Descargar</Btn>
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
function TabFotos({ detalle, patch }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ label: '', fecha: new Date().toISOString().split('T')[0], rubro: '' });

  const save = () => {
    if (!form.label.trim()) return;
    patch(d => ({ ...d, fotos: [...d.fotos, { id: newId(), ...form }] }));
    setAdding(false);
    setForm({ label: '', fecha: new Date().toISOString().split('T')[0], rubro: '' });
  };

  const del = (id) => patch(d => ({ ...d, fotos: d.fotos.filter(f => f.id !== id) }));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: T.ink2 }}>{detalle.fotos.length} fotos</div>
        <Btn sm fill onClick={() => setAdding(true)}>📷 Agregar foto</Btn>
      </div>

      {adding && (
        <FormPanel title="Agregar foto" onSave={save} onCancel={() => setAdding(false)} style={{ marginBottom: 14, maxWidth: 500 }}>
          <FInput label="Descripción" value={form.label} onChange={v => setForm(p => ({ ...p, label: v }))} placeholder="Ej: Tablero instalado" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <FInput label="Fecha" value={form.fecha} onChange={v => setForm(p => ({ ...p, fecha: v }))} type="date" />
            <FInput label="Rubro" value={form.rubro} onChange={v => setForm(p => ({ ...p, rubro: v }))} placeholder="Ej: Electricidad" />
          </div>
          <div style={{ background: T.faint, borderRadius: 4, padding: '14px', fontSize: 12, color: T.ink2, textAlign: 'center', cursor: 'pointer', border: `1.5px dashed ${T.faint2}` }}>
            📷 Tomar foto o seleccionar de galería (próximamente)
          </div>
        </FormPanel>
      )}

      {detalle.fotos.length === 0 ? (
        <div style={{ color: T.ink3, padding: 40, textAlign: 'center' }}>Sin fotos. Agregá la primera.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {detalle.fotos.map(f => (
            <div key={f.id} style={{ position: 'relative', group: true }}>
              <div style={{ background: T.faint2, borderRadius: 6, aspectRatio: '4/3', display: 'flex', alignItems: 'flex-end', overflow: 'hidden', border: `1.5px solid ${T.faint2}` }}>
                <div style={{ background: 'rgba(0,0,0,0.5)', color: 'white', padding: '5px 8px', width: '100%' }}>
                  <div style={{ fontSize: 11, fontWeight: 700 }}>{f.label}</div>
                  <div style={{ fontSize: 9, opacity: 0.8 }}>{fmtD(f.fecha)}{f.rubro ? ` · ${f.rubro}` : ''}</div>
                </div>
              </div>
              <span style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,0.5)', color: 'white', borderRadius: 3, fontSize: 10, padding: '1px 5px', cursor: 'pointer' }}
                onClick={() => del(f.id)}>✕</span>
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
const TABS_DEF = ['Resumen', 'Presupuesto', 'Materiales', 'Adicionales', 'Gantt', 'Movimientos', 'Cuenta cliente', 'Contratos MO', 'Documentos', 'Fotos', 'Portal cliente'];

export default function ObraPresupuesto() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { obras, getDetalle, patchDetalle } = useObras();
  const { currentUser } = useUsuarios();
  const tabsOcultos = currentUser?.tabsOcultos ?? [];
  const [activeTab, setActiveTab] = useState(() => {
    const t = parseInt(searchParams.get('tab'), 10);
    return isNaN(t) ? 0 : t;
  });
  const [showExport, setShowExport] = useState(false);
  const [showContrato, setShowContrato] = useState(false);

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
    return t;
  });

  // Filter to visible tab indices; if current tab is hidden, fall back to first visible
  const visibleTabIndices = TABS_DEF.reduce((acc, t, i) => { if (!tabsOcultos.includes(t)) acc.push(i); return acc; }, []);
  const displayTab = visibleTabIndices.includes(activeTab) ? activeTab : (visibleTabIndices[0] ?? 0);

  const handleTab = (i) => {
    if (TABS_DEF[i] === 'Gantt') { navigate(`/obras/${id}/gantt`); return; }
    if (TABS_DEF[i] === 'Portal cliente') { navigate(`/portal/cliente/${id}`); return; }
    setActiveTab(i);
  };

  const estadoColor = { activa: T.ok, 'en-presupuesto': T.ink2, pausada: T.warn, finalizada: T.accent, archivada: T.ink3 };

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
            {obra.cliente && <span>{obra.cliente} · </span>}
            <span>{obra.tipo || 'Obra'} · {moneda}</span>
            {obra.fechaFinEstim && <span> · entrega est. {fmtD(obra.fechaFinEstim)}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Btn sm onClick={() => navigate('/obras')}>← Obras</Btn>
          <Btn sm onClick={() => setShowExport(true)}>↗ Exportar</Btn>
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
      {displayTab === 0 && <TabResumen obra={obra} detalle={detalle} moneda={moneda} />}
      {displayTab === 1 && <TabPresupuesto obra={obra} detalle={detalle} patch={patch} moneda={moneda} />}
      {displayTab === 2 && <TabMateriales detalle={detalle} />}
      {displayTab === 3 && <TabAdicionales detalle={detalle} patch={patch} moneda={moneda} />}
      {displayTab === 5 && <TabMovimientos obra={obra} moneda={moneda} />}
      {displayTab === 6 && <TabCuentaCliente detalle={detalle} patch={patch} moneda={moneda} />}
      {displayTab === 7 && <TabContratosMO detalle={detalle} patch={patch} moneda={moneda} obra={obra} />}
      {displayTab === 8 && <TabDocumentos detalle={detalle} patch={patch} />}
      {displayTab === 9 && <TabFotos detalle={detalle} patch={patch} />}

      {showExport && <ExportModal onClose={() => setShowExport(false)} obra={obra} detalle={detalle} />}
      {showContrato && <ContratoMOModal onClose={() => setShowContrato(false)} />}
    </PageLayout>
  );
}
