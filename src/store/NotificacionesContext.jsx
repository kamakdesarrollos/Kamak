import { createContext, useContext, useCallback, useMemo, useRef, useEffect } from 'react';
import useSyncedSharedData from '../lib/useSyncedSharedData';
import { appendItemInSharedArray, patchItemInSharedArray } from '../lib/dbHelpers';
import { newId } from '../lib/id';
import { supabase } from '../lib/supabase';
import { EVENTOS, resolverDestinatarios, noLeidaPara } from '../lib/notificaciones';
import { useUsuarios } from './UsuariosContext';

// En este codebase `currentUser` (con .id y .rol) y la lista `usuarios` salen
// AMBOS de UsuariosContext — no de AuthContext (useAuth expone `user`, el user
// de Supabase, no el usuario de app). Por eso consumimos solo useUsuarios.
//
// 'notificaciones' es un blob GLOBAL compartido por todos los usuarios → se
// persiste ATÓMICO por ítem (atomic:true + append/patch), igual que Alertas y
// Comercial, para que dos usuarios escribiendo casi a la vez no se pisen el blob
// entero (last-write-wins) y se pierdan notifs o marcas de leído.

const CTX = createContext(null);

export function NotificacionesProvider({ children }) {
  const [notificaciones, setNotificaciones] = useSyncedSharedData('notificaciones', [], {
    lsKey: 'kamak_notificaciones_v1',
    skipMarkReady: true,
    atomic: true,
  });
  const { usuarios, currentUser } = useUsuarios() ?? { usuarios: [], currentUser: null };
  const myId = currentUser?.id || null;

  const ref = useRef(notificaciones);
  useEffect(() => { ref.current = notificaciones; }, [notificaciones]);

  const crearNotificacion = useCallback((tipo, datos = {}) => {
    const cfg = EVENTOS[tipo];
    if (!cfg) { console.warn('[notif] tipo desconocido', tipo); return; }
    const destino = { roles: cfg.roles, userIds: datos.userIds || [] };
    const rolesDestino = cfg.roles;
    const titulo = cfg.titulo(datos);
    const cuerpo = datos.cuerpo || '';
    const link = datos.link || cfg.link;
    const notif = {
      id: newId('ntf'), tipo, titulo, cuerpo, link,
      rolesDestino, userIds: datos.userIds || [],
      actorId: myId, creadoAt: new Date().toISOString(), leidaPor: [],
    };
    setNotificaciones(prev => [notif, ...prev]);
    appendItemInSharedArray('notificaciones', notif);   // persistencia atómica (no pisa el blob)
    try {
      const userIds = resolverDestinatarios(destino, usuarios, myId);
      if (userIds.length) {
        supabase.auth.getSession().then(({ data }) => {
          fetch('/api/whatsapp/jobs?job=push', {
            method: 'POST',
            headers: { 'content-type': 'application/json', Authorization: `Bearer ${data?.session?.access_token || ''}` },
            body: JSON.stringify({ userIds, titulo, cuerpo, link }),
          }).catch(() => {});
        });
      }
    } catch (e) { console.warn('[notif] push falló (no crítico)', e?.message); }
  }, [setNotificaciones, usuarios, myId]);

  const marcarLeida = useCallback((id) => {
    if (!myId) return;
    const cur = ref.current.find(n => n.id === id);
    if (!cur || !noLeidaPara(cur, myId)) return;
    const updated = { ...cur, leidaPor: [...(cur.leidaPor || []), myId] };
    setNotificaciones(prev => prev.map(n => n.id === id ? updated : n));
    patchItemInSharedArray('notificaciones', id, updated);
  }, [setNotificaciones, myId]);

  const marcarTodasLeidas = useCallback(() => {
    if (!myId) return;
    const pendientes = ref.current.filter(n => noLeidaPara(n, myId));
    if (!pendientes.length) return;
    setNotificaciones(prev => prev.map(n => noLeidaPara(n, myId) ? { ...n, leidaPor: [...(n.leidaPor || []), myId] } : n));
    pendientes.forEach(n => patchItemInSharedArray('notificaciones', n.id, { ...n, leidaPor: [...(n.leidaPor || []), myId] }));
  }, [setNotificaciones, myId]);

  const mias = useMemo(() => {
    const rol = currentUser?.rol;
    return (notificaciones || []).filter(n =>
      (n.rolesDestino || []).includes(rol) || (n.userIds || []).includes(myId)
    );
  }, [notificaciones, currentUser?.rol, myId]);

  const noLeidasCount = useMemo(() => mias.filter(n => noLeidaPara(n, myId)).length, [mias, myId]);

  const value = useMemo(
    () => ({ notificaciones: mias, noLeidasCount, crearNotificacion, marcarLeida, marcarTodasLeidas }),
    [mias, noLeidasCount, crearNotificacion, marcarLeida, marcarTodasLeidas]
  );

  return <CTX.Provider value={value}>{children}</CTX.Provider>;
}

export const useNotificaciones = () => useContext(CTX);
