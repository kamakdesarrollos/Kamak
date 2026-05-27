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

function TareaRow({ tarea, currentUser, usuarios, obras, onClick }) {
  const asignados = (tarea.asignadoA || []).map(uid => usuarios.find(u => u.id === uid)?.nombre || '?').join(', ');
  const obra = obras.find(o => o.id === tarea.obraId);
  const totalItems = (tarea.checklist || []).length;
  const completos = (tarea.checklist || []).filter(i => i.completado).length;
  const vencida = isVencida(tarea.fechaLimite, tarea.estado);
  const esNueva = currentUser
    && (tarea.asignadoA || []).includes(currentUser.id)
    && !(tarea.vistaPor || []).includes(currentUser.id);

  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 14px',
        borderBottom: `1px solid ${T.faint2}`,
        cursor: 'pointer',
        background: esNueva ? '#fff7ed' : 'transparent',
      }}
      onMouseEnter={e => e.currentTarget.style.background = '#f3eedf'}
      onMouseLeave={e => e.currentTarget.style.background = esNueva ? '#fff7ed' : 'transparent'}
    >
      {/* Indicador prioridad */}
      <div style={{
        width: 4,
        height: 32,
        background: PRIO_COLOR[tarea.prioridad] || T.ink3,
        borderRadius: 2,
        flexShrink: 0,
      }} />

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

      {/* Checklist progress */}
      <div style={{ width: 80, fontSize: 11, fontFamily: T.fontMono, color: T.ink2, textAlign: 'right' }}>
        {totalItems > 0 ? `${completos}/${totalItems}` : '—'}
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
  );
}

export default function Tareas() {
  const { currentUser, usuarios } = useUsuarios();
  const { obras } = useObras();
  const { tareas, marcarVista } = useTareas();
  const [searchParams, setSearchParams] = useSearchParams();

  const isAdmin = currentUser?.rol === 'Admin';
  const [tab, setTab] = useState('mias');           // mias | creadas | completadas | todas
  const [filtroPrio, setFiltroPrio] = useState(''); // '' | baja | media | alta
  const [filtroObra, setFiltroObra] = useState(''); // '' | obraId | 'sin-obra'
  const [editingId, setEditingId] = useState(null); // null | 'nueva' | tareaId

  // Abrir tarea desde notificacion in-app: /tareas?id=tarea-xyz
  useEffect(() => {
    const qid = searchParams.get('id');
    if (qid) {
      setEditingId(qid);
      // limpiar query param para no reabrir el modal en cada navegacion
      const next = new URLSearchParams(searchParams);
      next.delete('id');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Marcar como vista cuando se abre el modal de detalle.
  useEffect(() => {
    if (editingId && editingId !== 'nueva' && currentUser) {
      marcarVista(editingId, currentUser.id);
    }
  }, [editingId, currentUser, marcarVista]);

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
    return [
      { label: 'Mis pendientes', value: mias.length },
      { label: 'En progreso', value: enProgreso.length, color: '#d97706' },
      { label: 'Vencidas', value: vencidas.length, color: vencidas.length > 0 ? '#dc2626' : T.ink },
      { label: 'Completadas (mias)', value: completadasMias.length, color: T.ok },
    ];
  }, [tareas, currentUser]);

  const tabs = useMemo(() => {
    const base = [
      { key: 'mias', label: 'Mis tareas' },
      { key: 'creadas', label: 'Creadas por mí' },
      { key: 'completadas', label: 'Completadas' },
    ];
    if (isAdmin) base.splice(2, 0, { key: 'todas', label: 'Todas' });
    return base;
  }, [isAdmin]);

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
              onClick={() => setTab(t.key)}
              style={{
                padding: '10px 14px',
                fontSize: 12,
                fontWeight: tab === t.key ? 700 : 500,
                color: tab === t.key ? T.accent : T.ink2,
                borderBottom: tab === t.key ? `2px solid ${T.accent}` : '2px solid transparent',
                cursor: 'pointer',
                marginBottom: -1.5,
                transition: 'color 0.15s',
              }}
            >
              {t.label}
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
          <div style={{ flex: 3 }}>TAREA</div>
          <div style={{ flex: 1.5 }}>ASIGNADOS</div>
          <div style={{ flex: 1.3 }}>OBRA</div>
          <div style={{ width: 80, textAlign: 'right' }}>CHECKLIST</div>
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
              onClick={() => setEditingId(t.id)}
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
