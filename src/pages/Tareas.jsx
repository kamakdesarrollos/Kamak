import { useState, useMemo, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import PageLayout from '../components/layout/PageLayout';
import { Box, Btn } from '../components/ui';
import PageHero from '../components/ui/PageHero';
import { T } from '../theme';
import { useUsuarios } from '../store/UsuariosContext';
import { useObras } from '../store/ObrasContext';
import { useTareas } from '../store/TareasContext';
import { supabase } from '../lib/supabase';
import TareaModal from './modales/TareaModal';
import { useIsMobile } from '../hooks/useMediaQuery';

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

// Fecha+hora corta para los comentarios (DD/MM HH:mm).
const fmtFechaHora = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// Una tarea "le toca" a un usuario si está asignado a la tarea O es responsable
// de algún ítem del checklist. Así, asignarle un ítem a alguien hace aparecer la
// tarea en su panel (aunque no sea de los asignados a la tarea entera).
const tocaAlUsuario = (t, uid) =>
  !!uid && ((t.asignadoA || []).includes(uid) || (t.checklist || []).some(it => it.asignadoA === uid));

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

// Adjuntos (docs/fotos) de una tarea: subida multi-archivo al bucket kamak-fotos
// (path tareas/<id>/...) + lista con link. El borrado quita solo la referencia
// (no borra del Storage), igual que en Documentos de obra.
function AdjuntosTarea({ tarea, currentUser, addAdjunto, removeAdjunto }) {
  const fileRef = useRef(null);
  const [subiendo, setSubiendo] = useState(false);
  const adjuntos = tarea.adjuntos || [];

  const onFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setSubiendo(true);
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const ext = f.name.split('.').pop();
      const path = `tareas/${tarea.id}/${Date.now()}-${i}.${ext}`;
      const { error } = await supabase.storage.from('kamak-fotos').upload(path, f, { upsert: true });
      if (error) { window.alert(`No se pudo subir "${f.name}": ${error.message}`); continue; }
      const url = supabase.storage.from('kamak-fotos').getPublicUrl(path).data.publicUrl;
      addAdjunto(tarea.id, { nombre: f.name, url, tipo: f.type || '', subidoPor: currentUser?.id });
    }
    setSubiendo(false);
  };

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontFamily: T.fontMono, fontSize: 9.5, letterSpacing: 1, color: T.ink3, fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>
        ◆ Adjuntos{adjuntos.length ? ` (${adjuntos.length})` : ''}
      </div>
      {adjuntos.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
          {adjuntos.map(a => {
            const esImg = (a.tipo || '').startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(a.nombre || '');
            return (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, background: T.paper, border: `1px solid ${T.faint2}`, borderRadius: 4, padding: '5px 8px' }}>
                <span style={{ flexShrink: 0 }}>{esImg ? '🖼️' : '📄'}</span>
                <a href={a.url} target="_blank" rel="noreferrer" style={{ flex: 1, color: T.accent, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.nombre}</a>
                <span onClick={() => removeAdjunto(tarea.id, a.id)} role="button" title="Quitar adjunto" style={{ cursor: 'pointer', color: T.ink3, fontSize: 12, flexShrink: 0 }}>🗑</span>
              </div>
            );
          })}
        </div>
      )}
      <input ref={fileRef} type="file" multiple style={{ display: 'none' }} onChange={onFiles} />
      <Btn sm onClick={() => fileRef.current?.click()} disabled={subiendo}>{subiendo ? 'Subiendo…' : '📎 Adjuntar archivos'}</Btn>
    </div>
  );
}

function TareaRow({ tarea, currentUser, usuarios, obras, expanded, onToggleExpand, onEdit, toggleItem, addItem, addComentario, setItemObservacion, setItemTexto, setItemAsignado, addAdjunto, removeAdjunto, isAdmin, solapaUserId }) {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const asignados = (tarea.asignadoA || []).map(uid => usuarios.find(u => u.id === uid)?.nombre || '?').join(', ');
  const obra = obras.find(o => o.id === tarea.obraId);
  // Al hacer clic en la obra, llevar a su detalle. Si la tarea es de armar
  // contratos (origen 'auto-contratos'), abrir directo la pestaña Contratos MO
  // (tab=6); el resto, al detalle de la obra sin tab forzado.
  const irAObra = (e) => {
    if (!obra) return;
    e.stopPropagation();
    const qs = tarea.origen === 'auto-contratos' ? '?tab=6' : '';
    navigate(`/obras/${obra.id}/presupuesto${qs}`);
  };
  // Gestiona el checklist (ve TODO + asigna ítems a otros + agrega ítems): el
  // admin o quien CREÓ la tarea (el que delega). Los demás (los que reciben un
  // ítem) ven SOLO sus ítems.
  const puedeGestionar = isAdmin || (!!currentUser && tarea.creadoPor === currentUser.id);
  const checklistVisible = puedeGestionar
    ? (tarea.checklist || [])
    : (tarea.checklist || []).filter(it => it.asignadoA === currentUser?.id);
  const totalItems = checklistVisible.length;
  const completos = checklistVisible.filter(i => i.completado).length;
  const vencida = isVencida(tarea.fechaLimite, tarea.estado);
  const esNueva = currentUser
    && tocaAlUsuario(tarea, currentUser.id)
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

  const [nuevoCom, setNuevoCom] = useState('');
  const handleAddCom = () => {
    const txt = nuevoCom.trim();
    if (!txt) return;
    addComentario(tarea.id, currentUser?.id, txt);
    setNuevoCom('');
  };

  // Observación en edición (qué ítem del checklist + borrador del texto).
  const [obsEditId, setObsEditId] = useState(null);
  const [obsDraft, setObsDraft] = useState('');

  // Edición del texto de un ítem del checklist.
  const [textoEditId, setTextoEditId] = useState(null);
  const [textoDraft, setTextoDraft] = useState('');

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
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
            {(tarea.comentarios || []).length > 0 && (
              <span style={{ color: T.ink3, fontSize: 10, fontFamily: T.fontMono, flexShrink: 0 }} title={`${tarea.comentarios.length} comentario(s)`}>
                💬 {tarea.comentarios.length}
              </span>
            )}
            {(tarea.adjuntos || []).length > 0 && (
              <span style={{ color: T.ink3, fontSize: 10, fontFamily: T.fontMono, flexShrink: 0 }} title={`${tarea.adjuntos.length} adjunto(s)`}>
                📎 {tarea.adjuntos.length}
              </span>
            )}
          </div>
          {tarea.descripcion && (
            <div style={{ fontSize: 11, color: T.ink2, marginTop: 2, overflow: 'hidden', textOverflow: isMobile ? 'unset' : 'ellipsis', whiteSpace: isMobile ? 'normal' : 'nowrap', lineHeight: isMobile ? 1.3 : 1 }}>
              {tarea.descripcion}
            </div>
          )}
        </div>

        {/* Asignados */}
        <div style={{ flex: 1.5, fontSize: 11, color: T.ink2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={asignados}>
          {asignados || '—'}
        </div>

        {/* Obra (linkea al detalle de la obra; las tareas de contratos abren la pestaña Contratos MO) */}
        <div style={{ flex: 1.3, fontSize: 11, color: T.ink2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {obra
            ? <span onClick={irAObra} title={`Ir a ${obra.nombre}`} style={{ color: T.accent, cursor: 'pointer', fontWeight: 600 }}>{obra.nombre}</span>
            : <span style={{ color: T.ink3 }}>—</span>}
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
              {puedeGestionar ? 'Sin ítems. Agregá uno abajo.' : 'No tenés ítems asignados en esta tarea.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {checklistVisible.map(it => {
                const completadoPor = it.completadoPor ? usuarios.find(u => u.id === it.completadoPor)?.nombre : null;
                const editandoObs = obsEditId === it.id;
                const guardarObs = () => { setItemObservacion(tarea.id, it.id, obsDraft.trim()); setObsEditId(null); };
                const editandoTexto = textoEditId === it.id;
                const guardarTexto = () => {
                  const t2 = textoDraft.trim();
                  if (t2) setItemTexto(tarea.id, it.id, t2);
                  setTextoEditId(null);
                };
                return (
                  <div
                    key={it.id}
                    style={{
                      padding: '5px 8px',
                      borderRadius: 4,
                      background: it.completado ? '#ecfdf5' : T.paper,
                      border: `1px solid ${it.completado ? '#bbf7d0' : T.faint2}`,
                      transition: 'background 0.1s',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <input
                        type="checkbox"
                        checked={!!it.completado}
                        onChange={() => toggleItem(tarea.id, it.id, currentUser?.id)}
                        style={{ cursor: 'pointer', accentColor: '#059669' }}
                      />
                      {editandoTexto ? (
                        <input
                          type="text"
                          autoFocus
                          value={textoDraft}
                          onChange={e => setTextoDraft(e.target.value)}
                          onClick={e => e.stopPropagation()}
                          onBlur={e => { e.stopPropagation(); guardarTexto(); }}
                          onKeyDown={e => {
                            e.stopPropagation();
                            if (e.key === 'Enter') { e.preventDefault(); guardarTexto(); }
                            if (e.key === 'Escape') setTextoEditId(null);
                          }}
                          style={{ flex: 1, padding: '2px 6px', fontSize: 12, border: `1px solid ${T.accent}`, borderRadius: 4, fontFamily: T.font, background: T.paper, outline: 'none', minWidth: 0 }}
                        />
                      ) : (
                        <span
                          onClick={() => toggleItem(tarea.id, it.id, currentUser?.id)}
                          style={{
                            fontSize: 12,
                            color: it.completado ? T.ink3 : T.ink,
                            textDecoration: it.completado ? 'line-through' : 'none',
                            flex: 1,
                            minWidth: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: isMobile ? 'normal' : 'nowrap',
                            cursor: 'pointer',
                          }}
                        >
                          {it.texto}
                        </span>
                      )}
                      {/* El responsable es para repartir trabajo PENDIENTE; en un
                          ítem ya completado solo importa el "✓ quién lo hizo".
                          Solo el gestor (admin o creador) reparte; el que recibe no. */}
                      {!it.completado && puedeGestionar && (
                        <select
                          value={it.asignadoA || ''}
                          onChange={e => setItemAsignado(tarea.id, it.id, e.target.value || null)}
                          title="Responsable de este ítem"
                          style={{ fontSize: 10, padding: '1px 3px', border: `1px solid ${it.asignadoA ? '#a5b4fc' : T.faint2}`, borderRadius: 3, background: it.asignadoA ? '#eef2ff' : T.paper, color: it.asignadoA ? '#3949ab' : T.ink3, maxWidth: isMobile ? 70 : 100, flexShrink: 0, cursor: 'pointer' }}
                        >
                          <option value="">— responsable</option>
                          {usuarios.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                        </select>
                      )}
                      {completadoPor && (
                        <span style={{ fontSize: 9.5, color: T.ink3, fontFamily: T.fontMono }} title="Completó">
                          ✓ {completadoPor}
                        </span>
                      )}
                      {puedeGestionar && (
                        <span
                          onClick={e => { e.stopPropagation(); setTextoEditId(it.id); setTextoDraft(it.texto || ''); }}
                          title="Editar texto del ítem"
                          style={{ fontSize: 11, cursor: 'pointer', opacity: 0.4, flexShrink: 0, lineHeight: 1 }}
                        >✏️</span>
                      )}
                      <span
                        onClick={() => { setObsEditId(it.id); setObsDraft(it.observacion || ''); }}
                        title={it.observacion ? 'Editar observación' : 'Agregar observación'}
                        style={{ fontSize: 12, cursor: 'pointer', opacity: it.observacion ? 1 : 0.4, flexShrink: 0 }}
                      >📝</span>
                    </div>

                    {(editandoObs || it.observacion) && (
                      <div style={{ paddingLeft: 26, marginTop: 4 }}>
                        {editandoObs ? (
                          <input
                            type="text"
                            autoFocus
                            value={obsDraft}
                            onChange={e => setObsDraft(e.target.value)}
                            onBlur={guardarObs}
                            onKeyDown={e => {
                              if (e.key === 'Enter') { e.preventDefault(); guardarObs(); }
                              if (e.key === 'Escape') setObsEditId(null);
                            }}
                            placeholder="Observación…"
                            style={{ width: '100%', padding: '4px 7px', fontSize: 11, border: `1px solid ${T.accent}`, borderRadius: 4, fontFamily: T.font, background: T.paper, outline: 'none' }}
                          />
                        ) : (
                          <div
                            onClick={() => { setObsEditId(it.id); setObsDraft(it.observacion || ''); }}
                            style={{ fontSize: 11, color: T.ink2, fontStyle: 'italic', cursor: 'text', whiteSpace: 'pre-wrap', lineHeight: 1.35 }}
                          >
                            📝 {it.observacion}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Agregar ítem rápido (solo el gestor —admin o creador— arma el checklist). */}
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            {puedeGestionar && (
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
            )}
            <Btn sm onClick={onEdit}>{puedeGestionar ? 'Editar tarea' : 'Ver tarea'}</Btn>
          </div>

          {/* Comentarios — visibles sin entrar a editar (+ agregar inline). */}
          <div style={{ marginTop: 14 }}>
            <div style={{ fontFamily: T.fontMono, fontSize: 9.5, letterSpacing: 1, color: T.ink3, fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>
              ◆ Comentarios{(tarea.comentarios || []).length ? ` (${tarea.comentarios.length})` : ''}
            </div>
            {(tarea.comentarios || []).length === 0 ? (
              <div style={{ fontSize: 11, color: T.ink3, fontStyle: 'italic', padding: '2px 0' }}>Sin comentarios todavía.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(tarea.comentarios || []).map(c => {
                  const autor = usuarios.find(u => u.id === c.userId)?.nombre || '?';
                  return (
                    <div key={c.id} style={{ fontSize: 12, background: T.paper, border: `1px solid ${T.faint2}`, borderRadius: 4, padding: '6px 8px' }}>
                      <div style={{ fontSize: 9.5, color: T.ink3, fontFamily: T.fontMono, marginBottom: 2, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ fontWeight: 700, color: T.ink2 }}>{autor}</span>
                        <span>{fmtFechaHora(c.creadoAt)}</span>
                      </div>
                      <div style={{ color: T.ink, whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>{c.texto}</div>
                    </div>
                  );
                })}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <input
                type="text"
                value={nuevoCom}
                onChange={e => setNuevoCom(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddCom(); } }}
                placeholder="+ Comentario y presionar Enter"
                style={{ flex: 1, padding: '5px 8px', fontSize: 11, border: `1px solid ${T.faint2}`, borderRadius: 4, fontFamily: T.font, background: T.paper, outline: 'none' }}
              />
            </div>
          </div>

          <AdjuntosTarea tarea={tarea} currentUser={currentUser} addAdjunto={addAdjunto} removeAdjunto={removeAdjunto} />
        </div>
      )}
    </div>
  );
}

export default function Tareas() {
  const { currentUser, usuarios } = useUsuarios();
  const { obras } = useObras();
  const { tareas, marcarVista, toggleItem, addItem, addComentario, setItemObservacion, setItemTexto, setItemAsignado, addAdjunto, removeAdjunto } = useTareas();
  const isMobile = useIsMobile();
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
      if (!isAdmin) base = base.filter(t => tocaAlUsuario(t, currentUser.id) || t.creadoPor === currentUser.id);
    } else {
      // Solapa de un usuario: sus tareas activas (asignada a él, o responsable de algún ítem).
      base = tareas.filter(t => tocaAlUsuario(t, tab) && activa(t));
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

  // Agrupado por OBRA dentro de la solapa (persona). El orden de los grupos sigue
  // la urgencia (la obra aparece según su tarea más urgente); "Sin obra" al final.
  const grupos = useMemo(() => {
    const map = new Map();
    for (const t of tareasVisibles) {
      const k = t.obraId || '__sin__';
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(t);
    }
    const arr = [...map.entries()].map(([k, items]) => ({
      key: k,
      obraNombre: k === '__sin__' ? 'Sin obra' : (obras.find(o => o.id === k)?.nombre || 'Obra'),
      items,
    }));
    arr.sort((a, b) => (a.key === '__sin__' ? 1 : 0) - (b.key === '__sin__' ? 1 : 0));
    return arr;
  }, [tareasVisibles, obras]);

  // KPIs del usuario de la solapa activa (en 'Completadas', del usuario actual).
  const kpiUserId = tab === 'completadas' ? currentUser?.id : tab;
  const kpis = useMemo(() => {
    if (!currentUser) return [];
    const suyas = tareas.filter(t => tocaAlUsuario(t, kpiUserId) && activa(t));
    const vencidas = suyas.filter(t => isVencida(t.fechaLimite, t.estado));
    const enProgreso = suyas.filter(t => t.estado === 'en_progreso');
    const completadas = tareas.filter(t => tocaAlUsuario(t, kpiUserId) && t.estado === 'completada');
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
      count: tareas.filter(t => tocaAlUsuario(t, u.id) && activa(t)).length,
    }));
    const completadasCount = tareas.filter(t => {
      if (activa(t)) return false;
      return isAdmin || tocaAlUsuario(t, currentUser?.id) || t.creadoPor === currentUser?.id;
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#fbf9f1', borderBottom: `1px solid ${T.faint2}`, fontSize: 11, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: T.fontMono, color: T.ink3, letterSpacing: 1, fontWeight: 700, textTransform: 'uppercase', fontSize: 9.5 }}>Filtros</span>
          <select value={filtroPrio} onChange={e => setFiltroPrio(e.target.value)}
            style={{ padding: '4px 8px', border: `1px solid ${T.faint2}`, borderRadius: 4, fontFamily: T.font, fontSize: 11, background: T.paper, outline: 'none' }}>
            <option value="">Todas las prioridades</option>
            {PRIORIDADES.map(p => <option key={p} value={p}>{PRIO_LABEL[p]}</option>)}
          </select>
          <select value={filtroObra} onChange={e => setFiltroObra(e.target.value)}
            style={{ padding: '4px 8px', border: `1px solid ${T.faint2}`, borderRadius: 4, fontFamily: T.font, fontSize: 11, background: T.paper, outline: 'none', maxWidth: isMobile ? '90%' : 220 }}>
            <option value="">Todas las obras</option>
            <option value="sin-obra">Sin obra</option>
            {obras.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
          </select>
          <div style={{ flex: 1 }} />
          <span style={{ color: T.ink3, fontSize: 10 }}>
            {tareasVisibles.length} tarea{tareasVisibles.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Header de tabla + lista — scroll horizontal en mobile */}
        <div style={{ overflowX: isMobile ? 'auto' : 'visible', WebkitOverflowScrolling: 'touch' }}>
          <div style={{ minWidth: isMobile ? 640 : 'auto' }}>
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
              grupos.map(g => (
                <div key={g.key}>
                  {/* Banda de la obra (agrupado por obra dentro de la solapa) */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px', background: '#f3efe2', borderTop: `1px solid ${T.faint2}`, borderBottom: `1px solid ${T.faint2}` }}>
                    <span style={{ fontSize: 12 }}>🏗️</span>
                    <span style={{ fontSize: 11, fontWeight: 800, color: T.ink, textTransform: 'uppercase', letterSpacing: 0.4 }}>{g.obraNombre}</span>
                    <span style={{ fontSize: 9.5, fontFamily: T.fontMono, color: T.ink3, fontWeight: 700, background: T.faint2, borderRadius: 8, padding: '1px 6px' }}>{g.items.length}</span>
                  </div>
                  {g.items.map(t => (
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
                      addComentario={addComentario}
                      setItemObservacion={setItemObservacion}
                      setItemTexto={setItemTexto}
                      setItemAsignado={setItemAsignado}
                      addAdjunto={addAdjunto}
                      removeAdjunto={removeAdjunto}
                      isAdmin={isAdmin}
                    />
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
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
