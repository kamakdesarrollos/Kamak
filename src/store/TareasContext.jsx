import { createContext, useContext, useCallback, useMemo, useRef, useEffect } from 'react';
import useSyncedSharedData from '../lib/useSyncedSharedData';
import { appendItemInSharedArray, patchItemInSharedArray, removeItemInSharedArray } from '../lib/dbHelpers';
import { newId } from '../lib/id';

// Tareas con checklist asignables entre usuarios.
//
// Decisiones de diseño:
// - El estado de la tarea es DERIVADO del checklist: 0 items completos →
//   pendiente; algunos → en_progreso; todos → completada. No se setea a mano
//   (excepto cancelada, que sí es manual). Esto evita inconsistencias entre
//   estado y items.
// - asignadoA es un ARRAY de userId — una tarea puede estar asignada a
//   varios usuarios (ej. todo el equipo de obra).
// - obraId es OPCIONAL: tareas administrativas pueden no tener obra.
// - vistaPor[] guarda los userId que ya vieron la tarea; sirve para mostrar
//   "nueva" en la notificación in-app.

const CTX = createContext(null);

// Calcula el estado de una tarea según sus items del checklist.
// Si no hay items, queda pendiente (es la tarea misma la pendiente).
const calcEstadoTarea = (tarea) => {
  if (tarea.estado === 'cancelada') return 'cancelada';
  const items = tarea.checklist || [];
  if (items.length === 0) return tarea.estado === 'completada' ? 'completada' : 'pendiente';
  const completos = items.filter(i => i.completado).length;
  if (completos === 0) return 'pendiente';
  if (completos === items.length) return 'completada';
  return 'en_progreso';
};

export function TareasProvider({ children }) {
  // atomic: escritura por ítem. El bot crea/actualiza tareas atómico; sin esto
  // el save del blob entero de la app pisaba la tarea nueva o el avance del bot
  // (tareas LWW del audit).
  const [tareas, setTareas] = useSyncedSharedData('tareas', [], {
    lsKey: 'kamak_tareas_v1',
    skipMarkReady: true,
    atomic: true,
  });

  const tareasRef = useRef(tareas);
  useEffect(() => { tareasRef.current = tareas; }, [tareas]);

  // aplicarTarea: computa la tarea nueva desde el estado actual (ref), hace el
  // setState optimista y persiste SOLO esa tarea atómica (patchItemInSharedArray
  // con la tarea entera como patch → reemplaza sus campos, sin tocar las demás).
  const aplicarTarea = useCallback((tareaId, transform) => {
    const cur = tareasRef.current.find(t => t.id === tareaId);
    if (!cur) return;
    const updated = transform(cur);
    setTareas(prev => prev.map(t => t.id === tareaId ? updated : t));
    patchItemInSharedArray('tareas', tareaId, updated);
  }, [setTareas]);

  // ── CRUD ────────────────────────────────────────────────────────────────────

  const addTarea = useCallback((data) => {
    const nueva = {
      id: newId('tarea'),
      titulo: data.titulo || '',
      descripcion: data.descripcion || '',
      asignadoA: Array.isArray(data.asignadoA) ? data.asignadoA : (data.asignadoA ? [data.asignadoA] : []),
      creadoPor: data.creadoPor,
      obraId: data.obraId || null,
      estado: 'pendiente',
      prioridad: data.prioridad || 'media',
      fechaLimite: data.fechaLimite || null,
      // origen: 'manual' (creada a mano), 'auto-rubro' (auto al aprobar
      // presupuesto, viene de rubro.tareasEstandar) o 'auto-tipo' (viene
      // de tipoObra.tareasBase). Sirve para mostrar chip "AUTO" + filtrar.
      origen: data.origen || 'manual',
      // origenRef: id del rubro o tipoObra que la generó (para evitar
      // duplicados al re-sincronizar y para mostrar la fuente al hover).
      origenRef: data.origenRef || null,
      checklist: (data.checklist || []).map(it => ({
        id: newId('item'),
        texto: it.texto,
        completado: false,
        completadoPor: null,
        completadoAt: null,
      })),
      comentarios: [],
      vistaPor: data.creadoPor ? [data.creadoPor] : [],
      creadoAt: new Date().toISOString(),
      actualizadoAt: new Date().toISOString(),
      completadoAt: null,
    };
    setTareas(prev => [nueva, ...prev]);
    appendItemInSharedArray('tareas', nueva);
    return nueva.id;
  }, [setTareas]);

  const updateTarea = useCallback((id, changes) => {
    aplicarTarea(id, t => {
      const updated = { ...t, ...changes, actualizadoAt: new Date().toISOString() };
      updated.estado = calcEstadoTarea(updated);
      if (updated.estado === 'completada' && !updated.completadoAt) {
        updated.completadoAt = new Date().toISOString();
      }
      return updated;
    });
  }, [aplicarTarea]);

  const deleteTarea = useCallback((id) => {
    setTareas(prev => prev.filter(t => t.id !== id));
    removeItemInSharedArray('tareas', id);
  }, [setTareas]);

  // ── Checklist items ─────────────────────────────────────────────────────────

  const toggleItem = useCallback((tareaId, itemId, userId) => {
    aplicarTarea(tareaId, t => {
      const checklist = (t.checklist || []).map(it => {
        if (it.id !== itemId) return it;
        const completado = !it.completado;
        return {
          ...it,
          completado,
          completadoPor: completado ? userId : null,
          completadoAt: completado ? new Date().toISOString() : null,
        };
      });
      const updated = { ...t, checklist, actualizadoAt: new Date().toISOString() };
      updated.estado = calcEstadoTarea(updated);
      if (updated.estado === 'completada' && !updated.completadoAt) {
        updated.completadoAt = new Date().toISOString();
      } else if (updated.estado !== 'completada') {
        updated.completadoAt = null;
      }
      return updated;
    });
  }, [aplicarTarea]);

  const addItem = useCallback((tareaId, texto) => {
    aplicarTarea(tareaId, t => {
      const nuevo = { id: newId('item'), texto, completado: false, completadoPor: null, completadoAt: null };
      const updated = {
        ...t,
        checklist: [...(t.checklist || []), nuevo],
        actualizadoAt: new Date().toISOString(),
      };
      updated.estado = calcEstadoTarea(updated);
      return updated;
    });
  }, [aplicarTarea]);

  const removeItem = useCallback((tareaId, itemId) => {
    aplicarTarea(tareaId, t => {
      const updated = {
        ...t,
        checklist: (t.checklist || []).filter(it => it.id !== itemId),
        actualizadoAt: new Date().toISOString(),
      };
      updated.estado = calcEstadoTarea(updated);
      return updated;
    });
  }, [aplicarTarea]);

  // Observación/nota libre por ítem del checklist (no afecta el estado).
  const setItemObservacion = useCallback((tareaId, itemId, observacion) => {
    aplicarTarea(tareaId, t => ({
      ...t,
      checklist: (t.checklist || []).map(it => it.id === itemId ? { ...it, observacion } : it),
      actualizadoAt: new Date().toISOString(),
    }));
  }, [aplicarTarea]);

  // Responsable de un ítem del checklist (userId o null). Permite repartir los
  // ítems de una tarea grupal entre distintas personas. No afecta el estado.
  const setItemAsignado = useCallback((tareaId, itemId, userId) => {
    aplicarTarea(tareaId, t => ({
      ...t,
      checklist: (t.checklist || []).map(it => it.id === itemId ? { ...it, asignadoA: userId || null } : it),
      actualizadoAt: new Date().toISOString(),
    }));
  }, [aplicarTarea]);

  // ── Adjuntos (documentos / fotos de la tarea) ───────────────────────────────
  // Se suben al bucket kamak-fotos (path tareas/<id>/...). Acá solo guardamos
  // la referencia { id, nombre, url, tipo, subidoPor, creadoAt }.
  const addAdjunto = useCallback((tareaId, adjunto) => {
    aplicarTarea(tareaId, t => ({
      ...t,
      adjuntos: [...(t.adjuntos || []), { id: newId('adj'), creadoAt: new Date().toISOString(), ...adjunto }],
      actualizadoAt: new Date().toISOString(),
    }));
  }, [aplicarTarea]);

  const removeAdjunto = useCallback((tareaId, adjuntoId) => {
    aplicarTarea(tareaId, t => ({
      ...t,
      adjuntos: (t.adjuntos || []).filter(a => a.id !== adjuntoId),
      actualizadoAt: new Date().toISOString(),
    }));
  }, [aplicarTarea]);

  // ── Comentarios ────────────────────────────────────────────────────────────

  const addComentario = useCallback((tareaId, userId, texto) => {
    aplicarTarea(tareaId, t => ({
      ...t,
      comentarios: [
        ...(t.comentarios || []),
        { id: newId('com'), userId, texto, creadoAt: new Date().toISOString() },
      ],
      actualizadoAt: new Date().toISOString(),
    }));
  }, [aplicarTarea]);

  // ── Notificación: marcar como vista ────────────────────────────────────────

  const marcarVista = useCallback((tareaId, userId) => {
    const cur = tareasRef.current.find(t => t.id === tareaId);
    if (!cur || (cur.vistaPor || []).includes(userId)) return; // ya vista: sin write
    aplicarTarea(tareaId, t => ({ ...t, vistaPor: [...(t.vistaPor || []), userId] }));
  }, [aplicarTarea]);

  const value = useMemo(
    () => ({
      tareas,
      addTarea,
      updateTarea,
      deleteTarea,
      toggleItem,
      addItem,
      removeItem,
      setItemObservacion,
      setItemAsignado,
      addAdjunto,
      removeAdjunto,
      addComentario,
      marcarVista,
    }),
    [tareas, addTarea, updateTarea, deleteTarea, toggleItem, addItem, removeItem, setItemObservacion, setItemAsignado, addAdjunto, removeAdjunto, addComentario, marcarVista]
  );

  return <CTX.Provider value={value}>{children}</CTX.Provider>;
}

export const useTareas = () => useContext(CTX);

// Helpers públicos para que páginas/componentes calculen lo mismo sin duplicar
// la regla del estado derivado.
export { calcEstadoTarea };
