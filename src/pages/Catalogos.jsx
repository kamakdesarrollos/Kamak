import { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import PageLayout from '../components/layout/PageLayout';
import { Box, Btn, Chip, Divider } from '../components/ui';
import PageHero from '../components/ui/PageHero';
import { T } from '../theme';
import { useCatalog, calcTarea } from '../store/CatalogContext';
import { resolverItemAPU, resolverMOAPU, buildCatalogItemsIndex } from '../lib/apuPriceResolver';
import { groupByKey } from '../lib/catalogGroup';
import TareasEstandarEditor from './modales/TareasEstandarEditor';
import { useUsuarios } from '../store/UsuariosContext';
import { useIndices } from '../store/IndicesContext';
import { calcularPreviewCAC } from '../lib/cacUpdate';
import { getIndiceTipo } from '../lib/indices';

const newId = () => `ci-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;
const fmtPrecio = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-AR')}`;
const fmtN = (n) => Math.round(n).toLocaleString('es-AR');
const today = () => new Date().toISOString().split('T')[0];
const inputSt = { padding: '5px 8px', border: `1.2px solid ${T.faint2}`, borderRadius: 4, fontFamily: T.font, fontSize: 12, background: T.paper, boxSizing: 'border-box', outline: 'none', width: '100%' };
const labelSt = { fontSize: 10, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 2 };

// ── Excel paste parser ─────────────────────────────────────────────────────────
function parseReceta(text) {
  if (!text.trim()) return { rubro: '', receta: '', unidad: 'm²', items: [] };
  const SKIP = new Set(['Tipo','Descripcion','UD','Cantidad','P. Unitario','Importe',
    'Materiales:','Subcontratos:','Mano de Obra:','Equipos:','Otros:','Auxiliares:',
    'Obra:','Presupuesto:','Computo:','Emitido:','Usuario:']);
  const VALID = new Set(['MA','SC','OT','EQ','AU','MO']);
  const lines = text.split('\n');
  const hdrLines = [], dataLines = [];
  let found = false;
  let unidad = 'm²';
  for (const line of lines) {
    const cells = line.split('\t').map(c => c.trim());
    const first = cells.filter(c => c)[0] || '';
    if (first === 'Tipo') { found = true; continue; }
    if (VALID.has(first.toUpperCase())) found = true;
    (found ? dataLines : hdrLines).push(cells);
  }
  const hdrTokens = [];
  for (const cells of hdrLines) {
    let skipNext = false;
    for (const c of cells) {
      if (!c) continue;
      if (skipNext) { skipNext = false; continue; }
      if (c.length < 2) continue;
      if (SKIP.has(c)) { skipNext = true; continue; }
      if (/^unidad:/i.test(c)) { unidad = c.replace(/^unidad:\s*/i, '').trim() || unidad; continue; }
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
      nombre: ne[1] || '', unidad: ne[2] || 'u', cantidad, precio, tipo,
    });
  }
  return { rubro, receta, unidad, items };
}

function FRow({ label, children }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><div style={labelSt}>{label}</div>{children}</div>;
}

const RUBRO_COLORS = { ELECTRICIDAD:'#1a9b9c', ALBAÑILERÍA:'#d4923a', ESTRUCTURA:'#3d7a4a', PLOMERÍA:'#4a7ab5', PINTURA:'#b54a6e', CARPINTERÍA:'#7a4ab5', REVESTIMIENTOS:'#a05a2c', 'GASTOS GENERALES':'#6b7280' };
const rCol = (n) => RUBRO_COLORS[(n||'').toUpperCase()] ?? '#6b7280';

// ── Autocomplete search for catalog items ──────────────────────────────────────
function InsumoSearch({ items, onSelect, placeholder }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const ref = useRef(null);

  const results = useMemo(() => {
    if (!q.trim()) return [];
    const norm = s => (s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const ql = norm(q);
    const matches = items.filter(i => norm(i.nombre).includes(ql));
    const rank = s => {
      if (s.startsWith(ql)) return 2;
      if (s.split(/\s+/).some(w => w.startsWith(ql))) return 1;
      return 0;
    };
    matches.sort((a, b) => {
      const diff = rank(norm(b.nombre)) - rank(norm(a.nombre));
      if (diff !== 0) return diff;
      return a.nombre.localeCompare(b.nombre, 'es');
    });
    return matches.slice(0, 12);
  }, [q, items]);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const select = (item) => { onSelect(item); setQ(''); setOpen(false); };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <input
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true); setIdx(0); }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i+1, results.length-1)); }
          if (e.key === 'ArrowUp')   { e.preventDefault(); setIdx(i => Math.max(i-1, 0)); }
          if (e.key === 'Enter' && results[idx]) select(results[idx]);
          if (e.key === 'Escape') { setOpen(false); setQ(''); }
        }}
        onFocus={() => q && setOpen(true)}
        placeholder={placeholder || 'Buscar y agregar…'}
        style={{ ...inputSt, padding: '7px 10px' }}
      />
      {open && results.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: T.paper, border: `1.5px solid ${T.accent}`, borderRadius: 4, boxShadow: '0 4px 16px rgba(0,0,0,.15)', zIndex: 50, maxHeight: 220, overflow: 'auto' }}>
          {results.map((item, i) => (
            <div key={item.id}
              onMouseDown={() => select(item)}
              style={{ padding: '8px 12px', cursor: 'pointer', background: i === idx ? T.accentSoft : 'transparent', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{item.nombre}</span>
              <span style={{ fontSize: 11, color: T.ink2, fontFamily: T.fontMono }}>$ {fmtN(item.precio ?? item.precioHora ?? 0)} {item.unidad}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Full-screen APU editor ─────────────────────────────────────────────────────
const cellInSt = { width: '100%', textAlign: 'right', fontFamily: T.fontMono, fontSize: 12, border: `1px solid ${T.faint2}`, borderRadius: 3, padding: '2px 5px', outline: 'none', background: T.paper };

function APUEditor({ form, setForm, rubros, materiales, moItems, subcontratos, generales, onSave, onCancel }) {
  // Index del catálogo (Map por nombre normalizado) para lookup O(1) en
  // calcTarea — sin esto, cada material × cada item del catálogo SISMAT
  // (~2000) hacía string normalization lineal y mataba el render.
  const catalogIndex = useMemo(() => ({
    materiales:   buildCatalogItemsIndex(materiales || []),
    subcontratos: buildCatalogItemsIndex(subcontratos || []),
    mo:           buildCatalogItemsIndex(moItems || []),
    generales:    buildCatalogItemsIndex(generales || []),
  }), [materiales, subcontratos, moItems, generales]);
  const costs = useMemo(() => calcTarea(form, catalogIndex), [form, catalogIndex]);

  const addMat = (item) => setForm(f => ({ ...f, materiales: [...f.materiales, { id: newId(), nombre: item.nombre, cantidad: 1, unidad: item.unidad, precio: item.precio }] }));
  const addSub = (item) => setForm(f => ({ ...f, subcontratos: [...(f.subcontratos||[]), { id: newId(), nombre: item.nombre, cantidad: 1, unidad: item.unidad, precio: item.precio }] }));
  const addMO  = (item) => setForm(f => ({ ...f, mo: [...(f.mo||[]), { id: newId(), nombre: item.nombre, horas: 1, precioHora: item.precioHora }] }));
  const updateMat = (id, field, val) => setForm(f => ({ ...f, materiales: f.materiales.map(m => m.id === id ? { ...m, [field]: val } : m) }));
  const removeMat = (id) => setForm(f => ({ ...f, materiales: f.materiales.filter(m => m.id !== id) }));
  const updateSub = (id, field, val) => setForm(f => ({ ...f, subcontratos: (f.subcontratos||[]).map(s => s.id === id ? { ...s, [field]: val } : s) }));
  const removeSub = (id) => setForm(f => ({ ...f, subcontratos: (f.subcontratos||[]).filter(s => s.id !== id) }));
  const updateMO  = (id, field, val) => setForm(f => ({ ...f, mo: (f.mo||[]).map(m => m.id === id ? { ...m, [field]: val } : m) }));
  const removeMO  = (id) => setForm(f => ({ ...f, mo: (f.mo||[]).filter(m => m.id !== id) }));

  const headerInput = (extra) => ({ background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.18)', color: T.paper, fontFamily: T.font, fontSize: 12, padding: '4px 8px', borderRadius: 4, outline: 'none', ...extra });

  const SectionHeader = ({ label }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ flex: 1, height: 1, background: T.faint2 }} />
    </div>
  );

  const TableHeader = () => (
    <div className="k-tr" style={{ background: T.faint, fontWeight: 700, fontSize: 10, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.4 }}>
      <div className="k-cell" style={{ flex: 3 }}>Nombre</div>
      <div className="k-cell" style={{ flex: 1, textAlign: 'right' }}>Cant</div>
      <div className="k-cell" style={{ flex: 0.8, textAlign: 'center' }}>Unidad</div>
      <div className="k-cell" style={{ flex: 1.5, textAlign: 'right' }}>$ Unit</div>
      <div className="k-cell" style={{ flex: 1.5, textAlign: 'right' }}>Total $</div>
      <div className="k-cell" style={{ flex: 0.3 }} />
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 300, display: 'flex', padding: 16 }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.paper, borderRadius: 8, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.4)' }}>

        {/* Dark header */}
        <div style={{ background: T.dark, color: T.paper, padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <input
            value={form.nombre || ''}
            onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
            placeholder="Nombre de la tarea / receta…"
            autoFocus
            style={{ flex: 1, background: 'transparent', border: 'none', borderBottom: '1.5px solid rgba(255,255,255,.3)', color: T.paper, fontFamily: T.font, fontSize: 18, fontWeight: 800, outline: 'none', padding: '2px 0' }}
          />
          <input value={form.subRubro || ''} onChange={e => setForm(f => ({ ...f, subRubro: e.target.value }))}
            placeholder="Sub-categoría" style={headerInput({ width: 180 })} />
          <input value={form.codigo || ''} onChange={e => setForm(f => ({ ...f, codigo: e.target.value }))}
            placeholder="Código" style={headerInput({ width: 100, fontFamily: T.fontMono })} />
          <input value={form.unidad || ''} onChange={e => setForm(f => ({ ...f, unidad: e.target.value }))}
            placeholder="Unidad" style={headerInput({ width: 70 })} />
          <select value={form.rubroNombre || ''} onChange={e => setForm(f => ({ ...f, rubroNombre: e.target.value }))}
            style={headerInput({ cursor: 'pointer' })}>
            {rubros.map(r => <option key={r.id} style={{ background: T.dark }}>{r.nombre}</option>)}
          </select>
          <Btn sm fill onClick={onSave} style={{ flexShrink: 0 }}>Guardar</Btn>
          <span onClick={onCancel} style={{ cursor: 'pointer', fontSize: 20, opacity: 0.7, marginLeft: 4, userSelect: 'none' }}>✕</span>
        </div>

        {/* Totals strip */}
        <div style={{ background: T.faint, borderBottom: `1.5px solid ${T.faint2}`, padding: '8px 20px', display: 'flex', gap: 20, alignItems: 'center', flexShrink: 0 }}>
          {[
            { label: 'Materiales', val: costs.mat },
            { label: 'Mano de Obra', val: costs.sub + costs.mo },
          ].map(({ label, val }, i) => (
            <span key={label} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {i > 0 && <span style={{ color: T.faint2 }}>|</span>}
              <span style={{ fontSize: 10, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
              <span style={{ fontFamily: T.fontMono, fontWeight: 700, fontSize: 13 }}>$ {fmtN(val)}</span>
            </span>
          ))}
          <span style={{ color: T.faint2 }}>|</span>
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5 }}>Total</span>
            <span style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 16, color: T.accent }}>$ {fmtN(costs.total)}</span>
          </span>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 24 }}>

          {/* MATERIALES */}
          <div>
            <SectionHeader label="Materiales" />
            <div style={{ marginBottom: 10 }}>
              <InsumoSearch items={materiales} onSelect={addMat} placeholder="Buscar material del catálogo y agregar…" />
            </div>
            {form.materiales.length > 0 ? (
              <div>
                <TableHeader />
                {form.materiales.map(m => {
                  const r = resolverItemAPU(m, catalogIndex.materiales);
                  const warn = !r.encontrado;
                  const unidadMostrar = r.encontrado ? r.unidadCatalogo : m.unidad;
                  return (
                  <div key={m.id} className="k-tr" style={{ alignItems: 'center', background: warn ? '#fff7ed' : 'transparent' }}>
                    <div className="k-cell" style={{ flex: 3, fontSize: 12, fontWeight: 600 }}>
                      {m.nombre}
                      {warn && <span title="Material no encontrado en el catálogo — el precio puede estar desactualizado" style={{ marginLeft: 6, fontSize: 9.5, padding: '1px 5px', borderRadius: 8, background: '#dc2626', color: '#fff', fontWeight: 700, letterSpacing: 0.4 }}>SIN CATÁLOGO</span>}
                    </div>
                    <div className="k-cell" style={{ flex: 1 }}>
                      <input type="number" min="0" step="0.01" value={m.cantidad} onChange={e => updateMat(m.id, 'cantidad', +e.target.value)} style={cellInSt} />
                    </div>
                    <div className="k-cell" style={{ flex: 0.8, textAlign: 'center', color: T.ink2, fontSize: 11 }}>{unidadMostrar}</div>
                    <div className="k-cell" style={{ flex: 1.5, fontFamily: T.fontMono, textAlign: 'right', fontSize: 12, color: T.ink2 }}>$ {fmtN(r.precioUnitario)}</div>
                    <div className="k-cell" style={{ flex: 1.5, fontFamily: T.fontMono, textAlign: 'right', fontWeight: 700, fontSize: 12 }}>$ {fmtN(r.subtotal)}</div>
                    <div className="k-cell" style={{ flex: 0.3, textAlign: 'center' }}>
                      <span style={{ color: T.accent, cursor: 'pointer', fontSize: 15 }} onClick={() => removeMat(m.id)}>×</span>
                    </div>
                  </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ color: T.ink3, fontSize: 12, fontStyle: 'italic', padding: '6px 0' }}>Sin materiales. Buscá en el catálogo para agregar.</div>
            )}
          </div>

          {/* SUB CONTRATOS */}
          <div>
            <SectionHeader label="Mano de Obra — M.O" />
            <div style={{ marginBottom: 10 }}>
              <InsumoSearch items={subcontratos} onSelect={addSub} placeholder="Buscar M.O del catálogo y agregar…" />
            </div>
            {(form.subcontratos||[]).length > 0 ? (
              <div>
                <TableHeader />
                {(form.subcontratos||[]).map(s => {
                  const r = resolverItemAPU(s, catalogIndex.subcontratos);
                  const warn = !r.encontrado;
                  const unidadMostrar = r.encontrado ? r.unidadCatalogo : s.unidad;
                  return (
                  <div key={s.id} className="k-tr" style={{ alignItems: 'center', background: warn ? '#fff7ed' : 'transparent' }}>
                    <div className="k-cell" style={{ flex: 3, fontSize: 12, fontWeight: 600 }}>
                      {s.nombre}
                      {warn && <span title="Item de M.O no encontrado en el catálogo" style={{ marginLeft: 6, fontSize: 9.5, padding: '1px 5px', borderRadius: 8, background: '#dc2626', color: '#fff', fontWeight: 700, letterSpacing: 0.4 }}>SIN CATÁLOGO</span>}
                    </div>
                    <div className="k-cell" style={{ flex: 1 }}>
                      <input type="number" min="0" step="0.01" value={s.cantidad} onChange={e => updateSub(s.id, 'cantidad', +e.target.value)} style={cellInSt} />
                    </div>
                    <div className="k-cell" style={{ flex: 0.8, textAlign: 'center', color: T.ink2, fontSize: 11 }}>{unidadMostrar}</div>
                    <div className="k-cell" style={{ flex: 1.5, fontFamily: T.fontMono, textAlign: 'right', fontSize: 12, color: T.ink2 }}>$ {fmtN(r.precioUnitario)}</div>
                    <div className="k-cell" style={{ flex: 1.5, fontFamily: T.fontMono, textAlign: 'right', fontWeight: 700, fontSize: 12 }}>$ {fmtN(r.subtotal)}</div>
                    <div className="k-cell" style={{ flex: 0.3, textAlign: 'center' }}>
                      <span style={{ color: T.accent, cursor: 'pointer', fontSize: 15 }} onClick={() => removeSub(s.id)}>×</span>
                    </div>
                  </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ color: T.ink3, fontSize: 12, fontStyle: 'italic', padding: '6px 0' }}>Sin items de M.O. Buscá en el catálogo para agregar.</div>
            )}
          </div>

          {/* MANO DE OBRA - antes había una sección de "MO por horas" (catalog.mo)
              que se eliminó. Toda la mano de obra ahora vive en M.O / Sub
              Contratos arriba. */}
        </div>
      </div>
    </div>
  );
}

// ── Tab: Materiales / Sub contratos / MO / Generales (tabla simple + panel) ────
function TabSimple({ items, onAdd, onUpdate, onDelete, cols, emptyForm, renderForm, rubroKey = 'rubro', rubros }) {
  const [sel, setSel] = useState(null);
  const [form, setForm] = useState(null);
  const [search, setSearch] = useState('');
  const [lastAddedId, setLastAddedId] = useState(null);
  const [selRubro, setSelRubro] = useState('');

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const list = items.filter(i =>
      (!selRubro || i[rubroKey] === selRubro) &&
      Object.values(i).some(v => String(v).toLowerCase().includes(q))
    );
    if (lastAddedId) {
      const idx = list.findIndex(i => i.id === lastAddedId);
      if (idx > 0) { const [it] = list.splice(idx, 1); list.unshift(it); }
    }
    return list;
  }, [items, search, lastAddedId, selRubro, rubroKey]);

  const startAdd  = () => { setForm({ ...emptyForm }); setSel(null); };
  const startEdit = (item) => { setForm({ ...item }); setSel(item.id); };
  const cancel    = () => { setForm(null); setSel(null); setLastAddedId(null); };
  const save = () => {
    if (!form) return;
    if (sel) onUpdate(sel, form);
    else onAdd(form);
    setForm(null); setSel(null); setLastAddedId(null);
  };

  return (
    <div style={{ display: 'flex', gap: 10, height: '100%' }}>
      {rubros?.length > 0 && (
        <Box style={{ width: 190, flexShrink: 0, padding: '8px 6px', overflow: 'auto' }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: T.ink3, textTransform: 'uppercase', letterSpacing: 0.6, padding: '0 4px', marginBottom: 6 }}>Por rubro</div>
          <div onClick={() => setSelRubro('')}
            style={{ padding: '4px 8px', borderRadius: 3, cursor: 'pointer', fontWeight: !selRubro ? 700 : 400, fontSize: 11, background: !selRubro ? T.accentSoft : 'transparent', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
            <span style={{ color: !selRubro ? T.ink : T.ink2 }}>Todos</span>
            <span style={{ fontSize: 9, color: T.ink3, fontFamily: T.fontMono }}>{items.length}</span>
          </div>
          {rubros.map(r => {
            const count = items.filter(i => i[rubroKey] === r).length;
            const isOn  = selRubro === r;
            const label = r.replace(/^\d+\s*-\s*/, '');
            const num   = r.match(/^(\d+)/)?.[1];
            return (
              <div key={r} onClick={() => setSelRubro(r)}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 3, cursor: 'pointer', background: isOn ? T.accentSoft : 'transparent', borderLeft: `2px solid ${isOn ? T.accent : 'transparent'}`, marginBottom: 1 }}>
                {num && <span style={{ fontSize: 9, color: T.ink3, fontFamily: T.fontMono, flexShrink: 0, width: 14 }}>{num}</span>}
                <span style={{ flex: 1, fontSize: 11, color: isOn ? T.ink : T.ink2, fontWeight: isOn ? 700 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
                {count > 0 && <span style={{ fontSize: 9, color: T.ink3, fontFamily: T.fontMono, flexShrink: 0 }}>{count}</span>}
              </div>
            );
          })}
        </Box>
      )}

      <Box style={{ flex: 1, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '8px 10px', background: T.faint, borderBottom: `1px solid ${T.faint2}`, display: 'flex', gap: 8, alignItems: 'center' }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar…"
            style={{ ...inputSt, flex: 1, padding: '4px 8px' }} />
          <Btn sm fill onClick={startAdd}>+ Agregar</Btn>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: T.faint, position: 'sticky', top: 0 }}>
                {cols.map(c => <th key={c.label} style={{ padding: '6px 10px', textAlign: c.align||'left', fontWeight: 700, fontSize: 10, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: `1px solid ${T.faint2}` }}>{c.label}</th>)}
                <th style={{ width: 60, borderBottom: `1px solid ${T.faint2}` }} />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={cols.length+1} style={{ padding: 24, textAlign: 'center', color: T.ink3 }}>Sin resultados</td></tr>}
              {(() => {
                const rows = [];
                let lastGroup = null;
                // Agrupar por rubro SIN asumir que la lista viene ordenada: si no,
                // el encabezado se repetía cada vez que el rubro reaparecía salteado.
                const agrupar = rubros?.length > 0 && !selRubro;
                const lista = agrupar ? groupByKey(filtered, rubroKey) : filtered;
                lista.forEach(item => {
                  if (agrupar) {
                    const grp = item[rubroKey] || '';
                    if (grp !== lastGroup) {
                      lastGroup = grp;
                      const rNum = grp.match(/^(\d+)/)?.[1];
                      const rLabel = grp.replace(/^\d+\s*-\s*/, '');
                      rows.push(
                        <tr key={`grp-${grp}`}>
                          <td colSpan={cols.length+1} style={{ padding: '10px 10px 3px', background: T.faint, borderTop: `1px solid ${T.faint2}` }}>
                            <span style={{ fontSize: 9, fontWeight: 800, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                              {rNum && <span style={{ fontFamily: T.fontMono, color: T.ink3, marginRight: 5 }}>{rNum} ·</span>}
                              {rLabel}
                            </span>
                          </td>
                        </tr>
                      );
                    }
                  }
                  rows.push(
                    <tr key={item.id}
                      style={{ background: sel === item.id ? T.accentSoft : 'transparent', cursor: 'pointer', borderBottom: `1px solid ${T.faint2}` }}
                      onClick={() => startEdit(item)}>
                      {cols.map(c => <td key={c.key} style={{ padding: '7px 10px', fontFamily: c.mono ? T.fontMono : T.font, textAlign: c.align||'left' }}>{c.render ? c.render(item[c.key], item) : item[c.key]}</td>)}
                      <td style={{ padding: '4px 8px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                          <span title="Duplicar" style={{ color: T.ink2, cursor: 'pointer', fontSize: 13 }}
                            onClick={e => {
                              e.stopPropagation();
                              const dupId = newId();
                              const copy = { ...item, nombre: `Copia de ${item.nombre}`, id: dupId };
                              onAdd(copy);
                              setLastAddedId(dupId);
                              setForm({ ...copy });
                              setSel(dupId);
                            }}>⧉</span>
                          <span style={{ color: T.accent, cursor: 'pointer', fontSize: 12 }}
                            onClick={e => { e.stopPropagation(); if (confirm('¿Eliminar?')) onDelete(item.id); }}>🗑</span>
                        </div>
                      </td>
                    </tr>
                  );
                });
                return rows;
              })()}
            </tbody>
          </table>
        </div>
      </Box>

      {form && (
        <Box style={{ width: 300, flexShrink: 0, padding: 14, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 4 }}>{sel ? 'Editar' : 'Nuevo'}</div>
          {renderForm(form, setForm)}
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <Btn sm onClick={cancel} style={{ flex: 1 }}>Cancelar</Btn>
            <Btn sm fill onClick={save} style={{ flex: 1 }}>Guardar</Btn>
          </div>
        </Box>
      )}
    </div>
  );
}

// ── Importar APU desde Excel ──────────────────────────────────────────────────
// Modal: actualizar masivamente los precios del catálogo por índice CAC.
function ActualizarCACModal({ catalog, indices, onAplicar, onRestore, onClose }) {
  const meses = Object.keys(indices || {}).sort();
  const [mesBase, setMesBase] = useState(meses[0] || '');
  const [mesActual, setMesActual] = useState(meses[meses.length - 1] || '');
  const [incluirMOLegacy, setIncluirMOLegacy] = useState(false);
  let hayBackup = false;
  try { hayBackup = !!JSON.parse(localStorage.getItem('kamak_catalog_cac_backup') || 'null'); } catch { hayBackup = false; }

  const opts = { mesBase, mesActual, indices, incluirMOLegacy };
  const sinMeses = meses.length < 2;
  const mismoMes = mesBase === mesActual;
  const preview = sinMeses ? { porColeccion: {}, omitidos: 0, sinIndice: 0, totalActualizados: 0 } : calcularPreviewCAC(catalog, opts);
  const puedeAplicar = !sinMeses && !mismoMes && preview.totalActualizados > 0;

  const COLS = [['materiales', 'Materiales'], ['subcontratos', 'Mano de obra'], ['generales', 'Generales']]
    .concat(incluirMOLegacy ? [['mo', 'MO legacy (hora)']] : []);
  const lbl = { fontSize: 10, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 3, display: 'block' };
  const sel = { padding: '6px 10px', border: `1.2px solid ${T.faint2}`, borderRadius: 4, fontSize: 12, background: T.paper, cursor: 'pointer' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={onClose}>
      <div style={{ background: T.paper, borderRadius: 8, width: 580, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${T.faint2}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <b style={{ fontSize: 15 }}>⟳ Actualizar precios por CAC</b>
          <span style={{ cursor: 'pointer', color: T.ink3, fontSize: 18 }} onClick={onClose}>✕</span>
        </div>
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {sinMeses ? (
            <div style={{ color: T.warn, fontSize: 13 }}>Cargá al menos dos meses de índice CAC en <b>Configuración → Índices de redeterminación</b> para poder actualizar precios.</div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div><label style={lbl}>Mes base</label>
                  <select style={sel} value={mesBase} onChange={e => setMesBase(e.target.value)}>{meses.map(m => <option key={m}>{m}</option>)}</select></div>
                <div style={{ paddingBottom: 6, color: T.ink3 }}>→</div>
                <div><label style={lbl}>Mes actual</label>
                  <select style={sel} value={mesActual} onChange={e => setMesActual(e.target.value)}>{meses.map(m => <option key={m}>{m}</option>)}</select></div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={incluirMOLegacy} onChange={e => setIncluirMOLegacy(e.target.checked)} />
                Incluir MO legacy por hora (catalog.mo, deprecada)
              </label>

              <div style={{ border: `1px solid ${T.faint2}`, borderRadius: 6, overflow: 'hidden' }}>
                {COLS.map(([k, label], i) => {
                  const c = preview.porColeccion[k] || { total: 0, actualizados: 0, variacionPct: null, ejemplos: [] };
                  return (
                    <div key={k} style={{ padding: '8px 12px', borderTop: i > 0 ? `1px solid ${T.faint2}` : 'none', fontSize: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span><b>{label}</b> <span style={{ color: T.ink3 }}>({getIndiceTipo(c.tipo)?.nombre || c.tipo})</span></span>
                        <span style={{ fontFamily: T.fontMono }}>
                          {c.actualizados}/{c.total} ítems
                          {c.variacionPct != null && <b style={{ marginLeft: 6, color: c.variacionPct >= 0 ? T.warn : T.ok }}>{c.variacionPct >= 0 ? '+' : ''}{c.variacionPct}%</b>}
                        </span>
                      </div>
                      {c.ejemplos.slice(0, 2).map((e, j) => (
                        <div key={j} style={{ fontSize: 10.5, color: T.ink3, fontFamily: T.fontMono }}>{e.nombre}: {fmtPrecio(e.antes)} → {fmtPrecio(e.despues)}</div>
                      ))}
                    </div>
                  );
                })}
              </div>

              {(preview.omitidos > 0 || preview.sinIndice > 0) && (
                <div style={{ fontSize: 10.5, color: T.ink3 }}>
                  {preview.omitidos > 0 && <div>· {preview.omitidos} ítem(s) sin precio → omitidos.</div>}
                  {preview.sinIndice > 0 && <div>· {preview.sinIndice} ítem(s) sin índice para esos meses → sin cambio.</div>}
                </div>
              )}
              {mismoMes && <div style={{ color: T.warn, fontSize: 11.5 }}>El mes base y el actual son el mismo: no hay nada que actualizar.</div>}

              <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', color: '#b45309', borderRadius: 6, padding: '8px 12px', fontSize: 11.5 }}>
                ⚠️ Esto actualiza <b>solo el catálogo base</b>. Los presupuestos de obras ya cargadas <b>no cambian</b> (sus costos quedaron congelados al presupuestar). Los precios nuevos aplican a presupuestos que cargues a partir de ahora.
              </div>
            </>
          )}
        </div>
        <div style={{ padding: '10px 18px', borderTop: `1px solid ${T.faint2}`, display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
          <span>{hayBackup && <Btn sm onClick={onRestore} style={{ color: T.ink3 }}>↶ Deshacer última</Btn>}</span>
          <span style={{ display: 'flex', gap: 8 }}>
            <Btn sm onClick={onClose}>Cancelar</Btn>
            <Btn sm fill onClick={() => onAplicar(opts)} style={{ opacity: puedeAplicar ? 1 : 0.4, pointerEvents: puedeAplicar ? 'auto' : 'none' }}>
              Aplicar ({preview.totalActualizados})
            </Btn>
          </span>
        </div>
      </div>
    </div>
  );
}

function ImportarAPUModal({ rubros, onImport, onClose }) {
  const [text, setText] = useState('');
  const [nombre, setNombre] = useState('');
  const [subRubro, setSubRubro] = useState('');
  const [rubroNombre, setRubroNombre] = useState(rubros[0]?.nombre || '');
  const [unidad, setUnidad] = useState('m²');
  const [items, setItems] = useState([]);
  const [parsed, setParsed] = useState(false);

  const handlePaste = (raw) => {
    setText(raw);
    const r = parseReceta(raw);
    setNombre(r.receta || '');
    setUnidad(r.unidad || 'm²');
    if (r.rubro && rubros.find(rb => rb.nombre.toUpperCase() === r.rubro.toUpperCase())) {
      setRubroNombre(rubros.find(rb => rb.nombre.toUpperCase() === r.rubro.toUpperCase()).nombre);
    } else if (r.rubro && rubros.length > 0) {
      setRubroNombre(rubros[0].nombre);
    }
    setItems(r.items);
    setParsed(true);
  };

  const mats = items.filter(i => i.tipo === 'MA');
  const subs = items.filter(i => i.tipo === 'SC');
  const gens = items.filter(i => i.tipo === 'OT');
  const others = items.filter(i => i.tipo !== 'MA' && i.tipo !== 'SC' && i.tipo !== 'OT');

  const updateItem = (id, field, val) => setItems(prev => prev.map(it => it.id === id ? { ...it, [field]: val } : it));
  const removeItem = (id) => setItems(prev => prev.filter(it => it.id !== id));

  const confirm = () => {
    if (!nombre.trim()) return;
    onImport({ nombre: nombre.trim(), subRubro: subRubro.trim(), unidad, rubroNombre, mats, subs, gens });
    onClose();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: T.paper, borderRadius: 8, width: '100%', maxWidth: 680, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.4)', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ background: T.dark, color: T.paper, padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>Importar APU desde Excel</div>
          <span onClick={onClose} style={{ cursor: 'pointer', fontSize: 20, opacity: 0.7, userSelect: 'none' }}>✕</span>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Paste area */}
          <div>
            <div style={{ ...labelSt, marginBottom: 4 }}>1. Copiá la pestaña del Excel y pegala acá</div>
            <textarea
              value={text}
              onChange={e => handlePaste(e.target.value)}
              onPaste={e => { e.preventDefault(); handlePaste(e.clipboardData.getData('text')); }}
              placeholder="Ctrl+A en la pestaña del Excel → Ctrl+C → Ctrl+V acá…"
              style={{ width: '100%', height: 100, resize: 'vertical', fontFamily: T.fontMono, fontSize: 11, padding: 8, border: `1.5px solid ${T.faint2}`, borderRadius: 4, outline: 'none', background: T.faint, boxSizing: 'border-box', color: T.ink }}
            />
          </div>

          {/* Detected preview */}
          {parsed && (
            <>
              <div style={{ background: T.accentSoft, border: `1.5px solid ${T.accent}`, borderRadius: 6, padding: '10px 14px', fontSize: 12 }}>
                <div style={{ fontWeight: 800, marginBottom: 6, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: T.ink2 }}>2. Revisá y ajustá los datos detectados</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div>
                      <div style={labelSt}>Nombre de la tarea (receta)</div>
                      <input style={{ ...inputSt, fontWeight: 700 }} value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Nombre del APU…" />
                    </div>
                    <div>
                      <div style={labelSt}>Sub-categoría (opcional)</div>
                      <input style={inputSt} value={subRubro} onChange={e => setSubRubro(e.target.value)} placeholder="Ej: Muebles de hierro y madera…" />
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, alignContent: 'start' }}>
                    <div>
                      <div style={labelSt}>Unidad</div>
                      <input style={inputSt} value={unidad} onChange={e => setUnidad(e.target.value)} />
                    </div>
                    <div>
                      <div style={labelSt}>Gremio / Rubro</div>
                      <select style={{ ...inputSt, cursor: 'pointer' }} value={rubroNombre} onChange={e => setRubroNombre(e.target.value)}>
                        {rubros.map(r => <option key={r.id}>{r.nombre}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* Items editables */}
              {[{ label: 'Materiales (MA)', list: mats, color: '#3d7a4a' },
                { label: 'Mano de Obra (M.O)', list: subs, color: '#4a7ab5' },
                { label: 'Gastos generales (OT)', list: gens, color: '#a05a2c' }].map(({ label, list, color }) => (
                <div key={label} style={{ background: T.faint, borderRadius: 5, padding: 10, border: `1px solid ${T.faint2}` }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                    {label} · {list.length}
                  </div>
                  {list.length === 0
                    ? <div style={{ fontSize: 11, color: T.ink3, fontStyle: 'italic' }}>Sin items</div>
                    : <>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 56px 44px 80px 20px', gap: 3, marginBottom: 4, fontSize: 9, fontWeight: 700, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                          <span>Descripción</span><span style={{ textAlign: 'right' }}>Cant</span><span style={{ textAlign: 'center' }}>UD</span><span style={{ textAlign: 'right' }}>$ Unit</span><span />
                        </div>
                        {list.map(it => (
                          <div key={it.id} style={{ display: 'grid', gridTemplateColumns: '1fr 56px 44px 80px 20px', gap: 3, marginBottom: 3, alignItems: 'center' }}>
                            <input
                              value={it.nombre}
                              onChange={e => updateItem(it.id, 'nombre', e.target.value)}
                              style={{ ...inputSt, fontSize: 11, padding: '2px 5px' }}
                            />
                            <input
                              type="number" min="0" step="0.01"
                              value={it.cantidad}
                              onChange={e => updateItem(it.id, 'cantidad', parseFloat(e.target.value) || 0)}
                              style={{ ...inputSt, fontSize: 11, padding: '2px 5px', textAlign: 'right', fontFamily: T.fontMono }}
                            />
                            <input
                              value={it.unidad}
                              onChange={e => updateItem(it.id, 'unidad', e.target.value)}
                              style={{ ...inputSt, fontSize: 11, padding: '2px 5px', textAlign: 'center' }}
                            />
                            <input
                              type="number" min="0" step="0.01"
                              value={it.precio}
                              onChange={e => updateItem(it.id, 'precio', parseFloat(e.target.value) || 0)}
                              style={{ ...inputSt, fontSize: 11, padding: '2px 5px', textAlign: 'right', fontFamily: T.fontMono }}
                            />
                            <span
                              onClick={() => removeItem(it.id)}
                              style={{ color: T.accent, cursor: 'pointer', fontSize: 14, textAlign: 'center', userSelect: 'none', lineHeight: 1 }}>×</span>
                          </div>
                        ))}
                      </>
                  }
                </div>
              ))}
              {others.length > 0 && (
                <div style={{ fontSize: 11, color: T.ink3 }}>+ {others.length} items de otros tipos (MO, EQ, etc.) no importados</div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 18px', borderTop: `1px solid ${T.faint2}`, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn sm onClick={onClose}>Cancelar</Btn>
          <Btn sm fill onClick={confirm} style={{ opacity: (!parsed || !nombre.trim()) ? 0.4 : 1, pointerEvents: (!parsed || !nombre.trim()) ? 'none' : 'auto' }}>
            ✓ Crear APU
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ── Tab: APU ──────────────────────────────────────────────────────────────────
function TabAPU({ catalog, catalogIndex, onAdd, onUpdate, onDelete, onAddMaterial, onAddSubcontrato }) {
  const { tareas, rubros, materiales, subcontratos, mo } = catalog;
  const [selRubro, setSelRubro] = useState('');
  const [search, setSearch] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState(null);
  const [editId, setEditId] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [lastAddedId, setLastAddedId] = useState(null);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const list = tareas.filter(t =>
      (!selRubro || t.rubroNombre === selRubro) &&
      ((t.nombre||'').toLowerCase().includes(q) || (t.codigo||'').toLowerCase().includes(q))
    );
    if (lastAddedId) {
      const idx = list.findIndex(t => t.id === lastAddedId);
      if (idx > 0) { const [it] = list.splice(idx, 1); list.unshift(it); }
    }
    return list;
  }, [tareas, selRubro, search, lastAddedId]);

  // Memo de costos por APU. Sin esto, cada render recalcula calcTarea para
  // las ~1500 APUs del SISMAT y el cambio de tab tarda varios segundos.
  // Con el index O(1) + este cache → instantáneo.
  const costsById = useMemo(() => {
    const map = new Map();
    for (const t of filtered) map.set(t.id, calcTarea(t, catalogIndex));
    return map;
  }, [filtered, catalogIndex]);

  // Paginación virtual: renderear de a 200. Con 1500 filas DOM full
  // el browser se ahoga; este "ver más" mantiene el mount inicial liviano.
  const [pageSize, setPageSize] = useState(200);
  useEffect(() => { setPageSize(200); }, [selRubro, search]);
  const visibles = filtered.slice(0, pageSize);
  const hayMas = filtered.length > pageSize;

  const startEdit = (t) => { setForm(JSON.parse(JSON.stringify(t))); setEditId(t.id); setEditMode(true); };
  const startNew  = () => {
    setForm({ codigo: '', nombre: '', subRubro: '', unidad: 'u', rubroNombre: rubros[0]?.nombre || '', materiales: [], subcontratos: [], mo: [] });
    setEditId(null);
    setEditMode(true);
  };
  const cancel = () => { setEditMode(false); setForm(null); setEditId(null); setLastAddedId(null); };
  const duplicate = (t) => {
    const dupId = newId();
    const copy = {
      ...t,
      id: dupId,
      nombre: `Copia de ${t.nombre}`,
      materiales:   (t.materiales||[]).map(m => ({ ...m, id: newId() })),
      subcontratos: (t.subcontratos||[]).map(s => ({ ...s, id: newId() })),
      mo:           (t.mo||[]).map(m => ({ ...m, id: newId() })),
      generales:    (t.generales||[]).map(g => ({ ...g, id: newId() })),
    };
    onAdd(copy);
    setLastAddedId(dupId);
    setForm(JSON.parse(JSON.stringify(copy)));
    setEditId(dupId);
    setEditMode(true);
  };

  const handleImport = ({ nombre, subRubro, unidad, rubroNombre, mats, subs, gens }) => {
    const match = (list, item) => list.find(c => c.nombre.trim().toLowerCase() === item.nombre.trim().toLowerCase());

    const linkedMat = mats.map(item => {
      const existing = match(materiales, item);
      if (!existing) {
        const newItem = { id: newId(), codigo: '', nombre: item.nombre, unidad: item.unidad, precio: item.precio, rubro: rubroNombre, updatedAt: today() };
        onAddMaterial(newItem);
        return { id: newId(), nombre: item.nombre, unidad: item.unidad, cantidad: item.cantidad, precio: item.precio };
      }
      return { id: newId(), nombre: existing.nombre, unidad: existing.unidad, cantidad: item.cantidad, precio: existing.precio };
    });

    const linkedSub = subs.map(item => {
      const existing = match(subcontratos || [], item);
      if (!existing) {
        const newItem = { id: newId(), codigo: '', nombre: item.nombre, unidad: item.unidad, precio: item.precio, rubro: rubroNombre, updatedAt: today() };
        onAddSubcontrato(newItem);
        return { id: newId(), nombre: item.nombre, unidad: item.unidad, cantidad: item.cantidad, precio: item.precio };
      }
      return { id: newId(), nombre: existing.nombre, unidad: existing.unidad, cantidad: item.cantidad, precio: existing.precio };
    });

    const linkedGen = (gens || []).map(item => ({
      id: newId(), nombre: item.nombre, unidad: item.unidad, cantidad: item.cantidad, precio: item.precio,
    }));

    onAdd({ codigo: '', nombre, subRubro: subRubro || '', unidad, rubroNombre, materiales: linkedMat, subcontratos: linkedSub, mo: [], generales: linkedGen });
  };
  const save = () => {
    if (!form || !form.nombre.trim()) return;
    if (editId) onUpdate(editId, form);
    else onAdd(form);
    setEditMode(false); setForm(null); setEditId(null); setLastAddedId(null);
  };

  return (
    <div style={{ display: 'flex', gap: 10, height: '100%' }}>
      {/* Left: rubro tree */}
      <Box style={{ width: 190, flexShrink: 0, padding: '8px 6px', overflow: 'auto' }}>
        <div style={{ fontSize: 9, fontWeight: 800, color: T.ink3, textTransform: 'uppercase', letterSpacing: 0.6, padding: '0 4px', marginBottom: 6 }}>Por rubro</div>
        <div onClick={() => setSelRubro('')}
          style={{ padding: '4px 8px', borderRadius: 3, cursor: 'pointer', fontWeight: !selRubro ? 700 : 400, fontSize: 11, background: !selRubro ? T.accentSoft : 'transparent', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
          <span style={{ color: !selRubro ? T.ink : T.ink2 }}>Todos</span>
          <span style={{ fontSize: 9, color: T.ink3, fontFamily: T.fontMono }}>{tareas.length}</span>
        </div>
        {rubros.map(r => {
          const count = tareas.filter(t => t.rubroNombre === r.nombre).length;
          const isOn  = selRubro === r.nombre;
          // Show "N · Nombre corto" — strip the leading number prefix
          const label = r.nombre.replace(/^\d+\s*-\s*/, '');
          const num   = r.nombre.match(/^(\d+)/)?.[1];
          return (
            <div key={r.id} onClick={() => setSelRubro(r.nombre)}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 3, cursor: 'pointer', background: isOn ? T.accentSoft : 'transparent', borderLeft: `2px solid ${isOn ? T.accent : 'transparent'}`, marginBottom: 1 }}>
              {num && <span style={{ fontSize: 9, color: T.ink3, fontFamily: T.fontMono, flexShrink: 0, width: 14 }}>{num}</span>}
              <span style={{ flex: 1, fontSize: 11, color: isOn ? T.ink : T.ink2, fontWeight: isOn ? 700 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
              {count > 0 && <span style={{ fontSize: 9, color: T.ink3, fontFamily: T.fontMono, flexShrink: 0 }}>{count}</span>}
            </div>
          );
        })}
      </Box>

      {/* Main: task list */}
      <Box style={{ flex: 1, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '8px 10px', background: T.faint, borderBottom: `1px solid ${T.faint2}`, display: 'flex', gap: 8, alignItems: 'center' }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar tarea…"
            style={{ ...inputSt, flex: 1, padding: '4px 8px' }} />
          <Chip style={{ fontSize: 10 }}>{filtered.length} tareas</Chip>
          <Btn sm onClick={() => setShowImport(true)}>⬇ Desde Excel</Btn>
          <Btn sm fill onClick={startNew}>+ Nueva APU</Btn>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: T.faint, position: 'sticky', top: 0, zIndex: 2 }}>
                {['Tarea','Un','Mat $','M.O $','Total $'].map((h,i) => (
                  <th key={h} style={{ padding: '5px 10px', textAlign: i>=2 ? 'right' : 'left', fontWeight: 700, fontSize: 9, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: `1px solid ${T.faint2}` }}>{h}</th>
                ))}
                <th style={{ width: 56, borderBottom: `1px solid ${T.faint2}` }} />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: T.ink3 }}>Sin tareas</td></tr>}
              {(() => {
                const rows = [];
                let lastRubro = null;
                visibles.forEach(t => {
                  // Group header when showing all rubros
                  if (!selRubro && t.rubroNombre !== lastRubro) {
                    lastRubro = t.rubroNombre;
                    const rNum = t.rubroNombre.match(/^(\d+)/)?.[1];
                    const rLabel = t.rubroNombre.replace(/^\d+\s*-\s*/, '');
                    rows.push(
                      <tr key={`grp-${t.rubroNombre}`}>
                        <td colSpan={6} style={{ padding: '10px 10px 3px', background: T.faint, borderTop: `1px solid ${T.faint2}` }}>
                          <span style={{ fontSize: 9, fontWeight: 800, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                            {rNum && <span style={{ fontFamily: T.fontMono, color: T.ink3, marginRight: 5 }}>{rNum} ·</span>}
                            {rLabel}
                          </span>
                        </td>
                      </tr>
                    );
                  }
                  const c = costsById.get(t.id) || { mat: 0, sub: 0, total: 0 };
                  rows.push(
                    <tr key={t.id} onClick={() => startEdit(t)}
                      style={{ cursor: 'pointer', borderBottom: `1px solid ${T.faint2}`, background: editId === t.id ? T.accentSoft : 'transparent' }}>
                      <td style={{ padding: '5px 10px', fontWeight: 500 }}>
                        <div style={{ fontSize: 12 }}>{t.nombre}</div>
                        {t.subRubro && <div style={{ fontSize: 9, color: T.ink3, marginTop: 1 }}>{t.subRubro}</div>}
                      </td>
                      <td style={{ padding: '5px 10px', color: T.ink3, fontSize: 10 }}>{t.unidad}</td>
                      <td style={{ padding: '5px 10px', fontFamily: T.fontMono, fontSize: 11, textAlign: 'right', color: T.ink2 }}>{fmtN(c.mat)}</td>
                      <td style={{ padding: '5px 10px', fontFamily: T.fontMono, fontSize: 11, textAlign: 'right', color: T.ink2 }}>{fmtN(c.sub)}</td>
                      <td style={{ padding: '5px 10px', fontFamily: T.fontMono, fontSize: 11, fontWeight: 700, textAlign: 'right' }}>{fmtN(c.total)}</td>
                      <td style={{ padding: '4px 6px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', alignItems: 'center' }}>
                          <span title="Duplicar" style={{ fontSize: 12, color: T.ink3, cursor: 'pointer' }} onClick={e => { e.stopPropagation(); duplicate(t); }}>⧉</span>
                          <span style={{ fontSize: 11, color: T.ink3, cursor: 'pointer' }} onClick={e => { e.stopPropagation(); if (confirm('¿Eliminar?')) onDelete(t.id); }}>🗑</span>
                        </div>
                      </td>
                    </tr>
                  );
                });
                return rows;
              })()}
            </tbody>
          </table>
          {hayMas && (
            <div style={{ padding: '10px 14px', textAlign: 'center', borderTop: `1px solid ${T.faint2}`, background: T.faint }}>
              <span style={{ fontSize: 11, color: T.ink3, marginRight: 10 }}>Mostrando {visibles.length} de {filtered.length}</span>
              <Btn sm onClick={() => setPageSize(p => p + 200)}>Ver 200 más</Btn>
              <Btn sm style={{ marginLeft: 6 }} onClick={() => setPageSize(filtered.length)}>Ver todas</Btn>
            </div>
          )}
        </div>
      </Box>

      {editMode && form && (
        <APUEditor
          form={form}
          setForm={setForm}
          rubros={rubros}
          materiales={materiales}
          moItems={mo || []}
          subcontratos={subcontratos || []}
          generales={catalog?.generales || []}
          onSave={save}
          onCancel={cancel}
        />
      )}

      {showImport && (
        <ImportarAPUModal
          rubros={rubros}
          onImport={handleImport}
          onClose={() => setShowImport(false)}
        />
      )}
    </div>
  );
}

// ── Tab: Rubros / Gremios ─────────────────────────────────────────────────────
function TabRubros({ catalog, catalogIndex, onAdd, onUpdate, onDelete, onUpdateMO }) {
  const { rubros, tareas, mo, subcontratos } = catalog;
  const subs = subcontratos || [];
  const [form, setForm] = useState(null);
  const [selId, setSelId] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [moEdit, setMoEdit] = useState(null);

  const activeRubro = rubros.find(r => r.id === activeId) || null;
  const activeAPUs  = activeRubro ? tareas.filter(t => t.rubroNombre === activeRubro.nombre) : [];
  const activeMOs   = activeRubro ? mo.filter(m => m.oficio === activeRubro.nombre) : [];
  const activeSubs  = activeRubro ? subs.filter(s => s.rubro === activeRubro.nombre) : [];

  const saveMO = () => {
    if (!moEdit) return;
    onUpdateMO(moEdit.id, { precioHora: +moEdit.value || 0 });
    setMoEdit(null);
  };

  return (
    <div style={{ display: 'flex', gap: 10, height: '100%' }}>
      <div style={{ width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', flexShrink: 0, paddingBottom: 8 }}>
          <Btn sm fill onClick={() => { setForm({ nombre: '' }); setSelId(null); }}>+ Nuevo rubro</Btn>
        </div>
        {form && (
          <div style={{ background: T.accentSoft, border: `1.5px solid ${T.accent}`, borderRadius: 5, padding: '8px 10px', display: 'flex', gap: 6, alignItems: 'flex-end', flexShrink: 0, marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={labelSt}>Nombre</div>
              <input style={inputSt} value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value.toUpperCase() }))} placeholder="Ej: PINTURA" autoFocus />
            </div>
            <Btn sm onClick={() => setForm(null)}>✕</Btn>
            <Btn sm fill onClick={() => {
              if (!form.nombre.trim()) return;
              if (selId) onUpdate(selId, { nombre: form.nombre });
              else onAdd({ nombre: form.nombre });
              setForm(null); setSelId(null);
            }}>OK</Btn>
          </div>
        )}
        {rubros.map(r => {
          const isActive = activeId === r.id;
          const apu = tareas.filter(t => t.rubroNombre === r.nombre).length;
          return (
            <div key={r.id}
              style={{ display: 'flex', alignItems: 'center', padding: '5px 8px', borderRadius: 3, borderLeft: `3px solid ${isActive ? T.accent : rCol(r.nombre)}`, background: isActive ? T.accentSoft : 'transparent', cursor: 'pointer', gap: 6, marginBottom: 1 }}
              onClick={() => setActiveId(r.id === activeId ? null : r.id)}>
              <div style={{ flex: 1, fontSize: 11, fontWeight: isActive ? 700 : 400, color: isActive ? T.ink : T.ink2, lineHeight: 1.3 }}>{r.nombre}</div>
              {apu > 0 && <span style={{ fontSize: 9, color: T.ink3, fontFamily: T.fontMono }}>{apu}</span>}
              <span style={{ fontSize: 11, color: T.ink3, cursor: 'pointer', opacity: 0.6, lineHeight: 1 }}
                onClick={e => { e.stopPropagation(); setForm({ nombre: r.nombre }); setSelId(r.id); }}>✏</span>
              <span style={{ fontSize: 13, color: T.ink3, cursor: 'pointer', opacity: 0.5, lineHeight: 1 }}
                onClick={e => { e.stopPropagation(); if (confirm('¿Eliminar rubro?')) { onDelete(r.id); if (activeId === r.id) setActiveId(null); } }}>×</span>
            </div>
          );
        })}
      </div>

      {activeRubro ? (
        <Box style={{ flex: 1, padding: 14, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 14, height: 14, borderRadius: 3, background: rCol(activeRubro.nombre), flexShrink: 0 }} />
            <div style={{ fontWeight: 800, fontSize: 20 }}>{activeRubro.nombre}</div>
          </div>

          <div>
            <div style={{ fontSize: 10, fontWeight: 800, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
              Mano de Obra — M.O · {activeSubs.length} items
            </div>
            {activeSubs.length === 0 && <div style={{ color: T.ink3, fontSize: 12, fontStyle: 'italic' }}>Sin items de M.O para este gremio</div>}
            {activeSubs.map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', padding: '7px 12px', background: T.paper, border: `1px solid ${T.faint2}`, borderRadius: 4, marginBottom: 5, gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{s.nombre}</div>
                  {s.codigo && <div style={{ fontSize: 10, color: T.ink3, fontFamily: T.fontMono }}>{s.codigo}</div>}
                </div>
                <div style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 13, color: T.accent }}>$ {fmtN(s.precio)}</div>
                <span style={{ fontSize: 11, color: T.ink2 }}>{s.unidad}</span>
              </div>
            ))}
          </div>

          <Divider />

          <div>
            <div style={{ fontSize: 10, fontWeight: 800, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
              Tareas APU · {activeAPUs.length} items
            </div>
            {activeAPUs.length === 0 && <div style={{ color: T.ink3, fontSize: 12, fontStyle: 'italic' }}>Sin tareas APU — creá una desde la pestaña "Tareas (APU)"</div>}
            {activeAPUs.map(t => {
              const c = calcTarea(t, catalogIndex);
              return (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', padding: '7px 12px', background: T.paper, border: `1px solid ${T.faint2}`, borderRadius: 4, marginBottom: 5, gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{t.nombre}</div>
                    {t.codigo && <div style={{ fontSize: 10, color: T.ink3, fontFamily: T.fontMono }}>{t.codigo}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 12, fontSize: 11, fontFamily: T.fontMono, alignItems: 'center' }}>
                    <span style={{ color: T.ink2 }}>Mat: $ {fmtN(c.mat)}</span>
                    <span style={{ color: T.ink2 }}>M.O: $ {fmtN(c.sub)}</span>
                    <span style={{ fontWeight: 800, color: T.accent }}>$ {fmtN(c.total)}</span>
                    <span style={{ fontFamily: T.font, fontSize: 10, color: T.ink3 }}>{t.unidad}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <Divider />

          {/* Tareas estándar — se generan automáticamente al aprobar un
              presupuesto que tenga este rubro. */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                ◆ Tareas estándar
              </div>
              <span style={{ fontSize: 9.5, color: T.ink3, fontStyle: 'italic' }}>
                se generan al aprobar un presupuesto con este rubro
              </span>
            </div>
            <TareasEstandarEditor
              value={activeRubro.tareasEstandar || []}
              onChange={(next) => onUpdate(activeRubro.id, { tareasEstandar: next })}
            />
          </div>
        </Box>
      ) : (
        <Box style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.ink3 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>👈</div>
            <div style={{ fontSize: 12 }}>Seleccioná un gremio para ver sus tareas y precios de mano de obra</div>
          </div>
        </Box>
      )}
    </div>
  );
}

// ── Tab: Tipos de obra ────────────────────────────────────────────────────────
// CRUD de tipos de obra (Vivienda / Panadería / Estación / etc.) + lista de
// tareasBase que se generan al aprobar el presupuesto de una obra de ese
// tipo. No depende del rubro — son tareas administrativas/papeleo típicas.
function TabTiposObra({ tiposObra, onAdd, onUpdate, onDelete }) {
  const [form, setForm] = useState(null); // { nombre, descripcion } al crear/editar
  const [editId, setEditId] = useState(null);
  const [activeId, setActiveId] = useState(null);

  const activeTipo = tiposObra.find(t => t.id === activeId) || null;

  const submitForm = () => {
    if (!form?.nombre?.trim()) return;
    if (editId) onUpdate(editId, { nombre: form.nombre, descripcion: form.descripcion || '' });
    else onAdd({ nombre: form.nombre, descripcion: form.descripcion || '', tareasBase: [] });
    setForm(null); setEditId(null);
  };

  return (
    <div style={{ display: 'flex', gap: 10, height: '100%' }}>
      {/* Sidebar: lista de tipos */}
      <div style={{ width: 260, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', flexShrink: 0, paddingBottom: 8 }}>
          <Btn sm fill onClick={() => { setForm({ nombre: '', descripcion: '' }); setEditId(null); }}>+ Nuevo tipo</Btn>
        </div>
        {form && (
          <div style={{ background: T.accentSoft, border: `1.5px solid ${T.accent}`, borderRadius: 5, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0, marginBottom: 8 }}>
            <div>
              <div style={labelSt}>Nombre</div>
              <input style={inputSt} value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Ej: Panadería completa" autoFocus />
            </div>
            <div>
              <div style={labelSt}>Descripción (opcional)</div>
              <input style={inputSt} value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Ej: Local 80–150 m²" />
            </div>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <Btn sm onClick={() => { setForm(null); setEditId(null); }}>✕</Btn>
              <Btn sm fill onClick={submitForm}>OK</Btn>
            </div>
          </div>
        )}
        {tiposObra.length === 0 && !form && (
          <div style={{ fontSize: 11, color: T.ink3, fontStyle: 'italic', padding: '8px 4px' }}>
            Sin tipos de obra cargados. Agregá uno para definir tareas base que se generen automáticamente al aprobar presupuestos.
          </div>
        )}
        {tiposObra.map(t => {
          const isActive = activeId === t.id;
          const n = (t.tareasBase || []).length;
          return (
            <div key={t.id}
              style={{ display: 'flex', alignItems: 'center', padding: '6px 8px', borderRadius: 3, borderLeft: `3px solid ${isActive ? T.accent : T.faint2}`, background: isActive ? T.accentSoft : 'transparent', cursor: 'pointer', gap: 6, marginBottom: 2 }}
              onClick={() => setActiveId(t.id === activeId ? null : t.id)}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: isActive ? 700 : 500, color: isActive ? T.ink : T.ink2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.nombre}</div>
                {t.descripcion && <div style={{ fontSize: 9.5, color: T.ink3, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.descripcion}</div>}
              </div>
              {n > 0 && <span style={{ fontSize: 9, color: T.ink3, fontFamily: T.fontMono }}>{n}</span>}
              <span style={{ fontSize: 11, color: T.ink3, cursor: 'pointer', opacity: 0.6, lineHeight: 1, padding: '0 3px' }}
                onClick={e => { e.stopPropagation(); setForm({ nombre: t.nombre, descripcion: t.descripcion || '' }); setEditId(t.id); }}>
                ✎
              </span>
              <span style={{ fontSize: 11, color: T.accent, cursor: 'pointer', opacity: 0.6, lineHeight: 1, padding: '0 3px' }}
                onClick={e => { e.stopPropagation(); if (confirm(`¿Eliminar tipo "${t.nombre}"?`)) { onDelete(t.id); if (activeId === t.id) setActiveId(null); } }}>
                ×
              </span>
            </div>
          );
        })}
      </div>

      {/* Detalle: tareas base */}
      {activeTipo ? (
        <Box style={{ flex: 1, padding: 14, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 20 }}>{activeTipo.nombre}</div>
            {activeTipo.descripcion && <div style={{ fontSize: 12, color: T.ink2, marginTop: 2 }}>{activeTipo.descripcion}</div>}
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                ◆ Tareas base
              </div>
              <span style={{ fontSize: 9.5, color: T.ink3, fontStyle: 'italic' }}>
                se generan al aprobar el presupuesto de una obra de este tipo
              </span>
            </div>
            <TareasEstandarEditor
              value={activeTipo.tareasBase || []}
              onChange={(next) => onUpdate(activeTipo.id, { tareasBase: next })}
            />
          </div>
        </Box>
      ) : (
        <Box style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.ink3 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>👈</div>
            <div style={{ fontSize: 12 }}>Seleccioná un tipo para ver y editar sus tareas base</div>
          </div>
        </Box>
      )}
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
// Tab "Sub contratos" se llama ahora "Mano de Obra - M.O" porque en el modelo
// de Kamak toda MO se factura como sub-contrato. El catálogo MO por hora
// quedó deprecado — sus datos siguen sumándose en calcTarea por compat con
// APUs viejos, pero no hay UI para editarlos.
const TABS = ['Materiales', 'Mano de Obra - M.O', 'Generales', 'Tareas (APU)', 'Rubros / Gremios', 'Tipos de obra'];

export default function Catalogos() {
  const { currentUser } = useUsuarios();
  const navigate = useNavigate();
  const isAdmin = currentUser?.rol === 'Admin';
  // Guard: solo Admin (la pagina maneja catalogos de precios sensibles).
  useEffect(() => {
    if (currentUser && !isAdmin) navigate('/', { replace: true });
  }, [currentUser, isAdmin, navigate]);

  const [tab, setTab] = useState(4);
  const { catalog, catalogIndex, add, update, remove, bulkUpdatePreciosCAC, restoreCatalogCACBackup } = useCatalog();
  const { indices } = useIndices();
  const [cacModal, setCacModal] = useState(false);
  const [cacFlash, setCacFlash] = useState('');

  // KPIs = tabs (clickeables). Reemplaza la fila de tabs duplicada que había
  // abajo del banner — single source of truth para la navegación.
  // Tab "Mano de Obra" (por hora) fue eliminado — todo va por "M.O" (sub).
  const tabCounts = [
    catalog.materiales.length,
    (catalog.subcontratos||[]).length,
    catalog.generales.length,
    catalog.tareas.length,
    catalog.rubros.length,
    (catalog.tiposObra||[]).length,
  ];

  return (
    <PageLayout breadcrumb={['Catálogos', TABS[tab]]} active="Catálogos">
      <PageHero
        label="CATÁLOGO DE PRECIOS · APU"
        title="Catálogos"
        subtitle="Insumos, mano de obra, tareas y rubros base del presupuesto"
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {cacFlash && <Chip ok style={{ fontSize: 11 }}>{cacFlash}</Chip>}
            <Btn sm onClick={() => setCacModal(true)} title="Actualizar precios del catálogo por índice CAC">⟳ Actualizar por CAC</Btn>
            <Btn sm onClick={() => {
              const data = JSON.stringify(catalog, null, 2);
              const a = document.createElement('a'); a.href = 'data:text/json,' + encodeURIComponent(data); a.download = 'kamak_catalog.json'; a.click();
            }}>↓ Exportar JSON</Btn>
          </div>
        }
        kpis={TABS.map((label, i) => ({
          label,
          value: tabCounts[i],
          color: tab === i ? T.accent : T.ink,
          active: tab === i,
          onClick: () => setTab(i),
        }))}
      />

      <div style={{ height: 'calc(100vh - 230px)', overflow: 'hidden' }}>
        {tab === 0 && (() => {
          const seen = new Set();
          const rs = catalog.materiales.map(i => i.rubro).filter(r => r && !seen.has(r) && seen.add(r));
          return (
            <TabSimple
              items={catalog.materiales}
              onAdd={item => add('materiales', item)}
              onUpdate={(id, ch) => update('materiales', id, ch)}
              onDelete={id => remove('materiales', id)}
              rubros={rs}
              rubroKey="rubro"
              cols={[
                { key: 'codigo', label: 'Código', mono: true },
                { key: 'nombre', label: 'Nombre' },
                { key: 'precio', label: 'Precio $', align: 'right', mono: true, render: v => `$ ${fmtN(v)}` },
                { key: 'unidad', label: 'Unidad' },
                { key: 'rubro', label: 'Rubro', render: v => <span style={{ fontSize: 10, background: rCol(v)+'22', color: rCol(v), padding: '2px 6px', borderRadius: 3, fontWeight: 700 }}>{v}</span> },
                { key: 'updatedAt', label: 'Actualizado', mono: true },
              ]}
              emptyForm={{ codigo: '', nombre: '', unidad: 'm', precio: 0, rubro: rs[0] || '', updatedAt: today() }}
              renderForm={(form, setForm) => (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <FRow label="Código"><input style={inputSt} value={form.codigo||''} onChange={e => setForm(f=>({...f, codigo:e.target.value}))} /></FRow>
                    <FRow label="Unidad"><input style={inputSt} value={form.unidad||''} onChange={e => setForm(f=>({...f, unidad:e.target.value}))} /></FRow>
                  </div>
                  <FRow label="Nombre"><input style={inputSt} value={form.nombre||''} onChange={e => setForm(f=>({...f, nombre:e.target.value}))} /></FRow>
                  <FRow label="Precio $"><input style={inputSt} type="number" min="0" value={form.precio||0} onChange={e => setForm(f=>({...f, precio:+e.target.value}))} /></FRow>
                  <FRow label="Rubro">
                    <input list="mat-rubros" style={inputSt} value={form.rubro||''} onChange={e => setForm(f=>({...f, rubro:e.target.value}))} placeholder="Elegí o escribí un rubro…" />
                    <datalist id="mat-rubros">{rs.map(r => <option key={r} value={r} />)}</datalist>
                  </FRow>
                </>
              )}
            />
          );
        })()}
        {tab === 1 && (() => {
          const seen = new Set();
          const rs = (catalog.subcontratos||[]).map(i => i.rubro).filter(r => r && !seen.has(r) && seen.add(r));
          return (
            <TabSimple
              items={catalog.subcontratos||[]}
              onAdd={item => add('subcontratos', item)}
              onUpdate={(id, ch) => update('subcontratos', id, ch)}
              onDelete={id => remove('subcontratos', id)}
              rubros={rs}
              rubroKey="rubro"
              cols={[
                { key: 'codigo', label: 'Código', mono: true },
                { key: 'nombre', label: 'Nombre' },
                { key: 'precio', label: 'Precio $', align: 'right', mono: true, render: v => `$ ${fmtN(v)}` },
                { key: 'unidad', label: 'Unidad' },
                { key: 'rubro', label: 'Rubro', render: v => <span style={{ fontSize: 10, background: rCol(v)+'22', color: rCol(v), padding: '2px 6px', borderRadius: 3, fontWeight: 700 }}>{v}</span> },
                { key: 'updatedAt', label: 'Actualizado', mono: true },
              ]}
              emptyForm={{ codigo: '', nombre: '', unidad: 'm²', precio: 0, rubro: rs[0] || '', updatedAt: today() }}
              renderForm={(form, setForm) => (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <FRow label="Código"><input style={inputSt} value={form.codigo||''} onChange={e => setForm(f=>({...f, codigo:e.target.value}))} /></FRow>
                    <FRow label="Unidad"><input style={inputSt} value={form.unidad||''} onChange={e => setForm(f=>({...f, unidad:e.target.value}))} /></FRow>
                  </div>
                  <FRow label="Nombre"><input style={inputSt} value={form.nombre||''} onChange={e => setForm(f=>({...f, nombre:e.target.value}))} /></FRow>
                  <FRow label="Precio $"><input style={inputSt} type="number" min="0" value={form.precio||0} onChange={e => setForm(f=>({...f, precio:+e.target.value}))} /></FRow>
                  <FRow label="Rubro">
                    <input list="sub-rubros" style={inputSt} value={form.rubro||''} onChange={e => setForm(f=>({...f, rubro:e.target.value}))} placeholder="Elegí o escribí un rubro…" />
                    <datalist id="sub-rubros">{rs.map(r => <option key={r} value={r} />)}</datalist>
                  </FRow>
                </>
              )}
            />
          );
        })()}
        {tab === 2 && (
          <TabSimple
            items={catalog.generales}
            onAdd={item => add('generales', item)}
            onUpdate={(id, ch) => update('generales', id, ch)}
            onDelete={id => remove('generales', id)}
            cols={[
              { key: 'nombre', label: 'Concepto' },
              { key: 'precio', label: 'Precio $', align: 'right', mono: true, render: v => `$ ${fmtN(v)}` },
              { key: 'unidad', label: 'Unidad' },
            ]}
            emptyForm={{ nombre: '', unidad: 'gl', precio: 0 }}
            renderForm={(form, setForm) => (
              <>
                <FRow label="Concepto"><input style={inputSt} value={form.nombre||''} onChange={e => setForm(f=>({...f, nombre:e.target.value}))} /></FRow>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <FRow label="Unidad"><input style={inputSt} value={form.unidad||''} onChange={e => setForm(f=>({...f, unidad:e.target.value}))} /></FRow>
                  <FRow label="Precio $"><input style={inputSt} type="number" min="0" value={form.precio||0} onChange={e => setForm(f=>({...f, precio:+e.target.value}))} /></FRow>
                </div>
              </>
            )}
          />
        )}
        {tab === 3 && (
          <TabAPU
            catalog={catalog}
            catalogIndex={catalogIndex}
            onAdd={item => add('tareas', item)}
            onUpdate={(id, ch) => update('tareas', id, ch)}
            onDelete={id => remove('tareas', id)}
            onAddMaterial={item => add('materiales', item)}
            onAddSubcontrato={item => add('subcontratos', item)}
          />
        )}
        {tab === 4 && (
          <TabRubros
            catalog={catalog}
            catalogIndex={catalogIndex}
            onAdd={item => add('rubros', item)}
            onUpdate={(id, ch) => update('rubros', id, ch)}
            onDelete={id => remove('rubros', id)}
            onUpdateMO={(id, ch) => update('mo', id, ch)}
          />
        )}
        {tab === 5 && (
          <TabTiposObra
            tiposObra={catalog.tiposObra || []}
            onAdd={item => add('tiposObra', item)}
            onUpdate={(id, ch) => update('tiposObra', id, ch)}
            onDelete={id => remove('tiposObra', id)}
          />
        )}
      </div>

      {cacModal && (
        <ActualizarCACModal
          catalog={catalog}
          indices={indices}
          onClose={() => setCacModal(false)}
          onAplicar={(opts) => {
            bulkUpdatePreciosCAC(opts);
            setCacModal(false);
            setCacFlash('✓ Precios actualizados');
            setTimeout(() => setCacFlash(''), 2500);
          }}
          onRestore={() => {
            if (restoreCatalogCACBackup()) {
              setCacModal(false);
              setCacFlash('↶ Catálogo restaurado');
              setTimeout(() => setCacFlash(''), 2500);
            }
          }}
        />
      )}
    </PageLayout>
  );
}
