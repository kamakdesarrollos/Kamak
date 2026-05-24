import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { T } from '../theme';
import { useObras } from '../store/ObrasContext';
import { useProveedores } from '../store/ProveedoresContext';
import { useClientes } from '../store/ClientesContext';
import { useMovimientos } from '../store/MovimientosContext';

const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function highlight(text, query) {
  if (!query || !text) return text;
  const idx = norm(String(text)).indexOf(norm(query));
  if (idx < 0) return text;
  const s = String(text);
  return (
    <>
      {s.slice(0, idx)}
      <mark style={{ background: T.accent + '44', color: T.ink, borderRadius: 2, padding: '0 1px' }}>{s.slice(idx, idx + query.length)}</mark>
      {s.slice(idx + query.length)}
    </>
  );
}

const fmtM = (n) => n != null ? `$ ${Math.round(n).toLocaleString('es-AR')}` : '';

export default function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const panelRef = useRef(null);

  const { obras, getDetalle } = useObras();
  const { proveedores } = useProveedores();
  const { clientes } = useClientes();
  const { movimientos } = useMovimientos();

  const handleOpen = () => { setOpen(true); setQuery(''); setSelected(0); setTimeout(() => inputRef.current?.focus(), 50); };
  const handleClose = () => { setOpen(false); setQuery(''); };

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (panelRef.current && !panelRef.current.contains(e.target)) handleClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  // Ctrl+K / Cmd+K shortcut
  useEffect(() => {
    const h = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); open ? handleClose() : handleOpen(); } };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [open]);

  const results = useCallback(() => {
    if (!query.trim()) return [];
    const q = norm(query.trim());
    const items = [];

    // Obras
    obras.forEach(o => {
      if (norm(o.nombre).includes(q) || norm(o.cliente).includes(q) || norm(o.tipo).includes(q) || norm(o.direccion).includes(q)) {
        items.push({
          id: `obra-${o.id}`, type: 'obra', icon: '🏗',
          title: o.nombre, sub: `${o.cliente || '—'} · ${o.tipo || 'Obra'} · ${o.estado || ''}`,
          badge: o.estado, ruta: `/obras/${o.id}/presupuesto`,
        });
      }
    });

    // Adicionales en obras
    obras.forEach(o => {
      const det = getDetalle(o.id);
      (det.adicionales || []).forEach(a => {
        if (norm(a.descripcion).includes(q) || norm(a.tarea).includes(q)) {
          items.push({
            id: `adic-${o.id}-${a.id}`, type: 'adicional', icon: '➕',
            title: a.descripcion, sub: `Adicional · ${o.nombre}`,
            ruta: `/obras/${o.id}/presupuesto?tab=3`,
          });
        }
      });
    });

    // Proveedores
    proveedores.forEach(p => {
      if (norm(p.nombre).includes(q) || norm(p.cuit).includes(q) || norm(p.tipo).includes(q)) {
        items.push({
          id: `prov-${p.id}`, type: 'proveedor', icon: '🏢',
          title: p.nombre, sub: `${p.tipo || 'Proveedor'} · CUIT ${p.cuit || '—'}`,
          ruta: `/proveedores/${p.id}`,
        });
      }
    });

    // Clientes
    (clientes || []).forEach(c => {
      if (norm(c.nombre).includes(q) || norm(c.email).includes(q) || norm(c.telefono).includes(q)) {
        items.push({
          id: `cli-${c.id}`, type: 'cliente', icon: '👤',
          title: c.nombre, sub: `Cliente · ${c.email || c.telefono || '—'}`,
          ruta: `/clientes?q=${encodeURIComponent(c.nombre)}`,
        });
      }
    });

    // Movimientos
    (movimientos || []).forEach(m => {
      if (norm(m.descripcion).includes(q) || norm(m.proveedor).includes(q) || norm(m.obraNombre).includes(q)) {
        items.push({
          id: `mov-${m.id}`, type: 'movimiento', icon: m.tipo === 'ingreso' ? '💚' : '💸',
          title: m.descripcion || m.proveedor, sub: `${m.tipo === 'ingreso' ? 'Ingreso' : 'Gasto'} · ${m.obraNombre || '—'} · ${fmtM(m.monto)}`,
          ruta: m.obraId ? `/obras/${m.obraId}/presupuesto?tab=5` : `/movimientos`,
        });
      }
    });

    return items.slice(0, 12);
  }, [query, obras, proveedores, clientes, movimientos, getDetalle]);

  const items = results();

  useEffect(() => { setSelected(0); }, [query]);

  const go = (item) => { handleClose(); navigate(item.ruta); };

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter' && items[selected]) { go(items[selected]); }
    else if (e.key === 'Escape') { handleClose(); }
  };

  const typeColor = { obra: '#1a9b9c', proveedor: '#7c6af7', cliente: '#f59e0b', movimiento: '#6b7280', adicional: '#10b981' };

  return (
    <>
      {/* Trigger — same visual as existing dummy search bar */}
      <div
        onClick={handleOpen}
        style={{ width: 260, marginLeft: 'auto', background: '#171818', border: '1px solid #3a3a3e', borderRadius: 4, padding: '5px 10px', fontSize: 12, color: '#9a9892', fontFamily: `'JetBrains Mono', monospace`, letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 6, cursor: 'text', userSelect: 'none' }}
      >
        <span>⌕</span><span style={{ flex: 1 }}>buscar obra, proveedor, factura…</span>
        <span style={{ fontSize: 9, background: '#2a2a2e', border: '1px solid #3a3a3e', borderRadius: 3, padding: '1px 5px', letterSpacing: 0 }}>Ctrl K</span>
      </div>

      {/* Overlay + panel */}
      {open && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 80, background: 'rgba(0,0,0,0.55)' }}>
          <div ref={panelRef} style={{ width: '100%', maxWidth: 600, background: '#1e1e22', border: '1px solid #3a3a3e', borderRadius: 10, boxShadow: '0 24px 80px rgba(0,0,0,0.7)', overflow: 'hidden' }}>
            {/* Input */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: '1px solid #2a2a2e' }}>
              <span style={{ fontSize: 18, color: '#9a9892' }}>⌕</span>
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={onKey}
                placeholder="Buscar obra, proveedor, factura, cliente..."
                style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 15, color: '#fff', fontFamily: `'JetBrains Mono', monospace` }}
              />
              <span style={{ fontSize: 10, color: '#5a5a58', cursor: 'pointer' }} onClick={handleClose}>ESC</span>
            </div>

            {/* Results */}
            <div style={{ maxHeight: 440, overflowY: 'auto' }}>
              {query.trim() === '' ? (
                <div style={{ padding: '24px 18px', color: '#5a5a58', fontSize: 12, textAlign: 'center' }}>
                  Escribí para buscar obras, proveedores, clientes, movimientos y más
                </div>
              ) : items.length === 0 ? (
                <div style={{ padding: '24px 18px', color: '#5a5a58', fontSize: 12, textAlign: 'center' }}>
                  Sin resultados para <b style={{ color: '#9a9892' }}>"{query}"</b>
                </div>
              ) : (
                items.map((item, i) => (
                  <div
                    key={item.id}
                    onClick={() => go(item)}
                    onMouseEnter={() => setSelected(i)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '11px 18px',
                      borderBottom: i < items.length - 1 ? '1px solid #2a2a2e' : 'none',
                      background: i === selected ? '#2a2a2e' : 'transparent',
                      cursor: 'pointer', transition: 'background .08s',
                    }}
                  >
                    <span style={{ fontSize: 18, flexShrink: 0 }}>{item.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {highlight(item.title, query)}
                      </div>
                      <div style={{ fontSize: 11, color: '#9a9892', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
                        {highlight(item.sub, query)}
                      </div>
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, color: typeColor[item.type] || '#9a9892', textTransform: 'uppercase', letterSpacing: 0.5, flexShrink: 0, background: (typeColor[item.type] || '#9a9892') + '22', padding: '2px 7px', borderRadius: 4 }}>
                      {item.type}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
