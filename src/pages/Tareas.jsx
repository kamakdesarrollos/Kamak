import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageLayout from '../components/layout/PageLayout';
import { Box, Btn } from '../components/ui';
import PageHero from '../components/ui/PageHero';
import { T } from '../theme';
import { useUsuarios } from '../store/UsuariosContext';
import { useObras } from '../store/ObrasContext';
import { useTareas } from '../store/TareasContext';
import TareaModal from './modales/TareaModal';

// Pagina /tareas. Hub de tareas con checklist asignables entre usuarios.
//
// Tabs:
// - Mis tareas: las que tengo asignadas (pendientes + en progreso)
// - Creadas por mi: las que yo cree (asignadas a otros o a mi)
// - Completadas: archivo (mias o todas si soy admin)
// - Todas (admin only): vista global
//
// Filtros: prioridad, obra. Click en tarjeta → abre TareaModal en modo
// edicion (o detalle si no soy creador ni asignado).

const PRIORIDADES = ['baja', 'media', 'alta'];
const PRIO_COLOR = { baja: T.ink3, media: '#d97706', alta: '#dc2626' };
const PRIO_LABEL = { baja: 'Baja', media: 'Media', alta: 'Alta' };
const ESTADO_LABEL = { pendiente: 'Pendiente', en_progreso: 'En progreso', completada: 'Completada', cancelada: 'Cancelada' };
const ESTADO_COLOR = {
  pendiente: T.ink3,
  en_progreso: '#d97706',
  completada: '#059669',
  cancelada: '#94a3b8',
};

const fmtFecha = (iso) => {
  if (!iso) return '—';
  if (iso.length === 10) { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; }
  const d = new Date(iso);
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const isVencida = (fechaLimite, estado) => {
  if (!fechaLimite || estado === 'completada' || estado === 'cancelada') return false;
  return fechaLimite < new Date().toISOString().slice(0, 10);
};

function ProgressBar({ completos, total }) {
  const pct = total > 0 ? Math.round((completos / total) * 100) : 0;
  const color = pct === 100 ? '#059669' : pct >= 50 ? '#d97706' : T.accent;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
      <div style={{ flex: 1, height: 6, background: T.faint2, borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width 0.2s' }} />
      </div>
      <span style={{ fontSize: 10, fontFamily: T.fontMono, color: T.ink3, minWidth: 32, textAlign: 'right' }}>
        {total > 0 ? `${completos}/${total}` : '—'}
      </span>
    </div>
  );
}

function TareaRow({ tarea, currentUser, usuarios, obras, expanded, onToggleExpand, onEdit, toggleItem, addItem }) {
  const asignados = (tarea.asignadoA || []).map(uid => usuarios.find(u => u.id === uid)?.nombre || '?').join(', ');
  const obra = obras.find(o => o.id === tarea.obraId);
  const totalItems = (tarea.checklist || []).length;
  const completos = (tarea.checklist || []).filter(i => i.completado).length;
  const vencida = isVencida(tarea.fechaLimite, tarea.estado);
  const esNueva = currentUser
    && (tarea.asignadoA || []).includes(currentUser.id)
    && !(tarea.vistaPor || []).includes(currentUser.id);
  const [nuevoItem, setNuevoItem] = useState('');

  const handleAddItem = () => {
    const txt = nuevoItem.trim();
    if (!txt) return;
    addItem(tarea.id, txt);
    setNuevoItem('');
  };

  return (
    <div style={{ borderBottom: `1px solid ${T.faint2}` }}>
      <div
        onClick={onToggleExpand}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 14px',
          cursor: 'pointer',
          background: expanded ? '#f3eedf' : esNueva ? '#fff7ed' : 'transparent',
          transition: 'background 0.1s',
        }}
        onMouseEnter={e => { if (!expanded) e.currentTarget.style.background = '#f7f3e5'; }}
        onMouseLeave={e => { if (!expanded) e.currentTarget.style.background = esNueva ? '#fff7ed' : 'transparent'; }}
      >
        {/* Indicador prioridad */}
        <div style={{
          width: 4,
          height: 32,
          background: PRIO_COLOR[tarea.prioridad] || T.ink3,
          borderRadius: 2,
          flexShrink: 0,
        }} />

        {/* Chevron */}
        <div style={{
          width: 14,
          fontSize: 11,
          color: T.ink3,
          flexShrink: 0,
          transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform 0.15s',
          textAlign: 'center',
        }}>▶</div>

        {/* Titulo + meta */}
        <div style={{ flex: 3, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontWeight: 700, fontSize: 13, color: T.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {tarea.titulo}
            </span>
            {esNueva && (
              <span style={{ background: '#dc2626', color: '#fff', fontSize: 8.5, padding: '1px 5px', borderRadius: 8, fontWeight: 700, letterSpacing: 0.5 }}>
                NUEVA
              </span>
            )}
          </div>
          {tarea.descripcion && (
            <div style={{ fontSize: 11, color: T.ink2, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {tarea.descripcion}
            </div>
          )}
        </div>

        {/* Asignados */}
        <div style={{ flex: 1.5, fontSize: 11, color: T.ink2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={asignados}>
          {asignados || '—'}
        </div>

        {/* Obra */}
        <div style={{ flex: 1.3, fontSize: 11, color: T.ink2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {obra ? obra.nombre : <span style={{ color: T.ink3 }}>—</span>}
        </div>

        {/* Checklist progress bar */}
        <div style={{ width: 110 }}>
          <ProgressBar completos={completos} total={totalItems} />
        </div>

        {/* Fecha limite */}
        <div style={{ width: 90, fontSize: 11, fontFamily: T.fontMono, color: vencida ? '#dc2626' : T.ink2, fontWeight: vencida ? 700 : 400, textAlign: 'right' }}>
          {fmtFecha(tarea.fechaLimite)}
        </div>

        {/* Estado */}
        <div style={{
          width: 100,
          fontSize: 10,
          padding: '3px 8px',
          borderRadius: 10,
          background: `${ESTADO_COLOR[tarea.estado]}22`,
          color: ESTADO_COLOR[tarea.estado],
          fontWeight: 700,
          textAlign: 'center',
          flexShrink: 0,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}>
          {ESTADO_LABEL[tarea.estado] || tarea.estado}
        </div>
      </div>

      {/* Panel expandido: checklist interactivo */}
      {expanded && (
        <div style={{
          padding: '12px 14px 14px 34px',
          background: '#fbf9f1',
          borderTop: `1px solid ${T.faint2}`,
        }}>
          {tarea.descripcion && (
            <div style={{ fontSize: 12, color: T.ink2, marginBottom: 10, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>
              {tarea.descripcion}
            </div>
          )}

          <div style={{ fontFamily: T.fontMono, fontSize: 9.5, letterSpacing: 1, color: T.ink3, fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>
            ◆ Checklist
          </div>

          {totalItems === 0 ? (
            <div style={{ fontSize: 11, color: T.ink3, fontStyle: 'italic', padding: '6px 0' }}>
              Sin ítems. Agregá uno abajo.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {(tarea.checklist || []).map(it => {
                const completadoPor = it.completadoPor ? usuarios.find(u => u.id === it.completadoPor)?.nombre : null;
                return (
                  <label
                    key={it.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '5px 8px',
                      borderRadius: 4,
                      cursor: 'pointer',
                      background: it.completado ? '#ecfdf5' : T.paper,
                      border: `1px solid ${it.completado ? '#bbf7d0' : T.faint2}`,
                      transition: 'background 0.1s',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={!!it.completado}
                      onChange={() => toggleItem(tarea.id, it.id, currentUser?.id)}
                      style={{ cursor: 'pointer', accentColor: '#059669' }}
                    />
                    <span style={{
                      fontSize: 12,
                      color: it.completado ? T.ink3 : T.ink,
                      textDecoration: it.completado ? 'line-through' : 'none',
                      flex: 1,
                    }}>
                      {it.texto}
                    </span>
                    {completadoPor && (
                      <span style={{ fontSize: 9.5, color: T.ink3, fontFamily: T.fontMono }}>
                        {completadoPor}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          )}

          {/* Agregar ítem rápido */}
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <input
              type="text"
              value={nuevoItem}
              onChange={e => setNuevoItem(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddItem(); } }}
              placeholder="+ Agregar ítem y presionar Enter"
              style={{
                flex: 1,
                padding: '5px 8px',
                fontSize: 11,
                border: `1px solid ${T.faint2}`,
                borderRadius: 4,
                fontFamily: T.font,
                background: T.paper,
                outline: 'none',
              }}
            />
            <Btn sm onClick={onEdit}>Editar tarea</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Tareas() {
  const { currentUser, usuarios } = useUsuarios();
  const { obras } = useObras();
  const { tareas, marcarVista, toggleItem, addItem } = useTareas();
  const [searchParams, setSearchParams] = useSearchParams();

  const isAdmin = currentUser?.rol === 'Admin';
  const [tab, setTab] = useState('mias');           // mias | creadas | completadas | todas
  const [filtroPrio, setFiltroPrio] = useState(''); // '' | baja | media | alta
  const [filtroObra, setFiltroObra] = useState(''); // '' | obraId | 'sin-obra'
  const [filtroEstado, setFiltroEstado] = useState(''); // '' | 'en_progreso' | 'vencidas'
  const [editingId, setEditingId] = useState(null); // null | 'nueva' | tareaId
  const [expandedId, setExpandedId] = useState(null); // tarea expandida inline

  // Abrir tarea desde notificacion in-app: /tareas?id=tarea-xyz
  useEffect(() => {
    const qid = searchParams.get('id');
    if (qid) {
      setExpandedId(qid);
      // limpiar query param para no reabrir en cada navegacion
      const next = new URLSearchParams(searchParams);
      next.delete('id');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Marcar como vista cuando se expande la fila o se abre el modal.
  useEffect(() => {
    const id = expandedId || (editingId && editingId !== 'nueva' ? editingId : null);
    if (id && currentUser) marcarVista(id, currentUser.id);
  }, [expandedId, editingId, currentUser, marcarVista]);

  // Filtros por tab
  const tareasVisibles = useMemo(() => {
    if (!currentUser) return [];
    let base = tareas;
    if (tab === 'mias') {
      base = base.filter(t =>
        (t.asignadoA || []).includes(currentUser.id) &&
        t.estado !== 'completada' &&
        t.estado !== 'cancelada'
      );
    } else if (tab === 'creadas') {
      base = base.filter(t =>
        t.creadoPor === currentUser.id &&
        t.estado !== 'completada' &&
        t.estado !== 'cancelada'
      );
    } else if (tab === 'completadas') {
      base = base.filter(t => t.estado === 'completada' || t.estado === 'cancelada');
      if (!isAdmin) {
        base = base.filter(t =>
          (t.asignadoA || []).includes(currentUser.id) || t.creadoPor === currentUser.id
        );
      }
    } else if (tab === 'todas') {
      // Solo admin ve todas las activas
      base = base.filter(t => t.estado !== 'completada' && t.estado !== 'cancelada');
    }
    if (filtroPrio) base = base.filter(t => t.prioridad === filtroPrio);
    if (filtroObra === 'sin-obra') base = base.filter(t => !t.obraId);
    else if (filtroObra) base = base.filter(t => t.obraId === filtroObra);
    if (filtroEstado === 'en_progreso') base = base.filter(t => t.estado === 'en_progreso');
    else if (filtroEstado === 'vencidas') base = base.filter(t => isVencida(t.fechaLimite, t.estado));

    // Orden: vencidas primero, luego por fecha limite (las que tienen),
    // luego por prioridad (alta > media > baja), luego por creacion desc.
    const prioRank = { alta: 0, media: 1, baja: 2 };
    return [...base].sort((a, b) => {
      const va = isVencida(a.fechaLimite, a.estado) ? 0 : 1;
      const vb = isVencida(b.fechaLimite, b.estado) ? 0 : 1;
      if (va !== vb) return va - vb;
      if (a.fechaLimite && b.fechaLimite && a.fechaLimite !== b.fechaLimite) {
        return a.fechaLimite < b.fechaLimite ? -1 : 1;
      }
      if (a.fechaLimite && !b.fechaLimite) return -1;
      if (!a.fechaLimite && b.fechaLimite) return 1;
      const pr = (prioRank[a.prioridad] ?? 9) - (prioRank[b.prioridad] ?? 9);
      if (pr !== 0) return pr;
      return (b.creadoAt || '').localeCompare(a.creadoAt || '');
    });
  }, [tareas, tab, filtroPrio, filtroObra, currentUser, isAdmin]);

  // KPIs
  const kpis = useMemo(() => {
    if (!currentUser) return [];
    const mias = tareas.filter(t =>
      (t.asignadoA || []).includes(currentUser.id) &&
      t.estado !== 'completada' &&
      t.estado !== 'cancelada'
    );
    const vencidas = mias.filter(t => isVencida(t.fechaLimite, t.estado));
    const enProgreso = mias.filter(t => t.estado === 'en_progreso');
    const completadasMias = tareas.filter(t =>
      (t.asignadoA || []).includes(currentUser.id) && t.estado === 'completada'
    );
    const enMiasSinFiltro = tab === 'mias' && !filtroEstado;
    return [
      {
        label: 'Mis pendientes', value: mias.length,
        color: enMiasSinFiltro ? T.accent : T.ink,
        active: enMiasSinFiltro,
        onClick: () => { setTab('mias'); setFiltroEstado(''); setFiltroPrio(''); setFiltroObra(''); },
      },
      {
        label: 'En progreso', value: enProgreso.length,
        color: tab === 'mias' && filtroEstado === 'en_progreso' ? T.accent : '#d97706',
        active: tab === 'mias' && filtroEstado === 'en_progreso',
        onClick: () => filtrarPorKPI('en_progreso'),
      },
      {
        label: 'Vencidas', value: vencidas.length,
        color: tab === 'mias' && filtroEstado === 'vencidas' ? T.accent : (vencidas.length > 0 ? '#dc2626' : T.ink),
        active: tab === 'mias' && filtroEstado === 'vencidas',
        onClick: () => filtrarPorKPI('vencidas'),
      },
      {
        label: 'Completadas (mias)', value: completadasMias.length,
        color: tab === 'completadas' ? T.accent : T.ok,
        active: tab === 'completadas',
        onClick: () => cambiarTab('completadas'),
      },
    ];
  }, [tareas, currentUser, tab, filtroEstado]); // eslint-disable-line react-hooks/exhaustive-deps

  // Conteos por tab (sin filtros aplicados, para que el contador siempre
  // refleje el total real y el user no piense que está vacío por un filtro).
  const conteos = useMemo(() => {
    if (!currentUser) return { mias: 0, creadas: 0, completadas: 0, todas: 0 };
    const mias = tareas.filter(t =>
      (t.asignadoA || []).includes(currentUser.id) &&
      t.estado !== 'completada' && t.estado !== 'cancelada'
    ).length;
    const creadas = tareas.filter(t =>
      t.creadoPor === currentUser.id &&
      t.estado !== 'completada' && t.estado !== 'cancelada'
    ).length;
    const completadasBase = tareas.filter(t => t.estado === 'completada' || t.estado === 'cancelada');
    const completadas = isAdmin
      ? completadasBase.length
      : completadasBase.filter(t => (t.asignadoA || []).includes(currentUser.id) || t.creadoPor === currentUser.id).length;
    const todas = tareas.filter(t => t.estado !== 'completada' && t.estado !== 'cancelada').length;
    return { mias, creadas, completadas, todas };
  }, [tareas, currentUser, isAdmin]);

  const tabs = useMemo(() => {
    const base = [
      { key: 'mias', label: 'Mis tareas', count: conteos.mias },
      { key: 'creadas', label: 'Creadas por mí', count: conteos.creadas },
      { key: 'completadas', label: 'Completadas', count: conteos.completadas },
    ];
    if (isAdmin) base.splice(2, 0, { key: 'todas', label: 'Todas', count: conteos.todas });
    return base;
  }, [isAdmin, conteos]);

  // Al cambiar de tab, limpiar filtros para que no oculten resultados de la
  // nueva vista (típico: filtraste una obra en "Mis tareas", saltás a
  // "Completadas" y parece vacío porque el filtro sigue activo).
  const cambiarTab = (newTab) => {
    setTab(newTab);
    setFiltroPrio('');
    setFiltroObra('');
    setFiltroEstado('');
  };

  // Toggle de filtros desde los KPIs del banner.
  const filtrarPorKPI = (estadoFiltro) => {
    setTab('mias');
    setFiltroPrio('');
    setFiltroObra('');
    setFiltroEstado(prev => prev === estadoFiltro ? '' : estadoFiltro);
  };

  return (
    <PageLayout active="Tareas">
      <PageHero
        label="GESTIÓN DE TAREAS"
        title="Tareas"
        subtitle="Asignación y seguimiento de pendientes operativos y administrativos"
        kpis={kpis}
        actions={<Btn sm accent onClick={() => setEditingId('nueva')}>+ Nueva tarea</Btn>}
      />

      <Box style={{ padding: 0, overflow: 'hidden' }}>
        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: `1.5px solid ${T.faint2}`, padding: '0 14px', gap: 0 }}>
          {tabs.map(t => (
            <div
              key={t.key}
              onClick={() => cambiarTab(t.key)}
              style={{
                padding: '10px 14px',
                fontSize: 12,
                fontWeight: tab === t.key ? 700 : 500,
                color: tab === t.key ? T.accent : T.ink2,
                borderBottom: tab === t.key ? `2px solid ${T.accent}` : '2px solid transparent',
                cursor: 'pointer',
                marginBottom: -1.5,
                transition: 'color 0.15s',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span>{t.label}</span>
              <span style={{
                fontSize: 9.5,
                fontFamily: T.fontMono,
                padding: '1px 6px',
                borderRadius: 8,
                background: tab === t.key ? T.accent : T.faint2,
                color: tab === t.key ? '#fff' : T.ink3,
                fontWeight: 700,
                minWidth: 18,
                textAlign: 'center',
              }}>{t.count}</span>
            </div>
          ))}
        </div>

        {/* Filtros */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#fbf9f1', borderBottom: `1px solid ${T.faint2}`, fontSize: 11 }}>
          <span style={{ fontFamily: T.fontMono, color: T.ink3, letterSpacing: 1, fontWeight: 700, textTransform: 'uppercase', fontSize: 9.5 }}>Filtros</span>
          <select value={filtroPrio} onChange={e => setFiltroPrio(e.target.value)}
            style={{ padding: '4px 8px', border: `1px solid ${T.faint2}`, borderRadius: 4, fontFamily: T.font, fontSize: 11, background: T.paper, outline: 'none' }}>
            <option value="">Todas las prioridades</option>
            {PRIORIDADES.map(p => <option key={p} value={p}>{PRIO_LABEL[p]}</option>)}
          </select>
          <select value={filtroObra} onChange={e => setFiltroObra(e.target.value)}
            style={{ padding: '4px 8px', border: `1px solid ${T.faint2}`, borderRadius: 4, fontFamily: T.font, fontSize: 11, background: T.paper, outline: 'none', maxWidth: 220 }}>
            <option value="">Todas las obras</option>
            <option value="sin-obra">Sin obra</option>
            {obras.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
          </select>
          <div style={{ flex: 1 }} />
          <span style={{ color: T.ink3, fontSize: 10 }}>
            {tareasVisibles.length} tarea{tareasVisibles.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Header de tabla */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 14px', background: T.dark, color: '#fff', fontSize: 9.5, fontFamily: T.fontMono, letterSpacing: 1.2 }}>
          <div style={{ width: 4, flexShrink: 0 }} />
          <div style={{ width: 14, flexShrink: 0 }} />
          <div style={{ flex: 3 }}>TAREA</div>
          <div style={{ flex: 1.5 }}>ASIGNADOS</div>
          <div style={{ flex: 1.3 }}>OBRA</div>
          <div style={{ width: 110, textAlign: 'left' }}>PROGRESO</div>
          <div style={{ width: 90, textAlign: 'right' }}>VENCE</div>
          <div style={{ width: 100, textAlign: 'center' }}>ESTADO</div>
        </div>

        {/* Lista */}
        {tareasVisibles.length === 0 ? (
          <div style={{ padding: '40px 14px', textAlign: 'center', color: T.ink3, fontSize: 12 }}>
            No hay tareas en esta vista.
          </div>
        ) : (
          tareasVisibles.map(t => (
            <TareaRow
              key={t.id}
              tarea={t}
              currentUser={currentUser}
              usuarios={usuarios}
              obras={obras}
              expanded={expandedId === t.id}
              onToggleExpand={() => setExpandedId(expandedId === t.id ? null : t.id)}
              onEdit={() => setEditingId(t.id)}
              toggleItem={toggleItem}
              addItem={addItem}
            />
          ))
        )}
      </Box>

      {editingId && (
        <TareaModal
          tareaId={editingId === 'nueva' ? null : editingId}
          onClose={() => setEditingId(null)}
        />
      )}
    </PageLayout>
  );
}
