import { useState, useMemo, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageLayout from '../components/layout/PageLayout';
import { Box, Btn } from '../components/ui';
import { T } from '../theme';
import { useClientes } from '../store/ClientesContext';
import { useObras } from '../store/ObrasContext';
import { useMovimientos } from '../store/MovimientosContext';
import { useUsuarios } from '../store/UsuariosContext';

const inputSt = { padding: '6px 10px', border: `1.2px solid ${T.faint2}`, borderRadius: 4, fontFamily: T.font, fontSize: 12, background: T.paper, boxSizing: 'border-box', outline: 'none', width: '100%' };
const labelSt = { fontSize: 10, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 3, display: 'block' };

function Avatar({ nombre, size = 36 }) {
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: T.ok, color: '#fff', fontFamily: `'Montserrat',sans-serif`, fontSize: size * 0.42, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, flexShrink: 0 }}>
      {(nombre || '?')[0].toUpperCase()}
    </div>
  );
}

function NuevoClienteModal({ initial = null, onSave, onClose }) {
  const [form, setForm] = useState(initial || { nombre: '', empresa: '', cuit: '', telefono: '', email: '', notas: '' });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="k-modal-overlay" onClick={onClose}>
      <div className="k-modal" style={{ width: 460 }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', background: T.dark, color: T.paper, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 800, fontSize: 17, fontFamily: T.font }}>{initial ? 'Editar cliente' : 'Nuevo cliente'}</div>
          <span style={{ cursor: 'pointer', fontSize: 20, opacity: 0.7 }} onClick={onClose}>✕</span>
        </div>
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label style={labelSt}>Nombre / Razón social <span style={{ color: T.accent }}>*</span></label>
            <input style={inputSt} value={form.nombre} onChange={e => set('nombre', e.target.value)} placeholder="Ej: Familia Pérez" autoFocus />
          </div>
          <div>
            <label style={labelSt}>Empresa</label>
            <input style={inputSt} value={form.empresa} onChange={e => set('empresa', e.target.value)} placeholder="Razón social (opcional)" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelSt}>CUIT</label>
              <input style={inputSt} value={form.cuit} onChange={e => set('cuit', e.target.value)} placeholder="20-12345678-9" />
            </div>
            <div>
              <label style={labelSt}>Teléfono</label>
              <input style={inputSt} value={form.telefono} onChange={e => set('telefono', e.target.value)} placeholder="+54 11 1234-5678" />
            </div>
          </div>
          <div>
            <label style={labelSt}>Email</label>
            <input style={inputSt} type="email" value={form.email} onChange={e => set('email', e.target.value)} />
          </div>
          <div>
            <label style={labelSt}>Notas</label>
            <textarea style={{ ...inputSt, height: 60, resize: 'vertical' }} value={form.notas} onChange={e => set('notas', e.target.value)} />
          </div>
        </div>
        <div style={{ padding: '10px 18px', borderTop: `1.5px solid ${T.faint2}`, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Btn sm onClick={onClose}>Cancelar</Btn>
          <Btn sm fill onClick={() => { if (!form.nombre.trim()) return; onSave(form); onClose(); }}>
            {initial ? 'Guardar cambios' : 'Agregar cliente'}
          </Btn>
        </div>
      </div>
    </div>
  );
}

export default function Clientes() {
  const { currentUser } = useUsuarios();
  const navigate = useNavigate();
  const isAdmin = currentUser?.rol === 'Admin';
  // Guard: solo Admin puede entrar a esta pagina.
  useEffect(() => {
    if (currentUser && !isAdmin) navigate('/', { replace: true });
  }, [currentUser, isAdmin, navigate]);

  const { clientes, addCliente, updateCliente, removeCliente } = useClientes();
  const { obras, updateObra } = useObras();
  const { movimientos, updateMovimiento } = useMovimientos();
  const [searchParams] = useSearchParams();
  const [modal, setModal] = useState(false);
  const [editCliente, setEditCliente] = useState(null);
  const [search, setSearch] = useState(() => searchParams.get('q') || '');

  useEffect(() => {
    const q = searchParams.get('q');
    if (q) setSearch(q);
  }, [searchParams]);

  const obrasCount = useMemo(() => {
    const map = {};
    clientes.forEach(c => { map[c.id] = obras.filter(o => o.cliente === c.nombre).length; });
    return map;
  }, [clientes, obras]);

  const totalFacturado = useMemo(() => {
    const map = {};
    clientes.forEach(c => {
      map[c.id] = movimientos
        .filter(m => m.tipo === 'ingreso' && (m.proveedor === c.nombre || m.clienteId === c.id))
        .reduce((s, m) => s + m.monto, 0);
    });
    return map;
  }, [clientes, movimientos]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return clientes.filter(c =>
      !q || (c.nombre || '').toLowerCase().includes(q) ||
      (c.empresa || '').toLowerCase().includes(q) ||
      (c.cuit    || '').includes(q)
    );
  }, [clientes, search]);

  // Propaga el nombre actual del cliente a obras y movimientos vinculados.
  // Estrategia:
  //   1) Obras vinculadas por clienteId (FK real): siempre actualizar nombre
  //      si esta desincronizado, sin importar si el nombre cambio o no en
  //      este guardado. Esto permite "re-sincronizar" obras legacy con un
  //      simple click en Guardar.
  //   2) Obras legacy sin clienteId: si cambio el nombre, propagar por el
  //      nombre viejo Y aprovechar para asignarles clienteId (asi a futuro
  //      no necesitan este fallback).
  //   3) Movimientos de ingreso que usan el nombre del cliente como
  //      proveedor (legacy, antes de que existiera clienteId).
  const saveCliente = (initial, data) => {
    updateCliente(initial.id, data);
    const oldName = initial.nombre;
    const newName = data.nombre;

    // (1) Sync por clienteId — siempre.
    obras
      .filter(o => o.clienteId === initial.id && o.cliente !== newName)
      .forEach(o => updateObra(o.id, { cliente: newName }));

    // (2)+(3) Fallback legacy: si cambio el nombre.
    if (oldName && newName && oldName !== newName) {
      obras
        .filter(o => !o.clienteId && o.cliente === oldName)
        .forEach(o => updateObra(o.id, { cliente: newName, clienteId: initial.id }));
      movimientos
        .filter(m => m.tipo === 'ingreso' && m.proveedor === oldName)
        .forEach(m => updateMovimiento(m.id, { proveedor: newName }));
    }
  };

  return (
    <PageLayout breadcrumb={['Clientes']} active="Clientes">

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div className="k-h" style={{ fontSize: 28 }}>Clientes</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar nombre, empresa, CUIT…"
            style={{ ...inputSt, width: 220 }} />
          <Btn sm fill onClick={() => setModal(true)}>+ Nuevo cliente</Btn>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
        <Box style={{ padding: '10px 16px', flex: 1 }}>
          <div style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Total clientes</div>
          <div style={{ fontSize: 22, fontWeight: 800, fontFamily: T.fontMono, marginTop: 2 }}>{clientes.length}</div>
        </Box>
        <Box style={{ padding: '10px 16px', flex: 1 }}>
          <div style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Con obras activas</div>
          <div style={{ fontSize: 22, fontWeight: 800, fontFamily: T.fontMono, color: T.ok, marginTop: 2 }}>
            {clientes.filter(c => obrasCount[c.id] > 0).length}
          </div>
        </Box>
        <Box style={{ padding: '10px 16px', flex: 1 }}>
          <div style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Total obras</div>
          <div style={{ fontSize: 22, fontWeight: 800, fontFamily: T.fontMono, marginTop: 2 }}>
            {Object.values(obrasCount).reduce((s, v) => s + v, 0)}
          </div>
        </Box>
        <Box style={{ padding: '10px 16px', flex: 2 }}>
          <div style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Total facturado</div>
          <div style={{ fontSize: 22, fontWeight: 800, fontFamily: T.fontMono, color: T.ok, marginTop: 2 }}>
            $ {Math.round(Object.values(totalFacturado).reduce((s, v) => s + v, 0)).toLocaleString('es-AR')}
          </div>
        </Box>
      </div>

      {filtered.length === 0 ? (
        <Box style={{ padding: 32, textAlign: 'center', color: T.ink3, fontSize: 13 }}>
          Sin clientes{search ? ' con ese criterio' : ''}
          {!search && (
            <div style={{ marginTop: 10 }}>
              <Btn sm onClick={() => setModal(true)}>+ Agregar cliente</Btn>
            </div>
          )}
        </Box>
      ) : (
        <Box style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2.5fr 1.5fr 1fr 1.5fr 0.6fr 1fr 0.8fr', padding: '7px 14px', background: T.faint, borderBottom: `1.5px solid ${T.faint2}`, fontSize: 10, fontWeight: 700, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            <span>Cliente</span>
            <span>Empresa</span>
            <span>CUIT</span>
            <span>Contacto</span>
            <span style={{ textAlign: 'center' }}>Obras</span>
            <span style={{ textAlign: 'right' }}>Facturado</span>
            <span>Acciones</span>
          </div>
          {filtered.map(c => {
            const phone = (c.telefono || '').replace(/\s/g, '').replace('+', '');
            return (
              <div key={c.id}
                style={{ display: 'grid', gridTemplateColumns: '2.5fr 1.5fr 1fr 1.5fr 0.6fr 1fr 0.8fr', padding: '9px 14px', borderBottom: `1px solid ${T.faint2}`, alignItems: 'center', fontSize: 12, cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background = T.faint}
                onMouseLeave={e => e.currentTarget.style.background = ''}
                onClick={() => setEditCliente(c)}>
                <span style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Avatar nombre={c.nombre} size={30} />
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.nombre}</span>
                </span>
                <span style={{ color: T.ink2, fontSize: 11 }}>{c.empresa || '—'}</span>
                <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.ink2 }}>{c.cuit || '—'}</span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }} onClick={e => e.stopPropagation()}>
                  {c.telefono && (
                    <a href={`https://wa.me/${phone}`} target="_blank" rel="noopener noreferrer"
                      style={{ color: '#25d366', textDecoration: 'none', fontSize: 10 }}>
                      📱 {c.telefono}
                    </a>
                  )}
                  {c.email && (
                    <a href={`mailto:${c.email}`}
                      style={{ color: T.accent, textDecoration: 'none', fontSize: 10 }}>
                      ✉ {c.email}
                    </a>
                  )}
                  {!c.telefono && !c.email && <span style={{ color: T.ink3 }}>—</span>}
                </span>
                <span style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                  {obrasCount[c.id] > 0 ? (
                    <span
                      onClick={() => navigate(`/obras?q=${encodeURIComponent(c.nombre)}`)}
                      style={{ fontFamily: T.fontMono, fontWeight: 700, color: T.ok, cursor: 'pointer', textDecoration: 'underline', fontSize: 13 }}>
                      {obrasCount[c.id]}
                    </span>
                  ) : <span style={{ color: T.ink3, fontFamily: T.fontMono }}>0</span>}
                </span>
                <span style={{ textAlign: 'right', fontFamily: T.fontMono, fontSize: 11, color: totalFacturado[c.id] > 0 ? T.ok : T.ink3 }}>
                  {totalFacturado[c.id] > 0 ? `$ ${Math.round(totalFacturado[c.id]).toLocaleString('es-AR')}` : '—'}
                </span>
                <span style={{ display: 'flex', gap: 5, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                  {obrasCount[c.id] > 0 && (
                    <Btn sm onClick={() => navigate(`/obras?q=${encodeURIComponent(c.nombre)}`)}>🏗</Btn>
                  )}
                  <Btn sm onClick={() => setEditCliente(c)}>✏</Btn>
                  <span style={{ color: T.warn, cursor: 'pointer', fontSize: 16, padding: '0 2px', lineHeight: 1 }}
                    onClick={() => { if (confirm(`¿Eliminar ${c.nombre}?`)) removeCliente(c.id); }}>×</span>
                </span>
              </div>
            );
          })}
        </Box>
      )}

      {modal && <NuevoClienteModal onClose={() => setModal(false)} onSave={addCliente} />}
      {editCliente && (
        <NuevoClienteModal
          initial={editCliente}
          onClose={() => setEditCliente(null)}
          onSave={(data) => saveCliente(editCliente, data)} />
      )}
    </PageLayout>
  );
}
