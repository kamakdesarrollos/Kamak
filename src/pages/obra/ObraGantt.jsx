import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import PageLayout from '../../components/layout/PageLayout';
import { Btn } from '../../components/ui';
import { T } from '../../theme';
import { useObras } from '../../store/ObrasContext';
import { useUsuarios, ROL_TABS_OCULTAS, ROL_TABS_OCULTAS_DEFAULT } from '../../store/UsuariosContext';
import { useIsMobile } from '../../hooks/useMediaQuery';

// ── Fixed constants ────────────────────────────────────────────────────────────
const TOT_WEEKS  = 60;
const TOT_DAYS   = TOT_WEEKS * 7;
const TASK_H     = 36;
const RUBRO_H    = 26;
const HDR_H1     = 26;
const HDR_H2     = 20;
const LEFT_W     = 244;
const R_HANDLE   = 9;
const L_HANDLE   = 9;
const GAP_DAYS   = 5;
const ZOOM_MIN   = 8;
const ZOOM_MAX   = 2000;
const ZOOM_DEF   = 44;

const ZOOM_PRESETS = [
  { label: 'Hora',       val: 1680 },
  { label: 'Día',        val: 120  },
  { label: 'Semana',     val: 44   },
  { label: 'Mes',        val: 18   },
  { label: 'Total',      val: 10   },
];

// Debe mantenerse SINCRONIZADO con TABS_DEF de ObraPresupuesto.jsx para que
// la barra de pestañas se vea igual entre Gantt y el resto de los tabs.
const TABS_DEF = ['Resumen', 'Cuenta corriente', 'Presupuesto', 'Materiales', 'Gantt', 'Movimientos', 'Contratos MO', 'Archivos', 'Portal cliente'];

const RUBRO_COLORS = {
  ELECTRICIDAD: '#1a9b9c', ALBAÑILERÍA: '#d4923a', ESTRUCTURA: '#3d7a4a',
  PLOMERÍA: '#4a7ab5', PINTURA: '#b54a6e', CARPINTERÍA: '#7a4ab5',
};
const rCol = (n) => RUBRO_COLORS[(n || '').toUpperCase()] ?? '#6b7280';

const hex2rgba = (hex, a) => {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)},${a})`;
};
const blendWhite = (hex, a) => {
  const h = hex.replace('#', '');
  return `rgb(${Math.round(parseInt(h.slice(0,2),16)*a+255*(1-a))},${Math.round(parseInt(h.slice(2,4),16)*a+255*(1-a))},${Math.round(parseInt(h.slice(4,6),16)*a+255*(1-a))})`;
};

// ── Helpers ────────────────────────────────────────────────────────────────────
const newId   = () => `gt-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;
const isoAdd  = (iso, days) => { if (!iso) return ''; const d = new Date(iso+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+Math.round(days)); return d.toISOString().split('T')[0]; };
const fmtShort = (iso) => { if (!iso) return '—'; const [y,m,d] = iso.split('-'); return `${d}/${m}/${String(y).slice(2)}`; };
const daysBetween = (a,b) => (!a||!b) ? 0 : Math.round((new Date(b+'T12:00:00Z')-new Date(a+'T12:00:00Z'))/86400000);
const MONTH_NAMES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

function genMonths(startIso) {
  if (!startIso) return [];
  const months = []; let cur = new Date(startIso+'T12:00:00Z'), day = 0;
  while (day < TOT_DAYS) {
    const y = cur.getUTCFullYear(), m = cur.getUTCMonth();
    const dInM = new Date(Date.UTC(y,m+1,0)).getUTCDate();
    const rem  = dInM - cur.getUTCDate() + 1;
    const len  = Math.min(rem, TOT_DAYS-day);
    months.push({ label: `${MONTH_NAMES[m]} ${String(y).slice(2)}`, days: len, startDay: day });
    day += rem; cur = new Date(Date.UTC(y, m+1, 1));
  }
  return months;
}

function genDays(startIso) {
  if (!startIso) return [];
  const base = new Date(startIso + 'T12:00:00Z');
  return Array.from({ length: TOT_DAYS }, (_, i) => {
    const d = new Date(base); d.setUTCDate(base.getUTCDate() + i);
    return { dayOfMonth: d.getUTCDate(), dayOfWeek: d.getUTCDay(), startDay: i };
  });
}

function getSegments(task) {
  if (!task.splits?.length) return [{ start: task.startDay, dur: task.duration }];
  const segs = []; let pos = 0;
  const sorted = [...task.splits].sort((a,b) => a.at - b.at);
  for (const sp of sorted) {
    if (sp.at > pos) segs.push({ start: task.startDay+pos, dur: sp.at-pos });
    pos = sp.at + sp.len;
  }
  if (pos < task.duration) segs.push({ start: task.startDay+pos, dur: task.duration-pos });
  return segs;
}

function initFromRubros(rubros, startIso) {
  const ORDER = ['ESTRUCTURA','ALBAÑILERÍA','PLOMERÍA','ELECTRICIDAD','PINTURA','CARPINTERÍA'];
  const sorted = [...(rubros||[])].sort((a,b) => { const ai=ORDER.indexOf(a.nombre.toUpperCase()),bi=ORDER.indexOf(b.nombre.toUpperCase()); return (ai<0?99:ai)-(bi<0?99:bi); });
  const tasks = []; let rubroStart = 0;
  for (const r of sorted) {
    let d = rubroStart;
    for (const t of r.tareas) {
      tasks.push({ id: newId(), rubroId: r.id, rubroNombre: r.nombre, tareaId: t.id, nombre: t.nombre, startDay: d, duration: 21, startHour: 8, endDay: d+20, endHour: 17, avance: t.avance, deps: [], splits: [], isExtra: false });
      d += 7;
    }
    rubroStart = d + 14;
  }
  return { startDate: startIso || new Date().toISOString().split('T')[0], tasks };
}

function mergeGantt(saved, rubros) {
  const existing = new Set(saved.tasks.map(t => t.tareaId).filter(Boolean));
  const extra = [];
  for (const r of (rubros||[])) {
    for (const t of r.tareas) {
      if (!existing.has(t.id)) {
        const last = saved.tasks.filter(g=>g.rubroId===r.id).sort((a,b)=>(b.startDay+b.duration)-(a.startDay+a.duration))[0];
        extra.push({ id: newId(), rubroId: r.id, rubroNombre: r.nombre, tareaId: t.id, nombre: t.nombre, startDay: last?last.startDay+last.duration+7:0, duration: 21, startHour: 8, endDay: last?last.startDay+last.duration+26:20, endHour: 17, avance: t.avance, deps: [], splits: [], isExtra: false });
      }
    }
  }
  return { ...saved, tasks: [...saved.tasks, ...extra] };
}

// Match rubro name to contrato gremio (case-insensitive partial)
const matchGremio = (rubroNombre, gremio) => {
  const r = (rubroNombre||'').toUpperCase().trim(), g = (gremio||'').toUpperCase().trim();
  if (!r || !g) return false; // sin gremio NO matchea (antes '' pisaba TODOS los contratos)
  return r.includes(g) || g.includes(r);
};

// ── Component ──────────────────────────────────────────────────────────────────
export default function ObraGantt() {
  const { id }   = useParams();
  const navigate = useNavigate();
  const { obras, getDetalle, patchDetalle } = useObras();
  const { currentUser } = useUsuarios();
  const isMobile = useIsMobile();
  const LEFT_W_MOBILE = 88;
  const LEFT_W_EFF = isMobile ? LEFT_W_MOBILE : LEFT_W;
  const isAdmin = currentUser?.rol === 'Admin';
  // Mapa único de pestañas ocultas por rol (compartido con ObraPresupuesto).
  const rolHiddenTabs = isAdmin ? [] : (ROL_TABS_OCULTAS[currentUser?.rol] ?? ROL_TABS_OCULTAS_DEFAULT);
  const canSeeGantt = isAdmin || !rolHiddenTabs.includes('Gantt');
  // Guard: si el rol no puede ver Gantt, redirigir a /obras (antes el codigo seguia ejecutando).
  useEffect(() => {
    if (currentUser && !canSeeGantt) navigate('/obras', { replace: true });
  }, [currentUser, canSeeGantt, navigate]);
  const tabsOcultos = currentUser?.tabsOcultos ?? [];
  const allHiddenTabs = new Set([...tabsOcultos, ...rolHiddenTabs]);

  const obra    = obras.find(o => o.id === id) || { nombre: id||'—', fechaInicio: '' };
  const detalle = getDetalle(id||'');

  // ── Gantt state ──
  const [gantt, setGantt] = useState(() => {
    const saved = detalle.gantt;
    if (saved?.tasks?.length) return mergeGantt(saved, detalle.rubros);
    return initFromRubros(detalle.rubros, obra.fechaInicio);
  });
  const ganttRef = useRef(gantt);
  useEffect(() => { ganttRef.current = gantt; }, [gantt]);

  const saveGantt = useCallback((g) => {
    setGantt(g);
    patchDetalle(id, d => ({ ...d, gantt: g }));
  }, [id, patchDetalle]);

  // ── Zoom state ──
  const [weekPx, setWeekPx]   = useState(ZOOM_DEF);
  const dayPx                  = weekPx / 7;        // derived — no useMemo needed
  const weekPxRef              = useRef(weekPx);

  // Preserve viewport center during zoom
  useEffect(() => {
    const el = containerRef.current;
    if (!el || weekPxRef.current === weekPx) return;
    el.scrollLeft = el.scrollLeft * (weekPx / weekPxRef.current);
    weekPxRef.current = weekPx;
  }, [weekPx]);

  // ── UI state ──
  const [selId,       setSelId]       = useState(null);
  const [drag,        setDrag]        = useState(null);
  const [splitMode,   setSplitMode]   = useState(false);
  const [addingDep,   setAddingDep]   = useState(false);
  const [depSearch,   setDepSearch]   = useState('');
  const [showAdd,     setShowAdd]     = useState(false);
  const [newForm,     setNewForm]     = useState({ nombre: '', rubroNombre: '', duration: 21 });

  const containerRef  = useRef(null);
  const mouseDownRef  = useRef(false);

  // Auto-scroll to today on mount
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !gantt.startDate) return;
    const todayDay = daysBetween(gantt.startDate, new Date().toISOString().split('T')[0]);
    if (todayDay > 0) el.scrollLeft = Math.max(0, todayDay * dayPx - 220);
  }, []); // eslint-disable-line

  // ── Derived ──
  const months    = useMemo(() => genMonths(gantt.startDate), [gantt.startDate]);
  const isHourView = weekPx >= 700;
  const isDayView  = !isHourView && weekPx >= 65;
  const hourPx     = dayPx / 24;
  const gridStep   = isHourView ? hourPx : isDayView ? dayPx : weekPx;
  const days = useMemo(() => (isHourView || isDayView) ? genDays(gantt.startDate) : [], [isHourView, isDayView, gantt.startDate]);
  const hourLabels = useMemo(() => {
    if (!isHourView || !gantt.startDate) return [];
    const interval = hourPx >= 30 ? 1 : hourPx >= 15 ? 2 : hourPx >= 8 ? 4 : 6;
    const labels = [];
    for (let di = 0; di < TOT_DAYS; di++) {
      for (let h = 0; h < 24; h += interval) {
        labels.push({ key: `${di}-${h}`, left: di * dayPx + h * hourPx, hour: h });
      }
    }
    return labels;
  }, [isHourView, hourPx, dayPx, gantt.startDate]);

  const rows = useMemo(() => {
    const groups = {}, order = [];
    for (const t of gantt.tasks) {
      const g = t.rubroNombre || '— Tareas extra';
      if (!groups[g]) { groups[g] = []; order.push(g); }
      groups[g].push(t);
    }
    const result = [];
    for (const g of order) { result.push({ type: 'rubro', nombre: g }); for (const task of groups[g]) result.push({ type: 'task', task }); }
    return result;
  }, [gantt.tasks]);

  const { rowYMap, totalContentH } = useMemo(() => {
    const map = {}; let y = 0;
    for (const row of rows) { if (row.type==='task') { map[row.task.id]=y+TASK_H/2; y+=TASK_H; } else y+=RUBRO_H; }
    return { rowYMap: map, totalContentH: y };
  }, [rows]);

  const depArrows = useMemo(() => {
    const arrows = [];
    for (const task of gantt.tasks) {
      for (const depId of task.deps) {
        const dep = gantt.tasks.find(t => t.id === depId);
        if (!dep) continue;
        const x1=( dep.startDay + dep.duration)*dayPx, y1=rowYMap[dep.id]??-1;
        const x2=task.startDay*dayPx, y2=rowYMap[task.id]??-1;
        if (y1<0||y2<0) continue;
        arrows.push({ x1, y1, x2, y2, color: rCol(dep.rubroNombre) });
      }
    }
    return arrows;
  }, [gantt.tasks, rowYMap, dayPx]); // re-compute on zoom

  const todayDay = useMemo(() => daysBetween(gantt.startDate, new Date().toISOString().split('T')[0]), [gantt.startDate]);
  const selTask  = gantt.tasks.find(t => t.id === selId) || null;

  // CSS grid background — day lines in day view, week lines otherwise
  const weekBg = `repeating-linear-gradient(90deg,transparent 0px,transparent ${gridStep-1}px,${T.faint2} ${gridStep-1}px,${T.faint2} ${gridStep}px)`;

  // ── Drag ──
  useEffect(() => {
    if (!drag) return;
    const onMove = (e) => {
      if (drag.isHourView) {
        const dh = Math.round((e.clientX - drag.startX) / drag.hourPx);
        setGantt(prev => ({ ...prev, tasks: prev.tasks.map(t => {
          if (t.id !== drag.taskId) return t;
          if (drag.type === 'move') {
            const ns = drag.origTotalStartH + dh, ne = drag.origTotalEndH + dh;
            const nsd = Math.max(0, Math.floor(ns / 24)), nsh = ((ns % 24)+24)%24;
            const ned = Math.max(nsd, Math.floor(ne / 24)), neh = ((ne % 24)+24)%24;
            return { ...t, startDay: nsd, startHour: nsh, endDay: ned, endHour: neh, duration: Math.max(1, ned-nsd+1) };
          }
          if (drag.type === 'resize-right') {
            const ne = Math.max(drag.origTotalStartH + 1, drag.origTotalEndH + dh);
            const ned = Math.max(drag.origStartDay, Math.floor(ne / 24)), neh = ((ne % 24)+24)%24;
            return { ...t, endDay: ned, endHour: neh, duration: Math.max(1, ned-drag.origStartDay+1) };
          }
          if (drag.type === 'resize-left') {
            const ns = Math.min(drag.origTotalEndH - 1, Math.max(0, drag.origTotalStartH + dh));
            const nsd = Math.max(0, Math.floor(ns / 24)), nsh = ((ns % 24)+24)%24;
            return { ...t, startDay: nsd, startHour: nsh, duration: Math.max(1, drag.origEndDay-nsd+1) };
          }
          return t;
        })}));
      } else {
        const delta = Math.round((e.clientX - drag.startX) / drag.dayPx);
        setGantt(prev => ({
          ...prev, tasks: prev.tasks.map(t => {
            if (t.id !== drag.taskId) return t;
            if (drag.type==='move')         return { ...t, startDay: Math.max(0, drag.origStart+delta) };
            if (drag.type==='resize-right') return { ...t, duration: Math.max(1, drag.origDur+delta) };
            if (drag.type==='resize-left')  { const ns=Math.max(0,drag.origStart+delta); return { ...t, startDay: ns, duration: Math.max(1,drag.origDur-(ns-drag.origStart)) }; }
            return t;
          }),
        }));
      }
    };
    const onUp = () => {
      setDrag(null);
      patchDetalle(id, d => ({ ...d, gantt: ganttRef.current }));
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [drag, id, patchDetalle]);

  // ── Tab navigation ──
  const handleTabClick = (i) => {
    if (TABS_DEF[i] === 'Gantt') return;
    if (TABS_DEF[i] === 'Portal cliente') { navigate(`/portal/cliente/${id}`); return; }
    navigate(`/obras/${id}/presupuesto?tab=${i}`);
  };

  // ── Actions ──
  const setAvance = useCallback((taskId, av) => {
    const avNum = Math.max(0, Math.min(100, Math.round(av)));
    setGantt(prev => {
      const task = prev.tasks.find(t => t.id === taskId);
      const next = { ...prev, tasks: prev.tasks.map(t => t.id === taskId ? { ...t, avance: avNum } : t) };

      patchDetalle(id, d => {
        // Sync to tarea
        const newRubros = task?.tareaId
          ? (d.rubros||[]).map(r => ({ ...r, tareas: r.tareas.map(t => t.id===task.tareaId ? { ...t, avance: avNum } : t) }))
          : (d.rubros||[]);

        // Sync to MO contract — avance PONDERADO por costo de cada tarea.
        // Antes era promedio simple (todas las tareas pesaban igual), lo
        // que daba resultados absurdos: poner 100% en una tarea de $58
        // certificaba como si fuera proporcional al total del contrato.
        let newContratos = d.contratos||[];
        if (task?.rubroNombre) {
          const rubroTasks = next.tasks.filter(t => t.rubroNombre === task.rubroNombre);
          // Buscar las tareas del detalle (que tienen costo y cantidad) que
          // matchean con las tasks del Gantt por tareaId.
          const tareasDelRubro = (d.rubros || [])
            .filter(r => r.nombre === task.rubroNombre)
            .flatMap(r => r.tareas || []);
          let totalCosto = 0, ejecutado = 0;
          for (const gt of rubroTasks) {
            const td = tareasDelRubro.find(t => t.id === gt.tareaId);
            if (!td || td.tipo === 'seccion') continue;
            const costoUnit = (td.costoMat || 0) + (td.costoSub || 0);
            const costoTot = costoUnit * (td.cantidad || 0);
            totalCosto += costoTot;
            ejecutado  += costoTot * ((gt.avance || 0) / 100);
          }
          // Si no hay costos cargados, fallback al promedio simple anterior.
          const rubroAvg = totalCosto > 0
            ? Math.round(ejecutado / totalCosto * 100)
            : (rubroTasks.length > 0 ? Math.round(rubroTasks.reduce((s,t)=>s+t.avance,0)/rubroTasks.length) : avNum);
          newContratos = newContratos.map(c => matchGremio(task.rubroNombre, c.gremio) ? { ...c, avancePct: rubroAvg } : c);
        }

        return { ...d, gantt: next, rubros: newRubros, contratos: newContratos };
      });
      return next;
    });
  }, [id, patchDetalle]);

  const setFechaInicio = (taskId, iso) => {
    const ns = daysBetween(gantt.startDate, iso);
    if (ns < 0) return;
    const task = gantt.tasks.find(t=>t.id===taskId);
    const curEnd = task?.endDay ?? (task ? task.startDay+task.duration-1 : ns+20);
    const nd = Math.max(1, curEnd - ns + 1);
    saveGantt({ ...gantt, tasks: gantt.tasks.map(t => t.id===taskId ? { ...t, startDay: ns, duration: nd } : t) });
  };
  const setFechaFin = (taskId, iso) => {
    const task = gantt.tasks.find(t=>t.id===taskId);
    if (!task) return;
    const newEnd = Math.max(task.startDay, daysBetween(gantt.startDate, iso));
    const nd = Math.max(1, newEnd - task.startDay + 1);
    saveGantt({ ...gantt, tasks: gantt.tasks.map(t => t.id===taskId ? { ...t, duration: nd, endDay: newEnd } : t) });
  };

  const splitTask = (task, clickDay) => {
    const at = clickDay - task.startDay;
    if (at < 2 || at >= task.duration-2) return;
    saveGantt({ ...gantt, tasks: gantt.tasks.map(t => t.id===task.id ? { ...t, splits: [...(t.splits||[]), { at, len: GAP_DAYS }] } : t) });
    setSplitMode(false);
  };
  const clearSplits = (tid) => saveGantt({ ...gantt, tasks: gantt.tasks.map(t => t.id===tid ? { ...t, splits: [] } : t) });

  const addDep = (from, to) => {
    if (from===to) return;
    const task = gantt.tasks.find(t=>t.id===from);
    if (!task||task.deps.includes(to)) return;
    saveGantt({ ...gantt, tasks: gantt.tasks.map(t => t.id===from ? { ...t, deps: [...t.deps, to] } : t) });
  };
  const removeDep = (tid, depId) => saveGantt({ ...gantt, tasks: gantt.tasks.map(t => t.id===tid ? { ...t, deps: t.deps.filter(d=>d!==depId) } : t) });

  const deleteTask = (tid) => {
    saveGantt({ ...gantt, tasks: gantt.tasks.filter(t=>t.id!==tid).map(t=>({ ...t, deps: t.deps.filter(d=>d!==tid) })) });
    if (selId===tid) setSelId(null);
  };
  const updateHour = useCallback((taskId, field, val) => {
    setGantt(prev => {
      const next = { ...prev, tasks: prev.tasks.map(t => t.id === taskId ? { ...t, [field]: val } : t) };
      patchDetalle(id, d => ({ ...d, gantt: next }));
      return next;
    });
  }, [id, patchDetalle]);

  const addTask = () => {
    if (!newForm.nombre.trim()) return;
    const sd = selTask ? selTask.startDay+selTask.duration+3 : todayDay;
    const dur = Number(newForm.duration)||21;
    const task = { id: newId(), rubroId: null, rubroNombre: newForm.rubroNombre||'— Tareas extra', tareaId: null, nombre: newForm.nombre.trim(), startDay: sd, duration: dur, startHour: 8, endDay: sd+dur-1, endHour: 17, avance: 0, deps: [], splits: [], isExtra: true };
    saveGantt({ ...gantt, tasks: [...gantt.tasks, task] });
    setNewForm({ nombre: '', rubroNombre: '', duration: 21 });
    setShowAdd(false);
    setSelId(task.id);
  };

  const startAvanceDrag = (e, taskId, trackEl) => {
    e.stopPropagation();
    const rect = trackEl.getBoundingClientRect();
    const onMove = (me) => setAvance(taskId, Math.round(Math.max(0, Math.min(1,(me.clientX-rect.left)/rect.width))*100));
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const selStartIso = selTask ? isoAdd(gantt.startDate, selTask.startDay) : '';
  const selEndDay   = selTask ? (selTask.endDay ?? selTask.startDay + selTask.duration - 1) : 0;
  const selEndIso   = selTask ? isoAdd(gantt.startDate, selEndDay) : '';

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <PageLayout breadcrumb={[
      { label: 'Obras', to: '/obras' },
      { label: obra.nombre, to: `/obras/${obra.id}/presupuesto` },
      'Gantt',
    ]} active="Obras">

      {/* ── Tab bar (same as ObraPresupuesto) ── */}
      <div className="k-tabs" style={{ marginBottom: 8 }}>
        {TABS_DEF.map((tab, i) => {
          if (allHiddenTabs.has(tab)) return null;
          return (
            <span key={i} className={`k-tab${tab === 'Gantt' ? ' k-tab-on' : ''}`} onClick={() => handleTabClick(i)}>{tab}</span>
          );
        })}
      </div>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
        <div>
          <div className="k-h" style={{ fontSize: isMobile ? 16 : 20, whiteSpace: isMobile ? 'normal' : 'nowrap', lineHeight: 1.3 }}>{obra.nombre} — Gantt</div>
          <div style={{ fontSize: 12, color: T.ink2 }}>{gantt.tasks.length} tareas · desde {fmtShort(gantt.startDate)}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {/* Zoom presets */}
          <div style={{ display: 'flex', flexWrap: isMobile ? 'wrap' : 'nowrap', gap: 3, background: T.faint, borderRadius: 5, padding: '3px 4px', border: `1.2px solid ${T.faint2}` }}>
            {ZOOM_PRESETS.map(z => (
              <button key={z.label} onClick={() => setWeekPx(z.val)}
                style={{ padding: '3px 9px', background: Math.abs(weekPx-z.val)<5 ? T.accent : 'transparent', color: Math.abs(weekPx-z.val)<5 ? 'white' : T.ink2, border: 'none', borderRadius: 3, cursor: 'pointer', fontFamily: T.font, fontSize: 11, fontWeight: 700 }}>
                {z.label}
              </button>
            ))}
          </div>
          {/* Zoom slider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 12 }}>🔭</span>
            <input type="range" min={ZOOM_MIN} max={ZOOM_MAX} value={weekPx}
              onChange={e => setWeekPx(Number(e.target.value))}
              style={{ width: isMobile ? 'calc(100vw - 140px)' : 88, maxWidth: isMobile ? 160 : 'none', accentColor: T.accent, cursor: 'pointer' }} />
            <span style={{ fontSize: 11, fontFamily: T.fontMono, color: T.ink3, width: 'auto', minWidth: 28 }}>{weekPx}px</span>
          </div>
          <div style={{ width: 1, height: 20, background: T.faint2 }} />
          <Btn sm fill onClick={() => { setShowAdd(v=>!v); setSelId(null); setSplitMode(false); setAddingDep(false); }}>+ Tarea</Btn>
          <Btn sm onClick={() => { setSplitMode(v=>!v); setAddingDep(false); }}
            style={splitMode ? { background: T.warn, color: 'white', border: `1.5px solid ${T.warn}` } : {}}>
            ✂ {splitMode ? 'Cancelar' : 'Cortar'}
          </Btn>
        </div>
      </div>

      {/* ── Main ── */}
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 10, height: isMobile ? 'auto' : 'calc(100vh - 218px)', overflow: isMobile ? 'visible' : 'hidden' }}>

        {/* ── Timeline ── */}
        <div ref={containerRef}
          style={{ flex: 1, overflowX: 'auto', overflowY: 'auto', WebkitOverflowScrolling: 'touch', ...(isMobile ? { height: '62vh', minWidth: 0 } : {}), border: `1.5px solid ${T.faint2}`, borderRadius: 6, background: 'white', position: 'relative', cursor: drag ? 'grabbing' : splitMode ? 'crosshair' : addingDep ? 'cell' : 'default' }}>
          <div style={{ minWidth: LEFT_W_EFF + TOT_DAYS * dayPx, position: 'relative' }}>

            {/* Month header */}
            <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 22, height: HDR_H1, background: T.dark, borderBottom: `1.5px solid ${T.faint2}` }}>
              <div style={{ width: LEFT_W_EFF, flexShrink: 0, padding: isMobile ? '0 6px' : '0 12px', display: 'flex', alignItems: 'center', fontSize: 10, fontWeight: 800, color: T.ink3, textTransform: 'uppercase', letterSpacing: 0.8, position: 'sticky', left: 0, zIndex: 23, background: T.dark, borderRight: `1.5px solid rgba(255,255,255,0.1)`, overflow: 'hidden' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>TAREAS · {gantt.tasks.length}</span>
              </div>
              {isHourView ? (
                <div style={{ display: 'flex' }}>
                  {days.map((d, i) => {
                    const DOW = ['Do','Lu','Ma','Mi','Ju','Vi','Sa'][d.dayOfWeek];
                    const isWe = d.dayOfWeek === 0 || d.dayOfWeek === 6;
                    return (
                      <div key={i} style={{ width: dayPx, flexShrink: 0, borderRight: `1px solid rgba(255,255,255,0.1)`, padding: '0 6px', display: 'flex', alignItems: 'center', fontSize: 9, fontWeight: 800, color: isWe ? T.warn : T.accentSoft, fontFamily: T.fontMono, overflow: 'hidden', whiteSpace: 'nowrap', background: isWe ? 'rgba(255,255,255,0.04)' : 'transparent' }}>
                        {dayPx >= 80 ? `${DOW} ${d.dayOfMonth}` : String(d.dayOfMonth)}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ display: 'flex' }}>
                  {months.map((m, i) => (
                    <div key={i} style={{ width: m.days * dayPx, flexShrink: 0, borderRight: `1px solid rgba(255,255,255,0.1)`, padding: '0 8px', display: 'flex', alignItems: 'center', fontSize: 10, fontWeight: 800, color: T.accentSoft, fontFamily: T.fontMono, overflow: 'hidden', whiteSpace: 'nowrap' }}>
                      {m.label}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Week sub-header */}
            <div style={{ display: 'flex', position: 'sticky', top: HDR_H1, zIndex: 21, height: HDR_H2, background: T.faint, borderBottom: `1px solid ${T.faint2}` }}>
              <div style={{ width: LEFT_W_EFF, flexShrink: 0, position: 'sticky', left: 0, zIndex: 22, background: T.faint, borderRight: `1.5px solid ${T.faint2}`, fontSize: 10, color: T.ink3, display: 'flex', alignItems: 'center', padding: isMobile ? '0 4px' : '0 12px', fontFamily: T.fontMono, overflow: 'hidden' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fmtShort(gantt.startDate)} →</span>
              </div>
              {isHourView ? (
                <div style={{ width: TOT_DAYS * dayPx, flexShrink: 0, backgroundImage: weekBg, position: 'relative' }}>
                  {hourLabels.map(lb => (
                    <div key={lb.key} style={{ position: 'absolute', left: lb.left + 1, top: 3, fontSize: 8, color: lb.hour % 12 === 0 ? T.ink : T.ink3, fontFamily: T.fontMono, whiteSpace: 'nowrap', fontWeight: lb.hour % 12 === 0 ? 700 : 400 }}>
                      {String(lb.hour).padStart(2,'0')}
                    </div>
                  ))}
                </div>
              ) : isDayView ? (
                <div style={{ display: 'flex', flexShrink: 0 }}>
                  {days.map((d, i) => (
                    <div key={i} style={{
                      width: dayPx, flexShrink: 0,
                      background: (d.dayOfWeek === 0 || d.dayOfWeek === 6) ? 'rgba(0,0,0,0.06)' : 'transparent',
                      borderRight: `0.5px solid ${T.faint2}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 8, color: d.dayOfWeek === 0 || d.dayOfWeek === 6 ? T.ink : T.ink3,
                      fontFamily: T.fontMono, fontWeight: (d.dayOfWeek === 0 || d.dayOfWeek === 6) ? 700 : 400,
                      overflow: 'hidden',
                    }}>
                      {dayPx >= 11 ? d.dayOfMonth : ''}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ width: TOT_DAYS * dayPx, flexShrink: 0, backgroundImage: weekBg, position: 'relative' }}>
                  {/* Date labels every 2 weeks */}
                  {weekPx >= 12 && Array.from({ length: Math.floor(TOT_WEEKS / 2) }).map((_, i) => (
                    <div key={i} style={{ position: 'absolute', left: i * 2 * weekPx + 2, top: 3, fontSize: 9, color: T.ink3, fontFamily: T.fontMono, whiteSpace: 'nowrap' }}>
                      {fmtShort(isoAdd(gantt.startDate, i * 14))}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Rows */}
            <div style={{ position: 'relative' }}>

              {/* Dep arrows SVG */}
              {depArrows.length > 0 && (
                <svg style={{ position: 'absolute', left: LEFT_W_EFF, top: 0, width: TOT_DAYS * dayPx, height: totalContentH, pointerEvents: 'none', zIndex: 6, overflow: 'visible' }}>
                  {depArrows.map((a, i) => {
                    const cp = Math.abs(a.x2 - a.x1) / 2;
                    const d  = `M ${a.x1} ${a.y1} C ${a.x1+cp} ${a.y1} ${a.x2-cp} ${a.y2} ${a.x2} ${a.y2}`;
                    return (
                      <g key={i}>
                        <path d={d} fill="none" stroke={a.color} strokeWidth={1.5} strokeDasharray="5 3" opacity={0.65} />
                        <polygon points={`${a.x2},${a.y2} ${a.x2-7},${a.y2-4} ${a.x2-7},${a.y2+4}`} fill={a.color} opacity={0.8} />
                      </g>
                    );
                  })}
                </svg>
              )}

              {/* Today line */}
              {todayDay >= 0 && todayDay <= TOT_DAYS && (
                <div style={{ position: 'absolute', left: LEFT_W_EFF + todayDay * dayPx, top: 0, bottom: 0, width: 2, background: T.warn, zIndex: 7, pointerEvents: 'none' }}>
                  <div style={{ background: T.warn, color: 'white', fontSize: 8, fontWeight: 800, padding: '1px 3px', borderRadius: '0 2px 2px 0', whiteSpace: 'nowrap', fontFamily: T.fontMono, position: 'sticky', top: 0 }}>HOY</div>
                </div>
              )}

              {rows.map((row, ri) => {
                if (row.type === 'rubro') {
                  return (
                    <div key={ri} style={{ display: 'flex', height: RUBRO_H, borderBottom: `1px solid ${T.faint2}`, background: T.faint }}>
                      <div style={{ width: LEFT_W_EFF, flexShrink: 0, padding: isMobile ? '0 5px' : '0 12px', display: 'flex', alignItems: 'center', gap: 5, position: 'sticky', left: 0, zIndex: 12, background: T.faint, borderRight: `1.5px solid ${T.faint2}`, overflow: 'hidden' }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: rCol(row.nombre), flexShrink: 0 }} />
                        <span style={{ fontSize: 10, fontWeight: 800, color: T.ink, textTransform: 'uppercase', letterSpacing: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{row.nombre}</span>
                      </div>
                      <div style={{ width: TOT_DAYS * dayPx, flexShrink: 0, backgroundImage: weekBg }} />
                    </div>
                  );
                }

                const task  = row.task;
                const isSel = task.id === selId;
                const color = rCol(task.rubroNombre);
                const segs  = getSegments(task);

                return (
                  <div key={ri}
                    style={{ display: 'flex', height: TASK_H, borderBottom: `1px dashed ${T.faint2}`, background: isSel ? hex2rgba(color, 0.07) : 'white', transition: 'background 0.12s' }}
                    onClick={() => {
                      if (mouseDownRef.current) { mouseDownRef.current = false; return; }
                      if (addingDep && selId && task.id !== selId) { addDep(selId, task.id); setAddingDep(false); setDepSearch(''); return; }
                      if (!drag) { setSelId(isSel ? null : task.id); setShowAdd(false); }
                    }}
                  >
                    {/* Left: name */}
                    <div style={{ width: LEFT_W_EFF, flexShrink: 0, padding: isMobile ? '0 4px 0 8px' : '0 8px 0 18px', display: 'flex', alignItems: 'center', gap: 5, position: 'sticky', left: 0, zIndex: 11, background: isSel ? blendWhite(color, 0.12) : 'white', borderRight: `1.5px solid ${T.faint2}`, overflow: 'hidden' }}>
                      {task.deps.length > 0 && <span style={{ color: T.accent, fontSize: 9, flexShrink: 0, fontWeight: 800 }}>▶</span>}
                      <span style={{ fontSize: 11.5, color: T.ink, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: isSel ? 700 : 400 }}>{task.nombre}</span>
                      <span style={{ fontFamily: T.fontMono, fontSize: 10, color: task.avance===100 ? T.ok : task.avance>0 ? color : T.ink3, flexShrink: 0, fontWeight: 700 }}>{task.avance}%</span>
                    </div>

                    {/* Timeline area */}
                    <div style={{ width: TOT_DAYS * dayPx, flexShrink: 0, position: 'relative', backgroundImage: weekBg }}
                      onClick={(e) => {
                        if (splitMode && isSel) {
                          const rect = e.currentTarget.getBoundingClientRect();
                          splitTask(task, Math.floor((e.clientX - rect.left + (containerRef.current?.scrollLeft??0)) / dayPx));
                          e.stopPropagation();
                        }
                      }}
                    >
                      {isHourView ? (() => {
                        const sh  = task.startHour ?? 8;
                        const ed  = task.endDay ?? (task.startDay + task.duration - 1);
                        const eh  = task.endHour ?? 17;
                        const x   = task.startDay * dayPx + sh * hourPx;
                        const totalH = (ed - task.startDay) * 24 + (eh - sh);
                        const w   = Math.max(4, totalH * hourPx);
                        const fill = w * task.avance / 100;
                        const dragBase = { taskId: task.id, startX: 0, origStart: task.startDay, origDur: task.duration, dayPx, isHourView: true, origStartDay: task.startDay, origEndDay: ed, origTotalStartH: task.startDay * 24 + sh, origTotalEndH: ed * 24 + eh, hourPx };
                        return (
                          <div style={{ position: 'absolute', left: x, top: 6, height: TASK_H-12, width: w, borderRadius: 4, background: hex2rgba(color, 0.18), border: `1.5px solid ${hex2rgba(color, 0.5)}`, overflow: 'hidden', userSelect: 'none', boxSizing: 'border-box' }}
                            onMouseDown={(e) => {
                              if (splitMode) return;
                              e.stopPropagation(); mouseDownRef.current = true;
                              const xInBar = e.clientX - e.currentTarget.getBoundingClientRect().left;
                              const isR = xInBar >= w - R_HANDLE, isL = xInBar <= L_HANDLE;
                              setSelId(task.id);
                              setDrag({ ...dragBase, type: isR ? 'resize-right' : isL ? 'resize-left' : 'move', startX: e.clientX });
                            }}
                          >
                            {fill > 0 && <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: fill, background: color, opacity: 0.75 }} />}
                            {w > 50 && (
                              <div style={{ position: 'absolute', left: 4, right: 4, top: 0, bottom: 0, display: 'flex', alignItems: 'center', fontSize: 9, color: 'white', fontWeight: 700, pointerEvents: 'none', overflow: 'hidden', textShadow: '0 1px 2px rgba(0,0,0,0.45)', whiteSpace: 'nowrap', zIndex: 2, gap: 4 }}>
                                <span>{task.nombre}</span>
                                {w > 100 && <span style={{ opacity: 0.8 }}>{String(sh).padStart(2,'0')}–{String(eh).padStart(2,'0')}h</span>}
                              </div>
                            )}
                            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: L_HANDLE, cursor: 'ew-resize', background: hex2rgba(color, 0.35), zIndex: 3 }}
                              onMouseDown={(e) => { e.stopPropagation(); mouseDownRef.current = true; setSelId(task.id); setDrag({ ...dragBase, type: 'resize-left', startX: e.clientX }); }} />
                            <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: R_HANDLE, cursor: 'ew-resize', background: hex2rgba(color, 0.35), zIndex: 3 }}
                              onMouseDown={(e) => { e.stopPropagation(); mouseDownRef.current = true; setSelId(task.id); setDrag({ ...dragBase, type: 'resize-right', startX: e.clientX }); }} />
                          </div>
                        );
                      })() : segs.map((seg, si) => {
                        const x  = seg.start * dayPx;
                        const w  = Math.max(4, seg.dur * dayPx);
                        const fillPx    = task.duration * dayPx * task.avance / 100;
                        const segOffset = (seg.start - task.startDay) * dayPx;
                        const segFill   = Math.max(0, Math.min(w, fillPx - segOffset));
                        const isFirst   = si === 0, isLast = si === segs.length - 1;

                        return (
                          <div key={si}
                            style={{ position: 'absolute', left: x, top: 6, height: TASK_H-12, width: w, borderRadius: 4, background: hex2rgba(color, 0.18), border: `1.5px solid ${hex2rgba(color, 0.5)}`, overflow: 'hidden', userSelect: 'none', boxSizing: 'border-box' }}
                            onMouseDown={(e) => {
                              if (splitMode) return;
                              e.stopPropagation();
                              mouseDownRef.current = true;
                              const xInBar = e.clientX - e.currentTarget.getBoundingClientRect().left;
                              const isR = isLast  && xInBar >= w - R_HANDLE;
                              const isL = isFirst && xInBar <= L_HANDLE;
                              setSelId(task.id);
                              setDrag({ type: isR ? 'resize-right' : isL ? 'resize-left' : 'move', taskId: task.id, startX: e.clientX, origStart: task.startDay, origDur: task.duration, dayPx, isHourView: false });
                            }}
                          >
                            {segFill > 0 && <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: segFill, background: color, opacity: 0.75 }} />}
                            {isFirst && w > 36 && (
                              <div style={{ position: 'absolute', left: 4, right: 4, top: 0, bottom: 0, display: 'flex', alignItems: 'center', fontSize: 9.5, color: 'white', fontWeight: 700, pointerEvents: 'none', overflow: 'hidden', textShadow: '0 1px 2px rgba(0,0,0,0.45)', whiteSpace: 'nowrap', zIndex: 2 }}>
                                {task.nombre}
                              </div>
                            )}
                            {isFirst && (
                              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: L_HANDLE, cursor: 'ew-resize', background: hex2rgba(color, 0.35), zIndex: 3 }}
                                onMouseDown={(e) => { e.stopPropagation(); mouseDownRef.current = true; setSelId(task.id); setDrag({ type: 'resize-left', taskId: task.id, startX: e.clientX, origStart: task.startDay, origDur: task.duration, dayPx, isHourView: false }); }} />
                            )}
                            {isLast && (
                              <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: R_HANDLE, cursor: 'ew-resize', background: hex2rgba(color, 0.35), zIndex: 3 }}
                                onMouseDown={(e) => { e.stopPropagation(); mouseDownRef.current = true; setSelId(task.id); setDrag({ type: 'resize-right', taskId: task.id, startX: e.clientX, origStart: task.startDay, origDur: task.duration, dayPx, isHourView: false }); }} />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Right panel ── */}
        <div style={{ width: isMobile ? '100%' : 268, flexShrink: 0, border: `1.5px solid ${T.faint2}`, borderRadius: 6, background: 'white', overflow: isMobile ? 'visible' : 'auto', display: 'flex', flexDirection: 'column' }}>

          {/* Add task form */}
          {showAdd && (
            <div style={{ padding: 14, borderBottom: `1.5px solid ${T.faint2}`, background: T.faint }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: T.ink, marginBottom: 10 }}>Nueva tarea</div>
              {[
                ['Nombre', <input key="n" value={newForm.nombre} onChange={e=>setNewForm(p=>({...p,nombre:e.target.value}))} onKeyDown={e=>e.key==='Enter'&&addTask()} placeholder="Nombre de la tarea" style={{ width:'100%', padding:'5px 8px', border:`1.2px solid ${T.faint2}`, borderRadius:4, fontSize:12, fontFamily:T.font, boxSizing:'border-box' }} />],
                ['Rubro', <select key="r" value={newForm.rubroNombre} onChange={e=>setNewForm(p=>({...p,rubroNombre:e.target.value}))} style={{ width:'100%', padding:'5px 8px', border:`1.2px solid ${T.faint2}`, borderRadius:4, fontSize:12, fontFamily:T.font }}>
                  <option value="">— Sin rubro —</option>
                  {[...new Set([...gantt.tasks.map(t=>t.rubroNombre),...(detalle.rubros||[]).map(r=>r.nombre)].filter(Boolean))].map(r=><option key={r} value={r}>{r}</option>)}
                </select>],
                ['Duración (días)', <input key="d" type="number" min="1" max="365" value={newForm.duration} onChange={e=>setNewForm(p=>({...p,duration:e.target.value}))} style={{ width: isMobile ? '100%' : 80, boxSizing:'border-box', padding:'5px 8px', border:`1.2px solid ${T.faint2}`, borderRadius:4, fontSize:12, fontFamily:T.fontMono }} />],
              ].map(([label, input]) => (
                <div key={label} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize:10, color:T.ink3, fontWeight:700, textTransform:'uppercase', letterSpacing:0.5, marginBottom:3 }}>{label}</div>
                  {input}
                </div>
              ))}
              <div style={{ display:'flex', gap:6, marginTop:10 }}>
                <button onClick={addTask} style={{ flex:1, padding:'6px', background:T.accent, color:'white', border:'none', borderRadius:4, cursor:'pointer', fontFamily:T.font, fontWeight:700, fontSize:12 }}>Agregar</button>
                <button onClick={()=>setShowAdd(false)} style={{ padding:'6px 10px', background:T.faint2, border:'none', borderRadius:4, cursor:'pointer', fontFamily:T.font, fontSize:12 }}>✕</button>
              </div>
            </div>
          )}

          {/* No selection hint */}
          {!selTask && !showAdd && (
            <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:24, gap:10, color:T.ink3 }}>
              <span style={{ fontSize:36 }}>📋</span>
              <span style={{ fontSize:12, textAlign:'center', lineHeight:1.5 }}>Seleccioná una tarea para editarla</span>
              <button onClick={()=>setShowAdd(true)} style={{ padding:'6px 14px', background:T.accent, color:'white', border:'none', borderRadius:4, cursor:'pointer', fontFamily:T.font, fontWeight:700, fontSize:12, marginTop:4 }}>+ Nueva tarea</button>
            </div>
          )}

          {/* Task detail */}
          {selTask && (
            <div style={{ padding:14, display:'flex', flexDirection:'column', gap:14 }}>

              {/* Title */}
              <div>
                <div style={{ fontSize:10, color:rCol(selTask.rubroNombre), fontWeight:800, textTransform:'uppercase', letterSpacing:0.6, marginBottom:2 }}>{selTask.rubroNombre||'Tarea extra'}</div>
                <div style={{ fontSize:15, fontWeight:800, color:T.ink, lineHeight:1.3 }}>{selTask.nombre}</div>
              </div>

              {/* Avance */}
              <div>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:7 }}>
                  <span style={{ fontSize:10, fontWeight:800, color:T.ink2, textTransform:'uppercase', letterSpacing:0.5 }}>Avance</span>
                  <input type="number" min="0" max="100" value={selTask.avance} onChange={e=>setAvance(selTask.id,Number(e.target.value))}
                    style={{ width:52, padding:'3px 5px', border:`1.2px solid ${T.faint2}`, borderRadius:4, fontSize:12, fontFamily:T.fontMono, textAlign:'center' }} />
                </div>
                <div style={{ position:'relative', height:22, cursor:'pointer' }}
                  onClick={e=>{ const r=e.currentTarget.getBoundingClientRect(); setAvance(selTask.id,Math.round((e.clientX-r.left)/r.width*100)); }}>
                  <div style={{ position:'absolute', top:5, left:0, right:0, height:12, background:T.faint2, borderRadius:6 }} />
                  <div style={{ position:'absolute', top:5, left:0, width:`${selTask.avance}%`, height:12, background:rCol(selTask.rubroNombre), borderRadius:6, transition:'width 0.08s' }} />
                  <div style={{ position:'absolute', top:1, left:`${selTask.avance}%`, transform:'translateX(-50%)', width:20, height:20, background:'white', border:`2.5px solid ${rCol(selTask.rubroNombre)}`, borderRadius:10, cursor:'ew-resize', zIndex:2 }}
                    onMouseDown={e=>{ e.stopPropagation(); startAvanceDrag(e, selTask.id, e.currentTarget.parentElement); }} />
                </div>
                <div style={{ display:'flex', gap:3, marginTop:5 }}>
                  {[0,25,50,75,100].map(p=>(
                    <button key={p} onClick={()=>setAvance(selTask.id,p)}
                      style={{ flex:1, padding:'3px 0', background:selTask.avance===p?rCol(selTask.rubroNombre):T.faint, color:selTask.avance===p?'white':T.ink2, border:'none', borderRadius:3, cursor:'pointer', fontSize:10, fontFamily:T.fontMono, fontWeight:700 }}>
                      {p}%
                    </button>
                  ))}
                </div>
              </div>

              {/* Fechas (+ horario en vista Hora) */}
              <div>
                <div style={{ fontSize:10, fontWeight:800, color:T.ink2, textTransform:'uppercase', letterSpacing:0.5, marginBottom:7 }}>
                  {isHourView ? 'Fecha y hora' : 'Fechas'}
                </div>
                {isHourView ? (
                  <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                    {[
                      ['Inicio', selStartIso, setFechaInicio, 'startHour', selTask.startHour ?? 8],
                      ['Fin',    selEndIso,   setFechaFin,   'endHour',   selTask.endHour   ?? 17],
                    ].map(([lbl, dateVal, dateFn, hourField, hourVal]) => (
                      <div key={lbl}>
                        <div style={{ fontSize:10, color:T.ink3, fontWeight:700, marginBottom:3 }}>{lbl}</div>
                        <div style={{ display:'flex', gap:5, alignItems:'center' }}>
                          <input type="date" value={dateVal} onChange={e => dateFn(selTask.id, e.target.value)}
                            style={{ flex:1, padding:'5px 5px', border:`1.2px solid ${T.faint2}`, borderRadius:4, fontSize:11, fontFamily:T.font, boxSizing:'border-box' }} />
                          <input type="number" min={0} max={23} value={hourVal}
                            onChange={e => updateHour(selTask.id, hourField, Math.max(0, Math.min(23, +e.target.value)))}
                            style={{ width:46, padding:'5px 4px', border:`1.2px solid ${T.faint2}`, borderRadius:4, fontSize:12, fontFamily:T.fontMono, textAlign:'center', boxSizing:'border-box' }} />
                          <span style={{ fontSize:10, color:T.ink2, flexShrink:0 }}>hs</span>
                        </div>
                      </div>
                    ))}
                    {(() => {
                      const sh = selTask.startHour ?? 8, eh = selTask.endHour ?? 17;
                      const dh = (selEndDay - selTask.startDay) * 24 + (eh - sh);
                      return (
                        <div style={{ textAlign:'center', fontSize: isMobile ? 10 : 11, color:T.ink2, fontFamily:T.fontMono, whiteSpace: isMobile ? 'normal' : 'nowrap', wordBreak: isMobile ? 'break-word' : 'normal', lineHeight: 1.4 }}>
                          <span style={{ fontWeight:700, color:T.accent }}>{dh}</span> hs · {fmtShort(selStartIso)} {String(sh).padStart(2,'0')}:00 → {fmtShort(selEndIso)} {String(eh).padStart(2,'0')}:00
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  <>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                      {[['Inicio',selStartIso,setFechaInicio],['Fin',selEndIso,setFechaFin]].map(([lbl,val,fn])=>(
                        <div key={lbl}>
                          <div style={{ fontSize:10, color:T.ink3, fontWeight:700, marginBottom:3 }}>{lbl}</div>
                          <input type="date" value={val} onChange={e=>fn(selTask.id,e.target.value)}
                            style={{ width:'100%', padding:'5px 5px', border:`1.2px solid ${T.faint2}`, borderRadius:4, fontSize:11, fontFamily:T.font, boxSizing:'border-box' }} />
                        </div>
                      ))}
                    </div>
                    <div style={{ textAlign:'center', fontSize:11, color:T.ink2, marginTop:6, fontFamily:T.fontMono }}>
                      <span style={{ fontWeight:700, color:T.accent }}>{selTask.duration}</span> días · {fmtShort(selStartIso)} → {fmtShort(selEndIso)}
                    </div>
                  </>
                )}
              </div>

              {/* Contrato MO vinculado — solo nombre del gremio y % de avance,
                  SIN valores monetarios. Los montos (cert, reparo, total) se
                  ven en la pestaña Contratos MO. El Gantt es cronograma, no
                  vista financiera. */}
              {(() => {
                const contrato = (detalle.contratos||[]).find(c => matchGremio(selTask.rubroNombre, c.gremio));
                if (!contrato) return null;
                const avPct = contrato.avancePct ?? 0;
                return (
                  <div style={{ background:T.faint, borderRadius:6, padding:'10px 12px', borderLeft:`3px solid ${rCol(selTask.rubroNombre)}` }}>
                    <div style={{ fontSize:10, fontWeight:800, color:T.ink2, textTransform:'uppercase', letterSpacing:0.5, marginBottom:6 }}>Contrato MO — {contrato.gremio}</div>
                    <div style={{ fontSize:11, color:T.ink2, marginBottom:6 }}>{contrato.proveedor}</div>
                    <div style={{ position:'relative', height:10, background:T.faint2, borderRadius:5, overflow:'hidden', marginBottom:6 }}>
                      <div style={{ position:'absolute', left:0, top:0, bottom:0, width:`${avPct}%`, background:rCol(selTask.rubroNombre), transition:'width 0.3s' }} />
                    </div>
                    <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:T.ink2 }}>
                      <span style={{ minWidth:0, flex:1, fontSize:11, color:T.ink2 }}>Avance del contrato</span>
                      <b style={{ fontFamily:T.fontMono, color:rCol(selTask.rubroNombre), flexShrink:0 }}>{avPct}%</b>
                    </div>
                  </div>
                );
              })()}

              {/* Dependencies */}
              <div>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                  <span style={{ fontSize:10, fontWeight:800, color:T.ink2, textTransform:'uppercase', letterSpacing:0.5 }}>Dependencias</span>
                  <button onClick={()=>{ setAddingDep(v=>!v); setDepSearch(''); }}
                    style={{ fontSize:10, padding:'3px 8px', background:addingDep?T.accent:T.faint, color:addingDep?'white':T.ink2, border:'none', borderRadius:3, cursor:'pointer', fontFamily:T.font, fontWeight:700 }}>
                    {addingDep ? '✕ Cancelar' : '+ Enlazar'}
                  </button>
                </div>
                {addingDep && (() => {
                  const candidates = gantt.tasks.filter(t => t.id!==selTask.id && !selTask.deps.includes(t.id) && (depSearch==='' || t.nombre.toLowerCase().includes(depSearch.toLowerCase()) || (t.rubroNombre||'').toLowerCase().includes(depSearch.toLowerCase())));
                  return (
                    <div style={{ marginBottom:8 }}>
                      <input autoFocus value={depSearch} onChange={e=>setDepSearch(e.target.value)} placeholder="Buscar tarea predecesora…"
                        style={{ width:'100%', padding:'6px 8px', border:`1.5px solid ${T.accent}`, borderRadius:4, fontSize:11, fontFamily:T.font, boxSizing:'border-box', outline:'none', marginBottom:4 }} />
                      <div style={{ maxHeight: isMobile ? 'min(200px, 40vh)' : 160, overflowY:'auto', border:`1px solid ${T.faint2}`, borderRadius:4, background:'white' }}>
                        {candidates.length===0
                          ? <div style={{ padding:'8px 10px', fontSize:11, color:T.ink3 }}>Sin resultados</div>
                          : candidates.map(t=>(
                            <div key={t.id} onClick={()=>{ addDep(selTask.id,t.id); setAddingDep(false); setDepSearch(''); }}
                              style={{ display:'flex', alignItems:'center', gap:7, padding:'7px 10px', cursor:'pointer', borderBottom:`1px solid ${T.faint2}`, fontSize:11 }}
                              onMouseEnter={e=>e.currentTarget.style.background=T.faint}
                              onMouseLeave={e=>e.currentTarget.style.background='white'}>
                              <span style={{ width:7, height:7, borderRadius:2, background:rCol(t.rubroNombre), flexShrink:0 }} />
                              <span style={{ flex:1, color:T.ink, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.nombre}</span>
                              <span style={{ fontSize:9, color:T.ink3, flexShrink:0 }}>{t.rubroNombre}</span>
                            </div>
                          ))
                        }
                      </div>
                      <div style={{ fontSize:10, color:T.ink3, marginTop:4 }}>También podés hacer click en la tarea en el Gantt →</div>
                    </div>
                  );
                })()}
                {selTask.deps.length===0 && !addingDep
                  ? <div style={{ fontSize:11, color:T.ink3 }}>Sin dependencias</div>
                  : selTask.deps.map(depId=>{
                    const dep=gantt.tasks.find(t=>t.id===depId);
                    return dep ? (
                      <div key={depId} style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4, padding:'3px 0' }}>
                        <span style={{ width:7, height:7, borderRadius:2, background:rCol(dep.rubroNombre), flexShrink:0 }} />
                        <span style={{ flex:1, fontSize:11, color:T.ink, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{dep.nombre}</span>
                        <span style={{ fontSize:9, color:T.ink3, flexShrink:0, minWidth:0, maxWidth:55, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{dep.rubroNombre}</span>
                        <button onClick={()=>removeDep(selTask.id,depId)} style={{ fontSize:12, color:T.ink3, background:'none', border:'none', cursor:'pointer', padding:'0 2px' }}>✕</button>
                      </div>
                    ) : null;
                  })}
              </div>

              {/* Actions */}
              <div style={{ display:'flex', flexDirection:'column', gap:5, borderTop:`1px solid ${T.faint2}`, paddingTop:12 }}>
                <button onClick={()=>{ setSplitMode(v=>!v); setAddingDep(false); }}
                  style={{ padding:'6px 10px', background:splitMode?hex2rgba(T.warn,0.12):T.faint, color:splitMode?T.warn:T.ink, border:`1.2px solid ${splitMode?T.warn:T.faint2}`, borderRadius:4, cursor:'pointer', fontFamily:T.font, fontSize:11, fontWeight:600, textAlign:'left' }}>
                  ✂ {splitMode ? 'Hacé click en la barra para cortar' : 'Cortar tarea'}
                </button>
                {selTask.splits?.length > 0 && (
                  <button onClick={()=>clearSplits(selTask.id)}
                    style={{ padding:'6px 10px', background:T.faint, color:T.ink2, border:`1.2px solid ${T.faint2}`, borderRadius:4, cursor:'pointer', fontFamily:T.font, fontSize:11, textAlign:'left' }}>
                    ↩ Quitar {selTask.splits.length} corte{selTask.splits.length>1?'s':''}
                  </button>
                )}
                <button onClick={()=>deleteTask(selTask.id)}
                  style={{ padding:'6px 10px', background:'white', color:T.warn, border:`1.2px solid ${T.warn}80`, borderRadius:4, cursor:'pointer', fontFamily:T.font, fontSize:11, fontWeight:600, textAlign:'left' }}>
                  🗑 Eliminar tarea
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {(splitMode || addingDep) && (
        <div style={{
          position: 'fixed',
          bottom: 18,
          left: isMobile ? 8 : '50%',
          right: isMobile ? 8 : 'auto',
          transform: isMobile ? 'none' : 'translateX(-50%)',
          maxWidth: isMobile ? 'calc(100vw - 16px)' : 'none',
          background: T.dark,
          color: 'white',
          padding: isMobile ? '8px 12px' : '8px 18px',
          borderRadius: 20,
          fontSize: isMobile ? 11 : 12,
          fontWeight: 700,
          zIndex: 200,
          pointerEvents: 'none',
          boxSizing: 'border-box',
          textAlign: 'center',
        }}>
          {splitMode ? '✂  Hacé click sobre la barra de la tarea seleccionada para cortarla' : '→  Hacé click en la tarea predecesora para crear la dependencia'}
        </div>
      )}
    </PageLayout>
  );
}
