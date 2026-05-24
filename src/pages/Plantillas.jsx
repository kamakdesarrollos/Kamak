import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import PageLayout from '../components/layout/PageLayout';
import { Box, Btn, Chip, Divider } from '../components/ui';
import { T } from '../theme';
import { usePlantillas } from '../store/PlantillasContext';
import { useCatalog, calcTarea } from '../store/CatalogContext';
import { useObras } from '../store/ObrasContext';
import { useClientes } from '../store/ClientesContext';

const newId = () => `ci-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;
const fmtN  = (n) => Math.round(n).toLocaleString('es-AR');
const fmtM  = (n) => `$ ${fmtN(n)}`;

const inputSt = { padding: '5px 8px', border: `1.2px solid ${T.faint2}`, borderRadius: 4, fontFamily: T.font, fontSize: 12, background: T.paper, boxSizing: 'border-box', outline: 'none', width: '100%' };
const labelSt = { fontSize: 10, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 3, display: 'block' };

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
  for (const t of (r.tareas || []).filter(t => t.tipo !== 'seccion')) {
    cMat  += (t.costoMat || 0) * (t.cantidad || 1);
    cSub  += (t.costoSub || 0) * (t.cantidad || 1);
    venta += tareaVentaUnit(t, r) * (t.cantidad || 1);
  }
  const costo  = cMat + cSub;
  const margen = venta > 0 ? Math.round((venta - costo) / venta * 100) : 0;
  return { ...r, cMat, cSub, costo, venta, margen };
});

const calcRef    = (plt) => calcRubros(plt.rubros).reduce((s, r) => s + r.venta, 0);
const totalTareas = (plt) => (plt.rubros || []).reduce((s, r) => s + (r.tareas || []).filter(t => t.tipo !== 'seccion').length, 0);

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

// ── Excel paste parser ─────────────────────────────────────────────────────────
function parseReceta(text) {
  if (!text.trim()) return { rubro: '', receta: '', items: [] };
  const SKIP = new Set(['Tipo','Descripcion','UD','Cantidad','P. Unitario','Importe',
    'Materiales:','Subcontratos:','Mano de Obra:','Equipos:','Otros:','Auxiliares:',
    'Obra:','Presupuesto:','Computo:','Emitido:','Usuario:']);
  const VALID = new Set(['MA','SC','OT','EQ','AU','MO']);
  const lines = text.split('\n');
  const hdrLines = [], dataLines = [];
  let found = false;
  for (const line of lines) {
    const cells = line.split('\t').map(c => c.trim());
    const first = cells.filter(c => c)[0] || '';
    if (first === 'Tipo') { found = true; continue; }
    if (VALID.has(first.toUpperCase())) found = true;
    (found ? dataLines : hdrLines).push(cells);
  }
  const hdrTokens = [];
  for (const cells of hdrLines) {
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (!c || c.length < 3) continue;
      if (SKIP.has(c)) { i++; continue; }
      if (/^unidad/i.test(c)) continue;
      hdrTokens.push(c);
    }
  }
  const rubro  = hdrTokens[0] || '';
  const receta = hdrTokens.length > 1 ? hdrTokens[1] : hdrTokens[0] || '';
  const items  = [];
  for (const cells of dataLines) {
    const ne = cells.filter(c => c);
    if (ne.length < 3) continue;
    const tipo = ne[0].toUpperCase();
    if (!VALID.has(tipo)) continue;
    const cantidad = parseFloat((ne[3] || '1').replace(',', '.')) || 1;
    const precio   = ne[4] ? parseFloat(ne[4].replace(',', '.')) || 0 : 0;
    items.push({
      id: `ci-${Date.now()}-${Math.random().toString(36).slice(2,5)}-${items.length}`,
      nombre:   ne[1] || '',
      unidad:   ne[2] || 'u',
      cantidad,
      costoMat: tipo === 'SC' ? 0 : precio,
      costoSub: tipo === 'SC' ? precio : 0,
    });
  }
  return { rubro, receta, items };
}

// ── Totals strip ──────────────────────────────────────────────────────────────
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

// ── ImportarRecetaModal ───────────────────────────────────────────────────────
function ImportarRecetaModal({ onAgregar, onClose }) {
  const [texto,          setTexto]          = useState('');
  const [nombreOverride, setNombreOverride] = useState('');
  const [margenMat,      setMargenMat]      = useState(15);
  const [margenMO,       setMargenMO]       = useState(35);

  const parsed = useMemo(() => parseReceta(texto), [texto]);
  const nombre = nombreOverride || parsed.receta.toUpperCase();
  const canAdd = nombre.trim() && parsed.items.length > 0;

  useEffect(() => {
    if (parsed.receta && !nombreOverride) setNombreOverride(parsed.receta.toUpperCase());
  }, [parsed.receta]);

  return (
    <div className="k-modal-overlay" onClick={onClose}>
      <div className="k-modal" style={{ width: 640, maxHeight: '88vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', background: T.dark, color: T.paper, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>Importar receta desde Excel</div>
          <span style={{ cursor: 'pointer', fontSize: 20, opacity: 0.7 }} onClick={onClose}>✕</span>
        </div>

        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14, overflow: 'auto' }}>
          <div>
            <label style={labelSt}>Pegá el contenido copiado desde Excel</label>
            <textarea
              autoFocus
              value={texto}
              onChange={e => setTexto(e.target.value)}
              placeholder="Seleccioná todas las celdas en Excel (Ctrl+A) y pegá acá (Ctrl+V)…"
              style={{ width: '100%', height: 130, fontFamily: T.fontMono, fontSize: 10, padding: '6px 8px', border: `1.2px solid ${T.faint2}`, borderRadius: 4, resize: 'vertical', outline: 'none', color: T.ink2, boxSizing: 'border-box' }}
            />
          </div>

          {texto.trim() && (
            <div style={{ background: T.faint, borderRadius: 4, padding: '8px 12px', fontSize: 12, display: 'flex', gap: 20 }}>
              <span style={{ color: T.ink2 }}>Gremio detectado: <b style={{ color: T.ink }}>{parsed.rubro || '—'}</b></span>
              <span style={{ color: T.ink2 }}>Receta detectada: <b style={{ color: T.ink }}>{parsed.receta || '—'}</b></span>
            </div>
          )}

          {parsed.items.length > 0 && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px', gap: 10 }}>
                <div>
                  <label style={labelSt}>Nombre del rubro *</label>
                  <input style={inputSt} value={nombre}
                    onChange={e => setNombreOverride(e.target.value.toUpperCase())} />
                </div>
                <div>
                  <label style={labelSt}>% Mat</label>
                  <input style={inputSt} type="number" min="0" value={margenMat}
                    onChange={e => setMargenMat(+e.target.value)} />
                </div>
                <div>
                  <label style={labelSt}>% Sub</label>
                  <input style={inputSt} type="number" min="0" value={margenMO}
                    onChange={e => setMargenMO(+e.target.value)} />
                </div>
              </div>

              <div>
                <label style={{ ...labelSt, marginBottom: 6 }}>
                  {parsed.items.length} ítems detectados · vista previa
                </label>
                <div style={{ border: `1px solid ${T.faint2}`, borderRadius: 4, maxHeight: 230, overflow: 'auto' }}>
                  <div style={{ display: 'flex', padding: '4px 10px', background: T.faint, fontSize: 10, fontWeight: 700, color: T.ink2, borderBottom: `1px solid ${T.faint2}` }}>
                    <span style={{ width: 30 }}>Tipo</span>
                    <span style={{ flex: 1 }}>Descripción</span>
                    <span style={{ width: 60, textAlign: 'right' }}>Cant</span>
                    <span style={{ width: 40, marginLeft: 6 }}>Ud</span>
                    <span style={{ width: 90, textAlign: 'right' }}>$ Unitario</span>
                  </div>
                  {parsed.items.map((it, i) => (
                    <div key={i} style={{ display: 'flex', padding: '5px 10px', borderBottom: `1px solid ${T.faint2}`, fontSize: 11, alignItems: 'center', background: i % 2 ? T.faint : 'transparent' }}>
                      <span style={{ width: 30, fontWeight: 700, color: it.costoSub > 0 ? '#6b7db3' : T.ok, flexShrink: 0 }}>
                        {it.costoSub > 0 ? 'SC' : 'MA'}
                      </span>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.nombre}</span>
                      <span style={{ width: 60, textAlign: 'right', fontFamily: T.fontMono, color: T.ink2, flexShrink: 0 }}>{it.cantidad}</span>
                      <span style={{ width: 40, marginLeft: 6, color: T.ink2, flexShrink: 0 }}>{it.unidad}</span>
                      <span style={{ width: 90, textAlign: 'right', fontFamily: T.fontMono, color: T.accent, flexShrink: 0 }}>
                        $ {fmtN(Math.max(it.costoMat, it.costoSub))}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {texto.trim() && parsed.items.length === 0 && (
            <div style={{ fontSize: 12, color: T.warn, padding: '6px 10px', background: '#fff8e6', borderRadius: 4 }}>
              No se detectaron ítems MA/SC/OT. Asegurate de copiar las filas de datos desde Excel.
            </div>
          )}
        </div>

        <div style={{ padding: '10px 18px', borderTop: `1.5px solid ${T.faint2}`, display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
          <Btn sm onClick={onClose}>Cancelar</Btn>
          <Btn sm fill style={{ opacity: canAdd ? 1 : 0.5 }} onClick={() => {
            if (!canAdd) return;
            onAgregar({ id: newId(), nombre: nombre.trim(), margenMat, margenMO, tareas: parsed.items });
            onClose();
          }}>
            Agregar rubro
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ── buildVisibleTareas ────────────────────────────────────────────────────────
function buildVisibleTareas(tareas, collapsedSections) {
  let sec1 = null, sec2 = null;
  return tareas.map(t => {
    if (t.tipo === 'seccion') {
      if (t.nivel === 1) { sec1 = t; sec2 = null; return { ...t, _hidden: false }; }
      sec2 = t;
      return { ...t, _hidden: !!(sec1 && collapsedSections.has(sec1.id)) };
    }
    const hidden = (sec1 && collapsedSections.has(sec1.id)) || (sec2 && collapsedSections.has(sec2.id));
    return { ...t, _hidden: !!hidden };
  });
}

// ── PlantillaViewer ───────────────────────────────────────────────────────────
function PlantillaViewer({ plt, onClose, onEdit, onUsar }) {
  const [cols, setCols]         = useState({ costoUnit: false, costoTotal: true, margenL: false, ventaUnit: false, ventaTotal: true });
  const [abiertos, setAbiertos] = useState({});
  const [collapsedSections, setCollapsedSections] = useState(new Set());
  const rr = calcRubros(plt.rubros);
  const toggleRubro   = (id) => setAbiertos(p => ({ ...p, [id]: !p[id] }));
  const toggleSeccion = (id) => setCollapsedSections(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
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
                  {buildVisibleTareas(rubro.tareas || [], collapsedSections).map((t, ti) => {
                    if (t._hidden) return null;
                    if (t.tipo === 'seccion') {
                      const indent = (t.nivel || 1) === 2 ? 36 : 16;
                      const bg = t.nivel === 2 ? T.faint : '#e4eaf0';
                      const isCollapsed = collapsedSections.has(t.id);
                      return (
                        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: `5px 12px 5px ${indent}px`, background: bg, borderTop: `1px solid ${T.faint2}` }}>
                          <span onClick={() => toggleSeccion(t.id)} style={{ cursor: 'pointer', fontSize: 11, color: T.ink2, userSelect: 'none', width: 14, flexShrink: 0 }}>
                            {isCollapsed ? '▸' : '▾'}
                          </span>
                          <span style={{ fontSize: 11, fontWeight: 800, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t.nombre}</span>
                        </div>
                      );
                    }
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

// ── PlantillaEditor ───────────────────────────────────────────────────────────
function PlantillaEditor({ form, setForm, onSave, onCancel }) {
  const [cols, setCols]         = useState({ costoUnit: false, costoTotal: true, margenL: false, ventaUnit: false, ventaTotal: true });
  const [abiertos, setAbiertos] = useState({});
  const [showImport, setShowImport] = useState(false);
  const [addingRubro, setAddingRubro] = useState(false);
  const [newRubroForm, setNewRubroForm] = useState({ rubroId: '', margenMat: 15, margenMO: 35 });
  const [selectedTareasRubro, setSelectedTareasRubro] = useState(new Set());

  const { catalog } = useCatalog();

  const rr = calcRubros(form.rubros || []);
  const isOpen = (id) => abiertos[id] !== false;
  const toggleRubro = (id) => setAbiertos(p => ({ ...p, [id]: !p[id] }));

  // ── Rubro ops ────────────────────────────────────────────────────────────────
  const openAddRubro = () => setAddingRubro(true);
  const cancelAddRubro = () => {
    setAddingRubro(false);
    setNewRubroForm({ rubroId: '', margenMat: 15, margenMO: 35 });
    setSelectedTareasRubro(new Set());
  };
  const saveNewRubro = () => {
    const catalogRubro = (catalog.rubros || []).find(r => r.id === newRubroForm.rubroId);
    if (!catalogRubro) return;
    const tareasIniciales = (catalog.tareas || [])
      .filter(t => selectedTareasRubro.has(t.id))
      .map(t => {
        const { mat, sub, mo, gen } = calcTarea(t);
        return { id: newId(), nombre: t.nombre, codigo: t.codigo || '', unidad: t.unidad || 'u', cantidad: 1, costoMat: Math.round(mat + gen), costoSub: Math.round(sub + mo), receta: { materiales: (t.materiales || []).map(m => ({ id: newId(), nombre: m.nombre, cantidad: m.cantidad || 0, unidad: m.unidad || '', precio: m.precio || 0, costoUnit: (m.cantidad || 0) * (m.precio || 0) })) } };
      });
    const r = { id: newId(), nombre: catalogRubro.nombre, margenMat: +newRubroForm.margenMat, margenMO: +newRubroForm.margenMO, tareas: tareasIniciales };
    setForm(f => ({ ...f, rubros: [...(f.rubros || []), r] }));
    setAbiertos(p => ({ ...p, [r.id]: true }));
    cancelAddRubro();
  };
  const toggleTareaRubro = (id) => setSelectedTareasRubro(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const addRubroFromExcel = (rubro) => {
    setForm(f => ({ ...f, rubros: [...(f.rubros || []), rubro] }));
    setAbiertos(p => ({ ...p, [rubro.id]: true }));
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

        <TotalsStrip rr={rr} cols={cols} setCols={setCols}>
          <Btn sm fill onClick={openAddRubro}>+ Rubro</Btn>
          <Btn sm onClick={() => setShowImport(true)} style={{ background: '#e8f4ea', color: T.ok, border: `1px solid ${T.ok}` }}>
            ⬇ Desde Excel
          </Btn>
        </TotalsStrip>

        <div style={{ flex: 1, overflow: 'auto' }}>
          {(form.rubros || []).length === 0 && !addingRubro && (
            <div style={{ padding: 32, textAlign: 'center', color: T.ink3, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: 13 }}>Sin rubros. Agregá uno manualmente o importá desde Excel.</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn sm fill onClick={openAddRubro}>+ Agregar rubro</Btn>
                <Btn sm onClick={() => setShowImport(true)} style={{ background: '#e8f4ea', color: T.ok, border: `1px solid ${T.ok}` }}>⬇ Desde Excel</Btn>
              </div>
            </div>
          )}

          {rr.map(rubro => {
            const open = isOpen(rubro.id);
            return (
              <div key={rubro.id} style={{ borderBottom: `1px solid ${T.faint2}` }}>
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

                    {rubro.tareas.map(t => {
                      if (t.tipo === 'seccion') {
                        const indent = (t.nivel || 1) === 2 ? 36 : 16;
                        const bg = t.nivel === 2 ? T.faint : '#e4eaf0';
                        return (
                          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: `5px 12px 5px ${indent}px`, background: bg, borderTop: `1px solid ${T.faint2}` }}>
                            <span style={{ flex: 1, fontSize: 11, fontWeight: 800, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t.nombre}</span>
                            <span style={{ color: T.accent, cursor: 'pointer', fontSize: 11 }} onClick={() => delTarea(rubro.id, t.id)}>🗑</span>
                          </div>
                        );
                      }
                      const costoUnit  = (t.costoMat || 0) + (t.costoSub || 0);
                      const costoTotal = costoUnit * (t.cantidad || 1);
                      const ventaUnit  = tareaVentaUnit(t, rubro);
                      const ventaTotal = ventaUnit * (t.cantidad || 1);
                      const margenT    = ventaUnit > 0 ? Math.round((ventaUnit - costoUnit) / ventaUnit * 100) : 0;

                      return (
                        <div key={t.id} className="k-tr" style={{ alignItems: 'center' }}>
                          <div className="k-cell" style={{ flex: 3 }}>
                            <input value={t.nombre} placeholder="Nombre de la tarea"
                              onChange={e => updTarea(rubro.id, t.id, { nombre: e.target.value })}
                              style={cellInSt(false)} />
                          </div>
                          <div className="k-cell" style={{ flex: 0.8 }}>
                            <input type="number" min="0" step="any" value={t.cantidad || 1}
                              onChange={e => updTarea(rubro.id, t.id, { cantidad: +e.target.value })}
                              style={cellInSt(true)} />
                          </div>
                          <div className="k-cell" style={{ flex: 0.6 }}>
                            <input value={t.unidad || 'u'}
                              onChange={e => updTarea(rubro.id, t.id, { unidad: e.target.value })}
                              style={cellInSt(false)} />
                          </div>
                          <div className="k-cell" style={{ flex: 1 }}>
                            <input type="number" min="0" step="any" value={t.costoMat || 0}
                              onChange={e => updTarea(rubro.id, t.id, { costoMat: +e.target.value })}
                              style={cellInSt(true, '#c0392b')} />
                          </div>
                          <div className="k-cell" style={{ flex: 1 }}>
                            <input type="number" min="0" step="any" value={t.costoSub || 0}
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

                    <div className="k-tr" style={{ cursor: 'pointer' }} onClick={() => addTarea(rubro.id)}>
                      <div className="k-cell" style={{ flex: 1, color: T.accent, fontSize: 12 }}>+ Agregar tarea</div>
                    </div>
                  </>
                )}
              </div>
            );
          })}

          {addingRubro && (() => {
            const selCatRubro = (catalog.rubros || []).find(r => r.id === newRubroForm.rubroId);
            const tareasDispo = selCatRubro
              ? (catalog.tareas || []).filter(t => t.rubroNombre === selCatRubro.nombre)
              : [];
            return (
              <div style={{ margin: 12, background: T.accentSoft, border: `1.5px solid ${T.accent}`, borderRadius: 6, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>Nuevo rubro</div>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ fontSize: 10, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 3 }}>Rubro</div>
                    <select style={{ ...inputSt, cursor: 'pointer' }} value={newRubroForm.rubroId}
                      onChange={e => { setNewRubroForm(p => ({ ...p, rubroId: e.target.value })); setSelectedTareasRubro(new Set()); }}>
                      <option value="">— Seleccionar rubro —</option>
                      {(catalog.rubros || []).map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                    </select>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ fontSize: 10, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 3 }}>% Margen mat</div>
                    <input style={inputSt} type="number" value={newRubroForm.margenMat} onChange={e => setNewRubroForm(p => ({ ...p, margenMat: e.target.value }))} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ fontSize: 10, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 3 }}>% Margen sub</div>
                    <input style={inputSt} type="number" value={newRubroForm.margenMO} onChange={e => setNewRubroForm(p => ({ ...p, margenMO: e.target.value }))} />
                  </div>
                </div>
                {newRubroForm.rubroId && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: T.ink2, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      Tareas disponibles {selectedTareasRubro.size > 0 && <span style={{ color: T.accent }}>· {selectedTareasRubro.size} seleccionadas</span>}
                    </div>
                    {tareasDispo.length === 0
                      ? <div style={{ fontSize: 12, color: T.ink3, padding: '8px 0' }}>No hay tareas cargadas en este rubro del catálogo.</div>
                      : <div style={{ maxHeight: 220, overflowY: 'auto', border: `1px solid ${T.faint2}`, borderRadius: 4, background: T.paper }}>
                          {tareasDispo.map(t => {
                            const checked = selectedTareasRubro.has(t.id);
                            const { mat, sub, mo, gen } = calcTarea(t);
                            return (
                              <div key={t.id} onClick={() => toggleTareaRubro(t.id)}
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
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                  <Btn sm onClick={cancelAddRubro}>Cancelar</Btn>
                  <Btn sm fill style={{ opacity: newRubroForm.rubroId ? 1 : 0.5 }} onClick={saveNewRubro}>Agregar rubro</Btn>
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {showImport && (
        <ImportarRecetaModal
          onAgregar={addRubroFromExcel}
          onClose={() => setShowImport(false)}
        />
      )}
    </div>
  );
}

// ── Modal: crear obra desde plantilla ────────────────────────────────────────
function UsarPlantillaModal({ plantilla, onClose, onCrear }) {
  const { clientes } = useClientes();
  const todayStr = () => new Date().toISOString().split('T')[0];
  const [nombre, setNombre]     = useState('');
  const [clienteId, setClienteId] = useState('');
  const [fechaInicio, setFechaInicio] = useState(todayStr());
  const [fechaFin, setFechaFin] = useState('');
  const canSave = nombre.trim() && clienteId;
  const cliente = clientes.find(c => c.id === clienteId);

  const inputSt2 = { padding: '6px 10px', border: `1.2px solid ${T.faint2}`, borderRadius: 4, fontFamily: T.font, fontSize: 12, background: T.paper, boxSizing: 'border-box', outline: 'none', width: '100%' };
  const lblSt2  = { fontSize: 10, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 3, display: 'block' };

  return (
    <div className="k-modal-overlay" onClick={onClose}>
      <div className="k-modal" style={{ width: 420 }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', background: T.dark, color: T.paper, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, fontFamily: T.font }}>Crear obra desde plantilla</div>
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>{plantilla.nombre}</div>
          </div>
          <span style={{ cursor: 'pointer', fontSize: 20, opacity: 0.7 }} onClick={onClose}>✕</span>
        </div>
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label style={lblSt2}>Nombre de la obra <span style={{ color: T.accent }}>*</span></label>
            <input style={inputSt2} value={nombre} onChange={e => setNombre(e.target.value)} autoFocus placeholder="Ej: Baradero · Shell" />
          </div>
          <div>
            <label style={lblSt2}>Cliente <span style={{ color: T.accent }}>*</span></label>
            <select style={{ ...inputSt2, cursor: 'pointer' }} value={clienteId} onChange={e => setClienteId(e.target.value)}>
              <option value="">— Seleccionar —</option>
              {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={lblSt2}>Fecha inicio</label>
              <input type="date" style={inputSt2} value={fechaInicio} onChange={e => setFechaInicio(e.target.value)} />
            </div>
            <div>
              <label style={lblSt2}>Fecha fin estimada</label>
              <input type="date" style={inputSt2} value={fechaFin} onChange={e => setFechaFin(e.target.value)} />
            </div>
          </div>
          <div style={{ background: T.faint, borderRadius: 4, padding: '8px 10px', fontSize: 11, color: T.ink2 }}>
            Se copiarán <b>{(plantilla.rubros || []).length} rubros</b> y <b>{(plantilla.rubros || []).reduce((s, r) => s + (r.tareas || []).length, 0)} tareas</b> al presupuesto.
          </div>
        </div>
        <div style={{ padding: '10px 18px', borderTop: `1.5px solid ${T.faint2}`, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Btn sm onClick={onClose}>Cancelar</Btn>
          <Btn sm fill style={{ opacity: canSave ? 1 : 0.5 }}
            onClick={() => canSave && onCrear({ nombre: nombre.trim(), cliente: cliente?.nombre || '', clienteId, fechaInicio, fechaFinEstim: fechaFin })}>
            Crear obra →
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function Plantillas() {
  const navigate = useNavigate();
  const { addObra, patchDetalle } = useObras();
  const { plantillas, add, update, remove, duplicate, incrementUso } = usePlantillas();
  const [tipoFilt, setTipoFilt] = useState('Todos');
  const [search,   setSearch]   = useState('');
  const [viewId,   setViewId]   = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [form,     setForm]     = useState(null);
  const [menuId,   setMenuId]   = useState(null);
  const [flash,    setFlash]    = useState(null);
  const [usarPlt,  setUsarPlt]  = useState(null);

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
    setUsarPlt(p);
    setViewId(null);
  };

  const handleCrearObra = (datos) => {
    const obraId = addObra(datos);
    patchDetalle(obraId, d => ({ ...d, rubros: JSON.parse(JSON.stringify(usarPlt.rubros || [])) }));
    incrementUso(usarPlt.id);
    setUsarPlt(null);
    navigate(`/obras/${obraId}/presupuesto`);
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <div>
          <div className="k-h" style={{ fontSize: 26 }}>Plantillas de presupuesto</div>
          <div style={{ fontSize: 12, color: T.ink2 }}>Modelos reutilizables · hacé click en una para ver el detalle completo</div>
        </div>
        <Btn sm fill onClick={startNew}>+ Nueva plantilla</Btn>
      </div>

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

      {viewPlt && !showEdit && (
        <PlantillaViewer
          plt={viewPlt}
          onClose={() => setViewId(null)}
          onEdit={() => startEdit(viewPlt)}
          onUsar={() => handleUsar(viewPlt)}
        />
      )}

      {showEdit && (
        <PlantillaEditor form={form} setForm={setForm} onSave={save} onCancel={cancel} />
      )}

      {menuId && <div style={{ position: 'fixed', inset: 0, zIndex: 10 }} onClick={() => setMenuId(null)} />}

      {usarPlt && (
        <UsarPlantillaModal
          plantilla={usarPlt}
          onClose={() => setUsarPlt(null)}
          onCrear={handleCrearObra}
        />
      )}

      {flash && (
        <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: T.ink, color: 'white', padding: '10px 20px', borderRadius: 6, fontSize: 13, zIndex: 400, maxWidth: 420, textAlign: 'center', pointerEvents: 'none' }}>
          {flash}
        </div>
      )}
    </PageLayout>
  );
}
