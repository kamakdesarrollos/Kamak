import { createContext, useContext, useCallback, useMemo } from 'react';
import useSyncedSharedData from '../lib/useSyncedSharedData';
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
  const [tareas, setTareas] = useSyncedSharedData('tareas', [], {
    lsKey: 'kamak_tareas_v1',
    skipMarkReady: true,
  });

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
    return nueva.id;
  }, [setTareas]);

  const updateTarea = useCallback((id, changes) => {
    setTareas(prev => prev.map(t => {
      if (t.id !== id) return t;
      const updated = { ...t, ...changes, actualizadoAt: new Date().toISOString() };
      updated.estado = calcEstadoTarea(updated);
      if (updated.estado === 'completada' && !updated.completadoAt) {
        updated.completadoAt = new Date().toISOString();
      }
      return updated;
    }));
  }, [setTareas]);

  const deleteTarea = useCallback((id) => {
    setTareas(prev => prev.filter(t => t.id !== id));
  }, [setTareas]);

  // ── Checklist items ─────────────────────────────────────────────────────────

  const toggleItem = useCallback((tareaId, itemId, userId) => {
    setTareas(prev => prev.map(t => {
      if (t.id !== tareaId) return t;
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
    }));
  }, [setTareas]);

  const addItem = useCallback((tareaId, texto) => {
    setTareas(prev => prev.map(t => {
      if (t.id !== tareaId) return t;
      const nuevo = { id: newId('item'), texto, completado: false, completadoPor: null, completadoAt: null };
      const updated = {
        ...t,
        checklist: [...(t.checklist || []), nuevo],
        actualizadoAt: new Date().toISOString(),
      };
      updated.estado = calcEstadoTarea(updated);
      return updated;
    }));
  }, [setTareas]);

  const removeItem = useCallback((tareaId, itemId) => {
    setTareas(prev => prev.map(t => {
      if (t.id !== tareaId) return t;
      const updated = {
        ...t,
        checklist: (t.checklist || []).filter(it => it.id !== itemId),
        actualizadoAt: new Date().toISOString(),
      };
      updated.estado = calcEstadoTarea(updated);
      return updated;
    }));
  }, [setTareas]);

  // Observación/nota libre por ítem del checklist (no afecta el estado).
  const setItemObservacion = useCallback((tareaId, itemId, observacion) => {
    setTareas(prev => prev.map(t => {
      if (t.id !== tareaId) return t;
      return {
        ...t,
        checklist: (t.checklist || []).map(it => it.id === itemId ? { ...it, observacion } : it),
        actualizadoAt: new Date().toISOString(),
      };
    }));
  }, [setTareas]);

  // Responsable de un ítem del checklist (userId o null). Permite repartir los
  // ítems de una tarea grupal entre distintas personas. No afecta el estado.
  const setItemAsignado = useCallback((tareaId, itemId, userId) => {
    setTareas(prev => prev.map(t => {
      if (t.id !== tareaId) return t;
      return {
        ...t,
        checklist: (t.checklist || []).map(it => it.id === itemId ? { ...it, asignadoA: userId || null } : it),
        actualizadoAt: new Date().toISOString(),
      };
    }));
  }, [setTareas]);

  // ── Adjuntos (documentos / fotos de la tarea) ───────────────────────────────
  // Se suben al bucket kamak-fotos (path tareas/<id>/...). Acá solo guardamos
  // la referencia { id, nombre, url, tipo, subidoPor, creadoAt }.
  const addAdjunto = useCallback((tareaId, adjunto) => {
    setTareas(prev => prev.map(t => t.id !== tareaId ? t : {
      ...t,
      adjuntos: [...(t.adjuntos || []), { id: newId('adj'), creadoAt: new Date().toISOString(), ...adjunto }],
      actualizadoAt: new Date().toISOString(),
    }));
  }, [setTareas]);

  const removeAdjunto = useCallback((tareaId, adjuntoId) => {
    setTareas(prev => prev.map(t => t.id !== tareaId ? t : {
      ...t,
      adjuntos: (t.adjuntos || []).filter(a => a.id !== adjuntoId),
      actualizadoAt: new Date().toISOString(),
    }));
  }, [setTareas]);

  // ── Comentarios ────────────────────────────────────────────────────────────

  const addComentario = useCallback((tareaId, userId, texto) => {
    setTareas(prev => prev.map(t => {
      if (t.id !== tareaId) return t;
      return {
        ...t,
        comentarios: [
          ...(t.comentarios || []),
          { id: newId('com'), userId, texto, creadoAt: new Date().toISOString() },
        ],
        actualizadoAt: new Date().toISOString(),
      };
    }));
  }, [setTareas]);

  // ── Notificación: marcar como vista ────────────────────────────────────────

  const marcarVista = useCallback((tareaId, userId) => {
    setTareas(prev => prev.map(t => {
      if (t.id !== tareaId) return t;
      const vistaPor = t.vistaPor || [];
      if (vistaPor.includes(userId)) return t;
      return { ...t, vistaPor: [...vistaPor, userId] };
    }));
  }, [setTareas]);

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
