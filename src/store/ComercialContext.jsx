import { createContext, useContext, useCallback, useMemo, useRef, useEffect } from 'react';
import useSyncedSharedData from '../lib/useSyncedSharedData';
import { appendItemInSharedArray, patchItemInSharedArray, removeItemInSharedArray } from '../lib/dbHelpers';
import { newId } from '../lib/id';

const CTX = createContext(null);

// Timeline de actividades del CRM (spec §4.3). Blob 'crm_actividades' atómico:
// el bot también escribe actividades (cambio_etapa/portal_abierto/firma) desde el
// server, así que atomic:true evita que el save del blob entero las pise (LWW).
export function ComercialProvider({ children }) {
  const [actividades, setActividades] = useSyncedSharedData('crm_actividades', [], {
    lsKey: 'kamak_crm_actividades_v1',
    skipMarkReady: true,
    atomic: true,
  });

  const ref = useRef(actividades);
  useEffect(() => { ref.current = actividades; }, [actividades]);

  const aplicarActividad = useCallback((id, transform) => {
    const cur = ref.current.find(a => a.id === id);
    if (!cur) return;
    const updated = transform(cur);
    setActividades(prev => prev.map(a => a.id === id ? updated : a));
    patchItemInSharedArray('crm_actividades', id, updated);
  }, [setActividades]);

  const addActividad = useCallback((data) => {
    const now = new Date().toISOString();
    const nueva = {
      id: newId('act'),
      clienteId: data.clienteId || null,
      obraId: data.obraId || null,
      tipo: data.tipo || 'nota',          // llamada|mail|reunion|whatsapp|nota|propuesta_enviada|cambio_etapa|portal_abierto|firma
      texto: data.texto || '',
      fecha: data.fecha || now,
      usuario: data.usuario || null,      // userId | 'sistema' | 'bot'
      adjuntos: Array.isArray(data.adjuntos) ? data.adjuntos : [],
      creadoAt: now,
      actualizadoAt: now,
    };
    setActividades(prev => [nueva, ...prev]);
    appendItemInSharedArray('crm_actividades', nueva);
    return nueva.id;
  }, [setActividades]);

  const updateActividad = useCallback((id, changes) => {
    aplicarActividad(id, a => ({ ...a, ...changes, actualizadoAt: new Date().toISOString() }));
  }, [aplicarActividad]);

  const deleteActividad = useCallback((id) => {
    setActividades(prev => prev.filter(a => a.id !== id));
    removeItemInSharedArray('crm_actividades', id);
  }, [setActividades]);

  const value = useMemo(
    () => ({ actividades, addActividad, updateActividad, deleteActividad }),
    [actividades, addActividad, updateActividad, deleteActividad]
  );
  return <CTX.Provider value={value}>{children}</CTX.Provider>;
}

// Tolerante a estar fuera del provider (rutas públicas): devuelve defaults no-op.
export function useComercial() {
  return useContext(CTX) ?? { actividades: [], addActividad: () => {}, updateActividad: () => {}, deleteActividad: () => {} };
}
