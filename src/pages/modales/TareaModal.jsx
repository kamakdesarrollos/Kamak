import { useState, useMemo, useEffect } from 'react';
import { Btn } from '../../components/ui';
import { T } from '../../theme';
import { useUsuarios } from '../../store/UsuariosContext';
import { useObras } from '../../store/ObrasContext';
import { useTareas } from '../../store/TareasContext';

// Modal único para crear / ver / editar una tarea.
//
// Permisos:
// - Admin: puede crear, editar campos, asignar a cualquiera, eliminar.
// - Creador (no admin): puede editar la tarea y eliminarla.
// - Asignado: puede ver y completar items del checklist, agregar comentarios.
//   NO puede editar titulo / descripcion / asignados.
// - Otros usuarios: solo lectura (caso raro: si alguien comparte un link
//   a /tareas?id=X y la tarea no es suya).
//
// Auto-asignacion: un usuario no-admin que crea una tarea queda asignado a
// si mismo automaticamente. Si quiere crear para otro, debe ser admin.

const inputSt = { padding: '7px 10px', border: `1.2px solid ${T.faint2}`, borderRadius: 4, fontFamily: T.font, fontSize: 12, background: T.paper, outline: 'none', width: '100%', boxSizing: 'border-box' };
const labelSt = { fontSize: 9.5, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 700, marginBottom: 4, display: 'block', fontFamily: T.fontMono };

const PRIORIDADES = [
  { value: 'baja', label: 'Baja', color: T.ink3 },
  { value: 'media', label: 'Media', color: '#d97706' },
  { value: 'alta', label: 'Alta', color: '#dc2626' },
];

const fmtDatetime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) + ' · ' +
    d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
};

export default function TareaModal({ tareaId, presetAsignado, onClose }) {
  const { currentUser, usuarios } = useUsuarios();
  const { obras } = useObras();
  const {
    tareas,
    addTarea,
    updateTarea,
    deleteTarea,
    toggleItem,
    addItem,
    removeItem,
    addComentario,
  } = useTareas();

  const esNueva = !tareaId;
  const tareaActual = useMemo(() => tareas.find(t => t.id === tareaId), [tareas, tareaId]);

  const isAdmin = currentUser?.rol === 'Admin';
  const esCreador = !!tareaActual && tareaActual.creadoPor === currentUser?.id;
  const esAsignado = !!tareaActual && (tareaActual.asignadoA || []).includes(currentUser?.id);
  const puedeEditarCampos = esNueva || isAdmin || esCreador;
  const puedeAsignarAOtros = isAdmin;

  // Estado del form (solo se usa en modo nueva / edicion).
  const [titulo, setTitulo] = useState(tareaActual?.titulo || '');
  const [descripcion, setDescripcion] = useState(tareaActual?.descripcion || '');
  const [asignadoA, setAsignadoA] = useState(
    tareaActual?.asignadoA?.length ? tareaActual.asignadoA
      : (presetAsignado?.length ? presetAsignado : (currentUser ? [currentUser.id] : []))
  );
  const [obraId, setObraId] = useState(tareaActual?.obraId || '');
  const [prioridad, setPrioridad] = useState(tareaActual?.prioridad || 'media');
  const [fechaLimite, setFechaLimite] = useState(tareaActual?.fechaLimite || '');
  const [checklistDraft, setChecklistDraft] = useState(
    tareaActual?.checklist?.length ? null : [] // null = ya hay items en la tarea, los toco directo
  );
  const [nuevoItemTexto, setNuevoItemTexto] = useState('');
  const [nuevoComentario, setNuevoComentario] = useState('');

  // Si entran a una tarea existente, sincronizar form si cambia desde fuera.
  useEffect(() => {
    if (tareaActual) {
      setTitulo(tareaActual.titulo || '');
      setDescripcion(tareaActual.descripcion || '');
      setAsignadoA(tareaActual.asignadoA || []);
      setObraId(tareaActual.obraId || '');
      setPrioridad(tareaActual.prioridad || 'media');
      setFechaLimite(tareaActual.fechaLimite || '');
    }
  }, [tareaActual?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!esNueva && !tareaActual) {
    // Posible: el id de la URL no matchea (tarea eliminada).
    return (
      <div className="k-modal-overlay" onClick={onClose}>
        <div className="k-modal" style={{ width: 420 }} onClick={e => e.stopPropagation()}>
          <div style={{ padding: 20, fontSize: 13, color: T.ink2, textAlign: 'center' }}>
            La tarea ya no existe.
          </div>
          <div style={{ padding: '10px 18px', borderTop: `1px solid ${T.faint2}`, textAlign: 'right' }}>
            <Btn sm onClick={onClose}>Cerrar</Btn>
          </div>
        </div>
      </div>
    );
  }

  const toggleAsignado = (uid) => {
    if (!puedeAsignarAOtros && uid !== currentUser?.id) return;
    setAsignadoA(prev => prev.includes(uid) ? prev.filter(x => x !== uid) : [...prev, uid]);
  };

  const agregarItemDraft = () => {
    if (!nuevoItemTexto.trim()) return;
    setChecklistDraft(prev => [...(prev || []), { texto: nuevoItemTexto.trim() }]);
    setNuevoItemTexto('');
  };

  const quitarItemDraft = (idx) => {
    setChecklistDraft(prev => (prev || []).filter((_, i) => i !== idx));
  };

  const guardar = () => {
    if (!titulo.trim()) return;
    if (esNueva) {
      addTarea({
        titulo: titulo.trim(),
        descripcion: descripcion.trim(),
        asignadoA: asignadoA.length ? asignadoA : [currentUser.id],
        creadoPor: currentUser.id,
        obraId: obraId || null,
        prioridad,
        fechaLimite: fechaLimite || null,
        checklist: checklistDraft || [],
      });
    } else {
      updateTarea(tareaId, {
        titulo: titulo.trim(),
        descripcion: descripcion.trim(),
        asignadoA,
        obraId: obraId || null,
        prioridad,
        fechaLimite: fechaLimite || null,
      });
    }
    onClose();
  };

  const eliminar = () => {
    if (!window.confirm('¿Eliminar esta tarea? Esta acción no se puede deshacer.')) return;
    deleteTarea(tareaId);
    onClose();
  };

  const agregarItemDirecto = () => {
    if (!nuevoItemTexto.trim() || esNueva) return;
    addItem(tareaId, nuevoItemTexto.trim());
    setNuevoItemTexto('');
  };

  const agregarComentario = () => {
    if (!nuevoComentario.trim() || esNueva) return;
    addComentario(tareaId, currentUser.id, nuevoComentario.trim());
    setNuevoComentario('');
  };

  const checklistActual = tareaActual?.checklist || [];
  const checklistRender = esNueva ? (checklistDraft || []) : checklistActual;
  const completos = checklistActual.filter(i => i.completado).length;
  const totalItems = checklistActual.length;
  const progresoPct = totalItems > 0 ? Math.round((completos / totalItems) * 100) : 0;

  // Usuarios disponibles para asignar.
  const usuariosOpts = useMemo(() => {
    if (puedeAsignarAOtros) return usuarios;
    // No admin: solo a si mismo.
    return currentUser ? [currentUser] : [];
  }, [usuarios, currentUser, puedeAsignarAOtros]);

  const obrasOpts = useMemo(() => {
    const activas = obras.filter(o => o.estado === 'activa' || o.estado === 'en-presupuesto');
    if (obraId && !activas.find(o => o.id === obraId)) {
      // Si la tarea tiene una obra ya finalizada/archivada, igual la mostramos.
      const existente = obras.find(o => o.id === obraId);
      if (existente) return [...activas, existente];
    }
    return activas;
  }, [obras, obraId]);

  return (
    <div className="k-modal-overlay" onClick={onClose}>
      <div
        className="k-modal"
        style={{ width: 720, maxHeight: '92vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '12px 18px', background: T.dark, color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 9, opacity: 0.6, letterSpacing: 1.5, fontFamily: T.fontMono, fontWeight: 700, marginBottom: 2 }}>
              {esNueva ? 'NUEVA TAREA' : (puedeEditarCampos ? 'EDITAR TAREA' : 'DETALLE DE TAREA')}
            </div>
            <div style={{ fontWeight: 700, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {esNueva ? 'Crear tarea' : (tareaActual?.titulo || 'Tarea')}
            </div>
          </div>
          <span onClick={onClose} style={{ cursor: 'pointer', fontSize: 18, opacity: 0.7, padding: 4 }}>✕</span>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Titulo + descripcion */}
          <div>
            <label style={labelSt}>Título</label>
            <input
              value={titulo}
              onChange={e => setTitulo(e.target.value)}
              disabled={!puedeEditarCampos}
              style={{ ...inputSt, fontSize: 14, fontWeight: 600, opacity: puedeEditarCampos ? 1 : 0.7 }}
              placeholder="Ej: Comprar materiales para la obra"
            />
          </div>
          <div>
            <label style={labelSt}>Descripción (opcional)</label>
            <textarea
              value={descripcion}
              onChange={e => setDescripcion(e.target.value)}
              disabled={!puedeEditarCampos}
              style={{ ...inputSt, minHeight: 60, resize: 'vertical', opacity: puedeEditarCampos ? 1 : 0.7 }}
              placeholder="Detalles, contexto, links, etc."
            />
          </div>

          {/* Asignados + Obra + Prioridad + Fecha */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <label style={labelSt}>
                Asignar a
                {!puedeAsignarAOtros && esNueva && (
                  <span style={{ fontSize: 9, color: T.ink3, marginLeft: 6, textTransform: 'none', letterSpacing: 0 }}>
                    (solo Admin puede asignar a otros)
                  </span>
                )}
              </label>
              <div style={{ border: `1.2px solid ${T.faint2}`, borderRadius: 4, background: T.paper, maxHeight: 120, overflowY: 'auto' }}>
                {usuariosOpts.length === 0 ? (
                  <div style={{ padding: 10, fontSize: 11, color: T.ink3, textAlign: 'center' }}>Sin usuarios</div>
                ) : usuariosOpts.map(u => (
                  <label key={u.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', cursor: puedeEditarCampos ? 'pointer' : 'default', fontSize: 12, opacity: puedeEditarCampos ? 1 : 0.7 }}>
                    <input
                      type="checkbox"
                      checked={asignadoA.includes(u.id)}
                      onChange={() => toggleAsignado(u.id)}
                      disabled={!puedeEditarCampos}
                    />
                    <span>{u.nombre}</span>
                    <span style={{ fontSize: 9.5, color: T.ink3, marginLeft: 'auto' }}>{u.rol}</span>
                  </label>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label style={labelSt}>Obra (opcional)</label>
                <select value={obraId} onChange={e => setObraId(e.target.value)} disabled={!puedeEditarCampos} style={{ ...inputSt, opacity: puedeEditarCampos ? 1 : 0.7 }}>
                  <option value="">Sin obra (tarea general)</option>
                  {obrasOpts.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                </select>
              </div>
              <div>
                <label style={labelSt}>Prioridad</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {PRIORIDADES.map(p => (
                    <button
                      key={p.value}
                      type="button"
                      disabled={!puedeEditarCampos}
                      onClick={() => setPrioridad(p.value)}
                      style={{
                        flex: 1,
                        padding: '6px 4px',
                        border: prioridad === p.value ? `1.5px solid ${p.color}` : `1.2px solid ${T.faint2}`,
                        borderRadius: 4,
                        background: prioridad === p.value ? `${p.color}15` : T.paper,
                        color: prioridad === p.value ? p.color : T.ink2,
                        fontSize: 11,
                        fontWeight: prioridad === p.value ? 700 : 500,
                        cursor: puedeEditarCampos ? 'pointer' : 'default',
                        fontFamily: T.font,
                      }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label style={labelSt}>Fecha límite (opcional)</label>
                <input
                  type="date"
                  value={fechaLimite}
                  onChange={e => setFechaLimite(e.target.value)}
                  disabled={!puedeEditarCampos}
                  style={{ ...inputSt, opacity: puedeEditarCampos ? 1 : 0.7 }}
                />
              </div>
            </div>
          </div>

          {/* Checklist */}
          <div>
            <label style={{ ...labelSt, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <span>Checklist</span>
              {!esNueva && totalItems > 0 && (
                <span style={{ fontSize: 10, color: T.accent, fontWeight: 700, fontFamily: T.fontMono }}>
                  {completos}/{totalItems} · {progresoPct}%
                </span>
              )}
            </label>

            {!esNueva && totalItems > 0 && (
              <div style={{ height: 4, background: T.faint2, borderRadius: 2, overflow: 'hidden', marginBottom: 8 }}>
                <div style={{ width: `${progresoPct}%`, height: '100%', background: T.accent, transition: 'width 0.3s' }} />
              </div>
            )}

            {checklistRender.length === 0 ? (
              <div style={{ fontSize: 11, color: T.ink3, padding: '6px 0', fontStyle: 'italic' }}>
                Sin items. Podés agregar abajo.
              </div>
            ) : (
              <div style={{ border: `1px solid ${T.faint2}`, borderRadius: 4, background: T.paper }}>
                {checklistRender.map((item, idx) => {
                  const itemId = item.id;
                  const puedeMarcar = !esNueva && (esAsignado || esCreador || isAdmin);
                  const puedeBorrar = esNueva || puedeEditarCampos;
                  return (
                    <div key={itemId || idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px', borderBottom: idx < checklistRender.length - 1 ? `1px solid ${T.faint2}` : 'none' }}>
                      <input
                        type="checkbox"
                        checked={!!item.completado}
                        disabled={esNueva || !puedeMarcar}
                        onChange={() => { if (!esNueva && puedeMarcar) toggleItem(tareaId, itemId, currentUser.id); }}
                        style={{ marginTop: 2 }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: item.completado ? T.ink3 : T.ink, textDecoration: item.completado ? 'line-through' : 'none' }}>
                          {item.texto}
                        </div>
                        {item.completado && item.completadoAt && (
                          <div style={{ fontSize: 9.5, color: T.ink3, marginTop: 2, fontFamily: T.fontMono }}>
                            ✓ {usuarios.find(u => u.id === item.completadoPor)?.nombre || 'Alguien'} · {fmtDatetime(item.completadoAt)}
                          </div>
                        )}
                      </div>
                      {puedeBorrar && (
                        <span
                          onClick={() => esNueva ? quitarItemDraft(idx) : removeItem(tareaId, itemId)}
                          style={{ cursor: 'pointer', color: T.ink3, fontSize: 14, padding: '0 4px' }}
                          title="Quitar item"
                        >
                          ×
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {puedeEditarCampos && (
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <input
                  value={nuevoItemTexto}
                  onChange={e => setNuevoItemTexto(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      esNueva ? agregarItemDraft() : agregarItemDirecto();
                    }
                  }}
                  placeholder="+ Agregar item al checklist"
                  style={{ ...inputSt, fontSize: 11.5 }}
                />
                <Btn sm onClick={esNueva ? agregarItemDraft : agregarItemDirecto}>Agregar</Btn>
              </div>
            )}
          </div>

          {/* Comentarios (solo en modo existente) */}
          {!esNueva && (
            <div>
              <label style={labelSt}>Comentarios</label>
              {(tareaActual?.comentarios || []).length === 0 ? (
                <div style={{ fontSize: 11, color: T.ink3, fontStyle: 'italic', padding: '4px 0' }}>
                  Sin comentarios todavía.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(tareaActual.comentarios || []).map(c => {
                    const user = usuarios.find(u => u.id === c.userId);
                    return (
                      <div key={c.id} style={{ background: '#fbf9f1', border: `1px solid ${T.faint2}`, borderRadius: 4, padding: '6px 10px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: T.ink3, fontFamily: T.fontMono, marginBottom: 3 }}>
                          <span style={{ fontWeight: 700 }}>{user?.nombre || 'Alguien'}</span>
                          <span>{fmtDatetime(c.creadoAt)}</span>
                        </div>
                        <div style={{ fontSize: 12, color: T.ink, whiteSpace: 'pre-wrap' }}>{c.texto}</div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <input
                  value={nuevoComentario}
                  onChange={e => setNuevoComentario(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); agregarComentario(); } }}
                  placeholder="Escribir comentario…"
                  style={{ ...inputSt, fontSize: 11.5 }}
                />
                <Btn sm onClick={agregarComentario}>Enviar</Btn>
              </div>
            </div>
          )}

          {/* Meta info */}
          {!esNueva && tareaActual && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5, color: T.ink3, fontFamily: T.fontMono, paddingTop: 6, borderTop: `1px dashed ${T.faint2}` }}>
              <span>Creada por {usuarios.find(u => u.id === tareaActual.creadoPor)?.nombre || '—'} · {fmtDatetime(tareaActual.creadoAt)}</span>
              {tareaActual.completadoAt && <span style={{ color: T.ok }}>Completada · {fmtDatetime(tareaActual.completadoAt)}</span>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 18px', borderTop: `1.5px solid ${T.faint2}`, display: 'flex', justifyContent: 'space-between', gap: 8, flexShrink: 0, background: T.paper }}>
          <div>
            {!esNueva && puedeEditarCampos && (
              <Btn sm onClick={eliminar} style={{ color: '#dc2626', borderColor: '#dc2626' }}>
                Eliminar
              </Btn>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn sm onClick={onClose}>{puedeEditarCampos ? 'Cancelar' : 'Cerrar'}</Btn>
            {puedeEditarCampos && (
              <Btn sm accent onClick={guardar} disabled={!titulo.trim()}>
                {esNueva ? 'Crear tarea' : 'Guardar cambios'}
              </Btn>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
