import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageLayout from '../components/layout/PageLayout';
import { Box, Btn, Chip, Bar, Label, ImgPh } from '../components/ui';
import { T } from '../theme';
import { useObras, EMPTY_DETALLE } from '../store/ObrasContext';
import NuevaObraModal from './modales/NuevaObraModal';
import { useUsuarios } from '../store/UsuariosContext';

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n, moneda) => {
  if (!n) return moneda === 'USD' ? 'U$S 0' : '$ 0';
  const s = n.toLocaleString('es-AR');
  return moneda === 'USD' ? `U$S ${s}` : `$ ${s}`;
};

const fmtDate = (iso) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y.slice(2)}`;
};

const margenColor = (m) => m < 0 ? T.accent : m < 20 ? T.warn : T.ok;

// ── Calcula stats reales desde el detalle ─────────────────────────────────────
function computeStats(obra, detalle) {
  const movs  = detalle.movimientos || [];
  const rubros = detalle.rubros || [];

  const gastado = movs
    .filter(m => m.tipo === 'gasto')
    .reduce((s, m) => s + (m.monto || 0), 0);

  const todasTareas = rubros.flatMap(r => r.tareas || []);
  const avance = todasTareas.length > 0
    ? Math.round(todasTareas.reduce((s, t) => s + (t.avance || 0), 0) / todasTareas.length)
    : (obra.avance || 0);

  // Presupuesto: usa el valor manual si fue ingresado,
  // sino lo calcula desde los rubros (precio de venta al cliente)
  let presupuesto = obra.presupuesto || 0;
  if (!presupuesto && rubros.length > 0) {
    presupuesto = Math.round(rubros.reduce((s, rubro) => {
      return s + (rubro.tareas || []).reduce((rs, t) => {
        const ventaUnit = t.margenLinea != null
          ? (t.costoMat + (t.costoSub || 0)) * (1 + t.margenLinea / 100)
          : t.costoMat * (1 + (rubro.margenMat || 0) / 100)
            + (t.costoSub || 0) * (1 + (rubro.margenMO || 0) / 100);
        return rs + ventaUnit * (t.cantidad || 0);
      }, 0);
    }, 0));
  }

  const margen = presupuesto > 0 ? Math.round((presupuesto - gastado) / presupuesto * 100) : 0;

  return { presupuesto, gastado, avance, margen };
}

// ── Menu contextual de una obra ───────────────────────────────────────────────
function ObraMenu({ obra, onTransicion, onEditar, onEliminar }) {
  const [open, setOpen] = useState(false);

  const ACCIONES = {
    'en-presupuesto': [
      { label: 'Iniciar obra →',  next: 'activa',     icon: '▶' },
      { label: 'Editar',          fn: 'editar',        icon: '✎' },
      { label: 'Eliminar',        fn: 'eliminar',      icon: '🗑', danger: true },
    ],
    activa: [
      { label: 'Marcar finalizada', next: 'finalizada', icon: '✓' },
      { label: 'Editar',          fn: 'editar',        icon: '✎' },
    ],
    finalizada: [
      { label: 'Archivar',        next: 'archivada',   icon: '📁' },
      { label: 'Editar',          fn: 'editar',        icon: '✎' },
    ],
    archivada: [
      { label: 'Desarchivar',     next: 'en-presupuesto', icon: '↩' },
      { label: 'Eliminar',        fn: 'eliminar',      icon: '🗑', danger: true },
    ],
  };

  const acciones = ACCIONES[obra.estado] || [];

  return (
    <div style={{ position: 'relative' }}>
      <span
        style={{ cursor: 'pointer', fontSize: 18, padding: '2px 6px', borderRadius: 3, userSelect: 'none', color: T.ink2 }}
        onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
      >⋮</span>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 90 }} onClick={() => setOpen(false)} />
          <div style={{
            position: 'absolute', top: 24, right: 0, zIndex: 100,
            background: T.paper, border: `1.5px solid ${T.ink}`,
            borderRadius: 5, boxShadow: '2px 4px 12px rgba(0,0,0,0.14)',
            minWidth: 180, overflow: 'hidden',
          }}>
            {acciones.map((a, i) => (
              <div key={i}
                style={{
                  padding: '8px 14px', fontSize: 13, cursor: 'pointer',
                  color: a.danger ? T.accent : T.ink,
                  borderBottom: i < acciones.length - 1 ? `1px solid ${T.faint2}` : 'none',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}
                onMouseEnter={e => e.currentTarget.style.background = T.faint}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                onClick={e => {
                  e.stopPropagation();
                  setOpen(false);
                  if (a.fn === 'editar') onEditar();
                  else if (a.fn === 'eliminar') onEliminar();
                  else onTransicion(a.next);
                }}
              >
                <span>{a.icon}</span>{a.label}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Card: obra activa ─────────────────────────────────────────────────────────
function CardActiva({ obra, stats, onClick, onTransicion, onEditar, onEliminar, isAdmin = true }) {
  const [hover, setHover] = useState(false);
  const navigate = useNavigate();
  const { presupuesto, gastado, avance, margen } = stats;
  const sobrec = margen < 0;
  const alertCerrar = avance >= 85;
  const pctGastado = presupuesto > 0 ? Math.min(Math.round(gastado / presupuesto * 100), 100) : 0;

  return (
    <Box
      style={{ padding: 13, cursor: 'pointer', transition: 'box-shadow 0.15s', boxShadow: hover ? '4px 4px 0 rgba(0,0,0,0.1)' : 'none', position: 'relative' }}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="k-h" style={{ fontSize: 19, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{obra.nombre}</div>
          <div style={{ fontSize: 12, color: T.ink2, marginTop: 1 }}>
            {obra.cliente
              ? <span style={{ color: T.accent, cursor: 'pointer', textDecoration: 'underline' }}
                  onClick={e => { e.stopPropagation(); navigate(`/clientes?q=${encodeURIComponent(obra.cliente)}`); }}>
                  {obra.cliente}
                </span>
              : '—'
            }
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8, flexShrink: 0 }}>
          {sobrec && <Chip accent style={{ fontSize: 9 }}>sobrecosto</Chip>}
          {alertCerrar && !sobrec && <Chip warn style={{ fontSize: 9 }}>⚡ cierre</Chip>}
          <div
            style={{ width: 34, height: 34, borderRadius: 50, background: margenColor(margen), color: '#fff', fontFamily: T.fontMono, fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, flexShrink: 0 }}
          >{avance}%</div>
          <div onClick={e => e.stopPropagation()}>
            <ObraMenu obra={obra} onTransicion={onTransicion} onEditar={onEditar} onEliminar={onEliminar} />
          </div>
        </div>
      </div>

      <ImgPh w="100%" h={68} label={obra.tipo} style={{ marginTop: 8 }} />

      {/* avance de ejecución */}
      <div style={{ marginTop: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: T.ink2, marginBottom: 3 }}>
          <span>Avance tareas</span><span className="k-mono">{avance}%</span>
        </div>
        <Bar pct={avance} ok={avance === 100} warn={alertCerrar && !sobrec} accent={sobrec} />
      </div>

      {/* barra de gasto vs presupuesto */}
      {isAdmin && presupuesto > 0 && (
        <div style={{ marginTop: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: T.ink2, marginBottom: 3 }}>
            <span>Gasto vs presu</span>
            <span className="k-mono" style={{ color: sobrec ? T.accent : T.ink2 }}>{pctGastado}%</span>
          </div>
          <div style={{ height: 5, background: T.faint2, borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pctGastado}%`, background: sobrec ? T.accent : T.warn, borderRadius: 3, transition: 'width 0.3s' }} />
          </div>
        </div>
      )}

      {/* stats */}
      {isAdmin && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11 }}>
          <div>
            <Label>Presu</Label>
            <div className="k-mono" style={{ fontSize: 12 }}>{fmt(presupuesto, obra.moneda)}</div>
          </div>
          <div>
            <Label>Gastado</Label>
            <div className="k-mono" style={{ fontSize: 12, color: sobrec ? T.accent : T.ink }}>{fmt(gastado, obra.moneda)}</div>
          </div>
          <div>
            <Label>Margen real</Label>
            <div className="k-mono" style={{ fontSize: 12, fontWeight: 700, color: margenColor(margen) }}>{margen}%</div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: T.ink2 }}>
        {isAdmin ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 9, background: T.faint2, padding: '1px 5px', borderRadius: 3 }}>{obra.tipo}</span>
            <span>{obra.moneda}</span>
          </span>
        ) : <span />}
        <span>fin est. {fmtDate(obra.fechaFinEstim)}</span>
      </div>
    </Box>
  );
}

// ── Card: en presupuesto ──────────────────────────────────────────────────────
function CardPresupuesto({ obra, onClick, onTransicion, onEditar, onEliminar }) {
  const navigate = useNavigate();
  return (
    <Box style={{ padding: 13, borderStyle: 'dashed', cursor: 'pointer', position: 'relative' }} onClick={onClick}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="k-h" style={{ fontSize: 19 }}>{obra.nombre}</div>
          <div style={{ fontSize: 12, color: T.ink2 }}>
            {obra.cliente
              ? <span style={{ color: T.accent, cursor: 'pointer', textDecoration: 'underline' }}
                  onClick={e => { e.stopPropagation(); navigate(`/clientes?q=${encodeURIComponent(obra.cliente)}`); }}>
                  {obra.cliente}
                </span>
              : '—'
            }
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={e => e.stopPropagation()}>
          <Chip style={{ fontSize: 9 }}>borrador</Chip>
          <ObraMenu obra={obra} onTransicion={onTransicion} onEditar={onEditar} onEliminar={onEliminar} />
        </div>
      </div>

      <div style={{ margin: '10px 0', background: T.faint, borderRadius: 4, padding: '8px 10px', fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: T.ink2 }}>Tipo</span><span>{obra.tipo}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: T.ink2 }}>Presu est.</span>
          <span className="k-mono" style={{ fontWeight: 700 }}>{fmt(obra.presupuesto, obra.moneda)}</span>
        </div>
        {obra.fechaFinEstim && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: T.ink2 }}>Entrega est.</span><span>{fmtDate(obra.fechaFinEstim)}</span>
          </div>
        )}
        {obra.notas && (
          <div style={{ color: T.ink3, fontSize: 11, fontStyle: 'italic', marginTop: 2 }}>"{obra.notas}"</div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
        <Btn sm style={{ flex: 1, justifyContent: 'center' }} onClick={onClick}>Ver presupuesto</Btn>
        <Btn sm fill style={{ flex: 1, justifyContent: 'center' }}
          onClick={() => onTransicion('activa')}>Iniciar obra ▶</Btn>
      </div>
    </Box>
  );
}

// ── Card: pausada ─────────────────────────────────────────────────────────────
function CardPausada({ obra, stats, onClick, onTransicion, onEditar, onEliminar }) {
  const { presupuesto, gastado, avance, margen } = stats;
  const navigate = useNavigate();
  return (
    <Box style={{ padding: 13, position: 'relative', opacity: 0.9 }} onClick={onClick}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="k-h" style={{ fontSize: 19, color: T.ink2 }}>{obra.nombre}</div>
          <div style={{ fontSize: 12, color: T.ink3 }}>
            {obra.cliente
              ? <span style={{ color: T.accent, cursor: 'pointer', textDecoration: 'underline' }}
                  onClick={e => { e.stopPropagation(); navigate(`/clientes?q=${encodeURIComponent(obra.cliente)}`); }}>
                  {obra.cliente}
                </span>
              : '—'
            }
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={e => e.stopPropagation()}>
          <Chip warn style={{ fontSize: 9 }}>⏸ pausada</Chip>
          <ObraMenu obra={obra} onTransicion={onTransicion} onEditar={onEditar} onEliminar={onEliminar} />
        </div>
      </div>

      {/* barra congelada */}
      <div style={{ marginTop: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
          <span style={{ color: T.ink2 }}>Avance al pausar</span>
          <span className="k-mono">{avance}%</span>
        </div>
        <Bar pct={avance} />
      </div>

      <div style={{ marginTop: 8, fontSize: 12, display: 'flex', justifyContent: 'space-between' }}>
        <div><Label>Gastado</Label><div className="k-mono">{fmt(gastado, obra.moneda)}</div></div>
        <div><Label>Presup.</Label><div className="k-mono">{fmt(presupuesto, obra.moneda)}</div></div>
        <div><Label>Margen</Label><div className="k-mono" style={{ fontWeight: 700, color: margenColor(margen) }}>{margen}%</div></div>
      </div>

      {obra.notas && (
        <div style={{ marginTop: 8, fontSize: 11, color: T.ink2, background: '#fff7e6', borderRadius: 4, padding: '5px 8px', fontStyle: 'italic' }}>
          {obra.notas}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 10 }} onClick={e => e.stopPropagation()}>
        <Btn sm style={{ flex: 1, justifyContent: 'center' }} onClick={() => onTransicion('activa')}>▶ Reactivar</Btn>
        <Btn sm style={{ flex: 1, justifyContent: 'center' }} onClick={onClick}>Ver detalle</Btn>
      </div>
    </Box>
  );
}

// ── Card: finalizada ──────────────────────────────────────────────────────────
function CardFinalizada({ obra, stats, onClick, onTransicion, onEditar }) {
  const { presupuesto, gastado, margen: margenFinal } = stats;
  const navigate = useNavigate();

  return (
    <Box style={{ padding: 13, cursor: 'pointer' }} onClick={onClick}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="k-h" style={{ fontSize: 17 }}>{obra.nombre}</div>
          <div style={{ fontSize: 12, color: T.ink2 }}>
            {obra.cliente
              ? <span style={{ color: T.accent, cursor: 'pointer', textDecoration: 'underline' }}
                  onClick={e => { e.stopPropagation(); navigate(`/clientes?q=${encodeURIComponent(obra.cliente)}`); }}>
                  {obra.cliente}
                </span>
              : '—'
            }
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={e => e.stopPropagation()}>
          <Chip ok style={{ fontSize: 9 }}>✓ finalizada</Chip>
          <ObraMenu obra={obra} onTransicion={onTransicion} onEditar={onEditar} onEliminar={() => {}} />
        </div>
      </div>

      <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, fontSize: 11 }}>
        <div style={{ background: T.faint, borderRadius: 4, padding: '6px 8px' }}>
          <div style={{ color: T.ink2 }}>Presupuesto</div>
          <div className="k-mono" style={{ fontWeight: 700, fontSize: 12 }}>{fmt(presupuesto, obra.moneda)}</div>
        </div>
        <div style={{ background: T.faint, borderRadius: 4, padding: '6px 8px' }}>
          <div style={{ color: T.ink2 }}>Gastado</div>
          <div className="k-mono" style={{ fontWeight: 700, fontSize: 12 }}>{fmt(gastado, obra.moneda)}</div>
        </div>
        <div style={{ background: T.faint, borderRadius: 4, padding: '6px 8px' }}>
          <div style={{ color: T.ink2 }}>Margen</div>
          <div className="k-mono" style={{ fontWeight: 700, fontSize: 12, color: margenColor(margenFinal) }}>{margenFinal}%</div>
        </div>
      </div>

      <div style={{ marginTop: 8, fontSize: 11, color: T.ink2, display: 'flex', justifyContent: 'space-between' }}>
        <span>Inicio: {fmtDate(obra.fechaInicio)}</span>
        <span>Cierre: {fmtDate(obra.fechaFin)}</span>
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 10 }} onClick={e => e.stopPropagation()}>
        <Btn sm style={{ flex: 1, justifyContent: 'center' }} onClick={onClick}>Ver historial</Btn>
        <Btn sm style={{ flex: 1, justifyContent: 'center' }} onClick={() => onTransicion('archivada')}>📁 Archivar</Btn>
      </div>
    </Box>
  );
}

// ── Fila: archivada (lista compacta) ─────────────────────────────────────────
function FilaArchivada({ obra, onClick, onTransicion, onEliminar }) {
  const navigate = useNavigate();
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: `1px solid ${T.faint2}`, cursor: 'pointer', gap: 10 }}
      onClick={onClick}
      onMouseEnter={e => e.currentTarget.style.background = T.faint}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <div style={{ flex: 1.5 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{obra.nombre}</div>
        <div style={{ fontSize: 11, color: T.ink2 }}>
          {obra.cliente
            ? <span style={{ color: T.accent, cursor: 'pointer', textDecoration: 'underline' }}
                onClick={e => { e.stopPropagation(); navigate(`/clientes?q=${encodeURIComponent(obra.cliente)}`); }}>
                {obra.cliente}
              </span>
            : '—'
          }
        </div>
      </div>
      <div style={{ flex: 1, fontSize: 11, color: T.ink2 }}>{obra.tipo}</div>
      <div style={{ flex: 1, fontFamily: T.fontMono, fontSize: 12 }}>{fmt(obra.presupuesto, obra.moneda)}</div>
      <div style={{ flex: 0.8, fontSize: 11, color: T.ink2 }}>
        {fmtDate(obra.fechaFin || obra.fechaFinEstim)}
      </div>
      <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
        <Btn sm onClick={() => onTransicion('en-presupuesto')}>↩ Desarchivar</Btn>
        <Btn sm style={{ color: T.accent, borderColor: T.accent }} onClick={onEliminar}>🗑</Btn>
      </div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function Obras() {
  const navigate = useNavigate();
  const { obras, detalles, addObra, updateObra, setEstado, deleteObra, byEstado } = useObras();
  const { currentUser } = useUsuarios();
  const isAdmin = currentUser?.rol === 'Admin';

  const ov = currentUser?.obrasVisibles ?? '*';
  const puedeVer = (o) => ov === '*' || (Array.isArray(ov) && ov.includes(o.id));
  const canCreate = isAdmin || currentUser?.permisos?.crearObra === true;

  const getStats = (obra) => computeStats(obra, detalles[obra.id] || EMPTY_DETALLE);

  const [searchParams] = useSearchParams();
  const [tabIdx, setTabIdx] = useState(0);
  const [showNueva, setShowNueva] = useState(false);
  const [editando, setEditando] = useState(null);
  const [busqueda, setBusqueda] = useState(() => searchParams.get('q') || '');

  // Sync busqueda from URL param (e.g. navigating from Clientes)
  useEffect(() => {
    const q = searchParams.get('q');
    if (q) setBusqueda(q);
  }, [searchParams]);

  const activas      = byEstado('activa').filter(puedeVer);
  const enPresu      = byEstado('en-presupuesto').filter(puedeVer);
  const finalizadas  = byEstado('finalizada').filter(puedeVer);
  const archivadas   = byEstado('archivada').filter(puedeVer);

  const TABS = [
    { label: 'Activas',        count: activas.length },
    { label: 'En presupuesto', count: enPresu.length },
    { label: 'Finalizadas',    count: finalizadas.length },
    { label: 'Archivadas',     count: archivadas.length },
  ];
  const visibleTabs = isAdmin ? TABS : TABS.slice(0, 1); // non-admin: only "Activas"

  // Filtro de búsqueda sobre la lista activa
  const filtrar = (lista) => {
    if (!busqueda.trim()) return lista;
    const q = busqueda.toLowerCase();
    return lista.filter(o =>
      (o.nombre  || '').toLowerCase().includes(q) ||
      (o.cliente || '').toLowerCase().includes(q) ||
      (o.tipo    || '').toLowerCase().includes(q)
    );
  };

  const goObra = (o) => navigate(`/obras/${o.id}/presupuesto`);

  const handleTransicion = (id, nuevoEstado) => {
    setEstado(id, nuevoEstado);
    // Si la obra activa se pasa a 'activa' y estábamos en pestaña en-presupuesto → saltar a activas
    if (nuevoEstado === 'activa' && tabIdx === 1) setTabIdx(0);
    if (nuevoEstado === 'finalizada') setTabIdx(2);
    if (nuevoEstado === 'archivada') setTabIdx(3);
  };

  const handleEliminar = (id) => {
    if (window.confirm('¿Eliminar esta obra? Esta acción no se puede deshacer.')) deleteObra(id);
  };

  const handleSaveNueva = (datos) => {
    addObra(datos);
    setTabIdx(1); // ir a "En presupuesto"
  };

  const handleSaveEdit = (datos) => {
    updateObra(editando.id, datos);
    setEditando(null);
  };

  return (
    <PageLayout breadcrumb={['Inicio', 'Obras']} active="Obras">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div className="k-h" style={{ fontSize: 28 }}>Obras</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            value={busqueda} onChange={e => setBusqueda(e.target.value)}
            placeholder="⌕ Buscar obra o cliente…"
            style={{ padding: '5px 10px', border: `1.2px solid ${T.faint2}`, borderRadius: 4, fontSize: 12, fontFamily: T.font, width: 200, outline: 'none' }}
          />
          {canCreate && <Btn sm fill onClick={() => setShowNueva(true)}>+ Nueva obra</Btn>}
        </div>
      </div>

      {/* Tabs */}
      <div className="k-tabs" style={{ marginBottom: 14 }}>
        {visibleTabs.map((t, i) => (
          <span key={i} className={`k-tab${tabIdx === i ? ' k-tab-on' : ''}`} onClick={() => setTabIdx(i)}>
            {t.label} · {t.count}
          </span>
        ))}
      </div>

      {/* ── TAB 0: Activas ── */}
      {tabIdx === 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {filtrar(activas).map(o => (
            <CardActiva key={o.id} obra={o} stats={getStats(o)}
              onClick={() => goObra(o)}
              onTransicion={(est) => handleTransicion(o.id, est)}
              onEditar={() => setEditando(o)}
              onEliminar={() => handleEliminar(o.id)}
              isAdmin={isAdmin}
            />
          ))}
          {!busqueda && canCreate && (
            <Box dashed style={{ padding: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 180, color: T.ink3, fontSize: 14, cursor: 'pointer' }}
              onClick={() => setShowNueva(true)}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 30 }}>+</div>
                <div>Nueva obra</div>
              </div>
            </Box>
          )}
          {filtrar(activas).length === 0 && busqueda && (
            <div style={{ gridColumn: '1/-1', color: T.ink3, padding: 24 }}>Sin resultados para "{busqueda}"</div>
          )}
        </div>
      )}

      {/* ── TAB 1: En presupuesto ── */}
      {tabIdx === 1 && (
        <div>
          {filtrar(enPresu).length === 0 && !busqueda ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 260, color: T.ink3, gap: 12 }}>
              <div style={{ fontSize: 40 }}>📋</div>
              <div style={{ fontSize: 15 }}>No hay obras en presupuesto</div>
              {canCreate && <Btn sm fill onClick={() => setShowNueva(true)}>+ Nueva obra</Btn>}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              {filtrar(enPresu).map(o => (
                <CardPresupuesto key={o.id} obra={o}
                  onClick={() => goObra(o)}
                  onTransicion={(est) => handleTransicion(o.id, est)}
                  onEditar={() => setEditando(o)}
                  onEliminar={() => handleEliminar(o.id)}
                />
              ))}
              {!busqueda && (
                <Box dashed style={{ padding: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 160, color: T.ink3, cursor: 'pointer' }}
                  onClick={() => setShowNueva(true)}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 28 }}>+</div>
                    <div>Nueva cotización</div>
                  </div>
                </Box>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── TAB 2: Finalizadas ── */}
      {tabIdx === 2 && (
        <div>
          {filtrar(finalizadas).length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 260, color: T.ink3, gap: 8 }}>
              <div style={{ fontSize: 40 }}>✅</div>
              <div style={{ fontSize: 15 }}>No hay obras finalizadas</div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              {filtrar(finalizadas).map(o => (
                <CardFinalizada key={o.id} obra={o} stats={getStats(o)}
                  onClick={() => goObra(o)}
                  onTransicion={(est) => handleTransicion(o.id, est)}
                  onEditar={() => setEditando(o)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── TAB 3: Archivadas ── */}
      {tabIdx === 3 && (
        <Box style={{ padding: 0, overflow: 'hidden' }}>
          {/* header tabla */}
          <div style={{ display: 'flex', padding: '7px 14px', background: T.faint, borderBottom: `1.5px solid ${T.faint2}`, fontSize: 11, fontWeight: 700, color: T.ink2, gap: 10 }}>
            <span style={{ flex: 1.5 }}>Obra / Cliente</span>
            <span style={{ flex: 1 }}>Tipo</span>
            <span style={{ flex: 1 }}>Presupuesto</span>
            <span style={{ flex: 0.8 }}>Cierre</span>
            <span style={{ flex: 1.2 }}>Acciones</span>
          </div>
          {filtrar(archivadas).length === 0 ? (
            <div style={{ padding: 24, color: T.ink3, textAlign: 'center' }}>
              {busqueda ? `Sin resultados para "${busqueda}"` : 'No hay obras archivadas'}
            </div>
          ) : filtrar(archivadas).map(o => (
            <FilaArchivada key={o.id} obra={o}
              onClick={() => goObra(o)}
              onTransicion={(est) => handleTransicion(o.id, est)}
              onEliminar={() => handleEliminar(o.id)}
            />
          ))}
        </Box>
      )}

      {/* Modales */}
      {showNueva && (
        <NuevaObraModal onSave={handleSaveNueva} onClose={() => setShowNueva(false)} />
      )}
      {editando && (
        <NuevaObraModal obra={editando} onSave={handleSaveEdit} onClose={() => setEditando(null)} />
      )}
    </PageLayout>
  );
}
