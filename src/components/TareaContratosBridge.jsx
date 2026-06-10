import { useEffect, useRef } from 'react';
import { useObras } from '../store/ObrasContext';
import { useTareas } from '../store/TareasContext';
import { useUsuarios } from '../store/UsuariosContext';
import { obraConfirmada } from '../pages/obra/helpers';

// Disparador automático: al CONFIRMAR una obra (pasa a 'activa' / venta.etapa
// 'ganado' — el mismo evento que emite la alerta 'obra_iniciada' en
// ObrasContext, sin importar el camino: confirmar a mano, ganar en el embudo,
// aprobar presupuesto o auto-confirmar al recibir el primer pago), crea UNA
// tarea para Administración: "Armar contratos de los contratistas".
//
// Es un barrido (no un hook imperativo) — como VentaSync — porque así cubre
// TODOS los caminos de confirmación con un solo punto, y porque ObrasProvider
// es OUTER respecto de Tareas/Usuarios: desde dentro de ObrasContext no se puede
// llamar addTarea ni leer la lista de usuarios. Este puente vive dentro de los
// tres providers (montado junto a VentaSync, en el área autenticada).
//
// IDEMPOTENTE en tres capas:
//  1. Flag durable detalle.tareaContratosCreada (persiste entre sesiones/equipos).
//  2. Chequeo defensivo contra tareas existentes (obraId + origen 'auto-contratos'),
//     por si el flag no llegó a guardarse pero la tarea sí.
//  3. Set en memoria (sesión) para no re-disparar mientras el state propaga.
const ORIGEN = 'auto-contratos';

export default function TareaContratosBridge() {
  const { obras, detalles, patchDetalle, dataReady } = useObras();
  const tareasCtx = useTareas();
  const { usuarios, currentUser } = useUsuarios();
  const enProceso = useRef(new Set());

  useEffect(() => {
    // GATE anti race: no barrer 'obras' hasta que las obras REALES estén
    // cargadas de Supabase. Antes de dataReady, 'obras' es el seed/localStorage
    // (obras DEMO confirmadas) y este barrido escribía tareas basura + disparaba
    // markUserEdit, dejando al usuario pegado en las obras demo.
    if (!dataReady) return;
    if (!tareasCtx) return;
    const { tareas, addTarea } = tareasCtx;
    if (!Array.isArray(usuarios) || usuarios.length === 0) return; // sin usuarios aún (carga)

    for (const o of obras) {
      if (enProceso.current.has(o.id)) continue;
      if (!obraConfirmada(o)) continue; // solo obras confirmadas (activa/finalizada)

      const det = detalles[o.id];
      // Flag durable: ya se creó la tarea para esta obra.
      if (det?.tareaContratosCreada) continue;
      // Chequeo defensivo: ¿ya existe la tarea (aunque el flag no haya quedado)?
      const yaExiste = (tareas || []).some(t => t.obraId === o.id && t.origen === ORIGEN);
      if (yaExiste) {
        // Reponer el flag para no volver a escanear y para abaratar el sweep.
        if (det && !det.tareaContratosCreada) patchDetalle(o.id, d => ({ ...d, tareaContratosCreada: true }));
        enProceso.current.add(o.id);
        continue;
      }

      // Destinatarios: todos los usuarios con rol 'Administración'. Si no hay
      // ninguno, queda sin asignar (igual aparece en /tareas y la ve el Admin).
      const adminUserIds = usuarios.filter(u => u.rol === 'Administración').map(u => u.id);

      enProceso.current.add(o.id);
      addTarea({
        titulo: `Armar contratos de los contratistas — ${o.nombre}`,
        descripcion: 'Confeccionar los contratos PADIC de cada contratista (carta oferta, aceptación, nómina, plan de trabajo, locación de obra/servicios) y cargar las pólizas de seguro. Se abre en la pestaña "Contratos MO" de la obra.',
        asignadoA: adminUserIds,
        creadoPor: currentUser?.id || (adminUserIds[0] ?? null),
        obraId: o.id,
        prioridad: 'alta',
        origen: ORIGEN,
        origenRef: o.id,
      });
      // Sellar el flag durable (idempotencia entre sesiones/equipos).
      patchDetalle(o.id, d => ({ ...d, tareaContratosCreada: true }));
    }
  }, [dataReady, obras, detalles, tareasCtx, usuarios, currentUser, patchDetalle]);

  return null;
}
