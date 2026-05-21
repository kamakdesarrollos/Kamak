import { useState, useMemo } from 'react';
import PageLayout from '../components/layout/PageLayout';
import { Box, Btn, Chip, Divider } from '../components/ui';
import { T } from '../theme';
import { usePlantillas } from '../store/PlantillasContext';

const newId = () => `ci-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;
const fmtN  = (n) => Math.round(n).toLocaleString('es-AR');
const fmtM  = (n) => `$ ${fmtN(n)}`;

const inputSt = { padding: '5px 8px', border: `1.2px solid ${T.faint2}`, borderRadius: 4, fontFamily: T.font, fontSize: 12, background: T.paper, boxSizing: 'border-box', outline: 'none', width: '100%' };

const TIPOS = ['Todos', 'Comercial', 'Vivienda', 'Industrial', 'Refacción'];
const TIPO_BG  = { Comercial: '#e8f7f7', Vivienda: '#e8f4ea', Industrial: '#e8eef5', Refacción: '#f9f0e3', Otro: T.faint };
const TIPO_COL = { Comercial: '#1a9b9c', Vivienda: '#3d7a4a', Industrial: '#4a7ab5', Refacción: '#d4923a', Otro: T.ink2 };

// ── Calcs ─────────────────────────────────────────────────────────────────────
const tareaVentaUnit = (t, rubro) => {
  const cu = (t.costoMat || 0) + (t.costoSub || 0);
  if (t.margenLinea != null) return cu * (1 + t.margenLinea / 100);
  return (t.costoMat || 0) * (1 + rubro.margenMat / 100) + (t.costoSub || 0) * (1 + rubro.margenMO / 100);
};

const calcRubros = (rubros) => (rubros || []).map(r => {
  let cMat = 0, cSub = 0, venta = 0;
  for (const t of (r.tareas || [])) {
    cMat  += (t.costoMat || 0) * (t.cantidad || 1);
    cSub  += (t.costoSub || 0) * (t.cantidad || 1);
    venta += tareaVentaUnit(t, r) * (t.cantidad || 1);
  }
  const costo  = cMat + cSub;
  const margen = venta > 0 ? Math.round((venta - costo) / venta * 100) : 0;
  return { ...r, cMat, cSub, costo, venta, margen };
});

const calcRef    = (plt) => calcRubros(plt.rubros).reduce((s, r) => s + r.venta, 0);
const totalTareas = (plt) => (plt.rubros || []).reduce((s, r) => s + (r.tareas || []).length, 0);

const fmtRef = (n) => {
  if (n >= 1e6) return `$ ${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$ ${(n / 1e3).toFixed(0)}k`;
  return `$ ${Math.round(n).toLocaleString('es-AR')}`;
};

const COLS_DEF = [
  { key: 'costoUnit',  label: '$ Costo unit'  },
  { key: 'costoTotal', label: '$ Costo total' },
  { key: 'margenL',    label: 'Margen %'       },
  { key: 'ventaUnit',  label: '$ Venta unit'   },
  { key: 'ventaTotal', label: '$ Venta total'  },
];

// ── Totals strip (compartido entre viewer y editor) ───────────────────────────
function TotalsStrip({ rr, cols, setCols, children }) {
  const totalVenta  = rr.reduce((s, r) => s + r.venta, 0);
  const totalCosto  = rr.reduce((s, r) => s + r.costo, 0);
  const totalMargen = totalVenta > 0 ? Math.round((totalVenta - totalCosto) / totalVenta * 100) : 0;
  const totalMat    = rr.reduce((s, r) => s + r.cMat, 0);
  const totalSub    = rr.reduce((s, r) => s + r.cSub, 0);

  return (
    <div style={{ display: 'flex', gap: 10, padding: '8px 12px', background: '#f6efd9', borderBottom: `1px solid ${T.faint2}`, flexShrink: 0, alignItems: 'center' }}>
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', border: `1px solid ${T.faint2}`, borderRadius: 4, overflow: 'hidden', background: T.paper }}>
        {[
          { label: 'Total venta', val: fmtM(totalVenta), color: T.ink },
          { label: 'Total costo', val: fmtM(totalCosto), color: T.ink },
          { label: 'Margen',      val: `${totalMargen}%`, color: totalMargen < 0 ? '#dc2626' : totalMargen < 15 ? T.warn : T.ok },
        ].map((s, i) => (
          <div key={i} style={{ padding: '6px 14px', textAlign: 'center', borderRight: i < 2 ? `1px solid ${T.faint2}` : 'none' }}>
            <div style={{ fontSize: 9, color: T.ink3, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>{s.label}</div>
            <div style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 15, color: s.color }}>{s.val}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 3, fontSize: 11 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ color: T.ink2 }}>Materiales:</span>
          <span style={{ fontFamily: T.fontMono, color: '#c0392b' }}>{fmtM(totalMat)}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ color: T.ink2 }}>Subcontratos:</span>
          <span style={{ fontFamily: T.fontMono, color: '#c0392b' }}>{fmtM(totalSub)}</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
        {COLS_DEF.map(c => (
          <span key={c.key} onClick={() => setCols(p => ({ ...p, [c.key]: !p[c.key] }))}
            style={{ padding: '3px 8px', borderRadius: 3, cursor: 'pointer', fontSize: 10,
              border: `1px solid ${cols[c.key] ? T.accent : T.faint2}`,
              background: cols[c.key] ? T.accent : 'transparent',
              color: cols[c.key] ? 'white' : T.ink2 }}>
            {c.label}
          </span>
        ))}
      </div>
      {children}
    </div>
  );
}

// ── PlantillaViewer ───────────────────────────────────────────────────────────
function PlantillaViewer({ plt, onClose, onEdit, onUsar }) {
  const [cols, setCols]     = useState({ costoUnit: false, costoTotal: true, margenL: false, ventaUnit: false, ventaTotal: true });
  const [abiertos, setAbiertos] = useState({});
  const rr = calcRubros(plt.rubros);
  const toggleRubro = (id) => setAbiertos(p => ({ ...p, [id]: !p[id] }));
  const isOpen = (id) => abiertos[id] !== false;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 300, display: 'flex', padding: 16 }}>
      <div style={{ flex: 1, background: T.paper, borderRadius: 6, border: `1.5px solid ${T.faint2}`, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 8px 40px rgba(0,0,0,0.3)' }}>

        <div style={{ padding: '12px 18px', background: T.dark, color: T.paper, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 19, letterSpacing: 0.5 }}>{plt.nombre}</div>
            <div style={{ fontSize: 11, opacity: 0.55, marginTop: 2 }}>
              {plt.tipo} · {(plt.rubros || []).length} rubros · {totalTareas(plt)} tareas
              {plt.descripcion ? ` · ${plt.descripcion}` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Btn sm onClick={onEdit}>✏ Editar</Btn>
            <Btn sm fill onClick={onUsar}>Usar en obra →</Btn>
            <span style={{ cursor: 'pointer', fontSize: 22, opacity: 0.6, marginLeft: 8, lineHeight: 1 }} onClick={onClose}>✕</span>
          </div>
        </div>

        <TotalsStrip rr={rr} cols={cols} setCols={setCols} />

        <div style={{ flex: 1, overflow: 'auto' }}>
          {rr.map(rubro => (
            <div key={rubro.id} style={{ borderBottom: `1px solid ${T.faint2}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: T.faint, cursor: 'pointer', userSelect: 'none' }}
                onClick={() => toggleRubro(rubro.id)}>
                <span style={{ fontSize: 11, color: T.ink3, fontWeight: 700 }}>{isOpen(rubro.id) ? '▾' : '▸'}</span>
                <span style={{ fontWeight: 800, fontSize: 12, flex: 1, textTransform: 'uppercase', letterSpacing: 0.5 }}>{rubro.nombre}</span>
                <Chip style={{ fontSize: 10 }}>mat {rubro.margenMat}%</Chip>
                <Chip style={{ fontSize: 10 }}>sub {rubro.margenMO}%</Chip>
                <span style={{ fontSize: 11, color: T.ink2 }}>costo <b>{fmtM(rubro.costo)}</b></span>
                <span style={{ fontSize: 11, color: T.accent }}>venta <b>{fmtM(rubro.venta)}</b></span>
                <span style={{ fontSize: 11, color: rubro.margen > 0 ? T.ok : '#dc2626', fontWeight: 700 }}>
                  {rubro.margen > 0 ? '+' : ''}{rubro.margen}%
                </span>
              </div>

              {isOpen(rubro.id) && (
                <>
                  <div className="k-tr k-th" style={{ background: T.paper, borderBottom: `1px dashed ${T.faint2}` }}>
                    <div className="k-cell" style={{ flex: 3 }}>Tarea</div>
                    <div className="k-cell" style={{ flex: 0.8, textAlign: 'right' }}>Cant</div>
                    <div className="k-cell" style={{ flex: 0.6 }}>Un</div>
                    <div className="k-cell" style={{ flex: 1, textAlign: 'right', color: '#c0392b' }}>$ Mat</div>
                    <div className="k-cell" style={{ flex: 1, textAlign: 'right', color: '#c0392b' }}>$ Sub</div>
                    {cols.costoUnit  && <div className="k-cell" style={{ flex: 1, textAlign: 'right', color: '#c0392b' }}>$ Costo u</div>}
                    {cols.costoTotal && <div className="k-cell" style={{ flex: 1, textAlign: 'right', color: '#c0392b' }}>$ Costo T</div>}
                    {cols.margenL   && <div className="k-cell" style={{ flex: 0.9, textAlign: 'right', color: T.ok }}>Margen %</div>}
                    {cols.ventaUnit  && <div className="k-cell" style={{ flex: 1, textAlign: 'right', color: T.accent }}>$ Venta u</div>}
                    {cols.ventaTotal && <div className="k-cell" style={{ flex: 1.1, textAlign: 'right', color: T.accent }}>$ Venta T</div>}
                  </div>
                  {(rubro.tareas || []).map((t, ti) => {
                    const costoUnit  = (t.costoMat || 0) + (t.costoSub || 0);
                    const costoTotal = costoUnit * (t.cantidad || 1);
                    const ventaUnit  = tareaVentaUnit(t, rubro);
                    const ventaTotal = ventaUnit * (t.cantidad || 1);
                    const margenT    = ventaUnit > 0 ? Math.round((ventaUnit - costoUnit) / ventaUnit * 100) : 0;
                    return (
                      <div key={t.id} className="k-tr" style={{ alignItems: 'center', background: ti % 2 === 1 ? T.faint : 'transparent' }}>
                        <div className="k-cell" style={{ flex: 3 }}>{t.nombre || <span style={{ color: T.ink3, fontStyle: 'italic' }}>sin nombre</span>}</div>
                        <div className="k-cell" style={{ flex: 0.8, textAlign: 'right', fontFamily: T.fontMono, fontSize: 12 }}>{t.cantidad || 1}</div>
                        <div className="k-cell" style={{ flex: 0.6 }}>{t.unidad}</div>
                        <div className="k-cell" style={{ flex: 1, textAlign: 'right', fontFamily: T.fontMono, fontSize: 12, color: '#c0392b' }}>$ {fmtN(t.costoMat || 0)}</div>
                        <div className="k-cell" style={{ flex: 1, textAlign: 'right', fontFamily: T.fontMono, fontSize: 12, color: '#c0392b' }}>$ {fmtN(t.costoSub || 0)}</div>
                        {cols.costoUnit  && <div className="k-cell" style={{ flex: 1, textAlign: 'right', fontFamily: T.fontMono, fontSize: 12, color: '#c0392b' }}>$ {fmtN(costoUnit)}</div>}
                        {cols.costoTotal && <div className="k-cell" style={{ flex: 1, textAlign: 'right', fontFamily: T.fontMono, fontSize: 12, fontWeight: 700, color: '#c0392b' }}>$ {fmtN(costoTotal)}</div>}
                        {cols.margenL   && <div className="k-cell" style={{ flex: 0.9, textAlign: 'right', fontFamily: T.fontMono, fontSize: 12, color: margenT > 0 ? T.ok : '#dc2626' }}>{margenT}%</div>}
                        {cols.ventaUnit  && <div className="k-cell" style={{ flex: 1, textAlign: 'right', fontFamily: T.fontMono, fontSize: 12, color: T.accent }}>$ {fmtN(ventaUnit)}</div>}
                        {cols.ventaTotal && <div className="k-cell" style={{ flex: 1.1, textAlign: 'right', fontFamily: T.fontMono, fontSize: 12, fontWeight: 700, color: T.accent }}>$ {fmtN(ventaTotal)}</div>}
                      </div>
                    );
                  })}
                  {(rubro.tareas || []).length === 0 && (
                    <div style={{ padding: '6px 12px', fontSize: 11, color: T.ink3, fontStyle: 'italic' }}>Sin tareas</div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── PlantillaEditor — idéntico al presupuesto de obra ─────────────────────────
function PlantillaEditor({ form, setForm, onSave, onCancel }) {
  const [cols, setCols] = useState({ costoUnit: false, costoTotal: true, margenL: false, ventaUnit: false, ventaTotal: true });
  const [abiertos, setAbiertos] = useState({});

  const rr = calcRubros(form.rubros || []);
  const isOpen = (id) => abiertos[id] !== false;
  const toggleRubro = (id) => setAbiertos(p => ({ ...p, [id]: !p[id] }));

  // ── Rubro ops ────────────────────────────────────────────────────────────────
  const addRubro = () => {
    const r = { id: newId(), nombre: 'NUEVO RUBRO', margenMat: 15, margenMO: 35, tareas: [] };
    setForm(f => ({ ...f, rubros: [...(f.rubros || []), r] }));
    setAbiertos(p => ({ ...p, [r.id]: true }));
  };
  const delRubro = (rid) => {
    if (!window.confirm('¿Eliminar rubro y todas sus tareas?')) return;
    setForm(f => ({ ...f, rubros: f.rubros.filter(r => r.id !== rid) }));
  };
  const updRubro = (rid, patch) =>
    setForm(f => ({ ...f, rubros: f.rubros.map(r => r.id === rid ? { ...r, ...patch } : r) }));

  // ── Tarea ops ────────────────────────────────────────────────────────────────
  const addTarea = (rid) => {
    const t = { id: newId(), nombre: '', unidad: 'u', costoMat: 0, costoSub: 0, cantidad: 1 };
    setForm(f => ({ ...f, rubros: f.rubros.map(r => r.id === rid ? { ...r, tareas: [...r.tareas, t] } : r) }));
  };
  const delTarea = (rid, tid) =>
    setForm(f => ({ ...f, rubros: f.rubros.map(r => r.id === rid ? { ...r, tareas: r.tareas.filter(t => t.id !== tid) } : r) }));
  const updTarea = (rid, tid, patch) =>
    setForm(f => ({ ...f, rubros: f.rubros.map(r => r.id === rid
      ? { ...r, tareas: r.tareas.map(t => t.id === tid ? { ...t, ...patch } : t) }
      : r) }));

  // Estilos reutilizados para inputs inline dentro de celdas
  const cellInSt = (mono, color) => ({
    width: '100%', fontFamily: mono ? T.fontMono : T.font, fontSize: 12,
    background: 'transparent', border: 'none',
    borderBottom: `1px solid ${T.faint2}`, outline: 'none',
    padding: '1px 0', color: color || T.ink,
    textAlign: mono ? 'right' : 'left',
  });

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 300, display: 'flex', padding: 16 }}>
      <div style={{ flex: 1, background: T.paper, borderRadius: 6, border: `1.5px solid ${T.faint2}`, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 8px 40px rgba(0,0,0,0.3)' }}>

        {/* Header oscuro — nombre / tipo / descripción editables */}
        <div style={{ padding: '12px 18px', background: T.dark, color: T.paper, display: 'flex', gap: 14, alignItems: 'center', flexShrink: 0 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input
              autoFocus
              value={form.nombre}
              onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
              placeholder="Nombre de la plantilla"
              style={{ background: 'transparent', border: 'none', borderBottom: '1.5px solid rgba(255,255,255,0.3)', color: '#fff', fontWeight: 800, fontSize: 19, fontFamily: T.font, outline: 'none', width: '100%', padding: '2px 0' }}
            />
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <select
                value={form.tipo || 'Comercial'}
                onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}
                style={{ background: '#2a2a2e', border: 'none', color: '#9a9892', fontFamily: T.font, fontSize: 11, padding: '2px 8px', borderRadius: 3, cursor: 'pointer', outline: 'none' }}>
                {TIPOS.filter(t => t !== 'Todos').map(t => <option key={t}>{t}</option>)}
              </select>
              <input
                value={form.descripcion || ''}
                onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
                placeholder="Descripción opcional"
                style={{ background: 'transparent', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.18)', color: '#9a9892', fontFamily: T.font, fontSize: 11, outline: 'none', flex: 1, padding: '2px 0' }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            <Btn sm onClick={onCancel}>Cancelar</Btn>
            <Btn sm fill onClick={onSave} style={{ opacity: form.nombre.trim() ? 1 : 0.5 }}>Guardar plantilla</Btn>
            <span style={{ cursor: 'pointer', fontSize: 22, opacity: 0.6, marginLeft: 4, lineHeight: 1 }} onClick={onCancel}>✕</span>
          </div>
        </div>

        {/* Totals strip + col toggles + botón Rubro */}
        <TotalsStrip rr={rr} cols={cols} setCols={setCols}>
          <Btn sm fill onClick={addRubro}>+ Rubro</Btn>
        </TotalsStrip>

        {/* Cuerpo — rubros editables */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {(form.rubros || []).length === 0 && (
            <div style={{ padding: 32, textAlign: 'center', color: T.ink3, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: 13 }}>Sin rubros. Agregá el primero.</div>
              <Btn sm fill onClick={addRubro}>+ Agregar rubro</Btn>
            </div>
          )}

          {rr.map(rubro => {
            const open = isOpen(rubro.id);
            return (
              <div key={rubro.id} style={{ borderBottom: `1px solid ${T.faint2}` }}>

                {/* Rubro header editable */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: T.faint }}>
                  <span style={{ color: T.ink3, cursor: 'pointer', userSelect: 'none', fontSize: 11, fontWeight: 700 }}
                    onClick={() => toggleRubro(rubro.id)}>{open ? '▾' : '▸'}</span>
                  <input
                    value={rubro.nombre}
                    onChange={e => updRubro(rubro.id, { nombre: e.target.value.toUpperCase() })}
                    style={{ fontWeight: 800, fontSize: 13, flex: 1, fontFamily: T.font, background: 'transparent', border: 'none', borderBottom: `1px solid ${T.faint2}`, outline: 'none', textTransform: 'uppercase', letterSpacing: 0.5, color: T.ink, padding: '1px 0' }}
                  />
                  <span style={{ fontSize: 10, color: T.ink2, flexShrink: 0 }}>Mat%</span>
                  <input type="number" min="0" max="100" value={rubro.margenMat}
                    onChange={e => updRubro(rubro.id, { margenMat: +e.target.value })}
                    style={{ width: 38, fontSize: 11, fontFamily: T.fontMono, background: T.paper, border: `1px solid ${T.faint2}`, borderRadius: 3, padding: '2px 4px', outline: 'none', textAlign: 'right' }} />
                  <span style={{ fontSize: 10, color: T.ink2, flexShrink: 0 }}>Sub%</span>
                  <input type="number" min="0" max="100" value={rubro.margenMO}
                    onChange={e => updRubro(rubro.id, { margenMO: +e.target.value })}
                    style={{ width: 38, fontSize: 11, fontFamily: T.fontMono, background: T.paper, border: `1px solid ${T.faint2}`, borderRadius: 3, padding: '2px 4px', outline: 'none', textAlign: 'right' }} />
                  <span style={{ fontSize: 11, color: T.ink2, flexShrink: 0 }}>
                    costo <b style={{ fontFamily: T.fontMono }}>{fmtM(rubro.costo)}</b>
                  </span>
                  <span style={{ fontSize: 11, color: T.accent, flexShrink: 0 }}>
                    venta <b style={{ fontFamily: T.fontMono }}>{fmtM(rubro.venta)}</b>
                  </span>
                  <span style={{ fontSize: 11, color: rubro.margen > 0 ? T.ok : '#dc2626', fontWeight: 700, flexShrink: 0 }}>
                    {rubro.margen > 0 ? '+' : ''}{rubro.margen}%
                  </span>
                  <span style={{ color: T.accent, cursor: 'pointer', fontSize: 11 }}
                    onClick={() => delRubro(rubro.id)}>🗑</span>
                </div>

                {open && (
                  <>
                    {/* Cabecera de columnas */}
                    <div className="k-tr k-th" style={{ background: T.paper, borderBottom: `1px dashed ${T.faint2}` }}>
                      <div className="k-cell" style={{ flex: 3 }}>Tarea</div>
                      <div className="k-cell" style={{ flex: 0.8, textAlign: 'right' }}>Cant ✏</div>
                      <div className="k-cell" style={{ flex: 0.6 }}>Un</div>
                      <div className="k-cell" style={{ flex: 1, textAlign: 'right', color: '#c0392b' }}>$ Mat ✏</div>
                      <div className="k-cell" style={{ flex: 1, textAlign: 'right', color: '#c0392b' }}>$ Sub ✏</div>
                      {cols.costoUnit  && <div className="k-cell" style={{ flex: 1, textAlign: 'right', color: '#c0392b' }}>$ Costo u</div>}
                      {cols.costoTotal && <div className="k-cell" style={{ flex: 1, textAlign: 'right', color: '#c0392b' }}>$ Costo T</div>}
                      {cols.margenL   && <div className="k-cell" style={{ flex: 0.9, textAlign: 'right', color: T.ok }}>Margen %</div>}
                      {cols.ventaUnit  && <div className="k-cell" style={{ flex: 1, textAlign: 'right', color: T.accent }}>$ Venta u</div>}
                      {cols.ventaTotal && <div className="k-cell" style={{ flex: 1.1, textAlign: 'right', color: T.accent }}>$ Venta T</div>}
                      <div className="k-cell" style={{ flex: 0.4 }}></div>
                    </div>

                    {/* Filas de tareas editables */}
                    {rubro.tareas.map(t => {
                      const costoUnit  = (t.costoMat || 0) + (t.costoSub || 0);
                      const costoTotal = costoUnit * (t.cantidad || 1);
                      const ventaUnit  = tareaVentaUnit(t, rubro);
                      const ventaTotal = ventaUnit * (t.cantidad || 1);
                      const margenT    = ventaUnit > 0 ? Math.round((ventaUnit - costoUnit) / ventaUnit * 100) : 0;

                      return (
                        <div key={t.id} className="k-tr" style={{ alignItems: 'center' }}>
                          <div className="k-cell" style={{ flex: 3 }}>
                            <input
                              value={t.nombre}
                              placeholder="Nombre de la tarea"
                              onChange={e => updTarea(rubro.id, t.id, { nombre: e.target.value })}
                              style={cellInSt(false)} />
                          </div>
                          <div className="k-cell" style={{ flex: 0.8 }}>
                            <input type="number" min="0" value={t.cantidad || 1}
                              onChange={e => updTarea(rubro.id, t.id, { cantidad: +e.target.value })}
                              style={cellInSt(true)} />
                          </div>
                          <div className="k-cell" style={{ flex: 0.6 }}>
                            <input value={t.unidad || 'u'}
                              onChange={e => updTarea(rubro.id, t.id, { unidad: e.target.value })}
                              style={cellInSt(false)} />
                          </div>
                          <div className="k-cell" style={{ flex: 1 }}>
                            <input type="number" min="0" value={t.costoMat || 0}
                              onChange={e => updTarea(rubro.id, t.id, { costoMat: +e.target.value })}
                              style={cellInSt(true, '#c0392b')} />
                          </div>
                          <div className="k-cell" style={{ flex: 1 }}>
                            <input type="number" min="0" value={t.costoSub || 0}
                              onChange={e => updTarea(rubro.id, t.id, { costoSub: +e.target.value })}
                              style={cellInSt(true, '#c0392b')} />
                          </div>
                          {cols.costoUnit  && <div className="k-cell" style={{ flex: 1, textAlign: 'right', fontFamily: T.fontMono, fontSize: 12, color: '#c0392b' }}>$ {fmtN(costoUnit)}</div>}
                          {cols.costoTotal && <div className="k-cell" style={{ flex: 1, textAlign: 'right', fontFamily: T.fontMono, fontSize: 12, fontWeight: 700, color: '#c0392b' }}>$ {fmtN(costoTotal)}</div>}
                          {cols.margenL   && <div className="k-cell" style={{ flex: 0.9, textAlign: 'right', fontFamily: T.fontMono, fontSize: 12, color: margenT > 0 ? T.ok : '#dc2626' }}>{margenT}%</div>}
                          {cols.ventaUnit  && <div className="k-cell" style={{ flex: 1, textAlign: 'right', fontFamily: T.fontMono, fontSize: 12, color: T.accent }}>$ {fmtN(ventaUnit)}</div>}
                          {cols.ventaTotal && <div className="k-cell" style={{ flex: 1.1, textAlign: 'right', fontFamily: T.fontMono, fontSize: 12, fontWeight: 700, color: T.accent }}>$ {fmtN(ventaTotal)}</div>}
                          <div className="k-cell" style={{ flex: 0.4, padding: '0 4px' }}>
                            <span style={{ color: T.accent, cursor: 'pointer', fontSize: 11 }}
                              onClick={() => delTarea(rubro.id, t.id)}>🗑</span>
                          </div>
                        </div>
                      );
                    })}

                    {/* Fila "Agregar tarea" */}
                    <div className="k-tr" style={{ cursor: 'pointer' }}
                      onClick={() => addTarea(rubro.id)}>
                      <div className="k-cell" style={{ flex: 1, color: T.accent, fontSize: 12 }}>+ Agregar tarea</div>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function Plantillas() {
  const { plantillas, add, update, remove, duplicate, incrementUso } = usePlantillas();
  const [tipoFilt, setTipoFilt] = useState('Todos');
  const [search,   setSearch]   = useState('');
  const [viewId,   setViewId]   = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [form,     setForm]     = useState(null);
  const [menuId,   setMenuId]   = useState(null);
  const [flash,    setFlash]    = useState(null);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return plantillas.filter(p =>
      (tipoFilt === 'Todos' || p.tipo === tipoFilt) &&
      (p.nombre.toLowerCase().includes(q) || (p.descripcion || '').toLowerCase().includes(q))
    );
  }, [plantillas, tipoFilt, search]);

  const viewPlt  = viewId ? plantillas.find(p => p.id === viewId) : null;
  const showEdit = editMode && form !== null;

  const startNew = () => {
    setForm({ nombre: '', descripcion: '', tipo: 'Comercial', rubros: [] });
    setViewId(null);
    setEditMode(true);
    setMenuId(null);
  };

  const startEdit = (p) => {
    setForm(JSON.parse(JSON.stringify(p)));
    setViewId(p.id);
    setEditMode(true);
    setMenuId(null);
  };

  const cancel = () => { setEditMode(false); setForm(null); };

  const save = () => {
    if (!form || !form.nombre.trim()) return;
    if (viewId && editMode && plantillas.find(p => p.id === viewId)) update(viewId, form);
    else add(form);
    cancel();
  };

  const showFlash = (msg) => { setFlash(msg); setTimeout(() => setFlash(null), 2800); };

  const handleUsar = (p) => {
    incrementUso(p.id);
    showFlash(`"${p.nombre}" marcada. Creá la obra desde Obras → Nueva obra.`);
    setViewId(null);
  };

  const handleDup = (p) => { duplicate(p.id); showFlash(`"${p.nombre}" duplicada.`); setMenuId(null); };

  const handleDel = (p) => {
    if (!confirm(`¿Eliminar plantilla "${p.nombre}"?`)) return;
    remove(p.id);
    if (viewId === p.id) setViewId(null);
    setMenuId(null);
  };

  return (
    <PageLayout breadcrumb={['Plantillas']} active="Plantillas">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <div>
          <div className="k-h" style={{ fontSize: 26 }}>Plantillas de presupuesto</div>
          <div style={{ fontSize: 12, color: T.ink2 }}>Modelos reutilizables · hacé click en una para ver el detalle completo</div>
        </div>
        <Btn sm fill onClick={startNew}>+ Nueva plantilla</Btn>
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar…"
          style={{ ...inputSt, width: 180, padding: '5px 10px' }} />
        <div style={{ display: 'flex', gap: 4 }}>
          {TIPOS.map(t => (
            <span key={t} onClick={() => setTipoFilt(t)}
              style={{ padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12,
                fontWeight: tipoFilt === t ? 700 : 400,
                background: tipoFilt === t ? T.accent : T.faint,
                color: tipoFilt === t ? 'white' : T.ink }}>
              {t}
            </span>
          ))}
        </div>
        <span style={{ fontSize: 11, color: T.ink3, marginLeft: 4 }}>{filtered.length} plantillas</span>
      </div>

      {/* Card grid */}
      <div style={{ overflow: 'auto', height: 'calc(100vh - 230px)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {filtered.map(p => {
            const ref     = calcRef(p);
            const nTareas = totalTareas(p);
            return (
              <Box key={p.id}
                style={{ padding: 12, background: TIPO_BG[p.tipo] || T.paper, cursor: 'pointer',
                  border: viewId === p.id ? `2px solid ${T.accent}` : '2px solid transparent',
                  transition: 'box-shadow 0.15s', position: 'relative' }}
                onClick={() => { setViewId(p.id); setEditMode(false); setMenuId(null); }}
                onMouseEnter={e => e.currentTarget.style.boxShadow = '4px 4px 0 rgba(0,0,0,0.1)'}
                onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0, paddingRight: 6 }}>
                    <div style={{ fontSize: 10, color: TIPO_COL[p.tipo] || T.ink2, fontWeight: 800, textTransform: 'uppercase', marginBottom: 2 }}>{p.tipo}</div>
                    <div className="k-h" style={{ fontSize: 18, lineHeight: 1.2 }}>{p.nombre}</div>
                    {p.descripcion && <div style={{ fontSize: 12, color: T.ink2, marginTop: 2 }}>{p.descripcion}</div>}
                  </div>
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <span style={{ fontSize: 18, cursor: 'pointer', padding: '0 4px', userSelect: 'none' }}
                      onClick={e => { e.stopPropagation(); setMenuId(menuId === p.id ? null : p.id); }}>⋮</span>
                    {menuId === p.id && (
                      <div style={{ position: 'absolute', right: 0, top: 24, background: T.paper, border: `1px solid ${T.faint2}`, borderRadius: 4, zIndex: 20, minWidth: 120, boxShadow: '0 2px 8px rgba(0,0,0,0.12)' }}>
                        <div style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 12, borderBottom: `1px solid ${T.faint2}` }}
                          onClick={e => { e.stopPropagation(); startEdit(p); }}>Editar</div>
                        <div style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 12, borderBottom: `1px solid ${T.faint2}` }}
                          onClick={e => { e.stopPropagation(); handleDup(p); }}>Duplicar</div>
                        <div style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 12, color: T.warn }}
                          onClick={e => { e.stopPropagation(); handleDel(p); }}>Eliminar</div>
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 5, marginTop: 8 }}>
                  <Chip style={{ fontSize: 10 }}>{(p.rubros || []).length} rubros</Chip>
                  <Chip style={{ fontSize: 10 }}>{nTareas} tareas</Chip>
                  {p.usosCount > 0 && <Chip style={{ fontSize: 10, background: T.accentSoft }}>× {p.usosCount}</Chip>}
                </div>

                <div style={{ marginTop: 8, fontFamily: T.fontMono, fontWeight: 800, fontSize: 14, color: T.accent }}>{fmtRef(ref)}</div>
                <div style={{ fontSize: 10, color: T.ink3, marginBottom: 10 }}>referencia · {p.updatedAt}</div>

                <div style={{ display: 'flex', gap: 6 }}>
                  <Btn sm onClick={e => { e.stopPropagation(); startEdit(p); }} style={{ flex: 1, justifyContent: 'center' }}>✏ Editar</Btn>
                  <Btn sm fill onClick={e => { e.stopPropagation(); handleUsar(p); }} style={{ flex: 1, justifyContent: 'center' }}>Usar →</Btn>
                </div>
              </Box>
            );
          })}

          <Box dashed style={{ padding: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.ink3, minHeight: 165, cursor: 'pointer' }}
            onClick={startNew}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 30 }}>+</div>
              <div>Nueva plantilla<br /><span style={{ fontSize: 11 }}>desde cero o duplicando otra</span></div>
            </div>
          </Box>
        </div>
      </div>

      {/* Viewer pantalla completa */}
      {viewPlt && !showEdit && (
        <PlantillaViewer
          plt={viewPlt}
          onClose={() => setViewId(null)}
          onEdit={() => startEdit(viewPlt)}
          onUsar={() => handleUsar(viewPlt)}
        />
      )}

      {/* Editor pantalla completa — igual al presupuesto de obra */}
      {showEdit && (
        <PlantillaEditor form={form} setForm={setForm} onSave={save} onCancel={cancel} />
      )}

      {menuId && <div style={{ position: 'fixed', inset: 0, zIndex: 10 }} onClick={() => setMenuId(null)} />}

      {flash && (
        <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: T.ink, color: 'white', padding: '10px 20px', borderRadius: 6, fontSize: 13, zIndex: 400, maxWidth: 420, textAlign: 'center', pointerEvents: 'none' }}>
          {flash}
        </div>
      )}
    </PageLayout>
  );
}
