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

function TareaRow({ tarea, currentUser, usuarios, obras, expanded, onToggleExpand, onEdit, toggleItem, addItem, solapaUserId }) {
  const asignados = (tarea.asignadoA || []).map(uid => usuarios.find(u => u.id === uid)?.nombre || '?').join(', ');
  const obra = obras.find(o => o.id === tarea.obraId);
  const totalItems = (tarea.checklist || []).length;
  const completos = (tarea.checklist || []).filter(i => i.completado).length;
  const vencida = isVencida(tarea.fechaLimite, tarea.estado);
  const esNueva = currentUser
    && (tarea.asignadoA || []).includes(currentUser.id)
    && !(tarea.vistaPor || []).includes(currentUser.id);
  // En la solapa de un usuario, una tarea "agregada por otro" = la creó alguien
  // distinto al dueño de la solapa (ej. el Admin se la asignó). Se pinta distinto.
  const agregadaPorOtro = !!solapaUserId && !!tarea.creadoPor && tarea.creadoPor !== solapaUserId;
  const creador = agregadaPorOtro ? (usuarios.find(u => u.id === tarea.creadoPor)?.nombre || 'otro') : null;
  const baseBg = esNueva ? '#fff7ed' : agregadaPorOtro ? '#eef4ff' : 'transparent';
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
          background: expanded ? '#f3eedf' : baseBg,
          borderLeft: agregadaPorOtro ? '3px solid #6366f1' : '3px solid transparent',
          transition: 'background 0.1s',
        }}
        onMouseEnter={e => { if (!expanded) e.currentTarget.style.background = '#f7f3e5'; }}
        onMouseLeave={e => { if (!expanded) e.currentTarget.style.background = baseBg; }}
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
            {agregadaPorOtro && (
              <span style={{ background: '#6366f1', color: '#fff', fontSize: 8.5, padding: '1px 5px', borderRadius: 8, fontWeight: 700, letterSpacing: 0.3, flexShrink: 0 }} title={`Asignada por ${creador}`}>
                ↦ {creador}
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
  // Solapa activa: id de usuario (sus tareas) o 'completadas'. No-admin solo ve la suya.
  const [tab, setTab] = useState('');
  const [filtroPrio, setFiltroPrio] = useState('');
  const [filtroObra, setFiltroObra] = useState('');
  const [editingId, setEditingId] = useState(null); // null | 'nueva' | tareaId
  const [nuevaParaUser, setNuevaParaUser] = useState(null); // preasignar al crear desde una solapa
  const [expandedId, setExpandedId] = useState(null); // tarea expandida inline

  // Default = mi solapa; si un no-admin tuviera seleccionada una ajena, lo reseteo.
  useEffect(() => {
    if (!currentUser) return;
    if (!tab) { setTab(currentUser.id); return; }
    if (!isAdmin && tab !== 'completadas' && tab !== currentUser.id) setTab(currentUser.id);
  }, [currentUser, isAdmin, tab]);

  const activa = (t) => t.estado !== 'completada' && t.estado !== 'cancelada';

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
    let base;
    if (tab === 'completadas') {
      base = tareas.filter(t => !activa(t));
      if (!isAdmin) base = base.filter(t => (t.asignadoA || []).includes(currentUser.id) || t.creadoPor === currentUser.id);
    } else {
      // Solapa de un usuario: sus tareas activas (asignadas a él).
      base = tareas.filter(t => (t.asignadoA || []).includes(tab) && activa(t));
    }
    if (filtroPrio) base = base.filter(t => t.prioridad === filtroPrio);
    if (filtroObra === 'sin-obra') base = base.filter(t => !t.obraId);
    else if (filtroObra) base = base.filter(t => t.obraId === filtroObra);

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

  // KPIs del usuario de la solapa activa (en 'Completadas', del usuario actual).
  const kpiUserId = tab === 'completadas' ? currentUser?.id : tab;
  const kpis = useMemo(() => {
    if (!currentUser) return [];
    const suyas = tareas.filter(t => (t.asignadoA || []).includes(kpiUserId) && activa(t));
    const vencidas = suyas.filter(t => isVencida(t.fechaLimite, t.estado));
    const enProgreso = suyas.filter(t => t.estado === 'en_progreso');
    const completadas = tareas.filter(t => (t.asignadoA || []).includes(kpiUserId) && t.estado === 'completada');
    return [
      { label: 'Pendientes',  value: suyas.length,      color: T.accent },
      { label: 'En progreso', value: enProgreso.length, color: '#d97706' },
      { label: 'Vencidas',    value: vencidas.length,   color: vencidas.length > 0 ? '#dc2626' : T.ink },
      { label: 'Completadas', value: completadas.length, color: T.ok },
    ];
  }, [tareas, currentUser, kpiUserId]);

  // Solapas: admin = una por usuario + Completadas; no-admin = solo la suya + Completadas.
  const tabs = useMemo(() => {
    const usuariosSolapa = isAdmin ? usuarios : (currentUser ? [currentUser] : []);
    const userTabs = usuariosSolapa.map(u => ({
      key: u.id,
      label: u.id === currentUser?.id ? 'Mis tareas' : u.nombre,
      count: tareas.filter(t => (t.asignadoA || []).includes(u.id) && activa(t)).length,
    }));
    const completadasCount = tareas.filter(t => {
      if (activa(t)) return false;
      return isAdmin || (t.asignadoA || []).includes(currentUser?.id) || t.creadoPor === currentUser?.id;
    }).length;
    return [...userTabs, { key: 'completadas', label: 'Completadas', count: completadasCount }];
  }, [tareas, usuarios, isAdmin, currentUser]);

  // Al cambiar de solapa, limpiar filtros.
  const cambiarTab = (newTab) => { setTab(newTab); setFiltroPrio(''); setFiltroObra(''); };

  // "+ Nueva tarea" desde la solapa actual → queda asignada a ese usuario.
  const crearEnSolapa = () => {
    setNuevaParaUser(tab === 'completadas' ? (currentUser?.id || null) : tab);
    setEditingId('nueva');
  };
  const solapaEsUsuario = tab !== 'completadas';

  return (
    <PageLayout active="Tareas">
      <PageHero
        label="GESTIÓN DE TAREAS"
        title="Tareas"
        subtitle={isAdmin ? 'Una solapa por usuario — entrá a una y cargá tareas (quedan asignadas a esa persona)' : 'Tus tareas asignadas'}
        kpis={kpis}
        actions={solapaEsUsuario ? <Btn sm accent onClick={crearEnSolapa}>+ Nueva tarea{isAdmin && tab !== currentUser?.id ? ` · ${usuarios.find(u => u.id === tab)?.nombre || ''}` : ''}</Btn> : null}
      />

      <Box style={{ padding: 0, overflow: 'hidden' }}>
        {/* Solapas por usuario */}
        <div style={{ display: 'flex', borderBottom: `1.5px solid ${T.faint2}`, padding: '0 14px', gap: 0, overflowX: 'auto' }}>
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
              solapaUserId={solapaEsUsuario ? tab : null}
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
          presetAsignado={editingId === 'nueva' && nuevaParaUser ? [nuevaParaUser] : null}
          onClose={() => { setEditingId(null); setNuevaParaUser(null); }}
        />
      )}
    </PageLayout>
  );
}
