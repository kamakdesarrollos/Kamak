import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import PageLayout from '../components/layout/PageLayout';
import { Box, Btn, Chip, Label } from '../components/ui';
import PageHero from '../components/ui/PageHero';
import { T } from '../theme';
import { useProveedores, calcSaldoProveedorMov } from '../store/ProveedoresContext';
import { useMovimientos } from '../store/MovimientosContext';
import { useUsuarios } from '../store/UsuariosContext';
import RegistrarPagoModal from './modales/RegistrarPagoModal';
import { facturasPendientesDeProveedor, totalPendiente } from '../lib/facturasPendientes';

const inputSt = { padding: '6px 10px', border: `1.2px solid ${T.faint2}`, borderRadius: 4, fontFamily: T.font, fontSize: 12, background: T.paper, boxSizing: 'border-box', outline: 'none', width: '100%' };
const labelSt = { fontSize: 10, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 3, display: 'block' };
const fmtN = (n) => Math.abs(Math.round(n)).toLocaleString('es-AR');

const CONDICIONES = ['Responsable Inscripto', 'Monotributista', 'Exento', 'Consumidor Final'];
const CATEGORIAS  = ['Mano de obra', 'Materiales'];

const getCat = (p) =>
  p.categoria || (p.tipo?.toLowerCase().includes('material') ? 'Materiales' : 'Mano de obra');

// ── Star rating ───────────────────────────────────────────────────────────────
function StarRating({ value = 0, onChange, size = 14 }) {
  const [hover, setHover] = useState(0);
  return (
    <div style={{ display: 'flex', gap: 1 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <span key={i}
          style={{ fontSize: size, cursor: onChange ? 'pointer' : 'default', color: i <= (hover || value) ? '#f59e0b' : T.faint2, lineHeight: 1, userSelect: 'none' }}
          onMouseEnter={() => onChange && setHover(i)}
          onMouseLeave={() => onChange && setHover(0)}
          onClick={() => onChange && onChange(i === value ? 0 : i)}>
          ★
        </span>
      ))}
    </div>
  );
}

// ── Avatar ────────────────────────────────────────────────────────────────────
function Avatar({ nombre, size = 36, cat }) {
  const bg = cat === 'Materiales' ? '#0ea5e9' : T.accent;
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: bg, color: '#fff', fontFamily: `'Montserrat',sans-serif`, fontSize: size * 0.42, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, flexShrink: 0 }}>
      {(nombre || '?')[0].toUpperCase()}
    </div>
  );
}

// ── Category badge ────────────────────────────────────────────────────────────
function CatBadge({ cat }) {
  const isMat = cat === 'Materiales';
  return (
    <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 10, letterSpacing: 0.3, background: isMat ? 'rgba(14,165,233,.12)' : T.accentSoft, color: isMat ? '#0ea5e9' : T.accent, border: `1px solid ${isMat ? 'rgba(14,165,233,.3)' : T.accent + '55'}` }}>
      {cat}
    </span>
  );
}

// ── KPI card ──────────────────────────────────────────────────────────────────
function KPI({ label, value, color, sub }) {
  return (
    <Box style={{ padding: '10px 16px', flex: 1 }}>
      <div style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, fontFamily: T.fontMono, color: color || T.ink, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: T.ink3 }}>{sub}</div>}
    </Box>
  );
}

// ── Nuevo / Editar proveedor modal ────────────────────────────────────────────
function NuevoProveedorModal({ onClose, onSave, initial = null }) {
  const initCat = initial ? getCat(initial) : 'Mano de obra';
  const [form, setForm] = useState(initial
    ? { ...initial, categoria: initCat }
    : { nombre: '', categoria: 'Mano de obra', tipo: '', cuit: '', telefono: '', email: '', condicion: 'Responsable Inscripto', calificacion: 0, notas: '' });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="k-modal-overlay" onClick={onClose}>
      <div className="k-modal" style={{ width: 480 }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', background: T.dark, color: T.paper, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 800, fontSize: 17, fontFamily: T.font }}>{initial ? 'Editar proveedor' : 'Nuevo proveedor'}</div>
          <span style={{ cursor: 'pointer', fontSize: 20, opacity: 0.7 }} onClick={onClose}>✕</span>
        </div>
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label style={labelSt}>Nombre / Razón social</label>
            <input style={inputSt} value={form.nombre} onChange={e => set('nombre', e.target.value)} placeholder="Ej: Don Luis SRL" autoFocus />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelSt}>Categoría</label>
              <select style={{ ...inputSt, cursor: 'pointer' }} value={form.categoria} onChange={e => set('categoria', e.target.value)}>
                {CATEGORIAS.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={labelSt}>Especialidad / Rubro</label>
              <input style={inputSt} value={form.tipo} onChange={e => set('tipo', e.target.value)} placeholder="Ej: Electricidad, Pintura…" />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelSt}>Condición AFIP</label>
              <select style={{ ...inputSt, cursor: 'pointer' }} value={form.condicion} onChange={e => set('condicion', e.target.value)}>
                {CONDICIONES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={labelSt}>CUIT</label>
              <input style={inputSt} value={form.cuit} onChange={e => set('cuit', e.target.value)} placeholder="20-12345678-9" />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelSt}>Teléfono</label>
              <input style={inputSt} value={form.telefono} onChange={e => set('telefono', e.target.value)} placeholder="+54 11 1234-5678" />
            </div>
            <div>
              <label style={labelSt}>Email</label>
              <input style={inputSt} type="email" value={form.email} onChange={e => set('email', e.target.value)} />
            </div>
          </div>
          <div>
            <label style={labelSt}>Calificación</label>
            <StarRating value={form.calificacion || 0} onChange={v => set('calificacion', v)} size={22} />
          </div>
          <div>
            <label style={labelSt}>Notas</label>
            <textarea style={{ ...inputSt, height: 60, resize: 'vertical' }} value={form.notas} onChange={e => set('notas', e.target.value)} />
          </div>
        </div>
        <div style={{ padding: '10px 18px', borderTop: `1.5px solid ${T.faint2}`, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Btn sm onClick={onClose}>Cancelar</Btn>
          <Btn sm fill onClick={() => { if (!form.nombre.trim()) return; onSave(form); onClose(); }}>
            {initial ? 'Guardar cambios' : 'Agregar proveedor'}
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function Proveedores() {
  const navigate = useNavigate();
  const { currentUser } = useUsuarios();
  // En Proveedores, "Administración" tiene el mismo acceso que Admin: gestiona pagos
  // y cuenta corriente de proveedores (de mano de obra y de materiales).
  const isAdmin = currentUser?.rol === 'Admin' || currentUser?.rol === 'Administración';
  const { proveedores, addProveedor, updateProveedor, removeProveedor, getObrasProveedor, ccEntries: ccRaw, facturasPendientes } = useProveedores();
  const { movimientos } = useMovimientos();
  // Deuda en facturas pendientes de pago (cuentas por pagar) por proveedor.
  // Total de saldos de sus facturas abiertas. Independiente del saldo CC clásico.
  const deudaFacturas = useMemo(() => {
    const map = {};
    proveedores.forEach(p => { map[p.id] = totalPendiente(facturasPendientesDeProveedor(facturasPendientes, p)); });
    return map;
  }, [proveedores, facturasPendientes]);
  const totalDeudaFacturas = useMemo(() => Object.values(deudaFacturas).reduce((s, v) => s + v, 0), [deudaFacturas]);
  // Saldo DERIVADO: lo que debemos (debe de ccEntries) − lo que pagamos (gastos
  // a ese proveedor en movimientos). Libro único: los pagos son movimientos.
  const getSaldo = (pid, obraId = null) => calcSaldoProveedorMov(proveedores.find(p => p.id === pid), ccRaw, movimientos, obraId);
  const [pagoProvId, setPagoProvId] = useState(null);
  const [modalNuevo, setModalNuevo] = useState(false);
  const [editProv, setEditProv] = useState(null);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('Todos');
  const [sort, setSort] = useState('nombre');
  const [view, setView] = useState('lista');

  const conSaldo   = useMemo(() => proveedores.filter(p => getSaldo(p.id) > 0), [proveedores, getSaldo]);
  const totalDeuda = useMemo(() => conSaldo.reduce((s, p) => s + getSaldo(p.id), 0), [conSaldo, getSaldo]);
  const moCount    = useMemo(() => proveedores.filter(p => getCat(p) === 'Mano de obra').length, [proveedores]);
  const matCount   = useMemo(() => proveedores.filter(p => getCat(p) === 'Materiales').length, [proveedores]);

  const totalPagado = useMemo(() => {
    const map = {};
    proveedores.forEach(p => {
      map[p.id] = movimientos
        .filter(m => m.tipo === 'gasto' && (m.proveedor === p.nombre || m.proveedorId === p.id))
        .reduce((s, m) => s + m.monto, 0);
    });
    return map;
  }, [proveedores, movimientos]);

  const tabs = [
    { label: 'Todos',        key: 'Todos',        count: proveedores.length },
    { label: 'Mano de obra', key: 'Mano de obra', count: moCount },
    { label: 'Materiales',   key: 'Materiales',   count: matCount },
    { label: 'Con saldo',    key: 'conSaldo',     count: conSaldo.length },
  ];

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let list = proveedores.filter(p =>
      !q || (p.nombre || '').toLowerCase().includes(q) || (p.tipo || '').toLowerCase().includes(q) || (p.cuit || '').includes(q)
    );
    if (tab === 'conSaldo') list = list.filter(p => getSaldo(p.id) > 0);
    else if (tab !== 'Todos') list = list.filter(p => getCat(p) === tab);

    return [...list].sort((a, b) =>
      sort === 'saldo' ? getSaldo(b.id) - getSaldo(a.id) : a.nombre.localeCompare(b.nombre)
    );
  }, [proveedores, search, tab, sort, getSaldo]);

  const totalPagadoSum = Object.values(totalPagado).reduce((s, v) => s + v, 0);

  return (
    <PageLayout breadcrumb={['Proveedores']} active="Proveedores">
      <PageHero
        label="GESTIÓN DE PROVEEDORES"
        title="Proveedores"
        subtitle={isAdmin
          ? `$ ${fmtN(totalDeuda)} en deuda CC · $ ${fmtN(totalDeudaFacturas)} en facturas pendientes · $ ${fmtN(totalPagadoSum)} pagado histórico`
          : `${proveedores.length} proveedores · ${moCount} mano de obra · ${matCount} materiales`}
        actions={
          <>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar nombre, rubro, CUIT…"
              style={{ padding: '5px 10px', border: `1.2px solid #3a3a3e`, borderRadius: 4, fontSize: 12, fontFamily: T.font, background: 'rgba(255,255,255,0.06)', color: '#fff', width: 200, outline: 'none' }} />
            <select value={sort} onChange={e => setSort(e.target.value)}
              style={{ padding: '5px 8px', border: `1.2px solid #3a3a3e`, borderRadius: 4, fontSize: 12, fontFamily: T.font, background: 'rgba(255,255,255,0.06)', color: '#fff', cursor: 'pointer' }}>
              <option value="nombre" style={{ color: T.ink }}>A – Z</option>
              <option value="saldo" style={{ color: T.ink }}>Mayor saldo</option>
            </select>
            <div style={{ display: 'flex', border: `1px solid #3a3a3e`, borderRadius: 4, overflow: 'hidden', flexShrink: 0 }}>
              {[['lista', '≡'], ['cards', '⊞']].map(([v, icon]) => (
                <div key={v} onClick={() => setView(v)}
                  style={{ padding: '5px 11px', fontSize: 14, cursor: 'pointer', background: view === v ? T.accent : 'rgba(255,255,255,0.06)', color: '#fff', userSelect: 'none', lineHeight: 1 }}>
                  {icon}
                </div>
              ))}
            </div>
            <Btn sm fill onClick={() => setModalNuevo(true)}>+ Nuevo proveedor</Btn>
          </>
        }
        kpis={tabs.map(t => ({
          label: t.label,
          value: t.count,
          color: tab === t.key ? T.accent : (t.key === 'conSaldo' ? T.warn : T.ink),
          active: tab === t.key,
          onClick: () => setTab(t.key),
        }))}
      />

      {/* Vacío */}
      {filtered.length === 0 && (
        <Box style={{ padding: 32, textAlign: 'center', color: T.ink3, fontSize: 13 }}>
          Sin proveedores en esta categoría
        </Box>
      )}

      {/* ─── Vista lista ────────────────────────────────────────────────────── */}
      {view === 'lista' && filtered.length > 0 && (
        <Box style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: isAdmin ? '2.5fr 1.1fr 1fr 1.3fr 0.8fr 0.6fr 1fr 1fr 1fr 1fr' : '2.5fr 1.1fr 1fr 1.3fr 0.8fr 0.6fr 0.8fr auto', padding: '7px 14px', background: T.faint, borderBottom: `1.5px solid ${T.faint2}`, fontSize: 10, fontWeight: 700, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            <span>Proveedor</span>
            <span>Especialidad</span>
            <span style={{ fontFamily: T.fontMono }}>CUIT</span>
            <span>Contacto</span>
            <span>Calif.</span>
            <span style={{ textAlign: 'center' }}>Obras</span>
            {isAdmin && <span style={{ textAlign: 'right' }}>Pagado</span>}
            {isAdmin && <span style={{ textAlign: 'right' }}>Saldo CC</span>}
            <span style={{ textAlign: 'center' }}>Condición</span>
            <span>Acciones</span>
          </div>
          {filtered.map(p => {
            const saldo = getSaldo(p.id);
            const cat   = getCat(p);
            const phone = (p.telefono || '').replace(/\s/g, '').replace('+', '');
            const obrasCount = getObrasProveedor(p.id).length;
            return (
              <div key={p.id}
                style={{ display: 'grid', gridTemplateColumns: isAdmin ? '2.5fr 1.1fr 1fr 1.3fr 0.8fr 0.6fr 1fr 1fr 1fr 1fr' : '2.5fr 1.1fr 1fr 1.3fr 0.8fr 0.6fr 0.8fr auto', padding: '9px 14px', borderBottom: `1px solid ${T.faint2}`, alignItems: 'center', fontSize: 12, cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background = T.faint}
                onMouseLeave={e => e.currentTarget.style.background = ''}
                onClick={() => navigate(`/proveedores/${p.id}`)}>
                {/* Proveedor */}
                <span style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Avatar nombre={p.nombre} size={30} cat={cat} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.nombre}</div>
                    <CatBadge cat={cat} />
                  </div>
                </span>
                {/* Especialidad */}
                <span style={{ color: T.ink2, fontSize: 11 }}>{p.tipo || '—'}</span>
                {/* CUIT */}
                <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.ink2 }}>{p.cuit || '—'}</span>
                {/* Contacto */}
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }} onClick={e => e.stopPropagation()}>
                  {p.telefono && (
                    <a href={`https://wa.me/${phone}`} target="_blank" rel="noopener noreferrer"
                      style={{ color: '#25d366', textDecoration: 'none', fontSize: 10, display: 'flex', alignItems: 'center', gap: 3 }}>
                      <span>📱</span>{p.telefono}
                    </a>
                  )}
                  {p.email && (
                    <a href={`mailto:${p.email}`}
                      style={{ color: T.accent, textDecoration: 'none', fontSize: 10, display: 'flex', alignItems: 'center', gap: 3 }}>
                      <span>✉</span>{p.email}
                    </a>
                  )}
                  {!p.telefono && !p.email && <span style={{ color: T.ink3, fontSize: 11 }}>—</span>}
                </span>
                {/* Calificación */}
                <span><StarRating value={p.calificacion || 0} size={12} /></span>
                {/* Obras */}
                <span style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                  {obrasCount > 0 ? (
                    <span
                      style={{ fontFamily: T.fontMono, fontWeight: 700, color: T.accent, cursor: 'pointer', textDecoration: 'underline', fontSize: 13 }}
                      onClick={() => navigate(`/proveedores/${p.id}`)}>
                      {obrasCount}
                    </span>
                  ) : <span style={{ color: T.ink3, fontFamily: T.fontMono }}>0</span>}
                </span>
                {/* Total pagado — solo admin */}
                {isAdmin && (
                  <span style={{ textAlign: 'right', fontFamily: T.fontMono, fontSize: 11, color: totalPagado[p.id] > 0 ? T.ok : T.ink3 }}>
                    {totalPagado[p.id] > 0 ? `$ ${fmtN(totalPagado[p.id])}` : '—'}
                  </span>
                )}
                {/* Saldo — solo admin. Debajo, deuda en facturas pendientes (cuentas
                    por pagar) si la hay: es independiente del saldo CC. */}
                {isAdmin && (
                  <span style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                    <span style={{ fontFamily: T.fontMono, fontWeight: 800, color: saldo > 0 ? T.warn : T.ok }}>
                      {saldo > 0 ? `$ ${fmtN(saldo)}` : '—'}
                    </span>
                    {deudaFacturas[p.id] > 0 && (
                      <span style={{ fontSize: 9, fontFamily: T.fontMono, color: T.accent, fontWeight: 700 }}
                        title="Facturas pendientes de pago">
                        + $ {fmtN(deudaFacturas[p.id])} fact.
                      </span>
                    )}
                  </span>
                )}
                {/* Condición */}
                <span style={{ textAlign: 'center' }}>
                  <Chip style={{ fontSize: 9 }}>{p.condicion || '—'}</Chip>
                </span>
                {/* Acciones */}
                <span style={{ display: 'flex', gap: 5, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                  <Btn sm onClick={() => setEditProv(p)}>✏</Btn>
                  {isAdmin && <Btn sm accent onClick={() => setPagoProvId(p.id)}>Pagar</Btn>}
                  {isAdmin && (
                    <span style={{ color: T.warn, cursor: 'pointer', fontSize: 16, padding: '0 2px', lineHeight: 1 }}
                      onClick={() => { if (confirm(`¿Eliminar ${p.nombre}?`)) removeProveedor(p.id); }}>×</span>
                  )}
                </span>
              </div>
            );
          })}
        </Box>
      )}

      {/* ─── Vista cards ────────────────────────────────────────────────────── */}
      {view === 'cards' && filtered.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 10 }}>
          {filtered.map(p => {
            const saldo = getSaldo(p.id);
            const cat   = getCat(p);
            const phone = (p.telefono || '').replace(/\s/g, '').replace('+', '');
            return (
              <Box key={p.id} style={{ padding: 14, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 8 }}
                onClick={() => navigate(`/proveedores/${p.id}`)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Avatar nombre={p.nombre} size={40} cat={cat} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.nombre}</div>
                    <CatBadge cat={cat} />
                  </div>
                </div>
                {p.tipo && <div style={{ fontSize: 11, color: T.ink2 }}>{p.tipo}</div>}
                <StarRating value={p.calificacion || 0} size={13} />
                {/* Contacto */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }} onClick={e => e.stopPropagation()}>
                  {p.telefono && (
                    <a href={`https://wa.me/${phone}`} target="_blank" rel="noopener noreferrer"
                      style={{ color: '#25d366', fontSize: 11, textDecoration: 'none' }}>📱 {p.telefono}</a>
                  )}
                  {p.email && (
                    <a href={`mailto:${p.email}`}
                      style={{ color: T.accent, fontSize: 11, textDecoration: 'none' }}>✉ {p.email}</a>
                  )}
                </div>
                {/* Saldo — solo admin */}
                {isAdmin && (
                  <div style={{ borderTop: `1px solid ${T.faint2}`, paddingTop: 8 }}>
                    <div style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>Saldo CC</div>
                    <div style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 15, color: saldo > 0 ? T.warn : T.ok }}>
                      {saldo > 0 ? `$ ${fmtN(saldo)}` : 'Al día'}
                    </div>
                    {deudaFacturas[p.id] > 0 && (
                      <div style={{ fontSize: 10, fontFamily: T.fontMono, color: T.accent, fontWeight: 700, marginTop: 2 }}
                        title="Facturas pendientes de pago">
                        + $ {fmtN(deudaFacturas[p.id])} en fact. pendientes
                      </div>
                    )}
                  </div>
                )}
                {/* Acciones */}
                <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
                  {isAdmin && <Btn sm style={{ flex: 1 }} onClick={() => navigate(`/proveedores/${p.id}`)}>Ver CC</Btn>}
                  {isAdmin && <Btn sm accent style={{ flex: 1 }} onClick={() => setPagoProvId(p.id)}>Pagar</Btn>}
                  <Btn sm onClick={() => setEditProv(p)}>✏</Btn>
                </div>
              </Box>
            );
          })}
          {/* Nueva card */}
          <Box style={{ padding: 12, border: `1.5px dashed ${T.faint2}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: T.ink3, fontSize: 12, minHeight: 160 }}
            onClick={() => setModalNuevo(true)}>
            <div style={{ fontSize: 28, marginBottom: 6 }}>+</div>
            Nuevo proveedor
          </Box>
        </div>
      )}

      {/* Modales */}
      {pagoProvId && (
        <RegistrarPagoModal
          proveedor={proveedores.find(p => p.id === pagoProvId)?.nombre || ''}
          proveedorId={pagoProvId}
          onClose={() => setPagoProvId(null)} />
      )}
      {modalNuevo && (
        <NuevoProveedorModal onClose={() => setModalNuevo(false)} onSave={addProveedor} />
      )}
      {editProv && (
        <NuevoProveedorModal
          initial={editProv}
          onClose={() => setEditProv(null)}
          onSave={(data) => updateProveedor(editProv.id, data)} />
      )}
    </PageLayout>
  );
}
